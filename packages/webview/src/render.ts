/** DOM-free HTML string builders (tested in Node). */
import { paddingBytes, planReorder } from "@memlens/protocol";
import type { Block, FieldLayout, Fidelity, Issue, MemoryChange, MemorySnapshot, RecordInfo, Region, SnapshotDiff } from "@memlens/protocol";
import { blockMagnitude, confidenceLabel, esc, fidelityBadge, formatBytes, formatSize } from "./format.js";
import { applyLod } from "./lod.js";
import { paletteFor } from "./palette.js";

export interface RenderOptions {
  palette?: string;
  selectedId?: string;
  diff?: SnapshotDiff | null;
  /** Case-insensitive name/type filter. */
  filter?: string;
  /** Region keys (see regionKey) that are collapsed. */
  collapsed?: ReadonlySet<string>;
}

function allBlocks(snap: MemorySnapshot): Block[] {
  return snap.regions.flatMap((r) => r.blocks);
}

const REGION_LABEL: Record<Region["kind"], string> = {
  stack: "STACK",
  heap: "HEAP",
  global: "GLOBALS",
  static: "STATICS",
};

export function regionKey(region: Region): string {
  return `${region.kind}:${region.label}`;
}

export function recordId(name: string): string {
  return `record:${name}`;
}

function diffClass(id: string, diff?: SnapshotDiff | null): string {
  if (!diff) return "";
  if (diff.added.some((b) => b.id === id)) return " ml-added";
  if (diff.removed.some((b) => b.id === id)) return " ml-removed";
  if (diff.changed.some((c) => c.after.id === id)) return " ml-changed";
  return "";
}

function matches(b: Block, filter?: string): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  return b.name.toLowerCase().includes(f) || b.type.toLowerCase().includes(f);
}

// ---------------------------------------------------------------------------
// Toolbar + history scrubber
// ---------------------------------------------------------------------------

export interface ToolbarOptions {
  fileName: string;
  fidelity: Fidelity;
  available: Fidelity[];
  phase?: "idle" | "analyzing" | "stale" | "error";
  message?: string;
}

const FIDELITY_NAME: Record<Fidelity, string> = { static: "Static", traced: "Traced", debugger: "Debugger" };

export function renderToolbar(snap: MemorySnapshot | null, opts: ToolbarOptions): string {
  const blocks = snap ? allBlocks(snap) : [];
  const bytes = blocks.reduce((s, b) => s + (b.sizeBytes ?? 0), 0);
  const symbolic = blocks.filter((b) => b.sizeBytes === undefined).length;
  const issues = snap?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const chips: string[] = [];
  if (opts.phase === "analyzing") chips.push(`<span class="ml-chip ml-chip-busy" role="status">${esc(opts.message ?? "Analyzing…")}</span>`);
  else if (opts.phase === "error") chips.push(`<span class="ml-chip ml-chip-error" role="status" title="${esc(opts.message ?? "")}">${esc(opts.message ?? "Failed")}</span>`);
  else if (opts.message) chips.push(`<span class="ml-chip" role="status">${esc(opts.message)}</span>`);
  if (snap?.stale) chips.push(`<span class="ml-chip ml-chip-warn" role="status" title="${esc(snap.note ?? "")}">Syntax error · showing partial model</span>`);
  const switcher =
    opts.available.length > 1
      ? `<div class="ml-seg-switch" role="tablist" aria-label="Data source">${opts.available
          .map(
            (f) =>
              `<button role="tab" aria-selected="${f === opts.fidelity}" class="${f === opts.fidelity ? "ml-on" : ""}" data-action="fidelity" data-fidelity="${f}">${FIDELITY_NAME[f]}</button>`,
          )
          .join("")}</div>`
      : "";
  const layoutChip =
    snap && snap.fidelity === "static" && snap.records && snap.records.some((r) => r.layout)
      ? snap.layoutAccurate
        ? `<span class="ml-chip ml-chip-ok" title="Record layouts come from the compiler">compiler layouts</span>`
        : `<span class="ml-chip ml-chip-est" title="No compiler found — layouts use a built-in size table. Set memlens.compilerPath to a clang binary for verified numbers.">estimated layouts</span>`
      : "";
  return (
    `<div class="ml-tb-row">` +
    `<div class="ml-tb-title"><span class="ml-file" title="${esc(opts.fileName)}">${esc(opts.fileName || "No file")}</span>` +
    (snap ? `<span class="ml-badge ml-badge-${snap.fidelity}">${fidelityBadge(snap.fidelity)}</span>` : "") +
    layoutChip +
    chips.join("") +
    `</div>${switcher}</div>` +
    (snap
      ? `<div class="ml-stats" aria-label="Summary">` +
        `<span><strong>${blocks.length}</strong> block${blocks.length === 1 ? "" : "s"}</span>` +
        `<span><strong>${formatBytes(bytes)}</strong> known${symbolic ? ` <em>+${symbolic} symbolic</em>` : ""}</span>` +
        `<button class="ml-stat-issues${errors ? " ml-has-errors" : warnings ? " ml-has-warnings" : ""}" data-action="jump-issues" ${issues.length ? "" : "disabled"}><strong>${issues.length}</strong> issue${issues.length === 1 ? "" : "s"}</button>` +
        `</div>`
      : "")
  );
}

