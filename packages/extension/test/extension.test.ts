import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type * as vscode from "vscode";
import { EditorWatcher } from "../src/editorWatcher.js";
import { MemoryStore } from "../src/memoryStore.js";
import { AnalysisClient } from "../src/analysisClient.js";
import type { MemorySnapshot, RecordInfo } from "@memlens/protocol";
import { blockAt, fixMismatchedDelete, passesMinSeverity, planFieldReorderEdits, recordAt, recordHoverMarkdown, recordLensTitle, reorderLensTitle } from "../src/insights.js";
import { collectFrame } from "../src/debugBridge.js";

function fakeVscode() {
  const changeHandlers: Array<(e: { document: vscode.TextDocument }) => void> = [];
  const activeHandlers: Array<(e: vscode.TextEditor | undefined) => void> = [];
  return {
    api: {
      workspace: {
        onDidChangeTextDocument: (h: (e: { document: vscode.TextDocument }) => void) => {
          changeHandlers.push(h);
          return { dispose() {} };
        },
      },
      window: {
        onDidChangeActiveTextEditor: (h: (e: vscode.TextEditor | undefined) => void) => {
          activeHandlers.push(h);
          return { dispose() {} };
        },
        activeTextEditor: undefined,
      },
    } as unknown as typeof vscode,
    fireChange(doc: vscode.TextDocument) {
      for (const h of changeHandlers) h({ document: doc });
    },
  };
}

const doc = (version: number, languageId = "cpp") =>
  ({ uri: { toString: () => "file:///a.cpp" }, version, languageId, getText: () => "int x;" }) as unknown as vscode.TextDocument;

const mkSnap = (id: string, v: number): MemorySnapshot => ({
  id,
  docVersion: v,
  fidelity: "static",
  regions: [{ kind: "stack", label: "stack: main()", blocks: [] }],
  issues: [],
  timestamp: Date.now(),
});

