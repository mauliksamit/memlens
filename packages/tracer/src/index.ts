/**
 * TraceRunner: build + run instrumented binary, stream NDJSON events.
 *
 * Safety (NFR): explicit opt-in (`optIn: true` = workspace setting), timeout,
 * output cap, single-file or CMake/Make project support, Linux/macOS
 * first-class, Windows best-effort (falls back to ASan-log parsing when the
 * shim cannot interpose).
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, stat } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { parseTraceLine } from "@memlens/protocol";
import type { Block, Issue, MemoryEvent, MemorySnapshot, SourceRange } from "@memlens/protocol";

const execFileAsync = promisify(execFile);

export interface TraceOptions {
  /** File or project dir to build. */
  filePath: string;
  /** Extra compile flags (defaults honour compile_commands.json). */
  compileArgs?: string[];
  /** Must be true (workspace opt-in) or runTraced throws. */
  optIn?: boolean;
  timeoutMs?: number;
  outputCapBytes?: number;
  /** "auto" | "shim" | "asan" */
  strategy?: "auto" | "shim" | "asan";
  env?: Record<string, string>;
}

export function shimLibraryName(): string {
  return platform() === "darwin" ? "libmemlens_shim.dylib" : "libmemlens_shim.so";
}

export function shimSupported(): { ok: boolean; reason?: string } {
  if (platform() === "win32")
    return { ok: false, reason: "allocator interposition is not supported on Windows; use ASan-log fallback" };
  return { ok: true };
}

export function parseAsanLog(log: string): MemoryEvent[] {
  // Minimal ASan/LSan summary parsing: heap-use-after-free + leaks → synthetic
  // events so the timeline still shows *something* on Windows.
  const events: MemoryEvent[] = [];
  let seq = 0;
  const lines = log.split("\n");
  for (const ln of lines) {
    let m = /ERROR: AddressSanitizer: heap-use-after-free on address (0x[0-9a-fA-F]+)/.exec(ln);
    if (m) events.push({ seq: seq++, kind: "write", addr: m[1], size: 0, thread: "main", stack: [], timestamp: Date.now() });
    m = /SUMMARY: AddressSanitizer: (\d+) byte\(s\) leaked/.exec(ln);
    if (m) events.push({ seq: seq++, kind: "alloc", addr: "0x0", size: parseInt(m[1], 10), thread: "main", stack: [], timestamp: Date.now() });
    m = /LeakSanitizer: detected memory leaks/.exec(ln);
    if (m) events.push({ seq: seq++, kind: "alloc", addr: "0x0", size: 0, thread: "main", stack: [], timestamp: Date.now() });
  }
  return events;
}

/** Detect leaks + double-frees from an event stream (used by the UI and tests). */
export function analyzeEvents(events: MemoryEvent[]): { leaks: MemoryEvent[]; doubleFrees: MemoryEvent[] } {
  const live = new Map<string, MemoryEvent>();
  const freed = new Set<string>();
  const doubleFrees: MemoryEvent[] = [];
  for (const e of events) {
    if (e.kind === "alloc") {
      live.set(e.addr, e);
      freed.delete(e.addr);
    } else if (e.kind === "free") {
      if (!live.has(e.addr) || freed.has(e.addr)) doubleFrees.push(e);
      freed.add(e.addr);
      live.delete(e.addr);
    } else if (e.kind === "realloc") {
      live.set(e.addr, e);
    }
  }
  return { leaks: [...live.values()], doubleFrees };
}

/**
 * Fold a trace into a traced-fidelity snapshot: blocks still live at exit
 * become heap blocks (real addresses), leaks and double-frees become issues.
 */
