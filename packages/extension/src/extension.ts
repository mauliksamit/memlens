/**
 * Extension host entry: wires analysis → store → (webview, diagnostics,
 * CodeLens, hovers, status bar) and the live debugger bridge.
 */
import type * as vscode from "vscode";
import type { Fidelity, WebviewConfig } from "@memlens/protocol";
import { EditorWatcher } from "./editorWatcher.js";
import { AnalysisClient } from "./analysisClient.js";
import { MemoryStore } from "./memoryStore.js";
import { MemLensPanel, VIEW_TYPE } from "./webviewPanel.js";
import { EditorFeatures } from "./editorFeatures.js";
import { DebugBridge } from "./debugBridge.js";
import { allBlocks, blockAt, recordAt } from "./insights.js";

export interface MemLensState {
  watcher: EditorWatcher;
  client: AnalysisClient;
  store: MemoryStore;
  panel: MemLensPanel | null;
  status: vscode.StatusBarItem;
  inFlight: Map<string, string>;
}

export function getConfig(vscodeApi: typeof vscode) {
  const c = vscodeApi.workspace.getConfiguration("memlens");
  return {
    debounceMs: c.get<number>("debounceMs", 300),
    compilerPath: c.get<string>("compilerPath", ""),
    extraFlags: c.get<string[]>("extraFlags", []),
    historyLength: c.get<number>("historyLength", 50),
    themePalette: c.get<string>("themePalette", "colorblind-safe") as WebviewConfig["palette"],
    diagnostics: c.get<boolean>("diagnostics.enabled", true),
    minSeverity: c.get<"error" | "warning" | "info">("diagnostics.minSeverity", "info"),
    codeLens: c.get<boolean>("codeLens.enabled", true),
    hover: c.get<boolean>("hover.enabled", true),
    followCursor: c.get<boolean>("followCursor", true),
    preferDebugger: c.get<boolean>("preferDebuggerSnapshots", true),
  };
}

const isC = (doc: vscode.TextDocument | undefined): doc is vscode.TextDocument =>
  !!doc && (doc.languageId === "cpp" || doc.languageId === "c");

const baseName = (uri: string): string => {
  try {
    return decodeURIComponent(uri.split(/[\\/]/).pop() ?? uri);
  } catch {
    return uri;
  }
};

