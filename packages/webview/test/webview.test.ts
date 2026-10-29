import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockSnapshot } from "../src/mock.js";
import { renderByteStrip, renderChanges, renderInspector, renderIssues, renderMemoryMap, renderRecords, renderScrubber, renderStepper, renderStructLayout, renderTimeline, renderToolbar } from "../src/render.js";
import { paletteVars } from "../src/palette.js";
import { diffSnapshots } from "@memlens/protocol";
import { applyLod } from "../src/lod.js";
import { blockMagnitude, fidelityBadge, formatSize } from "../src/format.js";
import { validateSnapshot } from "@memlens/protocol";

describe("webview", () => {
  it("mock snapshot validates against the frozen protocol", () => {
    assert.deepEqual(validateSnapshot(mockSnapshot()), []);
  });

  it("memory map renders blocks with fidelity tooltips + a11y roles", () => {
    const svg = renderMemoryMap(mockSnapshot());
    assert.ok(svg.includes('class="ml-memory-map"'), "memory map root");
    assert.ok(svg.includes("<button"), "keyboard-focusable blocks");
    assert.ok(fidelityBadge("static").includes("STATIC · approx"), "honesty badge helper");
    assert.ok(svg.includes("40 B"), "heap int[10] sized");
    assert.ok(svg.includes("ml-block-link"), "pointer relationship cue");
  });

  it("struct layout shows offsets + padding holes + provenance badge", () => {
    const f = mockSnapshot().regions[0].blocks.find((b) => b.name === "f")!;
    const html = renderStructLayout(f);
    assert.ok(html.includes("sizeof = 8 B"));
    assert.ok(html.includes("+3 pad"));
    assert.ok(html.includes("estimated layout — no compiler data"), "fallback badge");
    const compilerHtml = renderStructLayout({ ...f, layoutSource: "compiler" });
    assert.ok(compilerHtml.includes("compiler-verified"), "compiler badge");
    const unknownHtml = renderStructLayout({ ...f, layoutSource: undefined });
    assert.ok(unknownHtml.includes("estimated layout"), "missing source treated as estimate");
  });

  it("LOD collapses 100k tiny blocks (perf path)", () => {
    const blocks = Array.from({ length: 100_000 }, (_, i) => ({
      id: `b${i}`,
      name: `v${i}`,
      type: "char",
      sizeBytes: 1,
      sourceRange: { uri: "u", startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      lifetime: { start: "main:1", scopeBound: true },
      confidence: 0.9,
      fidelity: "static" as const,
    }));
    const t0 = performance.now();
    const { blocks: kept, collapsedCount } = applyLod(blocks);
    const dt = performance.now() - t0;
    assert.ok(kept.length <= 500, `bounded nodes (got ${kept.length})`);
    assert.ok(collapsedCount > 90_000);
    assert.ok(dt < 1000, `LOD fast (${dt.toFixed(0)}ms)`);
    const svg = renderMemoryMap({ ...mockSnapshot(), regions: [{ kind: "heap", label: "heap", blocks }] });
    assert.ok(svg.includes("small blocks"), "collapse notice rendered");
  });

  it("timeline + issues render", () => {
    const tl = renderTimeline([{ id: "a", docVersion: 1 }, { id: "b", docVersion: 2 }], "b");
    assert.ok(tl.includes('role="slider"'), "scrubber role");
    assert.ok(tl.includes("ml-tick-active"), "active tick");
    assert.ok(renderIssues(mockSnapshot().issues).includes("large-padding"));
    assert.ok(renderIssues([]).includes("No issues"));
  });

  it("renders explicit relationships without inferring edges", () => {
    const snap = mockSnapshot();
    const html = (renderMemoryMap(snap) + renderStructLayout(snap.regions[0].blocks.find((b) => b.name === "f")!));
    assert.ok(html.includes("p (new int[10])"));
    assert.equal(renderMemoryMap({ ...snap, regions: snap.regions.map((r) => ({ ...r, blocks: r.blocks.map((b) => ({ ...b, pointsTo: undefined })) })) }).includes("ml-block-link"), false);
  });

  it("renders source-linked step controls and changes", () => {
    const before = mockSnapshot();
    const after = { ...before, id: "snap-mock-2", docVersion: 2, regions: before.regions.map((r) => ({ ...r, blocks: r.blocks.map((b) => b.name === "x" ? { ...b, sizeBytes: 8 } : b) })) };
    const diff = diffSnapshots(before, after);
    const stepper = renderStepper([before, after], 1, diff);
    assert.ok(stepper.includes("step 2 of 2"));
    assert.ok(stepper.includes("main.cpp:2"));
    assert.ok(renderChanges([{ blockId: diff.changed[0].after.id, kind: "resized", before: "4 B", after: "8 B" }], after).includes("4 B"));
  });

  it("symbolic sizes render as placeholders, never fake scale", () => {
    const { px, estimated } = blockMagnitude({
      id: "x", name: "p", type: "int[n]", sizeSymbolic: "4·(n) bytes",
      sourceRange: { uri: "u", startLine: 0, startCol: 0, endLine: 0, endCol: 1 },
      lifetime: { start: "s", scopeBound: false }, confidence: 0.5, fidelity: "static",
    });
    assert.equal(estimated, true);
    assert.equal(formatSize({ sizeSymbolic: "4·(n) bytes" } as never), "4·(n) bytes");
    assert.equal(fidelityBadge("traced"), "TRACED · measured");
    void px;
  });

  it("toolbar summarises the snapshot and flags estimated layouts", () => {
    const html = renderToolbar(mockSnapshot(), { fileName: "main.cpp", fidelity: "static", available: ["static"] });
    assert.ok(html.includes("main.cpp"));
    assert.ok(html.includes("<strong>4</strong> blocks"));
    assert.ok(html.includes("estimated layouts"));
    assert.ok(!html.includes('role="tablist"'), "no source switcher with one source");
    const multi = renderToolbar(mockSnapshot(), { fileName: "main.cpp", fidelity: "debugger", available: ["static", "debugger"] });
    assert.ok(multi.includes('data-fidelity="debugger"') && multi.includes('aria-selected="true"'));
    assert.ok(renderToolbar(null, { fileName: "", fidelity: "static", available: ["static"] }).includes("No file"));
  });

  it("scrubber only appears with history and labels the step", () => {
    const a = mockSnapshot();
    const b = { ...a, id: "snap-mock-2", docVersion: 2 };
    assert.equal(renderScrubber([a], 0, null), "");
    const html = renderScrubber([a, b], 0, null);
    assert.ok(html.includes('type="range"') && html.includes("Back to latest"));
    assert.ok(renderScrubber([a, b], 1, diffSnapshots(a, b)).includes("edit v2"));
  });

  it("byte strip draws fields and padding holes on a byte grid", () => {
    const f = mockSnapshot().regions[0].blocks.find((b) => b.name === "f")!;
    const strip = renderByteStrip(f.layout!, 8);
    assert.ok(strip.includes("--cols:8"));
    assert.ok(strip.includes("ml-seg-pad"), "padding hole drawn");
    assert.ok(strip.includes("3 B tail padding"));
    assert.ok(renderByteStrip(f.layout!, 4096).includes("--cols:128"), "large types are bucketed");
  });

  it("types list shows padding and possible savings; inspector opens records", () => {
    const snap = mockSnapshot();
    const rec = {
      ...snap.records![0],
      name: "Bad",
      layout: [
        { name: "a", type: "char", offset: 0, size: 1, align: 1, paddingAfter: 7 },
        { name: "d", type: "double", offset: 8, size: 8, align: 8, paddingAfter: 0 },
        { name: "b", type: "char", offset: 16, size: 1, align: 1, paddingAfter: 7 },
      ],
      totalSizeBytes: 24,
    };
    const html = renderRecords([rec]);
    assert.ok(html.includes("14 B pad"));
    assert.ok(html.includes("−8 B possible"));
    const insp = renderInspector({ ...snap, records: [rec] }, "record:Bad");
    assert.ok(insp.includes("Go to definition"));
    assert.ok(insp.includes("shrink it to 16 B"));
    assert.ok(renderInspector(snap, null).includes("Nothing selected"));
    assert.ok(renderInspector(snap, "stack:main.cpp:3:p").includes("until freed") || renderInspector(snap, "stack:main.cpp:3:p").includes("main:6"));
  });

  it("filter narrows the memory map and reports no matches", () => {
    const snap = mockSnapshot();
    const html = renderMemoryMap(snap, { filter: "int[10]" });
    assert.ok(html.includes("p (new int[10])"));
    assert.ok(!html.includes(">x<"));
    assert.ok(renderMemoryMap(snap, { filter: "zzz" }).includes("No blocks match"));
  });

  it("palette setting maps to CSS variables", () => {
    assert.equal(paletteVars("high-contrast")["--ml-heap"], "#ffff00");
    assert.equal(paletteVars("nonsense")["--ml-stack"], "#0072b2");
  });
});
