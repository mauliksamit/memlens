/**
 * WebviewPanel lifecycle: create/restore/reveal/dispose and the typed
 * message bridge. The host decides what the panel shows; the panel reports
 * user intent (select, open source, switch data source).
 */
import type * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { Fidelity, HostToWebviewMessage, MemorySnapshot, SourceRange, UiStatus, WebviewConfig, WebviewToHostMessage } from "@memlens/protocol";

export const VIEW_TYPE = "memlens.memoryView";

export interface PanelHandlers {
  onReady: () => void;
  onOpenSource: (range: SourceRange) => void;
  onSelectBlock: (blockId: string) => void;
  onSetFidelity: (f: Fidelity) => void;
}

export class MemLensPanel {
  private disposables: vscode.Disposable[] = [];
  private disposeHandlers: Array<() => void> = [];
  private ready = false;
  private queue: HostToWebviewMessage[] = [];
  /** What the webview currently shows (history key). */
  shownUri = "";
  shownFidelity: Fidelity = "static";

  static create(api: typeof vscode, context: vscode.ExtensionContext, handlers: PanelHandlers): MemLensPanel {
    const panel = api.window.createWebviewPanel(
      VIEW_TYPE,
      "MemLens",
      { viewColumn: api.ViewColumn.Beside, preserveFocus: true },
      MemLensPanel.options(api, context),
    );
    return new MemLensPanel(api, context, panel, handlers);
  }

  static options(api: typeof vscode, context: vscode.ExtensionContext): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [api.Uri.joinPath(context.extensionUri, "media")],
    };
  }

  constructor(
    private api: typeof vscode,
    context: vscode.ExtensionContext,
    readonly panel: vscode.WebviewPanel,
    private handlers: PanelHandlers,
  ) {
    panel.webview.options = MemLensPanel.options(api, context);
    panel.iconPath = api.Uri.joinPath(context.extensionUri, "resources", "icon.png");
    panel.webview.html = this.html(context);
    panel.webview.onDidReceiveMessage((msg: WebviewToHostMessage) => this.onMessage(msg), null, this.disposables);
    panel.onDidDispose(
      () => {
        for (const d of this.disposables) d.dispose();
        for (const h of this.disposeHandlers) h();
      },
      null,
      this.disposables,
    );
  }

  private onMessage(msg: WebviewToHostMessage): void {
    switch (msg?.type) {
      case "ready":
        this.ready = true;
        this.handlers.onReady();
        for (const m of this.queue.splice(0)) void this.panel.webview.postMessage(m);
        break;
      case "openSource":
        this.handlers.onOpenSource(msg.sourceRange);
        break;
      case "selectBlock":
        this.handlers.onSelectBlock(msg.blockId);
        break;
      case "setFidelity":
        this.handlers.onSetFidelity(msg.fidelity);
        break;
      default:
        break;
    }
  }

  onDidDispose(h: () => void): void {
    this.disposeHandlers.push(h);
  }

  get visible(): boolean {
    return this.panel.visible;
  }

  reveal(): void {
    this.panel.reveal(undefined, true);
  }

  setTitle(fileName: string): void {
    this.panel.title = fileName ? `MemLens · ${fileName}` : "MemLens";
  }

  post(msg: HostToWebviewMessage): void {
    if (!this.ready) {
      // Only the latest history/config matter before the webview boots.
      this.queue = this.queue.filter((m) => m.type !== msg.type || (m.type !== "history" && m.type !== "config"));
      this.queue.push(msg);
      return;
    }
    void this.panel.webview.postMessage(msg);
  }

  showHistory(uri: string, snapshots: readonly MemorySnapshot[], fidelity: Fidelity, available: Fidelity[]): void {
    this.shownUri = uri;
    this.shownFidelity = fidelity;
    this.post({ type: "history", uri, snapshots: [...snapshots], fidelity, available });
  }

  postSnapshot(snapshot: MemorySnapshot): void {
    this.post({ type: "snapshot", snapshot });
  }

  postStatus(state: UiStatus): void {
    this.post({ type: "status", state });
  }

  postConfig(config: WebviewConfig): void {
    this.post({ type: "config", config });
  }

  select(blockId: string | null): void {
    this.post({ type: "select", blockId });
  }

  dispose(): void {
    this.panel.dispose();
  }

  private html(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(this.api.Uri.joinPath(context.extensionUri, "media", "webview.js"));
    const style = webview.asWebviewUri(this.api.Uri.joinPath(context.extensionUri, "media", "webview.css"));
    const nonce = randomBytes(16).toString("base64");
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${style}"><title>MemLens</title></head>
<body><div id="app" role="main" aria-label="MemLens memory view"></div>
<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}