export function renderScrubber(history: MemorySnapshot[], activeIndex: number, diff: SnapshotDiff | null): string {
  if (history.length < 2) return "";
  const active = history[activeIndex];
  if (!active) return "";
  const n = diff ? diff.added.length + diff.removed.length + diff.changed.length : 0;
  const label = active.fidelity === "debugger" ? `stop ${activeIndex + 1}` : active.fidelity === "traced" ? `run ${activeIndex + 1}` : `edit v${active.docVersion}`;
  const isLatest = activeIndex === history.length - 1;
  return (
    `<div class="ml-scrubber" aria-label="History">` +
    `<button class="ml-icon-btn" data-action="step" data-index="${activeIndex - 1}" ${activeIndex > 0 ? "" : "disabled"} aria-label="Previous snapshot" title="Previous (←)">‹</button>` +
    `<input id="ml-range" type="range" min="0" max="${history.length - 1}" value="${activeIndex}" aria-label="Snapshot ${activeIndex + 1} of ${history.length}">` +
    `<button class="ml-icon-btn" data-action="step" data-index="${activeIndex + 1}" ${isLatest ? "disabled" : ""} aria-label="Next snapshot" title="Next (→)">›</button>` +
    `<span class="ml-scrub-label">${esc(label)} <span class="ml-muted">· ${activeIndex + 1}/${history.length}</span></span>` +
    (n ? `<button class="ml-chip ml-chip-delta" data-action="toggle-changes" title="Show what changed from the previous snapshot">Δ ${n} change${n === 1 ? "" : "s"}</button>` : `<span class="ml-muted ml-scrub-nochange">no changes</span>`) +
    (isLatest ? "" : `<button class="ml-link-btn" data-action="step" data-index="${history.length - 1}">Back to latest</button>`) +
    `</div>`
  );
}

/** Back-compat alias used by older call sites/tests. */
export function renderStepper(snapshots: MemorySnapshot[], activeIndex: number, diff: SnapshotDiff | null): string {
  const active = snapshots[activeIndex];
  if (!active) return "";
  const source = diff?.changed[0]?.after.sourceRange ?? diff?.added[0]?.sourceRange;
  const sourceText = source ? `${source.uri.split(/[\\/]/).pop() ?? source.uri}:${source.startLine + 1}` : "";
  return renderScrubber(snapshots, activeIndex, diff) + (sourceText ? `<span class="ml-source-chip">step ${activeIndex + 1} of ${snapshots.length} · ${esc(sourceText)}</span>` : "");
}

