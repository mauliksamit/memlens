/**
 * Pure, vscode-free helpers behind the editor integrations (diagnostics,
 * quick fixes, CodeLens, hovers). Unit-tested in Node.
 */
import { paddingBytes, planReorder } from "@memlens/protocol";
import type { Block, Issue, MemorySnapshot, RecordInfo } from "@memlens/protocol";

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function allBlocks(snap: MemorySnapshot): Block[] {
  return snap.regions.flatMap((r) => r.blocks);
}

/** Block declared/allocated on `line`, preferring one named `word`. */
export function blockAt(snap: MemorySnapshot, line: number, word?: string): Block | undefined {
  const onLine = allBlocks(snap).filter((b) => b.sourceRange.startLine === line);
  if (onLine.length === 0) return undefined;
  if (word) {
    const exact = onLine.find((b) => b.name === word || b.name.startsWith(`${word} (`));
    if (exact) return exact;
    return undefined;
  }
  return onLine.find((b) => b.id.startsWith("stack:") || b.id.startsWith("global:")) ?? onLine[0];
}

/** Record whose definition spans `line`. */
export function recordAt(snap: MemorySnapshot, line: number): RecordInfo | undefined {
  return snap.records?.find((r) => line >= r.sourceRange.startLine && line <= r.endLine);
}

