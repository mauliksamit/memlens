/**
 * Static model builder: declarations → MemorySnapshot (protocol v1.0.0).
 *
 * Honesty rules (enforced here, not in the UI):
 * - Exactly one of sizeBytes/sizeSymbolic per block.
 * - Unknown/runtime-dependent sizes are symbolic (`4·n bytes`), never guessed.
 * - Confidence reflects provenance: measured (0.9) > table (0.8) > approx (0.6)
 *   > symbolic (0.5) > unknown (0.4).
 */
import type { Block, FieldLayout, Issue, MemorySnapshot, RecordInfo, Region } from "@memlens/protocol";
import type { AllocSite, ParsedFile, VarDecl } from "./parser.js";
import { builtinTypeInfo, isContainerType, isNumericCount, numericValue, symbolicSize } from "./sizes.js";
import type { ResolvedLayout } from "./layout.js";

export interface BuildOptions {
  uri: string;
  docVersion: number;
  layoutAccurate: boolean;
  layouts: Map<string, ResolvedLayout>;
  partial: boolean;
  note?: string;
}

interface Sized {
  sizeBytes?: number;
  sizeSymbolic?: string;
  confidence: number;
}

export function sizeOfType(type: string, layouts: Map<string, ResolvedLayout>): Sized {
  // array "T[N]"
  const arr = type.match(/^(.*?)\s*\[\s*([^\]]*)\s*\]$/);
  if (arr) {
    const elem = sizeOfType(arr[1].trim(), layouts);
    const countExpr = arr[2].trim();
    if (!countExpr) return { sizeSymbolic: elem.sizeBytes !== undefined ? `${elem.sizeBytes}·n bytes` : `sizeof(${arr[1]})·n`, confidence: 0.5 };
    if (isNumericCount(countExpr)) {
      const n = parseInt(countExpr, 10);
      if (elem.sizeBytes !== undefined) return { sizeBytes: elem.sizeBytes * n, confidence: Math.min(0.9, elem.confidence) };
      return { sizeSymbolic: `sizeof(${arr[1]})·${n}`, confidence: 0.5 };
    }
    if (elem.sizeBytes !== undefined) return { sizeSymbolic: symbolicSize(elem.sizeBytes, countExpr), confidence: 0.5 };
    return { sizeSymbolic: `sizeof(${arr[1]})·(${countExpr})`, confidence: 0.4 };
  }
  const info = builtinTypeInfo(type);
  if (info) {
    const conf = isContainerType(type) ? 0.6 : 0.85;
    return { sizeBytes: info.size, confidence: conf };
  }
  const base = type.replace(/^(const|constexpr|volatile)\s+/, "").split("<")[0].trim();
  const lay = layouts.get(base) ?? layouts.get(type);
  if (lay) return { sizeBytes: lay.totalSize, confidence: 0.9 };
  return { sizeSymbolic: `sizeof(${type})`, confidence: 0.4 };
}

function layoutFor(type: string, layouts: Map<string, ResolvedLayout>): FieldLayout[] | undefined {
  const base = type.replace(/^(const|constexpr|volatile)\s+/, "").split("<")[0].trim().replace(/\s*[*&]\s*$/, "");
  return layouts.get(base)?.fields;
}

/** Per-file snapshot id: short FNV-1a hash of the URI keeps ids unique across files. */
export function snapshotId(uri: string, docVersion: number): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < uri.length; i++) {
    h ^= uri.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `snap-${h.toString(36)}-${docVersion}`;
}

function blockId(region: string, uri: string, line: number, name: string): string {
  const short = uri.split("/").pop() ?? uri;
  return `${region}:${short}:${line + 1}:${name}`;
}

function src(uri: string, line: number, col: number, endCol?: number) {
  return { uri, startLine: line, startCol: Math.max(0, col), endLine: line, endCol: endCol ?? Math.max(0, col) + 1 };
}