export function eventsToSnapshot(events: MemoryEvent[], uri: string, docVersion: number, timestamp = Date.now()): MemorySnapshot {
  const { leaks, doubleFrees } = analyzeEvents(events);
  const fallbackRange: SourceRange = { uri, startLine: 0, startCol: 0, endLine: 0, endCol: 1 };
  const rangeOf = (e: MemoryEvent): SourceRange => {
    if (e.sourceRange) return e.sourceRange;
    const f = e.stack.find((fr) => fr.line > 0);
    return f ? { uri, startLine: f.line - 1, startCol: f.col ?? 0, endLine: f.line - 1, endCol: (f.col ?? 0) + 1 } : fallbackRange;
  };
  const blocks: Block[] = leaks
    .filter((e) => e.addr !== "0x0" || e.size > 0)
    .map((e) => ({
      id: `traced:${e.addr}:${e.seq}`,
      name: e.stack[0]?.function ? `${e.stack[0].function} @ ${e.addr}` : e.addr,
      type: "heap allocation",
      sizeBytes: e.size,
      address: e.addr,
      sourceRange: rangeOf(e),
      lifetime: { start: `seq:${e.seq}`, scopeBound: false },
      confidence: 0.95,
      fidelity: "traced" as const,
    }));
  const issues: Issue[] = [
    ...leaks
      .filter((e) => e.size > 0)
      .map((e) => ({
        kind: "leak" as const,
        severity: "warning" as const,
        sourceRange: rangeOf(e),
        message: `leak: ${e.size} B at ${e.addr} still allocated at exit (measured)`,
        blockId: `traced:${e.addr}:${e.seq}`,
      })),
    ...doubleFrees.map((e) => ({
      kind: "double-free" as const,
      severity: "error" as const,
      sourceRange: rangeOf(e),
      message: `double free of ${e.addr} (measured)`,
    })),
  ];
  return {
    id: `snap-traced-${docVersion}-${timestamp.toString(36)}`,
    uri,
    docVersion,
    fidelity: "traced",
    regions: blocks.length ? [{ kind: "heap", label: "heap (live at exit)", blocks }] : [],
    issues,
    timestamp,
    ...(events.length === 0 ? { note: "trace produced no allocation events" } : {}),
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build (single-file g++/clang++ or existing CMake/Make project) and run the
 * binary under the allocator shim, returning parsed MemoryEvents.
 */
export async function runTraced(opts: TraceOptions): Promise<MemoryEvent[]> {
  if (!opts.optIn) throw new Error("traced mode requires explicit per-workspace opt-in (memlens.traceOptIn)");
  const timeoutMs = opts.timeoutMs ?? 30000;
  const cap = opts.outputCapBytes ?? 1 << 20;

  const work = await mkTmp();
  const traceOut = join(work, "events.ndjson");
  const isFile = (await stat(opts.filePath).catch(() => null))?.isFile() ?? false;

  let binary = "";
  let buildLog = "";
  if (isFile) {
    const compiler = process.env["MEMLENS_CXX"] ?? "g++";
    binary = join(work, "app");
    const args = [...(opts.compileArgs ?? ["-std=c++17", "-g", "-O0"]), opts.filePath, "-o", binary];
    try {
      const { stderr } = await execFileAsync(compiler, args, { timeout: timeoutMs });
      buildLog += stderr;
    } catch (e) {
      throw new Error(`traced build failed: ${(e as Error).message}\n${buildLog}`);
    }
  } else {
    // Project dir: prefer existing build, else cmake configure+build.
    const existing = join(opts.filePath, "build", "app");
    if (await fileExists(existing)) binary = existing;
    else {
      const buildDir = join(work, "build");
      await mkdir(buildDir, { recursive: true });
      await execFileAsync("cmake", [opts.filePath, "-DCMAKE_BUILD_TYPE=Debug"], { cwd: buildDir, timeout: timeoutMs });
      await execFileAsync("cmake", ["--build", ".", "-j"], { cwd: buildDir, timeout: timeoutMs });
      binary = join(buildDir, "app");
    }
  }

  const strat: "auto" | "shim" | "asan" = opts.strategy ?? "auto";
  const shimOk = shimSupported().ok;
  const useShim = strat === "shim" || (strat === "auto" && shimOk);
  const wantAsan = strat === "asan";
  if (!useShim || wantAsan) {
    // ASan fallback: rebuild with -fsanitize=address and parse stderr.
    const asanBin = `${binary}.asan`;
    const compiler = process.env["MEMLENS_CXX"] ?? "g++";
    if (isFile) {
      await execFileAsync(compiler, [...(opts.compileArgs ?? ["-std=c++17", "-g"]), "-fsanitize=address", opts.filePath, "-o", asanBin], { timeout: timeoutMs });
      const out = await runBinary(asanBin, {}, timeoutMs, cap);
      return parseAsanLog(out.stderr);
    }
    throw new Error("ASan fallback for project builds is not yet implemented (Windows gap — see README)");
  }

  // Shim run.
  const shim = await locateShim();
  const preloadVar = platform() === "darwin" ? "DYLD_INSERT_LIBRARIES" : "LD_PRELOAD";
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...opts.env,
    MEMLENS_TRACE_OUT: traceOut,
    MEMLENS_SEQ_START: "0",
    [preloadVar]: shim,
  };
  await runBinary(binary, env, timeoutMs, cap);
  const raw = await readFile(traceOut, "utf8").catch(() => "");
  const events: MemoryEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      events.push(parseTraceLine(t));
    } catch {
      /* skip malformed shim lines */
    }
  }
  return events;
}

async function locateShim(): Promise<string> {
  const env = process.env["MEMLENS_SHIM"];
  if (env && (await fileExists(env))) return env;
  throw new Error(
    `allocator shim not found. Build packages/tracer/shim (g++ -shared -fPIC -o ${shimLibraryName()} shim.cpp -ldl) and set MEMLENS_SHIM to its path.`,
  );
}

function runBinary(binary: string, env: Record<string, string>, timeoutMs: number, cap: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { env, timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > cap) child.kill();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > cap) child.kill();
    });
    child.on("error", reject);
    child.on("close", () => resolve({ stdout, stderr }));
  });
}

async function mkTmp(): Promise<string> {
  const dir = join(tmpdir(), `memlens-trace-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
