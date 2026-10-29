import {
  PROTOCOL_VERSION,
  type MemorySnapshot,
  type Region,
  type Block,
  type MemoryEvent,
  type SnapshotDiff,
  type Issue,
  type HostToWebviewMessage,
  type WebviewToHostMessage,
  type RpcRequest,
  type RpcResponse,
} from "./index.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numIn(n: unknown, lo: number, hi: number): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= lo && n <= hi;
}

export function validateSourceRange(r: unknown): boolean {
  if (!isObject(r)) return false;
  return (
    typeof r["uri"] === "string" &&
    numIn(r["startLine"], 0, 1e7) &&
    numIn(r["startCol"], 0, 1e6) &&
    numIn(r["endLine"], 0, 1e7) &&
    numIn(r["endCol"], 0, 1e6)
  );
}

export function validateBlock(b: unknown): string[] {
  const errs: string[] = [];
  if (!isObject(b)) return ["block must be object"];
  if (typeof b["id"] !== "string") errs.push("block.id string");
  if (typeof b["name"] !== "string") errs.push("block.name string");
  if (typeof b["type"] !== "string") errs.push("block.type string");
  const hasBytes = typeof b["sizeBytes"] === "number";
  const hasSym = typeof b["sizeSymbolic"] === "string";
  if (hasBytes === hasSym) errs.push("exactly one of sizeBytes|sizeSymbolic");
  if (hasBytes && !(typeof b["sizeBytes"] === "number" && (b["sizeBytes"] as number) >= 0))
    errs.push("sizeBytes >= 0");
  if (!validateSourceRange(b["sourceRange"])) errs.push("sourceRange invalid");
  if (!isObject(b["lifetime"])) errs.push("lifetime object");
  else {
    const l = b["lifetime"] as Record<string, unknown>;
    if (typeof l["start"] !== "string") errs.push("lifetime.start string");
    if (typeof l["scopeBound"] !== "boolean") errs.push("lifetime.scopeBound bool");
  }
  if (!numIn(b["confidence"], 0, 1)) errs.push("confidence 0..1");
  if (!["static", "traced", "debugger"].includes(b["fidelity"] as string))
    errs.push("fidelity enum");
  if (b["layoutSource"] !== undefined && !["compiler", "fallback"].includes(b["layoutSource"] as string))
    errs.push("layoutSource enum");
  if (b["pointsTo"] !== undefined) {
    if (!Array.isArray(b["pointsTo"])) errs.push("pointsTo array");
    else {
      for (const [i, p] of (b["pointsTo"] as unknown[]).entries()) {
        if (!isObject(p) || typeof p["targetId"] !== "string" || p["targetId"].length === 0)
          errs.push(`pointsTo[${i}].targetId string`);
        else {
          if (p["label"] !== undefined && typeof p["label"] !== "string") errs.push(`pointsTo[${i}].label string`);
          if (p["kind"] !== undefined && !["points-to", "owns", "borrows", "references", "aliases", "contains"].includes(p["kind"] as string))
            errs.push(`pointsTo[${i}].kind enum`);
          if (p["confidence"] !== undefined && !["measured", "debugger", "static", "inferred"].includes(p["confidence"] as string))
            errs.push(`pointsTo[${i}].confidence enum`);
          if (p["source"] !== undefined && !["compiler", "runtime", "debugger", "heuristic"].includes(p["source"] as string))
            errs.push(`pointsTo[${i}].source enum`);
        }
      }
    }
  }
  if (b["layout"] !== undefined) {    if (!Array.isArray(b["layout"])) errs.push("layout array");
    else
      for (const [i, f] of (b["layout"] as unknown[]).entries()) {
        if (!isObject(f)) {
          errs.push(`layout[${i}] object`);
          continue;
        }
        for (const k of ["name", "type"]) if (typeof f[k] !== "string") errs.push(`layout[${i}].${k}`);
        for (const k of ["offset", "size", "align", "paddingAfter"])
          if (!numIn(f[k], 0, 1e9)) errs.push(`layout[${i}].${k} >= 0`);
      }
  }
  return errs;
}