export function buildSnapshot(parsed: ParsedFile, text: string, opts: BuildOptions): MemorySnapshot {
  void text;
  const { uri, docVersion } = opts;
  const stackBlocks: Block[] = [];
  const heapBlocks: Block[] = [];
  const globalBlocks: Block[] = [];
  const issues: Issue[] = [];

  const fnEnd = new Map(parsed.functions.map((f) => [f.name, f.endLine]));

  const pushVar = (v: VarDecl, region: "stack" | "global") => {
    // Skip function-pointer-ish / void vars that carry no storage insight.
    if (/^(void)$/.test(v.type.trim())) return;
    const sized = sizeOfType(v.type, opts.layouts);
    const layout = layoutFor(v.type, opts.layouts);
    const end = v.isGlobal ? undefined : fnEnd.get(v.scope);
    const b: Block = {
      id: blockId(region, uri, v.line, v.name),
      name: v.name,
      type: v.type,
      ...(sized.sizeBytes !== undefined ? { sizeBytes: sized.sizeBytes } : { sizeSymbolic: sized.sizeSymbolic ?? `sizeof(${v.type})` }),
      sourceRange: src(uri, v.line, v.col, v.col + v.name.length),
      lifetime: {
        start: v.isGlobal ? "global" : `${v.scope}:${v.line + 1}`,
        ...(end !== undefined ? { end: `${v.scope}:${end + 1}` } : {}),
        scopeBound: !v.isGlobal && !v.isPointer,
      },
      ...(layout ? { layout, totalSizeBytes: sized.sizeBytes, layoutSource: (opts.layoutAccurate ? "compiler" : "fallback") as Block["layoutSource"] } : {}),
      confidence: opts.layoutAccurate ? sized.confidence : Math.min(sized.confidence, 0.6),
      fidelity: "static",
    };
    if (region === "stack") stackBlocks.push(b);
    else globalBlocks.push(b);
  };

  for (const v of parsed.locals) pushVar(v, "stack");
  for (const v of parsed.globals) pushVar(v, "global");

  // --- heap allocs ---
  for (const a of parsed.allocs) {
    const sized = allocSize(a, opts.layouts);
    const layout = layoutFor(a.typeArg, opts.layouts);
    heapBlocks.push({
      id: blockId("heap", uri, a.line, a.varName),
      name: `${a.varName} (${allocLabel(a)})`,
      type: a.kind === "newArray" ? `${a.typeArg}[${a.countExpr}]` : a.typeArg,
      ...(sized.sizeBytes !== undefined ? { sizeBytes: sized.sizeBytes } : { sizeSymbolic: sized.sizeSymbolic ?? "unknown" }),
      sourceRange: src(uri, a.line, a.col, a.col + 3),
      lifetime: { start: `${a.scope}:${a.line + 1}`, scopeBound: a.kind === "make_unique" || a.kind === "make_shared" },
      ...(layout ? { layout, totalSizeBytes: sized.sizeBytes, layoutSource: (opts.layoutAccurate ? "compiler" : "fallback") as Block["layoutSource"] } : {}),
      confidence: sized.confidence,
      fidelity: "static",
    });
  }

  // --- ownership simulation (per function, in line order) ---
  // Track which allocation each pointer variable holds so frees and leaks
  // follow simple copies (`b = a;`, `p = nullptr;`). Path-insensitive.
  const ptrLocals = new Set(parsed.locals.filter((v) => v.isPointer).map((v) => `${v.scope}::${v.name}`));
  const textLines = text.split("\n");
  type Ev = { line: number; order: number; kind: "alloc"; i: number } | { line: number; order: number; kind: "copy"; scope: string; lhs: string; rhs: string } | { line: number; order: number; kind: "free"; f: (typeof parsed.frees)[number] };
  const events: Ev[] = [];
  parsed.allocs.forEach((a, i) => events.push({ line: a.line, order: 1, kind: "alloc", i }));
  parsed.frees.forEach((f) => events.push({ line: f.line, order: 2, kind: "free", f }));
  for (const fn of parsed.functions) {
    for (let ln = fn.startLine; ln <= fn.endLine && ln < textLines.length; ln++) {
      const m = /^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*;/.exec(textLines[ln]);
      if (!m || !ptrLocals.has(`${fn.name}::${m[1]}`)) continue;
      const isNull = m[2] === "nullptr" || m[2] === "NULL";
      if (isNull || ptrLocals.has(`${fn.name}::${m[2]}`)) events.push({ line: ln, order: 0, kind: "copy", scope: fn.name, lhs: m[1], rhs: isNull ? "" : m[2] });
    }
  }
  events.sort((x, y) => x.line - y.line || x.order - y.order);
  const holder = new Map<string, number | null>(); // "scope::var" → alloc index
  const allocFrees: (typeof parsed.frees)[] = parsed.allocs.map(() => []);
  const overwrittenAt: (number | undefined)[] = parsed.allocs.map(() => undefined);
  const movedByRealloc = new Set<number>();
  const loseRef = (key: string, line: number, next: number | null) => {
    const old = holder.get(key);
    if (old === undefined || old === null || old === next) return;
    const stillHeld = [...holder.entries()].some(([k, v]) => k !== key && v === old);
    if (!stillHeld && allocFrees[old].length === 0 && !movedByRealloc.has(old)) overwrittenAt[old] = line;
  };
  for (const ev of events) {
    if (ev.kind === "alloc") {
      const a = parsed.allocs[ev.i];
      const key = `${a.scope}::${a.varName}`;
      const prev = holder.get(key);
      if (a.kind === "realloc" && prev !== undefined && prev !== null) movedByRealloc.add(prev);
      else loseRef(key, a.line, ev.i);
      holder.set(key, ev.i);
    } else if (ev.kind === "copy") {
      const next = ev.rhs ? holder.get(`${ev.scope}::${ev.rhs}`) ?? null : null;
      loseRef(`${ev.scope}::${ev.lhs}`, ev.line, next);
      holder.set(`${ev.scope}::${ev.lhs}`, next);
    } else {
      const held = holder.get(`${ev.f.scope}::${ev.f.varName}`);
      if (held !== undefined && held !== null) allocFrees[held].push(ev.f);
    }
  }

  // Relationships the parser can prove: each pointer local → the allocation
  // it holds at the end of its scope (its own `new`, or one copied into it).
  for (const b of stackBlocks) {
    const scope = b.lifetime.start.split(":")[0];
    const held = holder.get(`${scope}::${b.name}`);
    if (held === undefined || held === null) continue;
    const a = parsed.allocs[held];
    const own = a.varName === b.name;
    b.pointsTo = [{ targetId: blockId("heap", uri, a.line, a.varName), label: own ? "owns" : "points to", kind: own ? "owns" : "points-to", confidence: "inferred", source: "heuristic" }];
  }

  // --- issue heuristics ---
  for (const [ai, a] of parsed.allocs.entries()) {
    const frees = allocFrees[ai];
    if (a.kind === "make_unique" || a.kind === "make_shared") continue; // RAII — no leak
    if (movedByRealloc.has(ai)) continue; // ownership passed to the realloc result
    if (frees.length === 0) {
      const lost = overwrittenAt[ai];
      issues.push({
        kind: "leak",
        severity: "warning",
        sourceRange: src(uri, a.line, a.col, a.col + 3),
        message:
          lost !== undefined
            ? `possible leak: '${a.varName}' (${allocLabel(a)}) is overwritten on line ${lost + 1} before being freed`
            : `possible leak: '${a.varName}' allocated here (${allocLabel(a)}) is never freed on this path`,
        blockId: blockId("heap", uri, a.line, a.varName),
      });
    } else if (frees.length >= 2) {
      issues.push({
        kind: "double-free",
        severity: "error",
        sourceRange: src(uri, frees[1].line, frees[1].col, frees[1].col + 4),
        message: `possible double-free: '${frees[1].varName}' freed more than once`,
        blockId: blockId("heap", uri, a.line, a.varName),
      });
    }
    for (const f of frees) {
      const via = f.varName === a.varName ? `'${a.varName}'` : `'${f.varName}' (holds '${a.varName}' from line ${a.line + 1})`;
      if ((a.kind === "newArray") !== (f.kind === "deleteArray") && (f.kind === "delete" || f.kind === "deleteArray")) {
        issues.push({
          kind: "mismatched-delete",
          severity: "error",
          sourceRange: src(uri, f.line, f.col, f.col + 6),
          message: `mismatched ${a.kind === "newArray" ? "new[]/delete" : "new/delete[]"} for ${via}`,
          blockId: blockId("heap", uri, a.line, a.varName),
        });
      }
      if ((a.kind === "malloc" || a.kind === "calloc" || a.kind === "realloc") && f.kind !== "free") {
        issues.push({
          kind: "mismatched-delete",
          severity: "error",
          sourceRange: src(uri, f.line, f.col, f.col + 6),
          message: `malloc'd pointer ${via} must be freed with free(), not ${f.kind}`,
          blockId: blockId("heap", uri, a.line, a.varName),
        });
      }
    }
    // use-after-free: any textual use of the var after its last free line
    const lastFree = frees.length ? frees[frees.length - 1].line : -1;
    if (lastFree >= 0) {
      const lines = text.split("\n");
      for (let i = lastFree + 1; i < lines.length; i++) {
        // A fresh assignment TO the var (realloc/reuse) ends the hazard; any
        // other mention — including inside another variable's initializer —
        // is a possible use-after-free.
        if (new RegExp(`^\\s*${a.varName}\\s*=`).test(lines[i])) break;
        if (new RegExp(`\\b${a.varName}\\b`).test(lines[i])) {
          issues.push({
            kind: "use-after-free",
            severity: "warning",
            sourceRange: src(uri, i, lines[i].indexOf(a.varName)),
            message: `possible use-after-free: '${a.varName}' used after free`,
            blockId: blockId("heap", uri, a.line, a.varName),
          });
          break;
        }
      }
    }
  }

  // dangling refs: return of address of a local, or returning a local from a
  // pointer/reference-returning function. Plain `return x;` (by value) is fine.
  {
    const lines = text.split("\n");
    const localNames = new Set(parsed.locals.map((l) => `${l.scope}::${l.name}`));
    const ptrFn = new Set(parsed.functions.filter((f) => f.returnsPointer).map((f) => f.name));
    parsed.functions.forEach((fn) => {
      for (let i = fn.startLine; i <= fn.endLine && i < lines.length; i++) {
        const m = lines[i].match(/return\s*(&?)\s*(\w+)\s*;/);
        if (m && localNames.has(`${fn.name}::${m[2]}`) && (m[1] === "&" || ptrFn.has(fn.name))) {
          issues.push({
            kind: "dangling-ref",
            severity: "warning",
            sourceRange: src(uri, i, lines[i].indexOf("return"), lines[i].indexOf("return") + 6),
            message: `possible dangling reference: returning address of local '${m[2]}'`,
          });
        }
      }
    });
  }

  // large padding: needs layouts
  for (const [name, lay] of opts.layouts) {
    const holes = lay.fields.filter((f) => f.paddingAfter >= 8);
    const totalPad = lay.fields.reduce((s, f) => s + f.paddingAfter, 0);
    if ((lay.totalSize > 0 && totalPad / lay.totalSize > 0.25) || holes.length > 0) {
      const rec = parsed.records.find((r) => r.name === name);
      issues.push({
        kind: "large-padding",
        severity: "info",
        sourceRange: src(uri, rec?.line ?? 0, 0, 6),
        message: `struct ${name}: ${totalPad} padding bytes in ${lay.totalSize} total — consider reordering fields`,
      });
    }
  }

  const regions: Region[] = [];
  // group stack blocks by function
  const byFn = new Map<string, Block[]>();
  for (const b of stackBlocks) {
    const fn = b.lifetime.start.split(":")[0];
    if (!byFn.has(fn)) byFn.set(fn, []);
    byFn.get(fn)!.push(b);
  }
  for (const [fn, blocks] of byFn) regions.push({ kind: "stack", label: `stack: ${fn}()`, blocks });
  if (heapBlocks.length > 0) regions.push({ kind: "heap", label: "heap", blocks: heapBlocks });
  if (globalBlocks.length > 0) regions.push({ kind: "global", label: "globals", blocks: globalBlocks });

  const records: RecordInfo[] = parsed.records.map((r) => {
    const lay = opts.layouts.get(r.name);
    return {
      name: r.name,
      kind: r.kind,
      sourceRange: src(uri, r.line, 0, 0),
      endLine: r.endLine,
      fields: r.fields.map((f) => ({ name: f.name, type: f.type, line: f.line })),
      ...(r.hasAccessSpecifiers ? { hasAccessSpecifiers: true } : {}),
      ...(lay
        ? { layout: lay.fields, totalSizeBytes: lay.totalSize, align: lay.align, layoutSource: (opts.layoutAccurate ? "compiler" : "fallback") as RecordInfo["layoutSource"] }
        : {}),
    };
  });

  const stale = opts.partial;
  return {
    id: snapshotId(uri, docVersion),
    uri,
    docVersion,
    fidelity: "static",
    regions,
    issues,
    records,
    layoutAccurate: opts.layoutAccurate,
    timestamp: Date.now(),
    ...(stale ? { stale: true as const, note: opts.note ?? "parse/compile issue — showing last-good-compatible partial model" } : {}),
  };
}

