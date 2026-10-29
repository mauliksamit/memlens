/**
 * Layout engine: compiler-accurate record layouts with content-hash cache.
 *
 * Strategy (ADR-002):
 *  1. Extract record definitions + includes into a minimal TU snapshot.
 *  2. Run `clang -Xclang -fdump-record-layouts -fsyntax-only` (or
 *     `$MEMLENS_CLANG`, `$MEMLENS_COMPILER`) with project flags from
 *     `compile_commands.json` when available.
 *  3. Cache by SHA-256(tuText + flags + compiler id); on failure return the
 *     fallback table computation and `accurate: false`.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FieldLayout } from "@memlens/protocol";
import { builtinTypeInfo } from "./sizes.js";
import type { RecordDecl } from "./parser.js";

const execFileAsync = promisify(execFile);

export interface ResolvedLayout {
  fields: FieldLayout[];
  totalSize: number;
  align: number;
}

export interface LayoutOptions {
  projectDir?: string;
  compileArgs?: string[];
  compilerPath?: string;
  timeoutMs?: number;
  /** Text used for the cache key (default: the TU). See layoutKeyText. */
  cacheKeyText?: string;
}

function hashKey(tuText: string, flags: string[], compiler: string): string {
  return createHash("sha256").update(compiler + "\n" + flags.join(" ") + "\n" + tuText).digest("hex").slice(0, 16);
}

const cache = new Map<string, Map<string, ResolvedLayout>>();

export function clearLayoutCache(): void {
  cache.clear();
}

export function cacheSize(): number {
  return cache.size;
}

/**
 * Fallback table computation. Returns null (honest refusal) for records the
 * table cannot model: bases (needs base sizes + EBO rules), virtual functions
 * or bases (vptr size/placement is ABI-specific), bit-fields, alignas/pack
 * attributes, [[no_unique_address]], nested records (truncated bodies), or
 * members of unknown type (subsequent offsets would be wrong — e.g. P_NoEbo).
 * Unions ARE modeled (all offsets 0).
 * Empty records get sizeof 1 (C++: complete object type has nonzero size).
 */
export function fallbackLayout(rec: RecordDecl): ResolvedLayout | null {
  if (rec.kind === "union") return fallbackUnion(rec);
  if (
    rec.bases.length > 0 ||
    rec.hasVirtualFn ||
    rec.hasVirtualBase ||
    rec.hasBitfields ||
    rec.hasAlignas ||
    rec.hasPacked ||
    rec.hasNoUniqueAddress ||
    rec.hasNested
  ) {
    return null;
  }
  if (rec.fields.length === 0) return { fields: [], totalSize: 1, align: 1 };
  // Classic SysV layout algorithm over the builtin table. Any member whose
  // size is unknowable forces refusal — placing later members would fabricate
  // offsets.
  let offset = 0;
  let maxAlign = 1;
  const fields: FieldLayout[] = [];
  for (const f of rec.fields) {
    // array type "int[10]"
    const arrM = f.type.match(/^(.*?)\s*\[\s*(\d*)\s*\]$/);
    const info = builtinTypeInfo(arrM ? arrM[1] : f.type);
    if (!info) return null; // unknowable member: later offsets would be fabricated
    let count = 1;
    if (arrM && arrM[2]) count = parseInt(arrM[2], 10) || 1;
    const size = info.size * (arrM ? (arrM[2] ? count : 0) : 1);
    const align = info.align;
    maxAlign = Math.max(maxAlign, align);
    const pad = (align - (offset % align)) % align;
    offset += pad;
    const fieldOffset = offset;
    offset += size;
    fields.push({ name: f.name, type: f.type, offset: fieldOffset, size, align, paddingAfter: 0 });
  }
  // tail padding
  const tail = (maxAlign - (offset % maxAlign)) % maxAlign;
  for (let i = 0; i < fields.length; i++) {
    const cur = fields[i];
    const next = fields[i + 1];
    cur.paddingAfter = next ? next.offset - (cur.offset + cur.size) : tail;
  }
  return { fields, totalSize: offset + tail, align: maxAlign };
}

/** Union layout: every member at offset 0; size = max member, aligned up. Null on unknown members. */
function fallbackUnion(rec: RecordDecl): ResolvedLayout | null {
  let maxAlign = 1;
  let maxSize = 0;
  const fields: FieldLayout[] = [];
  for (const f of rec.fields) {
    const arrM = f.type.match(/^(.*?)\s*\[\s*(\d*)\s*\]$/);
    const info = builtinTypeInfo(arrM ? arrM[1] : f.type);
    if (!info) return null; // cannot bound the union without member sizes
    const size = info.size * (arrM && arrM[2] ? parseInt(arrM[2], 10) || 1 : 1);
    maxAlign = Math.max(maxAlign, info.align);
    maxSize = Math.max(maxSize, size);
    fields.push({ name: f.name, type: f.type, offset: 0, size, align: info.align, paddingAfter: 0 });
  }
  if (fields.length === 0) return { fields: [], totalSize: 1, align: 1 };
  const total = maxSize + ((maxAlign - (maxSize % maxAlign)) % maxAlign);
  return { fields, totalSize: total, align: maxAlign };
}

