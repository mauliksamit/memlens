/**
 * Native editor integration: squiggles + Problems entries, quick fixes,
 * struct-size CodeLens and hovers. Everything reads the latest static
 * snapshot for the document; no extra analysis runs.
 */
import type * as vscode from "vscode";
import type { MemorySnapshot } from "@memlens/protocol";
import {
  blockAt,
  blockHoverMarkdown,
  fixMismatchedDelete,
  passesMinSeverity,
  planFieldReorderEdits,
  recordAt,
  recordByName,
  recordHoverMarkdown,
  recordLensTitle,
  reorderLensTitle,
} from "./insights.js";

export const C_LANGS: vscode.DocumentSelector = [
  { language: "cpp", scheme: "file" },
  { language: "c", scheme: "file" },
  { language: "cpp", scheme: "untitled" },
  { language: "c", scheme: "untitled" },
];

export interface FeatureSettings {
  diagnostics: boolean;
  minSeverity: "error" | "warning" | "info";
  codeLens: boolean;
  hover: boolean;
}

type SnapshotLookup = (uri: string) => MemorySnapshot | null;

export class EditorFeatures implements vscode.CodeActionProvider, vscode.CodeLensProvider, vscode.HoverProvider {
  private diagnostics: vscode.DiagnosticCollection;
  private lensEmitter: vscode.EventEmitter<void>;
  readonly onDidChangeCodeLenses: vscode.Event<void>;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private api: typeof vscode,
    private lookup: SnapshotLookup,
    private settings: () => FeatureSettings,
  ) {
    this.diagnostics = api.languages.createDiagnosticCollection("memlens");
    this.lensEmitter = new api.EventEmitter<void>();
    this.onDidChangeCodeLenses = this.lensEmitter.event;
    this.disposables.push(
      this.diagnostics,
      this.lensEmitter,
      api.languages.registerCodeActionsProvider(C_LANGS, this, {
        providedCodeActionKinds: [api.CodeActionKind.QuickFix, api.CodeActionKind.RefactorRewrite],
      }),
      api.languages.registerCodeLensProvider(C_LANGS, this),
      api.languages.registerHoverProvider(C_LANGS, this),
      api.workspace.onDidCloseTextDocument((d) => this.diagnostics.delete(d.uri)),
    );
  }

  /** Called whenever a new static snapshot lands for a document. */
  update(snap: MemorySnapshot): void {
    if (snap.fidelity !== "static" || !snap.uri) return;
    const uri = this.api.Uri.parse(snap.uri);
    const s = this.settings();
    if (!s.diagnostics) {
      this.diagnostics.delete(uri);
    } else {
      const doc = this.api.workspace.textDocuments.find((d) => d.uri.toString() === snap.uri);
      const diags = snap.issues
        .filter((i) => passesMinSeverity(i.severity, s.minSeverity))
        .map((i) => {
          const range = this.rangeFor(doc, i.sourceRange.startLine, i.sourceRange.startCol, i.sourceRange.endLine, i.sourceRange.endCol);
          const sev =
            i.severity === "error"
              ? this.api.DiagnosticSeverity.Error
              : i.severity === "warning"
                ? this.api.DiagnosticSeverity.Warning
                : this.api.DiagnosticSeverity.Information;
          const d = new this.api.Diagnostic(range, i.message, sev);
          d.source = "MemLens";
          d.code = i.kind;
          return d;
        });
      this.diagnostics.set(uri, diags);
    }
    this.lensEmitter.fire();
  }

  clearAll(): void {
    this.diagnostics.clear();
    this.lensEmitter.fire();
  }

  refresh(): void {
    this.lensEmitter.fire();
  }

  private rangeFor(doc: vscode.TextDocument | undefined, sl: number, sc: number, el: number, ec: number): vscode.Range {
    if (!doc) return new this.api.Range(sl, sc, el, Math.max(ec, sc + 1));
    const line = Math.min(sl, doc.lineCount - 1);
    const text = doc.lineAt(line).text;
    // Tiny ranges become the word under them (or the trimmed line) so squiggles are visible.
    if (el === sl && ec - sc <= 1) {
      const word = doc.getWordRangeAtPosition(new this.api.Position(line, Math.min(sc, text.length)));
      if (word && !word.isEmpty) return word;
      const start = text.length - text.trimStart().length;
      return new this.api.Range(line, start, line, Math.max(start + 1, text.trimEnd().length));
    }
    return new this.api.Range(line, Math.min(sc, text.length), Math.min(el, doc.lineCount - 1), ec);
  }

  // --- quick fixes -----------------------------------------------------------

  provideCodeActions(doc: vscode.TextDocument, range: vscode.Range | vscode.Selection, ctx: vscode.CodeActionContext): vscode.CodeAction[] {
    const snap = this.lookup(doc.uri.toString());
    const actions: vscode.CodeAction[] = [];
    const memlensDiags = ctx.diagnostics.filter((d) => d.source === "MemLens");

    for (const d of memlensDiags) {
      if (d.code === "mismatched-delete") {
        const line = doc.lineAt(d.range.start.line);
        const fix = fixMismatchedDelete(line.text, d.message);
        if (fix) {
          const a = new this.api.CodeAction(fix.title, this.api.CodeActionKind.QuickFix);
          a.edit = new this.api.WorkspaceEdit();
          a.edit.replace(doc.uri, line.range, fix.text);
          a.diagnostics = [d];
          a.isPreferred = true;
          actions.push(a);
        }
      }
    }

    // Field reorder: offered as a quick fix on the padding diagnostic and as a
    // refactor anywhere inside a struct that would shrink.
    if (snap) {
      const rec = recordAt(snap, range.start.line);
      if (rec) {
        const lines = Array.from({ length: Math.min(doc.lineCount, rec.endLine + 1) }, (_, i) => doc.lineAt(i).text);
        const plan = planFieldReorderEdits(rec, lines);
        if (plan) {
          const padDiag = memlensDiags.find((d) => d.code === "large-padding");
          const a = new this.api.CodeAction(
            `Reorder fields of ${rec.name} to save ${plan.fromSize - plan.toSize} B (${plan.fromSize} → ${plan.toSize} B)`,
            padDiag ? this.api.CodeActionKind.QuickFix : this.api.CodeActionKind.RefactorRewrite,
          );
          a.edit = new this.api.WorkspaceEdit();
          for (const e of plan.edits) a.edit.replace(doc.uri, doc.lineAt(e.line).range, e.text);
          if (padDiag) {
            a.diagnostics = [padDiag];
            a.isPreferred = true;
          }
          actions.push(a);
        }
      }
    }

    if (memlensDiags.length) {
      const a = new this.api.CodeAction("Show in MemLens", this.api.CodeActionKind.QuickFix);
      a.command = { title: "Show in MemLens", command: "memlens.revealAtLine", arguments: [doc.uri.toString(), memlensDiags[0].range.start.line] };
      actions.push(a);
    }
    return actions;
  }

  // --- CodeLens ----------------------------------------------------------------

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.settings().codeLens) return [];
    const snap = this.lookup(doc.uri.toString());
    if (!snap?.records) return [];
    const lenses: vscode.CodeLens[] = [];
    for (const rec of snap.records) {
      const line = Math.min(rec.sourceRange.startLine, doc.lineCount - 1);
      const range = new this.api.Range(line, 0, line, 0);
      const title = recordLensTitle(rec);
      if (!title) continue;
      lenses.push(new this.api.CodeLens(range, { title, command: "memlens.revealAtLine", arguments: [doc.uri.toString(), line], tooltip: "Show this layout in MemLens" }));
      const reorder = reorderLensTitle(rec);
      const lines = Array.from({ length: Math.min(doc.lineCount, rec.endLine + 1) }, (_, i) => doc.lineAt(i).text);
      if (reorder && planFieldReorderEdits(rec, lines)) {
        lenses.push(new this.api.CodeLens(range, { title: reorder, command: "memlens.reorderFields", arguments: [doc.uri.toString(), rec.name], tooltip: "Reorder fields by alignment to remove padding" }));
      }
    }
    return lenses;
  }

  // --- hover ---------------------------------------------------------------------

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    if (!this.settings().hover) return undefined;
    const snap = this.lookup(doc.uri.toString());
    if (!snap) return undefined;
    const wordRange = doc.getWordRangeAtPosition(pos, /[A-Za-z_]\w*/);
    if (!wordRange) return undefined;
    const word = doc.getText(wordRange);
    const block = blockAt(snap, pos.line, word);
    let md: string | undefined;
    if (block) md = blockHoverMarkdown(block);
    else {
      const rec = recordByName(snap, word);
      if (rec) md = recordHoverMarkdown(rec);
    }
    if (!md) return undefined;
    return new this.api.Hover(new this.api.MarkdownString(md), wordRange);
  }

  /** Apply the reorder for a named record (CodeLens command). */
  async reorderFields(uriStr: string, name: string): Promise<boolean> {
    const snap = this.lookup(uriStr);
    const rec = snap ? recordByName(snap, name) : undefined;
    const doc = this.api.workspace.textDocuments.find((d) => d.uri.toString() === uriStr);
    if (!rec || !doc) return false;
    const lines = Array.from({ length: Math.min(doc.lineCount, rec.endLine + 1) }, (_, i) => doc.lineAt(i).text);
    const plan = planFieldReorderEdits(rec, lines);
    if (!plan) return false;
    const edit = new this.api.WorkspaceEdit();
    for (const e of plan.edits) edit.replace(doc.uri, doc.lineAt(e.line).range, e.text);
    return this.api.workspace.applyEdit(edit);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
