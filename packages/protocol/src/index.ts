/**
 * @memlens/protocol v1.4.0 — contract (1.3.0 adds execution-step and
 * relationship certainty metadata via ADR-008; 1.4.0 adds per-file snapshot
 * identity, record summaries, compilerPath and editor-sync messages via
 * ADR-009 — all purely additive).
 *
 * Rule: any change to the types in this file requires an ADR in /docs/adr
 * and a semver bump. Additive changes => minor,
 * breaking changes => major.
 *
 * JSON Schemas mirroring these types live in ./schema.json for cross-language
 * validation (tracer shim, external tools).
 */

/** Protocol version string. Bumped only via ADR. */
export const PROTOCOL_VERSION = "1.4.0";

/** Fidelity of a snapshot — must always be displayed in the UI. */
export type Fidelity = "static" | "traced" | "debugger";

/** Memory region kinds. */
export type RegionKind = "stack" | "heap" | "global" | "static";

/** Allocation event kinds on the trace stream. */
export type MemoryEventKind = "alloc" | "free" | "realloc" | "write";

/** Issue kinds the Issues panel understands. */
export type IssueKind =
  | "leak"
  | "double-free"
  | "use-after-free"
  | "mismatched-delete"
  | "dangling-ref"
  | "large-padding";

/** Severity levels. */
export type Severity = "info" | "warning" | "error";

export interface SourceRange {
  /** 0-based document URI (file path or untitled URI string). */
  uri: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface BlockLifetime {
  /** Scope/entry identifier where the block becomes live, e.g. "main:12" or "global". */
  start: string;
  /** Scope/exit identifier where it dies; absent => lives to end of snapshot (possible leak). */
  end?: string;
  /** True when the end is scope-derived (RAII/stack) vs explicit free/delete. */
  scopeBound: boolean;
}

export interface FieldLayout {
  name: string;
  type: string;
  /** Byte offset of the field within the record. */
  offset: number;
  /** Byte size of the field. */
  size: number;
  /** Alignment requirement of the field. */
  align: number;
  /** Padding bytes inserted AFTER this field (before next field or tail). */
  paddingAfter: number;
}

export interface PointerRelationship {
  /** Stable target block id in the same snapshot. */
  targetId: string;
  /** Optional expression or field name used to explain the relationship. */
  label?: string;
  kind?: "points-to" | "owns" | "borrows" | "references" | "aliases" | "contains";
  confidence?: "measured" | "debugger" | "static" | "inferred";
  source?: "compiler" | "runtime" | "debugger" | "heuristic";
}

export interface Block {
  /** Stable id within a snapshot, e.g. "heap:main.cpp:42:p". */
  id: string;
  /** Variable / allocation-site name, e.g. "p" or "*p (int[10])". */
  name: string;
  /** C++ type spelling, e.g. "int", "int[10]", "std::vector<int>", "Foo". */
  type: string;
  /** Exact byte size when known. Exactly one of sizeBytes/sizeSymbolic must be set. */
  sizeBytes?: number;
  /** Symbolic/range size when runtime-dependent, e.g. "4·n bytes", "24 + 4·n". */
  sizeSymbolic?: string;
  /** Hex address string when known (traced/debugger). Absent in static. */
  address?: string;
  /** Explicit pointer/reference targets; absent means no trustworthy edge is known. */
  pointsTo?: PointerRelationship[];
  sourceRange: SourceRange;
  lifetime: BlockLifetime;
  layout?: FieldLayout[];
  /** Total sizeof including tail padding (for records), when known. */
  totalSizeBytes?: number;
  /**
   * Provenance of `layout` (ADR-006, v1.1.0): "compiler" = clang record-layout
   * dump; "fallback" = builtin-table estimate. Absent = unknown / no layout.
   */
  layoutSource?: "compiler" | "fallback";
  /** 0..1 confidence. Static symbolic blocks are typically <= 0.6. */
  confidence: number;
  fidelity: Fidelity;
}

export interface Region {
  kind: RegionKind;
  /** Display label, e.g. "stack: main()", "heap", "globals". */
  label: string;
  blocks: Block[];
}

export interface Issue {
  kind: IssueKind;
  severity: Severity;
  sourceRange: SourceRange;
  message: string;
  /** Related block id, when applicable. */
  blockId?: string;
}

/** Field of a record definition as written in source (ADR-009, v1.4.0). */
export interface RecordFieldDecl {
  name: string;
  type: string;
  /** 0-based line of the declaration. */
  line: number;
}

/**
 * A struct/class/union definition found in the file, with its layout when
 * one is known (ADR-009, v1.4.0). Drives CodeLens and padding quick fixes.
 */
export interface RecordInfo {
  name: string;
  kind: "struct" | "class" | "union";
  /** Range of the `struct Name` header. */
  sourceRange: SourceRange;
  /** 0-based last line of the body (the closing `};`). */
  endLine: number;
  fields: RecordFieldDecl[];
  /** True when the body contains access specifiers (reordering would cross them). */
  hasAccessSpecifiers?: boolean;
  layout?: FieldLayout[];
  totalSizeBytes?: number;
  align?: number;
  layoutSource?: "compiler" | "fallback";
}

export interface MemorySnapshot {
  /** UUID-ish unique id, e.g. "snap-<docVersion>-<hash>". */
  id: string;
  /** Document URI this snapshot describes (v1.4.0; absent in older producers). */
  uri?: string;
  /** VS Code document version this snapshot was derived from. */
  docVersion: number;
  fidelity: Fidelity;
  regions: Region[];
  issues: Issue[];
  timestamp: number;
  /** True when derived from a stale/failed parse or compile (show badge). */
  stale?: boolean;
  /** Human-readable note, e.g. "parse error at line 12 — showing last good". */
  note?: string;
  /** Record definitions in the file (v1.4.0). */
  records?: RecordInfo[];
  /** True when record layouts came from the compiler (v1.4.0). */
  layoutAccurate?: boolean;
}

export interface MemoryChange {
  blockId: string;
  kind: "created" | "destroyed" | "value-changed" | "relationship-changed" | "resized";
  before?: string;
  after?: string;
  sourceRange?: SourceRange;
}

export interface ExecutionStep {
  id: string;
  index: number;
  total?: number;
  sourceRange?: SourceRange;
  label: string;
  fidelity: Fidelity;
  snapshotId: string;
  changes: MemoryChange[];
}

export interface Frame {
  function: string;
  file: string;
  line: number;
  col?: number;
}

export interface MemoryEvent {
  seq: number;
  kind: MemoryEventKind;
  /** Hex address, e.g. "0x7ffee1a2b3c0". */
  addr: string;
  /** Bytes for alloc/realloc/write; bytes freed for free (0 if unknown). */
  size: number;
  thread: string;
  stack: Frame[];
  sourceRange?: SourceRange;
  timestamp: number;
}

export interface BlockChange {
  before: Block;
  after: Block;
  /** Machine-readable summary, e.g. "size 16 → 40", "type Foo → Bar". */
  summary: string;
}

export interface SnapshotDiff {
  snapshotBefore: string;
  snapshotAfter: string;
  added: Block[];
  removed: Block[];
  changed: BlockChange[];
}

// ---------------------------------------------------------------------------
// Webview ⇄ extension host message protocol (typed discriminated unions)
// ---------------------------------------------------------------------------

/** Host → Webview messages. */
export type HostToWebviewMessage =
  | { type: "snapshot"; snapshot: MemorySnapshot }
  | { type: "diff"; diff: SnapshotDiff }
  | { type: "events"; events: MemoryEvent[] }
  | { type: "status"; state: UiStatus }
  | { type: "config"; config: WebviewConfig }
  /** Replace the webview's history (e.g. the active file changed). v1.4.0. */
  | { type: "history"; uri: string; snapshots: MemorySnapshot[]; fidelity?: Fidelity; available?: Fidelity[] }
  /** Editor cursor moved onto a block's declaration. v1.4.0. */
  | { type: "select"; blockId: string | null };

export interface UiStatus {
  phase: "idle" | "analyzing" | "stale" | "error";
  fidelity: Fidelity;
  message?: string;
}

export interface WebviewConfig {
  palette: "default" | "colorblind-safe" | "high-contrast";
  showConfidenceBadges: boolean;
}

/** Webview → Host messages. */
export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "selectBlock"; blockId: string }
  | { type: "scrub"; snapshotId: string }
  | { type: "setFidelity"; fidelity: Fidelity }
  | { type: "openSource"; sourceRange: SourceRange };