/** Parse clang -fdump-record-layouts stderr/stdout into layouts. */
export function parseClangRecordDump(output: string): Map<string, ResolvedLayout> {
  const out = new Map<string, ResolvedLayout>();
  // Example:
  // *** Dumping AST Record Layout
  //          0 | struct Derived
  //          0 |   struct Base (base)
  //          0 |     int a
  //          4 |   char c
  //          8 |   struct Inner in
  //          8 |     int x
  //            | [sizeof=12, dsize=12, align=4, ...]
  // Only direct members (one indent level below the header) are fields.
  const lines = output.split("\n");
  let cur: string | null = null;
  let memberIndent = -1;
  let pending: { offset: number; type: string; name: string }[] = [];
  let pendingTotal: number | null = null;
  let pendingAlign: number | null = null;
  const sizeOfMember = (type: string, offset: number, nextOffset: number | undefined, total: number | null) => {
    const info = builtinTypeInfo(type);
    if (info) return info;
    const rec = out.get(type.replace(/^(struct|class|union)\s+/, ""));
    if (rec) return { size: rec.totalSize, align: rec.align };
    // Unknown member type: the compiler's next offset bounds it.
    const end = nextOffset ?? total ?? offset;
    return { size: Math.max(0, end - offset), align: 1 };
  };
  const flush = () => {
    if (cur && (pending.length > 0 || pendingTotal !== null)) {
      let maxAlign = 1;
      const resolved: FieldLayout[] = pending.map((p, i) => {
        const info = sizeOfMember(p.type, p.offset, pending[i + 1]?.offset, pendingTotal);
        maxAlign = Math.max(maxAlign, info.align);
        return { name: p.name, type: p.type, offset: p.offset, size: info.size, align: info.align, paddingAfter: 0 };
      });
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const n = resolved[i + 1];
        r.paddingAfter = n ? Math.max(0, n.offset - (r.offset + r.size)) : 0;
      }
      const last = resolved[resolved.length - 1];
      let total = last ? last.offset + last.size : 0;
      if (pendingTotal !== null) {
        // Compiler-reported sizeof wins; tail padding follows from it.
        if (last) last.paddingAfter = Math.max(0, pendingTotal - (last.offset + last.size));
        total = pendingTotal;
        if (pendingAlign !== null) maxAlign = pendingAlign;
      }
      if (!out.has(cur)) out.set(cur, { fields: resolved, totalSize: total, align: maxAlign });
    }
    cur = null;
    memberIndent = -1;
    pending = [];
    pendingTotal = null;
    pendingAlign = null;
  };
  for (const rawLine of lines) {
    // Clang tags empty records/members: "struct E (empty)", "struct E e (empty)".
    const ln = rawLine.replace(/\s+\(empty\)\s*$/, "");
    if (/\*\*\* Dumping AST Record Layout/.test(ln)) {
      flush();
      continue;
    }
    const recM = /^\s*\d+\s*\|(\s*)(struct|class|union)\s+(\w+)\s*$/.exec(ln);
    if (recM && cur === null) {
      cur = recM[3];
      memberIndent = recM[1].length + 2;
      continue;
    }
    const sizeM = /\[\s*sizeof\s*=\s*(\d+)\s*,.*?\balign\s*=\s*(\d+)/.exec(ln);
    if (sizeM && cur) {
      pendingTotal = parseInt(sizeM[1], 10);
      pendingAlign = parseInt(sizeM[2], 10);
      flush();
      continue;
    }
    const fM = /^\s*(\d+)\s*\|(\s+)(\S(?:.*\S)?)\s+(\w+)\s*$/.exec(ln);
    if (fM && cur && fM[2].length === memberIndent) {
      const type = fM[3];
      if (/\((base|virtual base)\)$/.test(type) || type.startsWith("(")) continue;
      pending.push({ offset: parseInt(fM[1], 10), type, name: fM[4] });
    }
  }
  flush();
  return out;
}

/**
 * Translation unit handed to clang: the real file (so bases, virtual members,
 * alignas, bit-fields, typedefs and constants are all exactly as written)
 * plus one `sizeof` per record, which forces clang to lay each one out.
 */
