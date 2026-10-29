/**
 * Live debugger snapshots. When a C/C++ debug session stops, read
 * the top frame's locals over DAP (expanding pointers one level) and turn them
 * into a debugger-fidelity snapshot with real addresses and pointer edges.
 */
import type * as vscode from "vscode";
import { reduceDapEvent, snapshotFromFrame } from "@memlens/debugger";
import type { DebuggerState, FrameVariable } from "@memlens/debugger";
import type { MemorySnapshot } from "@memlens/protocol";

/** Debug adapter types that speak DAP for native code. */
export const NATIVE_DEBUG_TYPES = new Set(["cppdbg", "cppvsdbg", "lldb", "codelldb", "lldb-dap", "gdb", "cortex-debug"]);

const MAX_VARS = 200;
const MAX_POINTER_EXPANSIONS = 64;

type DapRequest = (command: string, args?: unknown) => PromiseLike<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  memoryReference?: string;
}

export interface CollectedFrame {
  path: string;
  frameName: string;
  line: number;
  vars: FrameVariable[];
}

/** Pure DAP walk (unit-tested with a fake request function). */
export async function collectFrame(request: DapRequest, threadId: number): Promise<CollectedFrame | null> {
  const st = await request("stackTrace", { threadId, startFrame: 0, levels: 1 });
  const frame = st?.stackFrames?.[0];
  if (!frame?.source?.path) return null;
  const scopes: { name: string; variablesReference: number; expensive?: boolean }[] = (await request("scopes", { frameId: frame.id }))?.scopes ?? [];
  const locals = scopes.find((s) => /local/i.test(s.name)) ?? scopes.find((s) => !s.expensive);
  if (!locals) return { path: frame.source.path, frameName: frame.name, line: frame.line - 1, vars: [] };
  const raw: DapVariable[] = ((await request("variables", { variablesReference: locals.variablesReference }))?.variables ?? []).slice(0, MAX_VARS);
  const vars: FrameVariable[] = [];
  let expansions = 0;
  for (const v of raw) {
    const fv: FrameVariable = { name: v.name, type: v.type, value: v.value, ...(v.memoryReference ? { memoryReference: v.memoryReference } : {}) };
    const isPtr = (v.type ?? "").trim().endsWith("*") && /0x[0-9a-f]+/i.test(v.value) && !/^0x0+\b/i.test(v.value.trim());
    if (isPtr && v.variablesReference > 0 && expansions < MAX_POINTER_EXPANSIONS) {
      expansions++;
      try {
        const kids: DapVariable[] = (await request("variables", { variablesReference: v.variablesReference }))?.variables ?? [];
        const pointee = kids[0];
        if (pointee) fv.pointee = { name: pointee.name, type: pointee.type, value: pointee.value };
      } catch {
        /* unreadable pointee (dangling / invalid) — keep the pointer alone */
      }
    }
    vars.push(fv);
  }
  return { path: frame.source.path, frameName: frame.name, line: frame.line - 1, vars };
}

export interface DebugBridgeHooks {
  /** A new live snapshot is ready. */
  onSnapshot: (snap: MemorySnapshot) => void;
  /** Session started (true) or ended (false). */
  onSessionChange: (active: boolean) => void;
  /** Static snapshot for borrowing source ranges of same-named locals. */
  staticFor: (uri: string) => MemorySnapshot | null;
  log: (msg: string) => void;
  enabled: () => boolean;
}

export class DebugBridge {
  private disposables: vscode.Disposable[] = [];
  private stops = 0;
  private state: DebuggerState = { attached: false, threadId: null, frameId: "" };
  private active = new Set<string>();

  constructor(private api: typeof vscode, private hooks: DebugBridgeHooks) {
    this.disposables.push(
      api.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker: (session) => {
          if (!NATIVE_DEBUG_TYPES.has(session.type)) return undefined;
          return {
            onWillStartSession: () => {
              this.active.add(session.id);
              this.state = { attached: true, threadId: null, frameId: "" };
              this.hooks.onSessionChange(true);
            },
            onDidSendMessage: (m: { type?: string; event?: string; body?: { threadId?: number; reason?: string } }) => {
              if (m.type !== "event" || (m.event !== "stopped" && m.event !== "continued" && m.event !== "terminated")) return;
              const { state, refreshView } = reduceDapEvent(this.state, { event: m.event, threadId: m.body?.threadId, reason: m.body?.reason });
              this.state = state;
              if (refreshView && m.event === "stopped" && this.hooks.enabled()) void this.capture(session, m.body?.threadId);
            },
            onWillStopSession: () => this.end(session.id),
            onExit: () => this.end(session.id),
          };
        },
      }),
    );
  }

  get isActive(): boolean {
    return this.active.size > 0;
  }

  private end(id: string): void {
    if (!this.active.delete(id)) return;
    if (this.active.size === 0) {
      this.state = { attached: false, threadId: null, frameId: "" };
      this.hooks.onSessionChange(false);
    }
  }

  private async capture(session: vscode.DebugSession, threadId: number | undefined): Promise<void> {
    try {
      const tid = threadId ?? (await session.customRequest("threads"))?.threads?.[0]?.id;
      if (tid === undefined) return;
      const frame = await collectFrame((cmd, args) => session.customRequest(cmd, args), tid);
      if (!frame) return;
      const uri = this.api.Uri.file(frame.path).toString();
      const stat = this.hooks.staticFor(uri);
      const staticBlocks = stat ? stat.regions.flatMap((r) => r.blocks) : [];
      const frameRange = { uri, startLine: Math.max(0, frame.line), startCol: 0, endLine: Math.max(0, frame.line), endCol: 1 };
      for (const v of frame.vars) {
        const decl = staticBlocks.find((b) => b.name === v.name && b.id.startsWith("stack:"));
        v.sourceRange = decl?.sourceRange ?? frameRange;
      }
      this.stops++;
      const snap = snapshotFromFrame(frame.vars, { ...this.state, frameId: frame.frameName }, this.stops, uri);
      this.hooks.onSnapshot(snap);
    } catch (e) {
      this.hooks.log(`debugger snapshot failed: ${(e as Error).message}`);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