// ---------------------------------------------------------------------------
// Analysis JSON-RPC methods (worker/process over stdio, newline-delimited)
// ---------------------------------------------------------------------------

export interface AnalyzeParams {
  /** Unique request id for cancellation. */
  requestId: string;
  uri: string;
  docVersion: number;
  /** Full text snapshot (debounced). */
  text: string;
  /** Language id, expected "cpp". */
  languageId: string;
  /** Project context for layout lookup. */
  projectDir?: string;
  /** Compile commands for the file, if known. */
  compileArgs?: string[];
  /** Compiler used for record layouts (v1.4.0); default: auto-detect clang. */
  compilerPath?: string;
  fidelity: Extract<Fidelity, "static">;
}

export interface AnalyzeResult {
  snapshot: MemorySnapshot;
  /** True when clang layout data was used (vs fallback table). */
  layoutAccurate: boolean;
  /** True when input had syntax errors but a partial model was produced. */
  partial: boolean;
}

export interface GetLayoutsParams {
  requestId: string;
  /** Record type names to resolve, e.g. ["Foo", "Bar"]. */
  typeNames: string[];
  /** A compilable TU snapshot containing the definitions. */
  tuText: string;
  projectDir?: string;
  compileArgs?: string[];
}

export interface GetLayoutsResult {
  layouts: Record<string, { fields: FieldLayout[]; totalSize: number; align: number }>;
  accurate: boolean;
  errors?: string[];
}

export interface CancelParams {
  requestId: string;
}

export type RpcRequest =
  | { jsonrpc: "2.0"; id: string | number; method: "analyze"; params: AnalyzeParams }
  | { jsonrpc: "2.0"; id: string | number; method: "getLayouts"; params: GetLayoutsParams }
  | { jsonrpc: "2.0"; id: string | number; method: "cancel"; params: CancelParams };

export type RpcResponse =
  | { jsonrpc: "2.0"; id: string | number; result: AnalyzeResult | GetLayoutsResult | { ok: true } }
  | { jsonrpc: "2.0"; id: string | number; error: { code: number; message: string; data?: unknown } };

// ---------------------------------------------------------------------------
// Trace event stream format: newline-delimited JSON (NDJSON), one MemoryEvent
// per line on stdout of the instrumented binary wrapper. See schema.json.
// ---------------------------------------------------------------------------

export const TRACE_STREAM = {
  encoding: "ndjson",
  lineType: "MemoryEvent",
  requiredEnv: ["MEMLENS_TRACE_OUT", "MEMLENS_SEQ_START"],
} as const;

export {
  validateBlock,
  validateSnapshot,
  validateMemoryEvent,
  parseTraceLine,
  diffSnapshots,
} from "./validate.js";
export { sequentialSize, paddingBytes, planReorder } from "./layout.js";
export type { ReorderPlan } from "./layout.js";
