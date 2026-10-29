/**
 * Debugger bridge: DAP tracker integration, memory reads, stepping.
 *
 * Listens to Debug Adapter Protocol events (via vscode.debug API at runtime;
 * pure functions here for testability), maps variables to protocol Blocks,
 * and pushes debugger-fidelity snapshots into the MemoryStore.
 */
import type { Block, Fidelity, MemorySnapshot, SourceRange } from "@memlens/protocol";

/** Minimal DAP-ish variable payload (from `variables` / `evaluate` responses). */
export interface DebugVariable {
  name: string;
  type?: string;
  value: string;
  /** Hex address when the debug adapter reports `memoryReference` or a pointer value. */
  memoryReference?: string;
  variablesReference?: number;
  sourceRange?: SourceRange;
}

export interface DapEvent {
  event: "stopped" | "continued" | "terminated" | "output" | "breakpoint";
  threadId?: number;
  reason?: string;
}

/** Extract a hex address from a pointer-ish value string ("0x7fff..."). */
export function parsePointerValue(value: string): string | null {
  const m = /(0x[0-9a-fA-F]+)/.exec(value);
  return m ? m[1].toLowerCase() : null;
}

/** Parse `${...}`-style size suffixes adapters append, e.g. "[10]". */
export function parseArrayValue(value: string): { base: string; count: number | null } {
  const m = /^(.*?)\s*\[(\d+|\?)\]$/.exec(value.trim());
  if (!m) return { base: value.trim(), count: null };
  return { base: m[1], count: m[2] === "?" ? null : parseInt(m[2], 10) };
}

const PTR_SIZE = 8;

function inferSizeBytes(type: string | undefined, value: string): { sizeBytes?: number; sizeSymbolic?: string } {
  const t = (type ?? "").trim();
  // LLP64 (Windows): long is 4 bytes; LP64 elsewhere.
  const longSize = typeof process !== "undefined" && process.platform === "win32" ? 4 : 8;
  const table: Record<string, number> = {
    int: 4, "unsigned int": 4, float: 4, double: 8, char: 1, "unsigned char": 1, bool: 1, short: 2,
    long: longSize, "unsigned long": longSize, "long long": 8, "unsigned long long": 8, size_t: 8,
  };
  if (table[t] !== undefined) return { sizeBytes: table[t] };
  if (t.endsWith("*") || t.includes("*")) return { sizeBytes: PTR_SIZE };
  const { count } = parseArrayValue(value);
  if (count !== null && table[t.replace(/\[.*\]$/, "")] !== undefined)
    return { sizeBytes: table[t.replace(/\[.*\]$/, "")] * count };
  if (count === null && value.includes("?")) return { sizeSymbolic: `sizeof(${t || "?"})·n` };
  return { sizeSymbolic: `sizeof(${t || value.slice(0, 24)})` };
}

/** Map one debug variable to a protocol Block (debugger fidelity). */
export function variableToBlock(v: DebugVariable, frameId: string, docVersion: number, uri: string): Block {
  const address = v.memoryReference ?? parsePointerValue(v.value) ?? undefined;
  const sized = inferSizeBytes(v.type, v.value);
  const isHeap = address !== undefined && (v.type?.includes("*") || v.name.startsWith("*"));
  return {
    id: `debug:${frameId}:${v.name}`,
    name: v.name,
    type: v.type ?? "?",
    ...sized,
    ...(address ? { address } : {}),
    sourceRange: v.sourceRange ?? { uri, startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
    lifetime: { start: frameId, scopeBound: !isHeap },
    confidence: address ? 0.95 : 0.7,
    fidelity: "debugger" as Fidelity,
  };
}

export interface DebuggerState {
  attached: boolean;
  threadId: number | null;
  frameId: string;
}

/** Pure DAP event reducer — stepping updates the view. */
export function reduceDapEvent(state: DebuggerState, e: DapEvent): { state: DebuggerState; refreshView: boolean } {
  switch (e.event) {
    case "stopped":
      return { state: { ...state, threadId: e.threadId ?? null, frameId: `thread:${e.threadId ?? 0}` }, refreshView: true };
    case "continued":
      return { state: { ...state, threadId: e.threadId ?? null }, refreshView: false };
    case "terminated":
      return { state: { attached: false, threadId: null, frameId: "" }, refreshView: true };
    default:
      return { state, refreshView: false };
  }
}

/** Build a debugger-fidelity snapshot from one stopped frame's variables. */
export function snapshotFromVariables(
  vars: DebugVariable[],
  state: DebuggerState,
  docVersion: number,
  uri: string,
  timestamp = Date.now(),
): MemorySnapshot {
  const stack: Block[] = [];
  const heap: Block[] = [];
  for (const v of vars) {
    const b = variableToBlock(v, state.frameId || "thread:0", docVersion, uri);
    if (b.address && (v.type?.includes("*") || v.name.startsWith("*"))) heap.push(b);
    else stack.push(b);
  }
  return {
    id: `snap-debug-${docVersion}-${timestamp.toString(36)}`,
    docVersion,
    fidelity: "debugger",
    regions: [
      { kind: "stack", label: `stack: ${state.frameId || "debug"}`, blocks: stack },
      ...(heap.length ? [{ kind: "heap" as const, label: "heap (live pointers)", blocks: heap }] : []),
    ],
    issues: [],
    timestamp,
  };
}

/** A frame variable plus (optionally) the children of a pointer, one level deep. */
export interface FrameVariable extends DebugVariable {
  /** For pointers: the pointee as the adapter reports it (e.g. `*p`). */
  pointee?: DebugVariable;
}

/**
 * Build a debugger snapshot for one stopped frame. Pointers whose pointee was
 * expanded get a heap block for the target and an explicit `points-to` edge
 * (certainty "debugger" — the adapter read the real address).
 */
export function snapshotFromFrame(
  vars: FrameVariable[],
  state: DebuggerState,
  docVersion: number,
  uri: string,
  timestamp = Date.now(),
): MemorySnapshot {
  const frameId = state.frameId || "thread:0";
  const stack: Block[] = [];
  const heap: Block[] = [];
  for (const v of vars) {
    const b = variableToBlock(v, frameId, docVersion, uri);
    // Locals live on the stack — even pointers; their *targets* are heap.
    b.lifetime = { start: frameId, scopeBound: true };
    const addr = parsePointerValue(v.value);
    const isPtr = (v.type ?? "").includes("*") && addr !== null && !/^0x0+$/.test(addr);
    if (isPtr) {
      const target = v.pointee;
      const pointeeType = (v.type ?? "").replace(/\s*\*\s*$/, "").trim();
      const t = variableToBlock(
        { name: `*${v.name}`, type: target?.type ?? pointeeType, value: target?.value ?? "", sourceRange: v.sourceRange },
        frameId,
        docVersion,
        uri,
      );
      t.id = `debug:heap:${addr}`;
      t.address = addr;
      t.lifetime = { start: frameId, scopeBound: false };
      if (!heap.some((h) => h.id === t.id)) heap.push(t);
      b.pointsTo = [{ targetId: t.id, label: "points to", kind: "points-to", confidence: "debugger", source: "debugger" }];
    }
    stack.push(b);
  }
  return {
    id: `snap-debug-${docVersion}-${timestamp.toString(36)}`,
    uri,
    docVersion,
    fidelity: "debugger",
    regions: [
      { kind: "stack", label: `stack: ${state.frameId || "debug"}`, blocks: stack },
      ...(heap.length ? [{ kind: "heap" as const, label: "heap (via live pointers)", blocks: heap }] : []),
    ],
    issues: [],
    timestamp,
  };
}
