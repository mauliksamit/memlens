/**
 * AnalysisClient: JSON-RPC (analyze/getLayouts/cancel) to the analysis
 * worker thread (ADR-003). Falls back to in-process `analyzeText` when worker
 * threads are unavailable. Tracks in-flight requestIds for cancellation.
 */
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { analyzeText } from "@memlens/analysis";
import type { AnalyzeParams, AnalyzeResult } from "@memlens/protocol";

interface Pending {
  resolve: (r: AnalyzeResult) => void;
  reject: (e: Error) => void;
}

export class AnalysisClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<string | number, Pending>();
  private cancelled = new Set<string>();
  readonly inProcess: boolean;

  constructor(workerPath?: string) {
    let w: Worker | null = null;
    try {
      const path = workerPath ?? this.defaultWorkerPath();
      w = new Worker(path);
      w.on("message", (msg) => this.onMessage(msg));
      w.on("error", (e: unknown) => this.failAll(e instanceof Error ? e : new Error(String(e))));
    } catch {
      w = null; // worker threads unavailable → in-process fallback
    }
    this.worker = w;
    this.inProcess = w === null;
  }

  private defaultWorkerPath(): string {
    // 1) Bundled worker shipped in the .vsix (out/analysis.worker.js).
    // 2) Workspace layout in dev (node_modules symlink → analysis dist).
    // 3) "" → in-process fallback (same pure core, same protocol).
    try {
      const bundled = join(__dirname, "analysis.worker.js");
      if (existsSync(bundled)) return bundled;
    } catch {
      /* fall through */
    }
    try {
      const g = globalThis as { require?: NodeRequire };
      if (typeof g.require === "function") return g.require.resolve("@memlens/analysis/dist/index.js");
    } catch {
      /* fall through */
    }
    return "";
  }

  private onMessage(msg: { id: string | number; result?: AnalyzeResult; error?: { message: string } }): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result as AnalyzeResult);
  }

  private failAll(e: Error): void {
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
  }

  async analyze(params: AnalyzeParams): Promise<AnalyzeResult> {
    if (this.cancelled.has(params.requestId)) {
      throw new Error(`cancelled: ${params.requestId}`);
    }
    if (!this.worker) {
      return analyzeText(params);
    }
    const id = ++this.seq;
    return new Promise<AnalyzeResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, method: "analyze", params });
    });
  }

  /** Mark a request cancelled; late results are dropped by MemoryStore. */
  cancel(requestId: string): void {
    this.cancelled.add(requestId);
    try {
      this.worker?.postMessage({ id: ++this.seq, method: "cancel", params: { requestId } });
    } catch {
      /* worker gone — harmless */
    }
    // Bound the set.
    if (this.cancelled.size > 500) {
      const first = this.cancelled.values().next().value;
      if (first) this.cancelled.delete(first);
    }
  }

  isCancelled(requestId: string): boolean {
    return this.cancelled.has(requestId);
  }

  async dispose(): Promise<void> {
    this.failAll(new Error("disposed"));
    await this.worker?.terminate();
    this.worker = null;
  }
}