export async function activate(context: vscode.ExtensionContext): Promise<MemLensState> {
  // `require`, not `import()`: the bundle is CommonJS and the extension host
  // only intercepts require("vscode") (a native ESM import of it fails).
  const api = require("vscode") as typeof vscode;
  let cfg = getConfig(api);
  const log = api.window.createOutputChannel("MemLens", { log: true });
  const store = new MemoryStore(cfg.historyLength);
  const client = new AnalysisClient();
  log.info(`MemLens activated (analysis ${client.inProcess ? "in-process" : "worker thread"})`);

  const status = api.window.createStatusBarItem("memlens.status", api.StatusBarAlignment.Right, 100);
  status.name = "MemLens";
  status.command = "memlens.openView";

  const holder: { panel: MemLensPanel | null } = { panel: null };
  const inFlight = new Map<string, string>();
  /** Which data source the view shows per document (default: static). */
  const viewMode = new Map<string, Fidelity>();
  const lastError = new Map<string, string>();
  let lastCUri = isC(api.window.activeTextEditor?.document) ? api.window.activeTextEditor!.document.uri.toString() : "";
  let toastShown = false;
  let debugActive = false;

  const currentUri = (): string => {
    const ed = api.window.activeTextEditor;
    if (isC(ed?.document)) lastCUri = ed!.document.uri.toString();
    return lastCUri;
  };

  const viewFidelity = (uri: string): Fidelity => {
    const available = store.fidelitiesFor(uri);
    const m = viewMode.get(uri);
    if (m && available.includes(m)) return m;
    return "static";
  };

  // --- editor features ----------------------------------------------------------
  const features = new EditorFeatures(
    api,
    (uri) => store.latest(uri, "static"),
    () => ({ diagnostics: cfg.diagnostics, minSeverity: cfg.minSeverity, codeLens: cfg.codeLens, hover: cfg.hover }),
  );

  // --- status bar -----------------------------------------------------------------
  const updateStatus = (): void => {
    const uri = currentUri();
    const activeIsC = isC(api.window.activeTextEditor?.document);
    if (!activeIsC && !holder.panel?.visible) {
      status.hide();
      return;
    }
    const snap = uri ? store.latest(uri, "static") : null;
    const err = uri ? lastError.get(uri) : undefined;
    const fid = uri ? viewFidelity(uri) : "static";
    const issues = snap?.issues.length ?? 0;
    const icon = err ? "$(error)" : debugActive && fid === "debugger" ? "$(debug-alt)" : snap?.stale ? "$(warning)" : "$(symbol-structure)";
    status.text = `${icon} MemLens${issues ? ` ${issues}` : ""}`;
    const md = new api.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ["memlens.openView", "memlens.showLog"] };
    md.appendMarkdown(`**MemLens** · ${uri ? baseName(uri) : "no C/C++ file"}\n\n`);
    if (err) md.appendMarkdown(`$(error) Analysis failed: ${err}\n\n`);
    if (snap) {
      const blocks = allBlocks(snap).length;
      md.appendMarkdown(`${blocks} block${blocks === 1 ? "" : "s"} · ${issues} issue${issues === 1 ? "" : "s"}`);
      if (snap.records?.some((r) => r.layout)) md.appendMarkdown(` · ${snap.layoutAccurate ? "compiler-verified layouts" : "estimated layouts (no compiler)"}`);
      md.appendMarkdown("\n\n");
      if (snap.stale) md.appendMarkdown(`$(warning) ${snap.note ?? "Syntax error: showing a partial model"}\n\n`);
    }
    if (debugActive) md.appendMarkdown(`$(debug-alt) Debug session active: ${cfg.preferDebugger ? "live frames shown when paused" : "live view disabled in settings"}\n\n`);
    md.appendMarkdown(`[Open memory view](command:memlens.openView) · [Show log](command:memlens.showLog)`);
    status.tooltip = md;
    status.backgroundColor = err ? new api.ThemeColor("statusBarItem.errorBackground") : undefined;
    status.show();
  };

  // --- panel ------------------------------------------------------------------------
  const highlight = api.window.createTextEditorDecorationType({
    backgroundColor: new api.ThemeColor("editor.findMatchHighlightBackground"),
    isWholeLine: true,
    overviewRulerColor: new api.ThemeColor("editorOverviewRuler.findMatchForeground"),
    overviewRulerLane: api.OverviewRulerLane.Center,
  });

  const showCurrent = (): void => {
    const p = holder.panel;
    if (!p) return;
    const uri = currentUri();
    const fid = uri ? viewFidelity(uri) : "static";
    const available = uri ? store.fidelitiesFor(uri) : [];
    p.setTitle(uri ? baseName(uri) : "");
    p.showHistory(uri, uri ? store.getHistory(uri, fid) : [], fid, available.length ? available : ["static"]);
    const err = uri ? lastError.get(uri) : undefined;
    if (err) p.postStatus({ phase: "error", fidelity: fid, message: `Analysis failed: ${err}` });
  };

  const findInShown = (blockId: string): { range: vscode.Range; uri: string } | null => {
    const p = holder.panel;
    if (!p) return null;
    const snap = store.latest(p.shownUri, p.shownFidelity);
    if (!snap) return null;
    if (blockId.startsWith("record:")) {
      const rec = snap.records?.find((r) => `record:${r.name}` === blockId);
      return rec ? { uri: rec.sourceRange.uri, range: new api.Range(rec.sourceRange.startLine, 0, rec.endLine, 0) } : null;
    }
    const b = allBlocks(snap).find((x) => x.id === blockId);
    if (!b) return null;
    const r = b.sourceRange;
    return { uri: r.uri, range: new api.Range(r.startLine, r.startCol, r.endLine, r.endCol) };
  };

  const editorFor = (uri: string) => api.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri);

  const ensurePanel = (): MemLensPanel => {
    if (!holder.panel) attachPanel(MemLensPanel.create(api, context, panelHandlers));
    else holder.panel.reveal();
    return holder.panel!;
  };

  const panelHandlers = {
    onReady: () => {
      holder.panel?.postConfig({ palette: cfg.themePalette, showConfidenceBadges: true });
      showCurrent();
    },
    onOpenSource: async (range: { uri: string; startLine: number; startCol: number; endLine: number; endCol: number }) => {
      try {
        const uri = api.Uri.parse(range.uri);
        const doc = await api.workspace.openTextDocument(uri);
        const existing = editorFor(range.uri);
        const line = Math.min(range.startLine, doc.lineCount - 1);
        const sel = new api.Range(line, range.startCol, line, Math.max(range.startCol, range.endLine === range.startLine ? range.endCol : range.startCol));
        await api.window.showTextDocument(doc, {
          viewColumn: existing?.viewColumn ?? (holder.panel?.panel.viewColumn === api.ViewColumn.One ? api.ViewColumn.Two : api.ViewColumn.One),
          selection: sel,
          preserveFocus: false,
        });
      } catch (e) {
        log.warn(`could not open source ${range.uri}: ${(e as Error).message}`);
      }
    },
    onSelectBlock: (blockId: string) => {
      const hit = findInShown(blockId);
      if (!hit) return;
      const ed = editorFor(hit.uri);
      if (!ed) return;
      ed.setDecorations(highlight, [hit.range]);
      ed.revealRange(hit.range, api.TextEditorRevealType.InCenterIfOutsideViewport);
    },
    onSetFidelity: (f: Fidelity) => {
      const p = holder.panel;
      if (!p?.shownUri) return;
      viewMode.set(p.shownUri, f);
      showCurrent();
      updateStatus();
    },
  };

  const attachPanel = (p: MemLensPanel): void => {
    holder.panel = p;
    p.onDidDispose(() => {
      holder.panel = null;
      for (const ed of api.window.visibleTextEditors) ed.setDecorations(highlight, []);
      updateStatus();
    });
    p.panel.onDidChangeViewState(() => updateStatus());
  };

  // --- store → everything --------------------------------------------------------------
  store.onSnapshot((snap) => {
    const uri = snap.uri ?? "";
    if (snap.fidelity === "static") features.update(snap);
    const p = holder.panel;
    if (p) {
      if (uri === p.shownUri && snap.fidelity === p.shownFidelity) p.postSnapshot(snap);
      else if (uri === currentUri() && viewFidelity(uri) === snap.fidelity) showCurrent();
    }
    updateStatus();
  });

  // --- static analysis ------------------------------------------------------------------
  const analyze = (doc: vscode.TextDocument): void => {
    const uri = doc.uri.toString();
    const prev = inFlight.get(uri);
    if (prev) client.cancel(prev);
    const requestId = `analyze-${doc.version}-${Date.now().toString(36)}`;
    inFlight.set(uri, requestId);
    const t0 = Date.now();
    void client
      .analyze({
        requestId,
        uri,
        docVersion: doc.version,
        text: doc.getText(),
        languageId: doc.languageId,
        projectDir: api.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath,
        compileArgs: cfg.extraFlags.length ? cfg.extraFlags : undefined,
        compilerPath: cfg.compilerPath || undefined,
        fidelity: "static",
      })
      .then((res) => {
        if (inFlight.get(uri) === requestId) inFlight.delete(uri);
        if (client.isCancelled(requestId)) return;
        if (lastError.delete(uri)) holder.panel?.postStatus({ phase: "idle", fidelity: "static" });
        log.trace(`${baseName(uri)} v${doc.version}: ${allBlocks(res.snapshot).length} blocks, ${res.snapshot.issues.length} issues, layouts ${res.layoutAccurate ? "compiler" : "fallback"} (${Date.now() - t0} ms)`);
        if (res.snapshot.note) log.debug(`${baseName(uri)}: ${res.snapshot.note}`);
        store.push({ ...res.snapshot, uri });
      })
      .catch((e: Error) => {
        if (inFlight.get(uri) === requestId) inFlight.delete(uri);
        if (client.isCancelled(requestId)) return;
        lastError.set(uri, e.message);
        log.error(`analysis failed for ${baseName(uri)}: ${e.stack ?? e.message}`);
        if (holder.panel?.shownUri === uri) holder.panel.postStatus({ phase: "error", fidelity: "static", message: `Analysis failed: ${e.message}` });
        updateStatus();
        if (!toastShown) {
          toastShown = true;
          void api.window.showErrorMessage(`MemLens couldn't analyze ${baseName(uri)}: ${e.message}`, "Show Log").then((pick) => {
            if (pick) log.show(true);
          });
        }
      });
  };

  const watcher = new EditorWatcher(api, {
    debounceMs: cfg.debounceMs,
    onSnapshot: (doc) => {
      const uri = doc.uri.toString();
      analyze(doc);
    },
  });
  watcher.start();

  // --- debugger -------------------------------------------------------------------------
  const debug = new DebugBridge(api, {
    enabled: () => cfg.preferDebugger,
    staticFor: (uri) => store.latest(uri, "static"),
    log: (m) => log.warn(m),
    onSessionChange: (active) => {
      debugActive = active;
      if (active) {
        store.clearFidelity("debugger");
        log.info("debug session started: live frames will appear in MemLens when paused");
      } else {
        for (const [uri, f] of viewMode) if (f === "debugger") viewMode.delete(uri);
        log.info("debug session ended: back to static view");
        showCurrent();
      }
      updateStatus();
    },
    onSnapshot: (snap) => {
      if (snap.uri) viewMode.set(snap.uri, "debugger");
      store.push(snap);
    },
  });

  // --- editor → view sync ---------------------------------------------------------------
  let selTimer: ReturnType<typeof setTimeout> | null = null;
  const onSelection = (e: vscode.TextEditorSelectionChangeEvent): void => {
    if (!cfg.followCursor || !holder.panel?.visible || !isC(e.textEditor.document)) return;
    if (e.kind === api.TextEditorSelectionChangeKind.Command) return;
    if (selTimer) clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const p = holder.panel;
      const uri = e.textEditor.document.uri.toString();
      if (!p || p.shownUri !== uri) return;
      const snap = store.latest(uri, p.shownFidelity);
      if (!snap) return;
      const line = e.selections[0].active.line;
      const pos = e.selections[0].active;
      const wordRange = e.textEditor.document.getWordRangeAtPosition(pos);
      const word = wordRange ? e.textEditor.document.getText(wordRange) : undefined;
      const b = (word && blockAt(snap, line, word)) || blockAt(snap, line);
      if (b) p.select(b.id);
      else {
        const rec = recordAt(snap, line);
        if (rec) p.select(`record:${rec.name}`);
      }
    }, 150);
  };

  // --- commands ----------------------------------------------------------------------------
  const revealAtLine = (uriStr: string, line: number): void => {
    const p = ensurePanel();
    if (p.shownUri !== uriStr) showCurrent();
    const snap = store.latest(uriStr, viewFidelity(uriStr));
    if (!snap) return;
    const b = blockAt(snap, line);
    const rec = recordAt(snap, line);
    const id = rec && rec.sourceRange.startLine === line ? `record:${rec.name}` : b?.id ?? (rec ? `record:${rec.name}` : null);
    if (id) p.select(id);
  };

  context.subscriptions.push(
    api.commands.registerCommand("memlens.openView", () => {
      ensurePanel();
      showCurrent();
      const doc = api.window.activeTextEditor?.document;
      if (isC(doc) && !store.latest(doc.uri.toString(), "static")) analyze(doc);
    }),
    api.commands.registerCommand("memlens.clearHistory", () => {
      store.clear();
      features.clearAll();
      const doc = api.window.activeTextEditor?.document;
      if (isC(doc)) analyze(doc);
      else showCurrent();
    }),
    api.commands.registerCommand("memlens.showLog", () => log.show(true)),
    api.commands.registerCommand("memlens.revealAtLine", (uri?: string, line?: number) => {
      const ed = api.window.activeTextEditor;
      const u = uri ?? (isC(ed?.document) ? ed!.document.uri.toString() : undefined);
      if (!u) return void api.window.showInformationMessage("Open a C or C++ file first.");
      revealAtLine(u, line ?? ed?.selection.active.line ?? 0);
    }),
    api.commands.registerCommand("memlens.reorderFields", async (uri: string, name: string) => {
      const ok = await features.reorderFields(uri, name);
      if (!ok) void api.window.showInformationMessage(`MemLens couldn't safely reorder the fields of ${name}. Use the quick fix on the struct instead.`);
    }),
    api.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (wp: vscode.WebviewPanel) => {
        attachPanel(new MemLensPanel(api, context, wp, panelHandlers));
      },
    }),
    api.window.onDidChangeActiveTextEditor((ed) => {
      if (isC(ed?.document)) showCurrent();
      updateStatus();
    }),
    api.window.onDidChangeTextEditorSelection(onSelection),
    api.workspace.onDidChangeTextDocument((e) => {
      if (!isC(e.document) || e.contentChanges.length === 0) return;
      editorFor(e.document.uri.toString())?.setDecorations(highlight, []);
    }),
    api.workspace.onDidCloseTextDocument((d) => {
      if (isC(d)) lastError.delete(d.uri.toString());
    }),
    api.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("memlens")) return;
      cfg = getConfig(api);
      if (e.affectsConfiguration("memlens.debounceMs")) watcher.setDebounceMs(cfg.debounceMs);
      if (e.affectsConfiguration("memlens.historyLength")) store.historyCap = cfg.historyLength;
      if (e.affectsConfiguration("memlens.themePalette")) holder.panel?.postConfig({ palette: cfg.themePalette, showConfidenceBadges: true });
      if (e.affectsConfiguration("memlens.diagnostics") || e.affectsConfiguration("memlens.codeLens")) {
        for (const d of api.workspace.textDocuments) {
          const s = isC(d) ? store.latest(d.uri.toString(), "static") : null;
          if (s) features.update(s);
        }
      }
      if (e.affectsConfiguration("memlens.compilerPath") || e.affectsConfiguration("memlens.extraFlags")) {
        const doc = api.window.activeTextEditor?.document;
        if (isC(doc)) analyze(doc);
      }
      updateStatus();
    }),
    status,
    watcher,
    features,
    debug,
    highlight,
    log,
    { dispose: () => void client.dispose() },
  );

  updateStatus();
  const state: MemLensState = { watcher, client, store, panel: null, status, inFlight };
  Object.defineProperty(state, "panel", { get: () => holder.panel, enumerable: true });
  return state;
}

export async function deactivate(): Promise<void> {
  // Disposal is handled via context.subscriptions.
}
