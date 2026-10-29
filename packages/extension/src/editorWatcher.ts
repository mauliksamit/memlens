/**
 * EditorWatcher: onDidChangeTextDocument → debounce → snapshot.
 *
 * Guarantees: typing never blocks; superseded analyses are cancelled via
 * AnalysisClient.cancel; only C++ documents are watched.
 */
import type * as vscode from "vscode";

export interface WatcherOptions {
  debounceMs: number;
  onSnapshot: (doc: vscode.TextDocument) => void;
}

export class EditorWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposables: vscode.Disposable[] = [];
  private lastQueuedVersion = new Map<string, number>();

  constructor(private vscodeApi: typeof vscode, private opts: WatcherOptions) {}

  start(): void {
    const { window, workspace } = this.vscodeApi;
    this.disposables.push(
      workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId !== "cpp" && e.document.languageId !== "c") return;
        if (e.document.version === this.lastQueuedVersion.get(e.document.uri.toString())) return;
        this.schedule(e.document);
      }),
      window.onDidChangeActiveTextEditor((ed) => {
        if (ed && (ed.document.languageId === "cpp" || ed.document.languageId === "c")) {
          this.schedule(ed.document);
        }
      }),
    );
    const active = window.activeTextEditor;
    if (active && (active.document.languageId === "cpp" || active.document.languageId === "c")) {
      this.schedule(active.document);
    }
  }

  /** Exposed for tests: simulate a document change event. */
  notifyChanged(doc: vscode.TextDocument): void {
    this.schedule(doc);
  }

  setDebounceMs(ms: number): void {
    this.opts.debounceMs = ms;
  }

  private schedule(doc: vscode.TextDocument): void {
    this.lastQueuedVersion.set(doc.uri.toString(), doc.version);
    if (this.lastQueuedVersion.size > 200) this.lastQueuedVersion.delete(this.lastQueuedVersion.keys().next().value as string);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.opts.onSnapshot(doc);
    }, this.opts.debounceMs);
    // Allow the process to exit in tests/CLI contexts.
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