export function recordByName(snap: MemorySnapshot, name: string): RecordInfo | undefined {
  return snap.records?.find((r) => r.name === name);
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/** 0 = Error, 1 = Warning, 2 = Information (vscode.DiagnosticSeverity values). */
export function severityRank(sev: Issue["severity"]): 0 | 1 | 2 {
  return sev === "error" ? 0 : sev === "warning" ? 1 : 2;
}

export function passesMinSeverity(sev: Issue["severity"], min: "error" | "warning" | "info"): boolean {
  return severityRank(sev) <= severityRank(min);
}

// ---------------------------------------------------------------------------
// Quick fixes
// ---------------------------------------------------------------------------

export interface LineEdit {
  line: number;
  text: string;
}

export interface ReorderEdit {
  edits: LineEdit[];
  fromSize: number;
  toSize: number;
  order: string[];
}

/**
 * Plan "reorder fields to minimise padding" as whole-line swaps. Refuses
 * (null) unless it is unambiguously safe: one simple declaration per line,
 * no access labels, layout known for every field, and the record shrinks.
 */
export function planFieldReorderEdits(rec: RecordInfo, lines: readonly string[]): ReorderEdit | null {
  if (rec.kind === "union" || rec.hasAccessSpecifiers || !rec.layout || rec.totalSizeBytes === undefined) return null;
  if (rec.layout.length !== rec.fields.length || rec.fields.length < 2) return null;
  const names = new Set(rec.fields.map((f) => f.name));
  if (rec.layout.some((f) => !names.has(f.name))) return null;
  const fieldLines = rec.fields.map((f) => f.line);
  if (new Set(fieldLines).size !== fieldLines.length) return null;
  for (const f of rec.fields) {
    const text = lines[f.line];
    if (text === undefined) return null;
    const code = text.replace(/\/\/.*$/, "");
    if ((code.match(/;/g) ?? []).length !== 1 || /[{}]|\/\*/.test(code)) return null;
    if (!new RegExp(`\\b${f.name}\\b`).test(code)) return null;
  }
  const plan = planReorder(rec.layout, rec.totalSizeBytes);
  if (!plan) return null;
  const lineOf = new Map(rec.fields.map((f) => [f.name, f.line]));
  const slots = [...fieldLines].sort((a, b) => a - b);
  const indentOf = (s: string) => /^\s*/.exec(s)?.[0] ?? "";
  const edits = slots
    .map((slot, i) => {
      const src = lines[lineOf.get(plan.order[i].name)!];
      return { line: slot, text: indentOf(lines[slot]) + src.trimStart() };
    })
    .filter((e) => lines[e.line] !== e.text);
  return { edits, fromSize: plan.currentSize, toSize: plan.size, order: plan.order.map((f) => f.name) };
}

/** Rewrite a line flagged as mismatched-delete. */
export function fixMismatchedDelete(lineText: string, message: string): { text: string; title: string } | null {
  let text = lineText;
  let title = "";
  if (message.includes("new[]/delete")) {
    text = lineText.replace(/\bdelete\s+(?!\[)/, "delete[] ");
    title = "Use delete[] (allocated with new[])";
  } else if (message.includes("new/delete[]")) {
    text = lineText.replace(/\bdelete\s*\[\s*\]\s*/, "delete ");
    title = "Use delete (allocated with new)";
  } else if (message.includes("must be freed with free()")) {
    text = lineText.replace(/\bdelete\s*(?:\[\s*\])?\s*([A-Za-z_]\w*)/, "free($1)");
    title = "Use free() (allocated with malloc)";
  }
  return text !== lineText ? { text, title } : null;
}

// ---------------------------------------------------------------------------
// CodeLens + hover text
// ---------------------------------------------------------------------------

export function recordLensTitle(rec: RecordInfo): string | null {
  if (!rec.layout || rec.totalSizeBytes === undefined) return null;
  const pad = paddingBytes(rec.layout);
  const pct = rec.totalSizeBytes ? Math.round((pad / rec.totalSizeBytes) * 100) : 0;
  const src = rec.layoutSource === "compiler" ? "compiler" : "estimated";
  return `sizeof ${rec.totalSizeBytes} B · ${pad ? `${pad} B padding (${pct}%)` : "no padding"} · ${src}`;
}

export function reorderLensTitle(rec: RecordInfo): string | null {
  if (rec.kind === "union" || !rec.layout || rec.totalSizeBytes === undefined) return null;
  const plan = planReorder(rec.layout, rec.totalSizeBytes);
  return plan ? `Reorder fields to save ${plan.currentSize - plan.size} B` : null;
}

function sizeText(b: Block): string {
  return b.sizeBytes !== undefined ? `${b.sizeBytes} B` : (b.sizeSymbolic ?? "unknown");
}

function regionOf(b: Block): string {
  const r = b.id.split(":")[0];
  return r === "global" ? "globals" : r === "debug" ? (b.lifetime.scopeBound ? "stack" : "heap") : r;
}

export function layoutTable(rec: Pick<RecordInfo, "layout">): string {
  if (!rec.layout?.length) return "";
  const rows = rec.layout.map((f) => `| \`${f.name}\` | \`${f.type}\` | ${f.offset} | ${f.size} | ${f.paddingAfter ? `**+${f.paddingAfter}**` : ""} |`);
  return ["| field | type | offset | size | pad |", "|---|---|--:|--:|--:|", ...rows].join("\n");
}

export function blockHoverMarkdown(b: Block): string {
  const lines = [
    `**${b.name}**: \`${b.type}\``,
    "",
    `${sizeText(b)} · ${regionOf(b)} · ${b.fidelity}${b.address ? ` · \`${b.address}\`` : ""}`,
    "",
    `Lifetime: ${b.lifetime.start === "global" ? "whole program" : b.lifetime.end ? `${b.lifetime.start} → ${b.lifetime.end}` : b.lifetime.scopeBound ? "until end of scope" : "until freed"} · confidence ${b.confidence.toFixed(2)}`,
  ];
  if (b.layout?.length) {
    lines.push("", layoutTable(b));
    if (b.layoutSource !== "compiler") lines.push("", "_Estimated layout (no compiler data)._");
  }
  return lines.join("\n");
}

export function recordHoverMarkdown(rec: RecordInfo): string {
  const title = recordLensTitle(rec);
  if (!title) return `**${rec.kind} ${rec.name}**: layout unknown without a compiler (set \`memlens.compilerPath\`).`;
  const reorder = reorderLensTitle(rec);
  return [`**${rec.kind} ${rec.name}**: ${title}`, "", layoutTable(rec), ...(reorder ? ["", `Tip: ${reorder.toLowerCase()} with the quick fix on the definition.`] : [])].join("\n");
}
