(() => {
  // ../protocol/dist/validate.js
  function diffSnapshots(before, after) {
    const bMap = /* @__PURE__ */ new Map();
    const aMap = /* @__PURE__ */ new Map();
    for (const r of before.regions)
      for (const b of r.blocks)
        bMap.set(b.id, b);
    for (const r of after.regions)
      for (const b of r.blocks)
        aMap.set(b.id, b);
    const added = [];
    const removed = [];
    const changed = [];
    for (const [id, a] of aMap) {
      const b = bMap.get(id);
      if (!b) {
        added.push(a);
        continue;
      }
      const summaryParts = [];
      const sizeB = b.sizeBytes ?? b.sizeSymbolic ?? "?";
      const sizeA = a.sizeBytes ?? a.sizeSymbolic ?? "?";
      if (sizeB !== sizeA)
        summaryParts.push(`size ${String(sizeB)} \u2192 ${String(sizeA)}`);
      if (b.type !== a.type)
        summaryParts.push(`type ${b.type} \u2192 ${a.type}`);
      if (JSON.stringify(b.layout ?? null) !== JSON.stringify(a.layout ?? null))
        summaryParts.push("layout changed");
      if (summaryParts.length > 0)
        changed.push({ before: b, after: a, summary: summaryParts.join("; ") });
    }
    for (const [id, b] of bMap)
      if (!aMap.has(id))
        removed.push(b);
    return { snapshotBefore: before.id, snapshotAfter: after.id, added, removed, changed };
  }

  // ../protocol/dist/layout.js
  function sequentialSize(fields) {
    let offset = 0;
    let maxAlign = 1;
    for (const f of fields) {
      const a = Math.max(1, f.align);
      maxAlign = Math.max(maxAlign, a);
      offset += (a - offset % a) % a;
      offset += f.size;
    }
    return offset + (maxAlign - offset % maxAlign) % maxAlign;
  }
  function paddingBytes(fields) {
    return fields.reduce((s, f) => s + f.paddingAfter, 0);
  }
  function planReorder(layout, currentSize) {
    if (layout.length < 2)
      return null;
    if (layout.some((f, i) => i > 0 && f.offset < layout[i - 1].offset + layout[i - 1].size))
      return null;
    const order = layout.map((f, i) => ({ f, i })).sort((a, b) => b.f.align - a.f.align || b.f.size - a.f.size || a.i - b.i).map((x) => x.f);
    const size = sequentialSize(order);
    return size < currentSize ? { order, size, currentSize } : null;
  }

  // src/mock.ts
  function mockSnapshot() {
    const uri = "file:///main.cpp";
    const sr = (l, c0, c1) => ({ uri, startLine: l, startCol: c0, endLine: l, endCol: c1 });
    return {
      id: "snap-mock-1",
      uri,
      docVersion: 1,
      fidelity: "static",
      timestamp: Date.now(),
      regions: [
        {
          kind: "stack",
          label: "stack: main()",
          blocks: [
            { id: "stack:main.cpp:2:x", name: "x", type: "int", sizeBytes: 4, sourceRange: sr(1, 6, 7), lifetime: { start: "main:2", end: "main:6", scopeBound: true }, confidence: 0.9, fidelity: "static" },
            { id: "stack:main.cpp:3:p", name: "p", type: "int *", sizeBytes: 8, pointsTo: [{ targetId: "heap:main.cpp:3:p", label: "owns", kind: "owns", confidence: "inferred", source: "heuristic" }], sourceRange: sr(2, 6, 7), lifetime: { start: "main:3", end: "main:6", scopeBound: true }, confidence: 0.9, fidelity: "static" },
            {
              id: "stack:main.cpp:4:f",
              name: "f",
              type: "Foo",
              sizeBytes: 8,
              sourceRange: sr(3, 6, 7),
              lifetime: { start: "main:4", end: "main:6", scopeBound: true },
              layout: [
                { name: "x", type: "int", offset: 0, size: 4, align: 4, paddingAfter: 0 },
                { name: "c", type: "char", offset: 4, size: 1, align: 1, paddingAfter: 3 }
              ],
              totalSizeBytes: 8,
              layoutSource: "fallback",
              confidence: 0.9,
              fidelity: "static"
            }
          ]
        },
        {
          kind: "heap",
          label: "heap",
          blocks: [
            { id: "heap:main.cpp:3:p", name: "p (new int[10])", type: "int[10]", sizeBytes: 40, sourceRange: sr(2, 8, 9), lifetime: { start: "main:3", scopeBound: false }, confidence: 0.8, fidelity: "static" }
          ]
        }
      ],
      records: [
        {
          name: "Foo",
          kind: "struct",
          sourceRange: sr(0, 0, 6),
          endLine: 3,
          fields: [
            { name: "x", type: "int", line: 1 },
            { name: "c", type: "char", line: 2 }
          ],
          layout: [
            { name: "x", type: "int", offset: 0, size: 4, align: 4, paddingAfter: 0 },
            { name: "c", type: "char", offset: 4, size: 1, align: 1, paddingAfter: 3 }
          ],
          totalSizeBytes: 8,
          align: 4,
          layoutSource: "fallback"
        }
      ],
      layoutAccurate: false,
      issues: [
        { kind: "large-padding", severity: "info", sourceRange: sr(0, 0, 5), message: "struct Foo: 3 padding bytes in 8 total \u2014 consider reordering fields" }
      ]
    };
  }

  // src/palette.ts
  var PALETTES = {
    default: { stack: "#4c9aff", heap: "#f5a623", global: "#9b51e0", static: "#6f777f", added: "#2ecc71", removed: "#e74c3c", changed: "#f1c40f" },
    "colorblind-safe": { stack: "#0072b2", heap: "#e69f00", global: "#cc79a7", static: "#999999", added: "#009e73", removed: "#d55e00", changed: "#f0e442" },
    "high-contrast": { stack: "#ffffff", heap: "#ffff00", global: "#00ffff", static: "#c0c0c0", added: "#00ff00", removed: "#ff0000", changed: "#ff00ff" }
  };
  function paletteFor(name) {
    return PALETTES[name ?? "colorblind-safe"] ?? PALETTES["colorblind-safe"];
  }
  function paletteVars(name) {
    const p = paletteFor(name);
    return {
      "--ml-stack": p.stack,
      "--ml-heap": p.heap,
      "--ml-global": p.global,
      "--ml-static": p.static,
      "--ml-added": p.added,
      "--ml-removed": p.removed,
      "--ml-changed": p.changed
    };
  }

  // src/format.ts
  function formatSize(b) {
    if (b.sizeBytes !== void 0) return `${b.sizeBytes} B`;
    return b.sizeSymbolic ?? "?";
  }
  function blockMagnitude(b) {
    if (b.sizeBytes !== void 0) return { px: b.sizeBytes, estimated: false };
    return { px: 16, estimated: true };
  }
  function fidelityBadge(f) {
    return f === "static" ? "STATIC \xB7 approx" : f === "traced" ? "TRACED \xB7 measured" : "DEBUGGER \xB7 live";
  }
  function confidenceLabel(c) {
    if (c >= 0.85) return "high";
    if (c >= 0.6) return "medium";
    return "low";
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  }

  // src/lod.ts
  function applyLod(blocks, opts = {}) {
    const order = new Map(blocks.map((b, i) => [b, i]));
    const bySource = (list) => list.sort((a, b) => order.get(a) - order.get(b));
    const r = applyLodBySize(blocks, opts);
    return { ...r, blocks: bySource(r.blocks) };
  }
  function applyLodBySize(blocks, opts) {
    const maxNodes = opts.maxNodes ?? 500;
    const frac = opts.collapseBelowFraction ?? 2e-3;
    if (blocks.length <= maxNodes) {
      const total = blocks.reduce((s, b) => s + (b.sizeBytes ?? 16), 0);
      const big = blocks.filter((b) => (b.sizeBytes ?? 16) >= Math.max(1, total * frac));
      const small = blocks.filter((b) => (b.sizeBytes ?? 16) < Math.max(1, total * frac));
      if (small.length <= 1) return { blocks: [...blocks].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)), collapsedCount: 0, collapsedBytes: 0 };
      void blockMagnitude;
      return {
        blocks: [...big].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)),
        collapsedCount: small.length,
        collapsedBytes: small.reduce((s, b) => s + (b.sizeBytes ?? 0), 0)
      };
    }
    const sorted = [...blocks].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
    const keep = sorted.slice(0, maxNodes - 1);
    const rest = sorted.slice(maxNodes - 1);
    return {
      blocks: keep,
      collapsedCount: rest.length,
      collapsedBytes: rest.reduce((s, b) => s + (b.sizeBytes ?? 0), 0)
    };
  }

  // src/render.ts
  function allBlocks(snap) {
    return snap.regions.flatMap((r) => r.blocks);
  }
  var REGION_LABEL = {
    stack: "STACK",
    heap: "HEAP",
    global: "GLOBALS",
    static: "STATICS"
  };
  function regionKey(region) {
    return `${region.kind}:${region.label}`;
  }
  function recordId(name) {
    return `record:${name}`;
  }
  function diffClass(id, diff) {
    if (!diff) return "";
    if (diff.added.some((b) => b.id === id)) return " ml-added";
    if (diff.removed.some((b) => b.id === id)) return " ml-removed";
    if (diff.changed.some((c) => c.after.id === id)) return " ml-changed";
    return "";
  }
  function matches(b, filter) {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return b.name.toLowerCase().includes(f) || b.type.toLowerCase().includes(f);
  }
  var FIDELITY_NAME = { static: "Static", traced: "Traced", debugger: "Debugger" };
  function renderToolbar(snap, opts) {
    const blocks = snap ? allBlocks(snap) : [];
    const bytes = blocks.reduce((s, b) => s + (b.sizeBytes ?? 0), 0);
    const symbolic = blocks.filter((b) => b.sizeBytes === void 0).length;
    const issues = snap?.issues ?? [];
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;
    const chips = [];
    if (opts.phase === "analyzing") chips.push(`<span class="ml-chip ml-chip-busy" role="status">${esc(opts.message ?? "Analyzing\u2026")}</span>`);
    else if (opts.phase === "error") chips.push(`<span class="ml-chip ml-chip-error" role="status" title="${esc(opts.message ?? "")}">${esc(opts.message ?? "Failed")}</span>`);
    else if (opts.message) chips.push(`<span class="ml-chip" role="status">${esc(opts.message)}</span>`);
    if (snap?.stale) chips.push(`<span class="ml-chip ml-chip-warn" role="status" title="${esc(snap.note ?? "")}">Syntax error \xB7 showing partial model</span>`);
    const switcher = opts.available.length > 1 ? `<div class="ml-seg-switch" role="tablist" aria-label="Data source">${opts.available.map(
      (f) => `<button role="tab" aria-selected="${f === opts.fidelity}" class="${f === opts.fidelity ? "ml-on" : ""}" data-action="fidelity" data-fidelity="${f}">${FIDELITY_NAME[f]}</button>`
    ).join("")}</div>` : "";
    const layoutChip = snap && snap.fidelity === "static" && snap.records && snap.records.some((r) => r.layout) ? snap.layoutAccurate ? `<span class="ml-chip ml-chip-ok" title="Record layouts come from the compiler">compiler layouts</span>` : `<span class="ml-chip ml-chip-est" title="No compiler found \u2014 layouts use a built-in size table. Set memlens.compilerPath to a clang binary for verified numbers.">estimated layouts</span>` : "";
    return `<div class="ml-tb-row"><div class="ml-tb-title"><span class="ml-file" title="${esc(opts.fileName)}">${esc(opts.fileName || "No file")}</span>` + (snap ? `<span class="ml-badge ml-badge-${snap.fidelity}">${fidelityBadge(snap.fidelity)}</span>` : "") + layoutChip + chips.join("") + `</div>${switcher}</div>` + (snap ? `<div class="ml-stats" aria-label="Summary"><span><strong>${blocks.length}</strong> block${blocks.length === 1 ? "" : "s"}</span><span><strong>${formatBytes(bytes)}</strong> known${symbolic ? ` <em>+${symbolic} symbolic</em>` : ""}</span><button class="ml-stat-issues${errors ? " ml-has-errors" : warnings ? " ml-has-warnings" : ""}" data-action="jump-issues" ${issues.length ? "" : "disabled"}><strong>${issues.length}</strong> issue${issues.length === 1 ? "" : "s"}</button></div>` : "");
  }
  function renderScrubber(history2, activeIndex2, diff) {
    if (history2.length < 2) return "";
    const active = history2[activeIndex2];
    if (!active) return "";
    const n = diff ? diff.added.length + diff.removed.length + diff.changed.length : 0;
    const label = active.fidelity === "debugger" ? `stop ${activeIndex2 + 1}` : active.fidelity === "traced" ? `run ${activeIndex2 + 1}` : `edit v${active.docVersion}`;
    const isLatest = activeIndex2 === history2.length - 1;
    return `<div class="ml-scrubber" aria-label="History"><button class="ml-icon-btn" data-action="step" data-index="${activeIndex2 - 1}" ${activeIndex2 > 0 ? "" : "disabled"} aria-label="Previous snapshot" title="Previous (\u2190)">\u2039</button><input id="ml-range" type="range" min="0" max="${history2.length - 1}" value="${activeIndex2}" aria-label="Snapshot ${activeIndex2 + 1} of ${history2.length}"><button class="ml-icon-btn" data-action="step" data-index="${activeIndex2 + 1}" ${isLatest ? "disabled" : ""} aria-label="Next snapshot" title="Next (\u2192)">\u203A</button><span class="ml-scrub-label">${esc(label)} <span class="ml-muted">\xB7 ${activeIndex2 + 1}/${history2.length}</span></span>` + (n ? `<button class="ml-chip ml-chip-delta" data-action="toggle-changes" title="Show what changed from the previous snapshot">\u0394 ${n} change${n === 1 ? "" : "s"}</button>` : `<span class="ml-muted ml-scrub-nochange">no changes</span>`) + (isLatest ? "" : `<button class="ml-link-btn" data-action="step" data-index="${history2.length - 1}">Back to latest</button>`) + `</div>`;
  }
  function renderMemoryMap(snap, opts = {}) {
    const pal = paletteFor(opts.palette ?? "colorblind-safe");
    const color = { stack: pal.stack, heap: pal.heap, global: pal.global, static: pal.static };
    const parts = [`<div class="ml-memory-map" aria-label="Memory map">`];
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
        `<section class="ml-region ml-region-${region.kind}${collapsed ? " ml-collapsed-region" : ""}" data-region="${region.kind}" style="--region-color:${color[region.kind]}"><button class="ml-region-heading" data-action="toggle-region" data-region-key="${esc(key)}" aria-expanded="${!collapsed}"><span class="ml-caret" aria-hidden="true">${collapsed ? "\u25B8" : "\u25BE"}</span><span class="ml-region-kicker">${REGION_LABEL[region.kind]}</span><strong>${esc(title)}</strong><span class="ml-region-meta">${region.blocks.length} block${region.blocks.length === 1 ? "" : "s"}${knownBytes ? ` \xB7 ${formatBytes(knownBytes)}` : ""}</span></button>`
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
            `<button class="${cls}" style="--block-color:${color[region.kind]};--block-grow:${grow}" data-action="select" data-id="${esc(b.id)}" role="listitem" title="${esc(`${b.name} \xB7 ${b.type} \xB7 ${formatSize(b)}${b.address ? ` \xB7 ${b.address}` : ""}
Double-click to go to source`)}" aria-label="${esc(b.name)} ${esc(b.type)} ${esc(formatSize(b))} confidence ${confidenceLabel(b.confidence)}"><span class="ml-block-name">${esc(b.name)}</span><span class="ml-block-type">${esc(b.type)}</span><span class="ml-block-size">${esc(formatSize(b))}${b.address ? ` \xB7 <code>${esc(b.address)}</code>` : ""}</span>${b.pointsTo?.length ? `<span class="ml-block-link" title="Points to another block">\u2197</span>` : ""}</button>`
          );
        }
        if (collapsedCount > 0) parts.push(`<div class="ml-collapsed">+${collapsedCount} small block${collapsedCount === 1 ? "" : "s"} \xB7 ${formatBytes(collapsedBytes)} collapsed</div>`);
        parts.push(`</div>`);
      }
      parts.push(`</section>`);
    }
    if (snap.regions.length === 0) parts.push(`<div class="ml-empty-inline">No variables or allocations found in this file yet.</div>`);
    else if (opts.filter && shown === 0) parts.push(`<div class="ml-empty-inline">No blocks match \u201C${esc(opts.filter)}\u201D.</div>`);
    parts.push(`</div>`);
    return parts.join("");
  }
  function renderRecords(records, selectedId) {
    if (!records || records.length === 0) return "";
    const rows = records.map((r) => {
      const id = recordId(r.name);
      const pad = r.layout ? paddingBytes(r.layout) : 0;
      const plan = r.layout && r.totalSizeBytes !== void 0 && r.kind !== "union" ? planReorder(r.layout, r.totalSizeBytes) : null;
      const size = r.totalSizeBytes !== void 0 ? formatBytes(r.totalSizeBytes) : "size unknown";
      return `<button class="ml-type-row${id === selectedId ? " ml-selected" : ""}" data-action="select" data-id="${esc(id)}" title="Double-click to go to the definition"><span class="ml-type-name"><span class="ml-muted">${r.kind}</span> <strong>${esc(r.name)}</strong></span>` + (r.layout && r.totalSizeBytes ? renderByteStrip(r.layout, r.totalSizeBytes, true) : `<span class="ml-muted ml-type-nolayout">${r.layout ? "" : "layout not modelled without a compiler"}</span>`) + `<span class="ml-type-meta"><span>${size}</span>${pad ? `<span class="ml-pad-text">${pad} B pad</span>` : ""}${plan ? `<span class="ml-save" title="Reordering fields would shrink this type">\u2212${plan.currentSize - plan.size} B possible</span>` : ""}</span></button>`;
    }).join("");
    return `<div class="ml-types">${rows}</div>`;
  }
  function renderByteStrip(layout, totalSize, compact = false) {
    if (totalSize <= 0 || layout.length === 0) return "";
    const unit = totalSize <= 128 ? 1 : Math.ceil(totalSize / 128);
    const cols = Math.ceil(totalSize / unit);
    const span = (bytes) => Math.max(1, Math.round(bytes / unit));
    const segs = [];
    const union = layout.every((f) => f.offset === 0) && layout.length > 1;
    const list = union ? [...layout].sort((a, b) => b.size - a.size).slice(0, 1) : layout;
    let cursor = 0;
    list.forEach((f, i) => {
      if (f.offset > cursor) segs.push(`<span class="ml-seg ml-seg-pad" style="grid-column:span ${span(f.offset - cursor)}" title="${f.offset - cursor} B padding"></span>`);
      segs.push(
        `<span class="ml-seg ml-seg-f${i % 4}" style="grid-column:span ${span(f.size)}" title="${esc(`${f.name}: ${f.type} \u2014 offset ${f.offset}, ${f.size} B`)}">${compact || f.size / unit < 2 ? "" : esc(f.name)}</span>`
      );
      cursor = f.offset + f.size;
    });
    if (totalSize > cursor) segs.push(`<span class="ml-seg ml-seg-pad" style="grid-column:span ${span(totalSize - cursor)}" title="${totalSize - cursor} B tail padding"></span>`);
    const label = `${totalSize} bytes: ${layout.map((f) => `${f.name} at ${f.offset}`).join(", ")}`;
    return `<div class="ml-bytes${compact ? " ml-bytes-compact" : ""}" role="img" aria-label="${esc(label)}" style="--cols:${cols};--grid-step:${Math.max(1, Math.round(8 / unit))}">${segs.join("")}</div>`;
  }
  function renderStructLayout(block) {
    if (!block.layout || block.layout.length === 0)
      return `<div class="ml-struct-empty">No field layout for <code>${esc(block.type)}</code> (dynamic or opaque type).</div>`;
    const badge = block.layoutSource === "compiler" ? `<span class="ml-layout-src ml-src-compiler" role="note">\u2713 compiler-verified layout</span>` : `<span class="ml-layout-src ml-src-fallback" role="note" title="Set memlens.compilerPath to a clang binary for exact numbers">estimated layout \u2014 no compiler data (confidence ${block.confidence.toFixed(2)})</span>`;
    const rows = block.layout.map(
      (f, i) => `<tr><td><i class="ml-swatch ml-seg-f${i % 4}"></i>${esc(f.name)}</td><td><code>${esc(f.type)}</code></td><td class="ml-num">${f.offset}</td><td class="ml-num">${f.size}</td><td class="ml-num">${f.align}</td><td class="ml-num ${f.paddingAfter > 0 ? "ml-pad" : ""}">${f.paddingAfter > 0 ? `+${f.paddingAfter} pad` : "\u2014"}</td></tr>`
    ).join("");
    const total = block.totalSizeBytes;
    const pad = paddingBytes(block.layout);
    const plan = total !== void 0 ? planReorder(block.layout, total) : null;
    return (total !== void 0 ? renderByteStrip(block.layout, total) : "") + `<div class="ml-struct-summary">` + (total !== void 0 ? `<span class="ml-struct-total">sizeof = ${total} B</span>` : "") + (pad ? `<span class="ml-pad-text">${pad} B padding (${total ? Math.round(pad / total * 100) : 0}%)</span>` : `<span class="ml-ok-text">no padding</span>`) + (plan ? `<span class="ml-save">Reordering fields would shrink it to ${plan.size} B. Use the quick fix on the struct.</span>` : "") + `</div><div class="ml-table-wrap"><table class="ml-struct" aria-label="Struct layout for ${esc(block.name)}"><thead><tr><th>field</th><th>type</th><th class="ml-num">offset</th><th class="ml-num">size</th><th class="ml-num">align</th><th class="ml-num">padding</th></tr></thead><tbody>${rows}</tbody></table></div>` + badge;
  }
  function lifetimeText(b) {
    const l = b.lifetime;
    if (l.start === "global") return "whole program";
    if (l.end) return `${l.start} \u2192 ${l.end}${l.scopeBound ? " (scope)" : ""}`;
    return l.scopeBound ? `${l.start} \u2192 end of scope` : `${l.start} \u2192 until freed`;
  }
  function renderInspector(snap, selectedId) {
    if (!selectedId)
      return `<div class="ml-empty-detail"><strong>Nothing selected</strong><span>Click a block or type to see its layout, size and lifetime. Double-click to jump to the code.</span></div>`;
    if (selectedId.startsWith("record:")) {
      const rec = snap.records?.find((r) => recordId(r.name) === selectedId);
      if (!rec) return `<div class="ml-empty-detail"><span>That type is no longer in this snapshot.</span></div>`;
      return `<div class="ml-inspector-head"><div><span class="ml-muted">${rec.kind}</span> <strong>${esc(rec.name)}</strong></div><button class="ml-link-btn" data-action="open" data-id="${esc(selectedId)}">Go to definition \u2197</button></div>` + (rec.layout ? renderStructLayout({ name: rec.name, type: rec.name, layout: rec.layout, totalSizeBytes: rec.totalSizeBytes, layoutSource: rec.layoutSource, confidence: rec.layoutSource === "compiler" ? 0.9 : 0.6 }) : `<div class="ml-struct-empty">MemLens can't estimate this layout without a compiler (it has bases, virtual members, bit-fields, alignment attributes or members of unknown type). Install clang or set <code>memlens.compilerPath</code> to get exact offsets.</div>`);
    }
    const b = allBlocks(snap).find((x) => x.id === selectedId);
    if (!b) return `<div class="ml-empty-detail"><span>That block is not in this snapshot.</span></div>`;
    const facts = [
      ["type", `<code>${esc(b.type)}</code>`],
      ["size", esc(formatSize(b))],
      ["lifetime", esc(lifetimeText(b))],
      ["confidence", `${confidenceLabel(b.confidence)} <span class="ml-muted">(${b.confidence.toFixed(2)})</span>`]
    ];
    if (b.address) facts.splice(2, 0, ["address", `<code>${esc(b.address)}</code>`]);
    return `<div class="ml-inspector-head"><div><strong>${esc(b.name)}</strong> <span class="ml-badge ml-badge-${b.fidelity}">${b.fidelity}</span></div><button class="ml-link-btn" data-action="open" data-id="${esc(b.id)}">Go to source \u2197</button></div><dl class="ml-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` + (b.layout ? renderStructLayout(b) : "");
  }
  function renderRelationships(snap, selectedId) {
    const blocks = allBlocks(snap);
    const selected = selectedId ? blocks.find((b) => b.id === selectedId) : void 0;
    if (!selected) return `<div class="ml-muted ml-pad-y">Select a block to see what it points to and what points to it.</div>`;
    const outgoing = selected.pointsTo ?? [];
    const incoming = blocks.flatMap((b) => (b.pointsTo ?? []).filter((p) => p.targetId === selected.id).map((p) => ({ block: b, p })));
    const target = (id) => blocks.find((b) => b.id === id);
    const certainty = (p) => p.confidence === "inferred" || p.source === "heuristic" ? "inferred" : p.confidence ?? p.source ?? "explicit";
    const row = (direction, b, label, cert) => `<button class="ml-rel-row" data-action="select" data-id="${esc(b.id)}"><span class="ml-rel-arrow">${direction === "out" ? "\u2192" : "\u2190"}</span><span class="ml-rel-main"><strong>${esc(b.name)}</strong><small>${esc(b.type)} \xB7 ${esc(formatSize(b))}</small></span><span class="ml-rel-meta">${esc(label)}<small class="ml-cert ml-cert-${esc(cert)}">${esc(cert)}</small></span></button>`;
    const out = outgoing.map((p) => {
      const b = target(p.targetId);
      return b ? row("out", b, p.label ?? p.kind ?? "points to", certainty(p)) : `<div class="ml-muted">Target not in snapshot \xB7 ${esc(p.targetId)}</div>`;
    }).join("");
    const inc = incoming.map((i) => row("in", i.block, i.p.label ?? "referenced by", certainty(i.p))).join("");
    if (!out && !inc) return `<div class="ml-muted ml-pad-y">No known pointer relationship for <strong>${esc(selected.name)}</strong>. MemLens only draws edges it can prove.</div>`;
    return `<div class="ml-rel">` + (out ? `<div class="ml-rel-group"><span class="ml-label">POINTS TO</span>${out}</div>` : "") + (inc ? `<div class="ml-rel-group"><span class="ml-label">REFERENCED BY</span>${inc}</div>` : "") + `</div>`;
  }
  function changesFromDiff(diff) {
    if (!diff) return [];
    const sz = (b) => b.sizeBytes !== void 0 ? `${b.sizeBytes} B` : b.sizeSymbolic;
    return [
      ...diff.added.map((b) => ({ blockId: b.id, kind: "created", after: sz(b), sourceRange: b.sourceRange })),
      ...diff.removed.map((b) => ({ blockId: b.id, kind: "destroyed", before: sz(b), sourceRange: b.sourceRange })),
      ...diff.changed.map((c) => ({ blockId: c.after.id, kind: "resized", before: sz(c.before), after: sz(c.after), sourceRange: c.after.sourceRange }))
    ];
  }
  function renderChanges(changes, snap) {
    if (changes.length === 0) return `<div class="ml-muted">No changes from the previous snapshot.</div>`;
    const blocks = new Map(allBlocks(snap).map((b) => [b.id, b]));
    const labels = {
      created: "added",
      destroyed: "removed",
      "value-changed": "value changed",
      "relationship-changed": "relationship changed",
      resized: "changed"
    };
    return `<ul class="ml-changes">${changes.map((c) => {
      const b = blocks.get(c.blockId);
      const line = c.sourceRange ? ` \xB7 line ${c.sourceRange.startLine + 1}` : "";
      const name = b?.name ?? c.blockId.split(":").pop() ?? c.blockId;
      return `<li><button class="ml-change ml-change-${c.kind}" data-action="select" data-id="${esc(c.blockId)}" ${b ? "" : "disabled"}><span class="ml-change-symbol">${c.kind === "created" ? "+" : c.kind === "destroyed" ? "\u2212" : "~"}</span><span class="ml-change-main"><strong>${esc(name)}</strong><small>${labels[c.kind]}${line}</small></span>${c.before !== void 0 || c.after !== void 0 ? `<code>${esc(c.before ?? "\u2205")} \u2192 ${esc(c.after ?? "\u2205")}</code>` : ""}</button></li>`;
    }).join("")}</ul>`;
  }
  var ISSUE_TITLE = {
    leak: "Possible leak",
    "double-free": "Double free",
    "use-after-free": "Use after free",
    "mismatched-delete": "Mismatched delete",
    "dangling-ref": "Dangling reference",
    "large-padding": "Padding"
  };
  function renderIssues(issues) {
    if (issues.length === 0) return `<div class="ml-no-issues">No issues detected in this snapshot.</div>`;
    const order = { error: 0, warning: 1, info: 2 };
    return `<ul class="ml-issues">` + issues.map((i, idx) => ({ i, idx })).sort((a, b) => order[a.i.severity] - order[b.i.severity] || a.i.sourceRange.startLine - b.i.sourceRange.startLine).map(
      ({ i, idx }) => `<li><button class="ml-issue ml-${i.severity}" data-kind="${i.kind}" data-action="open-issue" data-index="${idx}" title="Go to line ${i.sourceRange.startLine + 1}"><span class="ml-issue-kind">${esc(ISSUE_TITLE[i.kind] ?? i.kind)}</span><span class="ml-issue-msg">${esc(i.message)}</span><span class="ml-issue-line">L${i.sourceRange.startLine + 1}</span></button></li>`
    ).join("") + `</ul>`;
  }

  // src/main.ts
  var standalone = typeof acquireVsCodeApi !== "function";
  var vscode = standalone ? { postMessage: () => {
  }, getState: () => void 0, setState: () => {
  } } : acquireVsCodeApi();
  var saved = vscode.getState();
  var ui = {
    selectedId: saved?.selectedId ?? null,
    filter: saved?.filter ?? "",
    collapsed: saved?.collapsed ?? [],
    showChanges: saved?.showChanges ?? false
  };
  var history = [];
  var activeIndex = -1;
  var fileUri = "";
  var fidelity = "static";
  var available = ["static"];
  var status = null;
  var palette = "colorblind-safe";
  var followLatest = true;
  var rendered = /* @__PURE__ */ new Map();
  function persist() {
    vscode.setState(ui);
  }
  function post(m) {
    vscode.postMessage(m);
  }
  function current() {
    return history[activeIndex] ?? null;
  }
  function activeDiff() {
    return activeIndex > 0 ? diffSnapshots(history[activeIndex - 1], history[activeIndex]) : null;
  }
  function fileName() {
    const u = fileUri || current()?.uri || "";
    try {
      return decodeURIComponent(u.split(/[\\/]/).pop() ?? u);
    } catch {
      return u;
    }
  }
  function patch(id, html) {
    if (rendered.get(id) === html) return;
    const host = document.getElementById(id);
    if (!host) return;
    const active = document.activeElement;
    const hadFocus = active && host.contains(active);
    const focusKey = hadFocus ? `${active.getAttribute("data-action") ?? ""}|${active.getAttribute("data-id") ?? active.getAttribute("data-index") ?? active.id}` : null;
    host.innerHTML = html;
    host.hidden = html === "";
    rendered.set(id, html);
    if (focusKey) {
      const match = Array.from(host.querySelectorAll("button, input")).find(
        (e) => `${e.getAttribute("data-action") ?? ""}|${e.getAttribute("data-id") ?? e.getAttribute("data-index") ?? e.id}` === focusKey
      );
      match?.focus({ preventScroll: true });
    }
  }
  function card(title, hint, body, extra = "") {
    return `<div class="ml-card-heading"><h2>${title}</h2>${hint ? `<span class="ml-muted">${hint}</span>` : ""}${extra}</div>${body}`;
  }
  function render() {
    const snap = current();
    patch("ml-tb", renderToolbar(snap, { fileName: fileName(), fidelity, available, phase: status?.phase, message: status?.message }));
    if (!snap) {
      const empty = fidelity === "debugger" ? `<strong>Waiting for the debugger</strong><span>Pause at a breakpoint in a C or C++ file to see the live frame.</span>` : `<strong>Open a C or C++ file</strong><span>MemLens shows where each variable lives, how big it is, and how structs are laid out, updating as you type.</span>`;
      patch("ml-empty", `<div class="ml-empty">${empty}</div>`);
      for (const id of ["ml-scrubber", "ml-changes", "ml-issues", "ml-map", "ml-types", "ml-inspector", "ml-links"]) patch(id, "");
      return;
    }
    patch("ml-empty", "");
    const diff = activeDiff();
    const blocks = snap.regions.flatMap((r) => r.blocks);
    if (ui.selectedId && !ui.selectedId.startsWith("record:") && !blocks.some((b) => b.id === ui.selectedId)) {
      const oldName = ui.selectedId.split(":").pop();
      ui.selectedId = blocks.find((b) => b.id.split(":").pop() === oldName)?.id ?? null;
    }
    patch("ml-scrubber", renderScrubber(history, activeIndex, diff));
    const changes = changesFromDiff(diff);
    patch("ml-changes", ui.showChanges && changes.length ? card("Changes", "compared with the previous snapshot", renderChanges(changes, snap)) : "");
    patch("ml-issues", snap.issues.length ? card("Issues", "click to go to the line", renderIssues(snap.issues)) : "");
    patch(
      "ml-map",
      card(
        "Memory",
        snap.fidelity === "static" ? "estimated from source" : snap.fidelity === "debugger" ? "live from the paused frame" : "measured at runtime",
        renderMemoryMap(snap, { palette, selectedId: ui.selectedId ?? void 0, diff, filter: ui.filter, collapsed: new Set(ui.collapsed) }),
        `<span class="ml-legend"><i class="ml-dot ml-dot-stack"></i>stack <i class="ml-dot ml-dot-heap"></i>heap <i class="ml-dot ml-dot-global"></i>globals</span>`
      )
    );
    patch("ml-types", snap.records?.length ? card("Types", "struct, class and union layouts", renderRecords(snap.records, ui.selectedId)) : "");
    patch("ml-inspector", card("Inspector", "", renderInspector(snap, ui.selectedId)));
    const sel = blocks.find((b) => b.id === ui.selectedId);
    patch("ml-links", sel ? card("Relationships", "", renderRelationships(snap, ui.selectedId)) : "");
  }
  function select(id, notifyHost = true) {
    ui.selectedId = id;
    persist();
    render();
    if (id && notifyHost) post({ type: "selectBlock", blockId: id });
  }
  function openSource(id) {
    const snap = current();
    if (!snap) return;
    if (id.startsWith("record:")) {
      const rec = snap.records?.find((r) => recordId(r.name) === id);
      if (rec) post({ type: "openSource", sourceRange: rec.sourceRange });
      return;
    }
    const b = snap.regions.flatMap((r) => r.blocks).find((x) => x.id === id);
    if (b) post({ type: "openSource", sourceRange: b.sourceRange });
  }
  function step(index) {
    if (index < 0 || index >= history.length || index === activeIndex) return;
    activeIndex = index;
    followLatest = index === history.length - 1;
    post({ type: "scrub", snapshotId: history[index].id });
    render();
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action]");
    if (!t || t.disabled) return;
    const id = t.getAttribute("data-id") ?? "";
    switch (t.getAttribute("data-action")) {
      case "select":
        select(id);
        break;
      case "open":
        openSource(id);
        break;
      case "open-issue": {
        const issue = current()?.issues[Number(t.getAttribute("data-index"))];
        if (issue) post({ type: "openSource", sourceRange: issue.sourceRange });
        break;
      }
      case "step":
        step(Number(t.getAttribute("data-index")));
        break;
      case "fidelity": {
        const f = t.getAttribute("data-fidelity");
        if (f && f !== fidelity) post({ type: "setFidelity", fidelity: f });
        break;
      }
      case "toggle-changes":
        ui.showChanges = !ui.showChanges;
        persist();
        render();
        break;
      case "toggle-region": {
        const key = t.getAttribute("data-region-key") ?? "";
        ui.collapsed = ui.collapsed.includes(key) ? ui.collapsed.filter((k) => k !== key) : [...ui.collapsed, key];
        persist();
        render();
        break;
      }
      case "jump-issues":
        document.getElementById("ml-issues")?.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
    }
  });
  document.addEventListener("dblclick", (e) => {
    const t = e.target.closest('[data-action="select"]');
    if (t) openSource(t.getAttribute("data-id") ?? "");
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "ml-range") step(Number(t.value));
    else if (t.id === "ml-filter") {
      ui.filter = t.value.trim();
      persist();
      render();
    }
  });
  document.addEventListener("keydown", (e) => {
    const target = e.target;
    const inText = target.tagName === "INPUT" && target.type !== "range";
    if (e.key === "Escape") {
      if (inText && ui.filter) {
        target.value = "";
        ui.filter = "";
      } else ui.selectedId = null;
      persist();
      render();
      return;
    }
    if (inText) return;
    if (e.key === "/") {
      e.preventDefault();
      document.getElementById("ml-filter")?.focus();
    } else if (e.key === "Enter" && e.shiftKey && target.getAttribute("data-action") === "select") {
      e.preventDefault();
      openSource(target.getAttribute("data-id") ?? "");
    } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target.id !== "ml-range") {
      e.preventDefault();
      step(activeIndex + (e.key === "ArrowLeft" ? -1 : 1));
    }
  });
  function applyPalette(name) {
    palette = name;
    for (const [k, v] of Object.entries(paletteVars(name))) document.documentElement.style.setProperty(k, v);
  }
  window.addEventListener("message", (e) => {
    const msg = e.data;
    switch (msg.type) {
      case "history": {
        const fileChanged = msg.uri !== fileUri;
        fileUri = msg.uri;
        history = msg.snapshots.slice(-200);
        activeIndex = history.length - 1;
        followLatest = true;
        if (msg.fidelity) fidelity = msg.fidelity;
        if (msg.available) available = msg.available;
        if (fileChanged) ui.selectedId = null;
        status = null;
        render();
        break;
      }
      case "snapshot": {
        const snap = msg.snapshot;
        const i = history.findIndex((s) => s.id === snap.id);
        if (i >= 0) history[i] = snap;
        else history.push(snap);
        if (history.length > 200) history.shift();
        if (followLatest) activeIndex = history.length - 1;
        else activeIndex = Math.min(activeIndex, history.length - 1);
        if (status?.phase !== "error") status = null;
        render();
        break;
      }
      case "status":
        status = msg.state.phase === "idle" && !msg.state.message ? null : msg.state;
        render();
        break;
      case "config":
        applyPalette(msg.config.palette);
        render();
        break;
      case "select":
        if (msg.blockId !== ui.selectedId) select(msg.blockId, false);
        break;
      default:
        break;
    }
  });
  function boot() {
    const app = document.getElementById("app");
    if (!app) return;
    app.innerHTML = `<header class="ml-toolbar"><div id="ml-tb"></div><div class="ml-filter-row"><input id="ml-filter" type="search" placeholder="Filter blocks by name or type" aria-label="Filter blocks" value=""><kbd title="Press / to filter">/</kbd></div><div id="ml-scrubber"></div></header><div id="ml-empty"></div><div class="ml-layout"><div class="ml-col-main"><section id="ml-changes" class="ml-card" aria-label="Changes" hidden></section><section id="ml-issues" class="ml-card ml-issues-card" aria-label="Issues" hidden></section><section id="ml-map" class="ml-card" aria-label="Memory map" hidden></section><section id="ml-types" class="ml-card" aria-label="Types" hidden></section></div><aside class="ml-col-side"><section id="ml-inspector" class="ml-card" aria-label="Inspector" hidden></section><section id="ml-links" class="ml-card" aria-label="Relationships" hidden></section></aside></div>`;
    document.getElementById("ml-filter").value = ui.filter;
    const toolbar = app.querySelector(".ml-toolbar");
    if (toolbar && typeof ResizeObserver === "function") {
      new ResizeObserver(() => document.documentElement.style.setProperty("--ml-toolbar-h", `${toolbar.offsetHeight + 12}px`)).observe(toolbar);
    }
    applyPalette(palette);
    if (standalone) {
      const m = mockSnapshot();
      history = [m];
      activeIndex = 0;
      fileUri = m.uri ?? "file:///main.cpp";
    }
    render();
    post({ type: "ready" });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
//# sourceMappingURL=webview.js.map