export function buildTuSnapshot(fullText: string, records: RecordDecl[]): string {
  const force = records.map((r, i) => `typedef char memlens_force_layout_${i}[sizeof(${r.name}) ? 1 : 1];`);
  return `${fullText}\n\n// MemLens: force record layouts\n${force.join("\n")}\n`;
}

/** Cache key text: the file without function bodies (editing code inside functions can't change layouts). */
export function layoutKeyText(fullText: string, functions: { startLine: number; endLine: number }[]): string {
  const lines = fullText.split("\n");
  const drop = new Set<number>();
  for (const f of functions) for (let i = f.startLine + 1; i < f.endLine; i++) drop.add(i);
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

export async function discoverCompileArgs(projectDir?: string, fileName = "memlens_tu.cpp"): Promise<string[]> {
  if (!projectDir) return [];
  try {
    const db = JSON.parse(await readFile(join(projectDir, "compile_commands.json"), "utf8")) as Array<{ file: string; arguments?: string[]; command?: string }>;
    const entry = db.find((e) => e.file.endsWith(fileName)) ?? db[0];
    if (!entry) return [];
    if (entry.arguments) return entry.arguments.filter((a) => a.startsWith("-std=") || a.startsWith("-I") || a.startsWith("-D"));
    if (entry.command) return entry.command.split(" ").filter((a) => a.startsWith("-std=") || a.startsWith("-I") || a.startsWith("-D"));
  } catch {
    /* no compilation database — fine */
  }
  return [];
}

export interface LayoutResult {
  layouts: Map<string, ResolvedLayout>;
  accurate: boolean;
  errors: string[];
}

export async function getLayouts(
  fullText: string,
  records: RecordDecl[],
  opts: LayoutOptions = {},
): Promise<LayoutResult> {
  const errors: string[] = [];
  if (records.length === 0) return { layouts: new Map(), accurate: true, errors };
  const tu = buildTuSnapshot(fullText, records);
  const extra = opts.compileArgs ?? (await discoverCompileArgs(opts.projectDir));
  const compiler = opts.compilerPath ?? process.env["MEMLENS_CLANG"] ?? process.env["MEMLENS_COMPILER"] ?? "clang";
  const key = hashKey(opts.cacheKeyText ?? tu, extra, compiler);
  const cached = cache.get(key);
  if (cached) return { layouts: cached, accurate: true, errors };

  // Try the real compiler; time-boxed. Missing binary => fallback (Windows).
  // Code being typed often has errors: clang still dumps every record it
  // could lay out, so parse its output even when it exits non-zero.
  try {
    const dir = await mkTmp();
    const file = join(dir, "memlens_tu.cpp");
    await writeFile(file, tu, "utf8");
    const args = ["-Xclang", "-fdump-record-layouts", "-fsyntax-only", "-ferror-limit=0", "-w", file, ...extra];
    let output = "";
    let failure: Error | null = null;
    try {
      const { stderr, stdout } = await execFileAsync(compiler, args, { timeout: opts.timeoutMs ?? 8000, maxBuffer: 64 * 1024 * 1024 });
      output = `${stdout}\n${stderr}`;
    } catch (e) {
      const ex = e as Error & { stdout?: string; stderr?: string; code?: string | number };
      if (ex.code === "ENOENT" || (!ex.stdout && !ex.stderr)) throw ex;
      output = `${ex.stdout ?? ""}\n${ex.stderr ?? ""}`;
      failure = ex;
    }
    const all = parseClangRecordDump(output);
    const parsed = new Map<string, ResolvedLayout>();
    for (const r of records) {
      const lay = all.get(r.name);
      if (lay) parsed.set(r.name, lay);
    }
    if (parsed.size > 0) {
      if (failure) errors.push(`clang reported errors; ${parsed.size}/${records.length} record layouts recovered`);
      else cache.set(key, parsed);
      return { layouts: parsed, accurate: true, errors };
    }
    errors.push(failure ? `clang could not lay out any record: ${firstError(output)}; using fallback table` : "clang produced no record layouts; using fallback table");
  } catch (e) {
    errors.push(`layout compiler unavailable (${compiler}): ${(e as Error).message.split("\n")[0]}; using fallback table`);
  }

  const fb = new Map<string, ResolvedLayout>();
  for (const r of records) {
    const lay = fallbackLayout(r);
    if (lay) fb.set(r.name, lay);
    // Refused records are simply absent: the model falls back to symbolic
    // sizeof() with low confidence instead of inventing numbers.
  }
  return { layouts: fb, accurate: false, errors };
}

function firstError(output: string): string {
  return output.split("\n").find((l) => /error:/.test(l))?.replace(/^.*?error:\s*/, "").slice(0, 160) ?? "unknown error";
}

async function mkTmp(): Promise<string> {
  const dir = join(tmpdir(), `memlens-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}