/** C++ spelling of an allocation site, e.g. "new int[5]", "malloc(64)". */
function allocLabel(a: AllocSite): string {
  switch (a.kind) {
    case "new":
      return `new ${a.typeArg}`;
    case "newArray":
      return `new ${a.typeArg}[${a.countExpr}]`;
    case "make_unique":
    case "make_shared":
      return `${a.kind}<${a.typeArg}>`;
    case "calloc":
      return `calloc(${a.countExpr.replace("*", ", ")})`;
    default:
      return `${a.kind}(${a.countExpr})`;
  }
}

function allocSize(a: AllocSite, layouts: Map<string, ResolvedLayout>): Sized {
  switch (a.kind) {
    case "new":
    case "make_unique":
    case "make_shared": {
      const s = sizeOfType(a.typeArg, layouts);
      return s;
    }
    case "newArray": {
      const elem = sizeOfType(a.typeArg, layouts);
      if (isNumericCount(a.countExpr)) {
        const n = parseInt(a.countExpr, 10);
        if (elem.sizeBytes !== undefined) return { sizeBytes: elem.sizeBytes * n, confidence: 0.8 };
        return { sizeSymbolic: `sizeof(${a.typeArg})·${n}`, confidence: 0.5 };
      }
      if (elem.sizeBytes !== undefined) return { sizeSymbolic: symbolicSize(elem.sizeBytes, a.countExpr), confidence: 0.5 };
      return { sizeSymbolic: `sizeof(${a.typeArg})·(${a.countExpr})`, confidence: 0.4 };
    }
    case "malloc":
    case "realloc": {
      const n = numericValue(a.countExpr);
      if (n !== null) return { sizeBytes: n, confidence: 0.8 };
      return { sizeSymbolic: a.countExpr, confidence: 0.5 };
    }
    case "calloc": {
      const parts = a.countExpr.split("*").map((s) => s.trim());
      if (parts.length === 2 && parts.every(isNumericCount)) {
        return { sizeBytes: parseInt(parts[0], 10) * parseInt(parts[1], 10), confidence: 0.8 };
      }
      return { sizeSymbolic: a.countExpr, confidence: 0.5 };
    }
  }
}