describe("extension core", () => {
  it("debounces rapid edits into one snapshot", async () => {
    const f = fakeVscode();
    let calls = 0;
    const w = new EditorWatcher(f.api, { debounceMs: 30, onSnapshot: () => calls++ });
    w.start();
    f.fireChange(doc(1));
    f.fireChange(doc(2));
    f.fireChange(doc(3));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls, 1);
    w.dispose();
  });

  it("ignores non-C++ documents", async () => {
    const f = fakeVscode();
    let calls = 0;
    const w = new EditorWatcher(f.api, { debounceMs: 10, onSnapshot: () => calls++ });
    w.start();
    f.fireChange(doc(1, "python"));
    f.fireChange(doc(1, "markdown"));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(calls, 0);
    w.dispose();
  });

  it("MemoryStore ring buffer + diff", () => {
    const store = new MemoryStore(2);
    let diffs = 0;
    store.onSnapshot((_s, d) => {
      if (d) diffs++;
    });
    store.push(mkSnap("a", 1));
    store.push(mkSnap("b", 2));
    store.push(mkSnap("c", 3)); // evicts "a"
    assert.equal(store.getHistory().length, 2);
    assert.equal(store.getById("a"), undefined);
    assert.equal(diffs, 2);
    store.clear();
    assert.equal(store.latest(), null);
  });

  it("AnalysisClient round-trips analyze over the worker", async () => {
    const client = new AnalysisClient();
    try {
      const res = await client.analyze({
        requestId: "test-1",
        uri: "file:///main.cpp",
        docVersion: 1,
        text: "int main() {\n int x;\n int* p = new int[10];\n delete[] p;\n}\n",
        languageId: "cpp",
        fidelity: "static",
      });
      const heap = res.snapshot.regions.filter((r) => r.kind === "heap").flatMap((r) => r.blocks);
      assert.ok(heap.some((b) => b.sizeBytes === 40), "heap int[10] = 40 bytes via worker");
    } finally {
      await client.dispose();
    }
  });

  it("MemoryStore keeps separate histories per file and per fidelity", () => {
    const store = new MemoryStore(10);
    store.push({ ...mkSnap("a1", 1), uri: "file:///a.cpp" });
    store.push({ ...mkSnap("b1", 1), uri: "file:///b.cpp" });
    store.push({ ...mkSnap("a2", 2), uri: "file:///a.cpp" });
    store.push({ ...mkSnap("d1", 1), uri: "file:///a.cpp", fidelity: "debugger" });
    assert.deepEqual(store.getHistory("file:///a.cpp").map((s) => s.id), ["a1", "a2"]);
    assert.deepEqual(store.getHistory("file:///b.cpp").map((s) => s.id), ["b1"]);
    assert.equal(store.latest("file:///a.cpp", "debugger")?.id, "d1");
    assert.deepEqual(store.fidelitiesFor("file:///a.cpp"), ["static", "debugger"]);
    store.clearFidelity("debugger");
    assert.deepEqual(store.fidelitiesFor("file:///a.cpp"), ["static"]);
    // Re-pushing the same id (same doc version) replaces instead of duplicating.
    store.push({ ...mkSnap("a2", 2), uri: "file:///a.cpp" });
    assert.equal(store.getHistory("file:///a.cpp").length, 2);
  });

  const padded: RecordInfo = {
    name: "Padded",
    kind: "struct",
    sourceRange: { uri: "file:///p.cpp", startLine: 0, startCol: 0, endLine: 0, endCol: 0 },
    endLine: 5,
    fields: [
      { name: "a", type: "char", line: 1 },
      { name: "d", type: "double", line: 2 },
      { name: "b", type: "char", line: 3 },
      { name: "c", type: "int", line: 4 },
    ],
    layout: [
      { name: "a", type: "char", offset: 0, size: 1, align: 1, paddingAfter: 7 },
      { name: "d", type: "double", offset: 8, size: 8, align: 8, paddingAfter: 0 },
      { name: "b", type: "char", offset: 16, size: 1, align: 1, paddingAfter: 3 },
      { name: "c", type: "int", offset: 20, size: 4, align: 4, paddingAfter: 0 },
    ],
    totalSizeBytes: 24,
    align: 8,
    layoutSource: "fallback",
  };
  const paddedSrc = ["struct Padded {", "  char a;", "  double d;   // mass", "  char b;", "  int c;", "};"];

  it("plans a safe field reorder that removes padding", () => {
    const plan = planFieldReorderEdits(padded, paddedSrc);
    assert.ok(plan);
    assert.equal(plan.fromSize, 24);
    assert.equal(plan.toSize, 16);
    assert.deepEqual(plan.order, ["d", "c", "a", "b"]);
    const out = [...paddedSrc];
    for (const e of plan.edits) out[e.line] = e.text;
    assert.deepEqual(out, ["struct Padded {", "  double d;   // mass", "  int c;", "  char a;", "  char b;", "};"]);
  });

  it("refuses the reorder when it is not clearly safe", () => {
    assert.equal(planFieldReorderEdits({ ...padded, hasAccessSpecifiers: true }, paddedSrc), null, "access labels");
    assert.equal(planFieldReorderEdits({ ...padded, kind: "union" }, paddedSrc), null, "union");
    const twoPerLine = ["struct Padded {", "  char a; double d;", "  double d;", "  char b;", "  int c;", "};"];
    assert.equal(planFieldReorderEdits(padded, twoPerLine), null, "two declarations on one line");
    const tight = { ...padded, layout: padded.layout!.map((f) => ({ ...f, paddingAfter: 0 })), totalSizeBytes: 16, fields: padded.fields, };
    assert.equal(planFieldReorderEdits({ ...tight, layout: [padded.layout![1], padded.layout![3], padded.layout![0], padded.layout![2]].map((f, i) => ({ ...f, offset: [0, 8, 12, 13][i] })) }, paddedSrc), null, "already optimal");
  });

  it("rewrites mismatched deletes", () => {
    assert.deepEqual(fixMismatchedDelete("  delete p;", "mismatched new[]/delete for 'p'")?.text, "  delete[] p;");
    assert.deepEqual(fixMismatchedDelete("  delete [] q;", "mismatched new/delete[] for 'q'")?.text, "  delete q;");
    assert.deepEqual(fixMismatchedDelete("  delete buf;", "malloc'd pointer 'buf' must be freed with free(), not delete")?.text, "  free(buf);");
    assert.equal(fixMismatchedDelete("  free(p);", "mismatched new[]/delete for 'p'"), null);
  });

  it("CodeLens and hover text describe size, padding and savings", () => {
    assert.equal(recordLensTitle(padded), "sizeof 24 B · 10 B padding (42%) · estimated");
    assert.equal(reorderLensTitle(padded), "Reorder fields to save 8 B");
    assert.equal(recordLensTitle({ ...padded, layout: undefined }), null);
    assert.ok(recordHoverMarkdown(padded).includes("| `a` | `char` | 0 | 1 | **+7** |"));
    assert.ok(passesMinSeverity("error", "warning") && !passesMinSeverity("info", "warning"));
  });

  it("finds blocks by line and word, and records by line", () => {
    const snap: MemorySnapshot = {
      ...mkSnap("s", 1),
      regions: [
        {
          kind: "stack",
          label: "stack: main()",
          blocks: [
            { id: "stack:p.cpp:3:p", name: "p", type: "int *", sizeBytes: 8, sourceRange: { uri: "u", startLine: 2, startCol: 7, endLine: 2, endCol: 8 }, lifetime: { start: "main:3", scopeBound: false }, confidence: 0.9, fidelity: "static" },
          ],
        },
        {
          kind: "heap",
          label: "heap",
          blocks: [
            { id: "heap:p.cpp:3:p", name: "p (newArray int[10])", type: "int[10]", sizeBytes: 40, sourceRange: { uri: "u", startLine: 2, startCol: 11, endLine: 2, endCol: 14 }, lifetime: { start: "main:3", scopeBound: false }, confidence: 0.8, fidelity: "static" },
          ],
        },
      ],
      records: [padded],
    };
    assert.equal(blockAt(snap, 2)?.id, "stack:p.cpp:3:p");
    assert.equal(blockAt(snap, 2, "p")?.id, "stack:p.cpp:3:p");
    assert.equal(blockAt(snap, 2, "new"), undefined);
    assert.equal(recordAt(snap, 3)?.name, "Padded");
    assert.equal(recordAt(snap, 7), undefined);
  });

  it("collects a stopped frame over DAP, expanding pointers once", async () => {
    const calls: string[] = [];
    const responses: Record<string, unknown> = {
      stackTrace: { stackFrames: [{ id: 7, name: "main", line: 12, source: { path: "/src/a.cpp" } }] },
      scopes: { scopes: [{ name: "Registers", variablesReference: 9, expensive: true }, { name: "Locals", variablesReference: 1 }] },
    };
    const vars: Record<number, unknown> = {
      1: { variables: [
        { name: "n", value: "3", type: "int", variablesReference: 0 },
        { name: "p", value: "0x55aa10", type: "int *", variablesReference: 2 },
        { name: "q", value: "0x0", type: "int *", variablesReference: 3 },
      ] },
      2: { variables: [{ name: "*p", value: "42", type: "int", variablesReference: 0 }] },
    };
    const frame = await collectFrame(async (cmd: string, args?: unknown) => {
      calls.push(cmd);
      if (cmd === "variables") return vars[(args as { variablesReference: number }).variablesReference];
      return responses[cmd];
    }, 1);
    assert.ok(frame);
    assert.equal(frame.path, "/src/a.cpp");
    assert.equal(frame.line, 11);
    assert.equal(frame.vars.length, 3);
    assert.equal(frame.vars[1].pointee?.value, "42");
    assert.equal(frame.vars[2].pointee, undefined, "null pointers are not expanded");
    assert.deepEqual(calls, ["stackTrace", "scopes", "variables", "variables"]);
  });
});