export function renderTimeline(snapshots: { id: string; docVersion: number }[], activeId: string): string {
  const items = snapshots
    .map((s) => `<button class="ml-tick${s.id === activeId ? " ml-tick-active" : ""}" data-snap="${esc(s.id)}" aria-label="snapshot v${s.docVersion}">${s.docVersion}</button>`)
    .join("");
  return `<div class="ml-timeline" role="slider" aria-label="Snapshot timeline" tabindex="0">${items || '<span class="ml-timeline-empty">no history yet</span>'}</div>`;
}

// ---------------------------------------------------------------------------
// Memory map
// ---------------------------------------------------------------------------

export function renderMemoryMap(snap: MemorySnapshot, opts: RenderOptions = {}): string {
  const pal = paletteFor(opts.palette ?? "colorblind-safe");
  const color: Record<Region["kind"], string> = { stack: pal.stack, heap: pal.heap, global: pal.global, static: pal.static };
  const parts: string[] = [`<div class="ml-memory-map" aria-label="Memory map">`];
  let shown = 0;
  for (const region of snap.regions) {
    const visible = region.blocks.filter((b) => matches(b, opts.filter));
    if (opts.filter && visible.length === 0) continue;
    const key = regionKey(region);
    const collapsed = opts.collapsed?.has(key) ?? false;
    const { blocks, collapsedCount, collapsedBytes } = applyLod(visible);
    const knownBytes = region.blocks.reduce((s, b) => s + (b.sizeBytes ?? 0), 0);
    const title = region.label.replace(/^.+?:\s*/, "");
    parts.push(
      `<section class="ml-region ml-region-${region.kind}${collapsed ? " ml-collapsed-region" : ""}" data-region="${region.kind}" style="--region-color:${color[region.kind]}">` +
        `<button class="ml-region-heading" data-action="toggle-region" data-region-key="${esc(key)}" aria-expanded="${!collapsed}">` +
        `<span class="ml-caret" aria-hidden="true">${collapsed ? "▸" : "▾"}</span><span class="ml-region-kicker">${REGION_LABEL[region.kind]}</span><strong>${esc(title)}</strong>` +
        `<span class="ml-region-meta">${region.blocks.length} block${region.blocks.length === 1 ? "" : "s"}${knownBytes ? ` · ${formatBytes(knownBytes)}` : ""}</span></button>`,
    );
    if (!collapsed) {
      parts.push(`<div class="ml-lane" role="list" aria-label="${esc(region.label)} blocks">`);
      for (const b of blocks) {
        shown++;
        const { estimated } = blockMagnitude(b);
        const px = b.sizeBytes ?? 16;
        const cls = `ml-block${diffClass(b.id, opts.diff)}${b.id === opts.selectedId ? " ml-selected" : ""}${estimated ? " ml-estimated" : ""}`;
        const grow = Math.max(1, Math.min(6, Math.log2(px + 1))).toFixed(2);
        parts.push(
          `<button class="${cls}" style="--block-color:${color[region.kind]};--block-grow:${grow}" data-action="select" data-id="${esc(b.id)}" role="listitem" ` +
            `title="${esc(`${b.name} · ${b.type} · ${formatSize(b)}${b.address ? ` · ${b.address}` : ""}\nDouble-click to go to source`)}" ` +
            `aria-label="${esc(b.name)} ${esc(b.type)} ${esc(formatSize(b))} confidence ${confidenceLabel(b.confidence)}">` +
            `<span class="ml-block-name">${esc(b.name)}</span><span class="ml-block-type">${esc(b.type)}</span>` +
            `<span class="ml-block-size">${esc(formatSize(b))}${b.address ? ` · <code>${esc(b.address)}</code>` : ""}</span>` +
            `${b.pointsTo?.length ? `<span class="ml-block-link" title="Points to another block">↗</span>` : ""}</button>`,
        );
      }
      if (collapsedCount > 0) parts.push(`<div class="ml-collapsed">+${collapsedCount} small block${collapsedCount === 1 ? "" : "s"} · ${formatBytes(collapsedBytes)} collapsed</div>`);
      parts.push(`</div>`);
    }
    parts.push(`</section>`);
  }
  if (snap.regions.length === 0) parts.push(`<div class="ml-empty-inline">No variables or allocations found in this file yet.</div>`);
  else if (opts.filter && shown === 0) parts.push(`<div class="ml-empty-inline">No blocks match “${esc(opts.filter)}”.</div>`);
  parts.push(`</div>`);
  return parts.join("");
}