export function validateSnapshot(s: unknown): string[] {
  const errs: string[] = [];
  if (!isObject(s)) return ["snapshot must be object"];
  for (const k of ["id", "timestamp"]) {
    if (k === "id" && typeof s[k] !== "string") errs.push("id string");
    if (k === "timestamp" && typeof s[k] !== "number") errs.push("timestamp number");
  }
  if (!numIn(s["docVersion"], 0, 1e9)) errs.push("docVersion >= 0");
  if (!["static", "traced", "debugger"].includes(s["fidelity"] as string)) errs.push("fidelity");
  if (!Array.isArray(s["regions"])) errs.push("regions array");
  else
    for (const [ri, r] of (s["regions"] as unknown[]).entries()) {
      if (!isObject(r)) {
        errs.push(`regions[${ri}] object`);
        continue;
      }
      if (!["stack", "heap", "global", "static"].includes(r["kind"] as string))
        errs.push(`regions[${ri}].kind`);
      if (!Array.isArray(r["blocks"])) errs.push(`regions[${ri}].blocks array`);
      else
        for (const [bi, b] of (r["blocks"] as unknown[]).entries()) {
          const be = validateBlock(b);
          for (const e of be) errs.push(`regions[${ri}].blocks[${bi}]: ${e}`);
        }
    }
  if (!Array.isArray(s["issues"])) errs.push("issues array");
  return errs;
}

export function validateMemoryEvent(e: unknown): string[] {
  const errs: string[] = [];
  if (!isObject(e)) return ["event must be object"];
  if (!["alloc", "free", "realloc", "write"].includes(e["kind"] as string)) errs.push("kind enum");
  if (typeof e["addr"] !== "string" || !/^0x[0-9a-fA-F]+$/.test(e["addr"] as string))
    errs.push("addr hex");
  if (!numIn(e["size"], 0, 2 ** 53)) errs.push("size >= 0");
  if (typeof e["thread"] !== "string") errs.push("thread string");
  if (!Array.isArray(e["stack"])) errs.push("stack array");
  if (!numIn(e["seq"], 0, 2 ** 53)) errs.push("seq >= 0");
  return errs;
}

/** Parse one NDJSON trace line into a MemoryEvent (throws on invalid). */
export function parseTraceLine(line: string): MemoryEvent {
  const obj = JSON.parse(line) as unknown;
  const errs = validateMemoryEvent(obj);
  if (errs.length > 0) throw new Error(`invalid MemoryEvent: ${errs.join("; ")}`);
  return obj as MemoryEvent;
}

export function diffSnapshots(before: MemorySnapshot, after: MemorySnapshot): SnapshotDiff {
  const bMap = new Map<string, Block>();
  const aMap = new Map<string, Block>();
  for (const r of before.regions) for (const b of r.blocks) bMap.set(b.id, b);
  for (const r of after.regions) for (const b of r.blocks) aMap.set(b.id, b);
  const added: Block[] = [];
  const removed: Block[] = [];
  const changed: SnapshotDiff["changed"] = [];
  for (const [id, a] of aMap) {
    const b = bMap.get(id);
    if (!b) {
      added.push(a);
      continue;
    }
    const summaryParts: string[] = [];
    const sizeB = b.sizeBytes ?? b.sizeSymbolic ?? "?";
    const sizeA = a.sizeBytes ?? a.sizeSymbolic ?? "?";
    if (sizeB !== sizeA) summaryParts.push(`size ${String(sizeB)} → ${String(sizeA)}`);
    if (b.type !== a.type) summaryParts.push(`type ${b.type} → ${a.type}`);
    if (JSON.stringify(b.layout ?? null) !== JSON.stringify(a.layout ?? null))
      summaryParts.push("layout changed");
    if (summaryParts.length > 0)
      changed.push({ before: b, after: a, summary: summaryParts.join("; ") });
  }
  for (const [id, b] of bMap) if (!aMap.has(id)) removed.push(b);
  return { snapshotBefore: before.id, snapshotAfter: after.id, added, removed, changed };
}

export { PROTOCOL_VERSION };
export type {
  MemorySnapshot,
  Region,
  Block,
  MemoryEvent,
  SnapshotDiff,
  Issue,
  HostToWebviewMessage,
  WebviewToHostMessage,
  RpcRequest,
  RpcResponse,
};