// ---------------------------------------------------------------------------
// Types (record definitions)
// ---------------------------------------------------------------------------

export function renderRecords(records: RecordInfo[] | undefined, selectedId?: string | null): string {
  if (!records || records.length === 0) return "";
  const rows = records
    .map((r) => {
      const id = recordId(r.name);
      const pad = r.layout ? paddingBytes(r.layout) : 0;
      const plan = r.layout && r.totalSizeBytes !== undefined && r.kind !== "union" ? planReorder(r.layout, r.totalSizeBytes) : null;
      const size = r.totalSizeBytes !== undefined ? formatBytes(r.totalSizeBytes) : "size unknown";
      return (
        `<button class="ml-type-row${id === selectedId ? " ml-selected" : ""}" data-action="select" data-id="${esc(id)}" title="Double-click to go to the definition">` +
        `<span class="ml-type-name"><span class="ml-muted">${r.kind}</span> <strong>${esc(r.name)}</strong></span>` +
        (r.layout && r.totalSizeBytes ? renderByteStrip(r.layout, r.totalSizeBytes, true) : `<span class="ml-muted ml-type-nolayout">${r.layout ? "" : "layout not modelled without a compiler"}</span>`) +
        `<span class="ml-type-meta"><span>${size}</span>${pad ? `<span class="ml-pad-text">${pad} B pad</span>` : ""}${plan ? `<span class="ml-save" title="Reordering fields would shrink this type">−${plan.currentSize - plan.size} B possible</span>` : ""}</span>` +
        `</button>`
      );
    })
    .join("");
  return `<div class="ml-types">${rows}</div>`;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

/** Visual byte map: one grid column per byte (or per N bytes for big types). */
export function renderByteStrip(layout: FieldLayout[], totalSize: number, compact = false): string {
  if (totalSize <= 0 || layout.length === 0) return "";
  const unit = totalSize <= 128 ? 1 : Math.ceil(totalSize / 128);
  const cols = Math.ceil(totalSize / unit);
  const span = (bytes: number) => Math.max(1, Math.round(bytes / unit));
  const segs: string[] = [];
  const union = layout.every((f) => f.offset === 0) && layout.length > 1;
  const list = union ? [...layout].sort((a, b) => b.size - a.size).slice(0, 1) : layout;
  let cursor = 0;
  list.forEach((f, i) => {
    if (f.offset > cursor) segs.push(`<span class="ml-seg ml-seg-pad" style="grid-column:span ${span(f.offset - cursor)}" title="${f.offset - cursor} B padding"></span>`);
    segs.push(
      `<span class="ml-seg ml-seg-f${i % 4}" style="grid-column:span ${span(f.size)}" title="${esc(`${f.name}: ${f.type} — offset ${f.offset}, ${f.size} B`)}">${compact || f.size / unit < 2 ? "" : esc(f.name)}</span>`,
    );
    cursor = f.offset + f.size;
  });
  if (totalSize > cursor) segs.push(`<span class="ml-seg ml-seg-pad" style="grid-column:span ${span(totalSize - cursor)}" title="${totalSize - cursor} B tail padding"></span>`);
  const label = `${totalSize} bytes: ${layout.map((f) => `${f.name} at ${f.offset}`).join(", ")}`;
  return `<div class="ml-bytes${compact ? " ml-bytes-compact" : ""}" role="img" aria-label="${esc(label)}" style="--cols:${cols};--grid-step:${Math.max(1, Math.round(8 / unit))}">${segs.join("")}</div>`;
}

type LayoutSubject = Pick<Block, "name" | "type" | "layout" | "totalSizeBytes" | "layoutSource" | "confidence">;

export function renderStructLayout(block: LayoutSubject): string {
  if (!block.layout || block.layout.length === 0)
    return `<div class="ml-struct-empty">No field layout for <code>${esc(block.type)}</code> (dynamic or opaque type).</div>`;
  // ADR-006: provenance badge — compiler numbers vs fallback estimates.
  const badge =
    block.layoutSource === "compiler"
      ? `<span class="ml-layout-src ml-src-compiler" role="note">✓ compiler-verified layout</span>`
      : `<span class="ml-layout-src ml-src-fallback" role="note" title="Set memlens.compilerPath to a clang binary for exact numbers">estimated layout — no compiler data (confidence ${block.confidence.toFixed(2)})</span>`;
  const rows = block.layout
    .map(
      (f, i) =>
        `<tr><td><i class="ml-swatch ml-seg-f${i % 4}"></i>${esc(f.name)}</td><td><code>${esc(f.type)}</code></td><td class="ml-num">${f.offset}</td><td class="ml-num">${f.size}</td><td class="ml-num">${f.align}</td>` +
        `<td class="ml-num ${f.paddingAfter > 0 ? "ml-pad" : ""}">${f.paddingAfter > 0 ? `+${f.paddingAfter} pad` : "—"}</td></tr>`,
    )
    .join("");
  const total = block.totalSizeBytes;
  const pad = paddingBytes(block.layout);
  const plan = total !== undefined ? planReorder(block.layout, total) : null;
  return (
    (total !== undefined ? renderByteStrip(block.layout, total) : "") +
    `<div class="ml-struct-summary">` +
    (total !== undefined ? `<span class="ml-struct-total">sizeof = ${total} B</span>` : "") +
    (pad ? `<span class="ml-pad-text">${pad} B padding (${total ? Math.round((pad / total) * 100) : 0}%)</span>` : `<span class="ml-ok-text">no padding</span>`) +
    (plan ? `<span class="ml-save">Reordering fields would shrink it to ${plan.size} B. Use the quick fix on the struct.</span>` : "") +
    `</div>` +
    `<div class="ml-table-wrap"><table class="ml-struct" aria-label="Struct layout for ${esc(block.name)}"><thead><tr><th>field</th><th>type</th><th class="ml-num">offset</th><th class="ml-num">size</th><th class="ml-num">align</th><th class="ml-num">padding</th></tr></thead><tbody>${rows}</tbody></table></div>` +
    badge
  );
}

function lifetimeText(b: Block): string {
  const l = b.lifetime;
  if (l.start === "global") return "whole program";
  if (l.end) return `${l.start} → ${l.end}${l.scopeBound ? " (scope)" : ""}`;
  return l.scopeBound ? `${l.start} → end of scope` : `${l.start} → until freed`;
}

export function renderInspector(snap: MemorySnapshot, selectedId: string | null): string {
  if (!selectedId)
    return `<div class="ml-empty-detail"><strong>Nothing selected</strong><span>Click a block or type to see its layout, size and lifetime. Double-click to jump to the code.</span></div>`;
  if (selectedId.startsWith("record:")) {
    const rec = snap.records?.find((r) => recordId(r.name) === selectedId);
    if (!rec) return `<div class="ml-empty-detail"><span>That type is no longer in this snapshot.</span></div>`;
    return (
      `<div class="ml-inspector-head"><div><span class="ml-muted">${rec.kind}</span> <strong>${esc(rec.name)}</strong></div>` +
      `<button class="ml-link-btn" data-action="open" data-id="${esc(selectedId)}">Go to definition ↗</button></div>` +
      (rec.layout
        ? renderStructLayout({ name: rec.name, type: rec.name, layout: rec.layout, totalSizeBytes: rec.totalSizeBytes, layoutSource: rec.layoutSource, confidence: rec.layoutSource === "compiler" ? 0.9 : 0.6 })
        : `<div class="ml-struct-empty">MemLens can't estimate this layout without a compiler (it has bases, virtual members, bit-fields, alignment attributes or members of unknown type). Install clang or set <code>memlens.compilerPath</code> to get exact offsets.</div>`)
    );
  }
  const b = allBlocks(snap).find((x) => x.id === selectedId);
  if (!b) return `<div class="ml-empty-detail"><span>That block is not in this snapshot.</span></div>`;
  const facts: [string, string][] = [
    ["type", `<code>${esc(b.type)}</code>`],
    ["size", esc(formatSize(b))],
    ["lifetime", esc(lifetimeText(b))],
    ["confidence", `${confidenceLabel(b.confidence)} <span class="ml-muted">(${b.confidence.toFixed(2)})</span>`],
  ];
  if (b.address) facts.splice(2, 0, ["address", `<code>${esc(b.address)}</code>`]);
  return (
    `<div class="ml-inspector-head"><div><strong>${esc(b.name)}</strong> <span class="ml-badge ml-badge-${b.fidelity}">${b.fidelity}</span></div>` +
    `<button class="ml-link-btn" data-action="open" data-id="${esc(b.id)}">Go to source ↗</button></div>` +
    `<dl class="ml-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` +
    (b.layout ? renderStructLayout(b) : "")
  );
}

// ---------------------------------------------------------------------------
// Relationships, changes, issues
// ---------------------------------------------------------------------------

export function renderRelationships(snap: MemorySnapshot, selectedId?: string | null): string {
  const blocks = allBlocks(snap);
  const selected = selectedId ? blocks.find((b) => b.id === selectedId) : undefined;
  if (!selected) return `<div class="ml-muted ml-pad-y">Select a block to see what it points to and what points to it.</div>`;
  const outgoing = selected.pointsTo ?? [];
  const incoming = blocks.flatMap((b) => (b.pointsTo ?? []).filter((p) => p.targetId === selected.id).map((p) => ({ block: b, p })));
  const target = (id: string) => blocks.find((b) => b.id === id);
  const certainty = (p: { confidence?: string; source?: string }) =>
    p.confidence === "inferred" || p.source === "heuristic" ? "inferred" : p.confidence ?? p.source ?? "explicit";
  const row = (direction: "out" | "in", b: Block, label: string, cert: string) =>
    `<button class="ml-rel-row" data-action="select" data-id="${esc(b.id)}"><span class="ml-rel-arrow">${direction === "out" ? "→" : "←"}</span>` +
    `<span class="ml-rel-main"><strong>${esc(b.name)}</strong><small>${esc(b.type)} · ${esc(formatSize(b))}</small></span>` +
    `<span class="ml-rel-meta">${esc(label)}<small class="ml-cert ml-cert-${esc(cert)}">${esc(cert)}</small></span></button>`;
  const out = outgoing
    .map((p) => {
      const b = target(p.targetId);
      return b ? row("out", b, p.label ?? p.kind ?? "points to", certainty(p)) : `<div class="ml-muted">Target not in snapshot · ${esc(p.targetId)}</div>`;
    })
    .join("");
  const inc = incoming.map((i) => row("in", i.block, i.p.label ?? "referenced by", certainty(i.p))).join("");
  if (!out && !inc) return `<div class="ml-muted ml-pad-y">No known pointer relationship for <strong>${esc(selected.name)}</strong>. MemLens only draws edges it can prove.</div>`;
  return (
    `<div class="ml-rel">` +
    (out ? `<div class="ml-rel-group"><span class="ml-label">POINTS TO</span>${out}</div>` : "") +
    (inc ? `<div class="ml-rel-group"><span class="ml-label">REFERENCED BY</span>${inc}</div>` : "") +
    `</div>`
  );
}

export function changesFromDiff(diff: SnapshotDiff | null): MemoryChange[] {
  if (!diff) return [];
  const sz = (b: Block) => (b.sizeBytes !== undefined ? `${b.sizeBytes} B` : b.sizeSymbolic);
  return [
    ...diff.added.map((b) => ({ blockId: b.id, kind: "created" as const, after: sz(b), sourceRange: b.sourceRange })),
    ...diff.removed.map((b) => ({ blockId: b.id, kind: "destroyed" as const, before: sz(b), sourceRange: b.sourceRange })),
    ...diff.changed.map((c) => ({ blockId: c.after.id, kind: "resized" as const, before: sz(c.before), after: sz(c.after), sourceRange: c.after.sourceRange })),
  ];
}

export function renderChanges(changes: MemoryChange[], snap: MemorySnapshot): string {
  if (changes.length === 0) return `<div class="ml-muted">No changes from the previous snapshot.</div>`;
  const blocks = new Map(allBlocks(snap).map((b) => [b.id, b]));
  const labels: Record<MemoryChange["kind"], string> = {
    created: "added",
    destroyed: "removed",
    "value-changed": "value changed",
    "relationship-changed": "relationship changed",
    resized: "changed",
  };
  return `<ul class="ml-changes">${changes
    .map((c) => {
      const b = blocks.get(c.blockId);
      const line = c.sourceRange ? ` · line ${c.sourceRange.startLine + 1}` : "";
      const name = b?.name ?? c.blockId.split(":").pop() ?? c.blockId;
      return (
        `<li><button class="ml-change ml-change-${c.kind}" data-action="select" data-id="${esc(c.blockId)}" ${b ? "" : "disabled"}>` +
        `<span class="ml-change-symbol">${c.kind === "created" ? "+" : c.kind === "destroyed" ? "−" : "~"}</span>` +
        `<span class="ml-change-main"><strong>${esc(name)}</strong><small>${labels[c.kind]}${line}</small></span>` +
        `${c.before !== undefined || c.after !== undefined ? `<code>${esc(c.before ?? "∅")} → ${esc(c.after ?? "∅")}</code>` : ""}</button></li>`
      );
    })
    .join("")}</ul>`;
}

const ISSUE_TITLE: Record<Issue["kind"], string> = {
  leak: "Possible leak",
  "double-free": "Double free",
  "use-after-free": "Use after free",
  "mismatched-delete": "Mismatched delete",
  "dangling-ref": "Dangling reference",
  "large-padding": "Padding",
};

export function renderIssues(issues: Issue[]): string {
  if (issues.length === 0) return `<div class="ml-no-issues">No issues detected in this snapshot.</div>`;
  const order = { error: 0, warning: 1, info: 2 } as const;
  return (
    `<ul class="ml-issues">` +
    issues
      .map((i, idx) => ({ i, idx }))
      .sort((a, b) => order[a.i.severity] - order[b.i.severity] || a.i.sourceRange.startLine - b.i.sourceRange.startLine)
      .map(
        ({ i, idx }) =>
          `<li><button class="ml-issue ml-${i.severity}" data-kind="${i.kind}" data-action="open-issue" data-index="${idx}" title="Go to line ${i.sourceRange.startLine + 1}">` +
          `<span class="ml-issue-kind">${esc(ISSUE_TITLE[i.kind] ?? i.kind)}</span><span class="ml-issue-msg">${esc(i.message)}</span>` +
          `<span class="ml-issue-line">L${i.sourceRange.startLine + 1}</span></button></li>`,
      )
      .join("") +
    `</ul>`
  );
}
