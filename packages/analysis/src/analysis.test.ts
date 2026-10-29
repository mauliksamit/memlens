import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RegexParser } from "./parser.js";
import { buildSnapshot } from "./model.js";
import { getLayouts } from "./layout.js";
import { analyzeText } from "./index.js";
import { validateSnapshot } from "@memlens/protocol";

const URI = "file:///main.cpp";

async function snap(text: string, docVersion = 1) {
  const r = await analyzeText({ requestId: "t", uri: URI, docVersion, text, languageId: "cpp", fidelity: "static" });
  const errs = validateSnapshot(r.snapshot);
  assert.deepEqual(errs, [], `snapshot valid: ${errs.join(",")}`);
  return r;
}

function blocksOf(s: Awaited<ReturnType<typeof snap>>["snapshot"], region: string) {
  return s.regions.filter((r) => r.kind === region).flatMap((r) => r.blocks);
}

describe("static model", () => {
  it("tracks stack locals + heap new[]", async () => {
    const r = await snap(`int main() {\n  int x;\n  int* p = new int[10];\n  delete[] p;\n  return 0;\n}\n`, 2);
    const stack = blocksOf(r.snapshot, "stack");
    const heap = blocksOf(r.snapshot, "heap");
    assert.ok(stack.some((b) => b.name === "x" && b.sizeBytes === 4), "stack int x = 4 bytes");
    const p = heap.find((b) => b.name.startsWith("p"));
    assert.ok(p, "heap block for p");
    assert.equal(p!.sizeBytes, 40);
    assert.equal(r.snapshot.issues.length, 0);
  });

  it("symbolic size for runtime count (never fabricates)", async () => {
    const r = await snap(`int main() {\n  int n;\n  int* p = new int[n];\n  delete[] p;\n}\n`);
    const heap = blocksOf(r.snapshot, "heap");
    const p = heap.find((b) => b.name.startsWith("p"))!;
    assert.ok(p.sizeSymbolic?.includes("4·(n)") || p.sizeSymbolic?.includes("4·n"), `symbolic, got ${p.sizeSymbolic}`);
    assert.ok(p.confidence <= 0.6);
  });

  it("reports leak candidates", async () => {
    const r = await snap(`int main() {\n int* p = new int(5);\n return 0;\n}\n`);
    assert.ok(r.snapshot.issues.some((i) => i.kind === "leak"), "leak issue");
  });

  it("reports double-free and mismatched delete", async () => {
    const r = await snap(
      `int main() {\n int* a = new int[3];\n delete a;\n int* q = new int(1);\n delete q;\n delete q;\n}\n`,
    );
    assert.ok(r.snapshot.issues.some((i) => i.kind === "mismatched-delete"), "mismatch");
    assert.ok(r.snapshot.issues.some((i) => i.kind === "double-free"), "double free");
  });

  it("malloc/free pairing + mismatched delete", async () => {
    const r = await snap(`int main() {\n int* m = (int*)malloc(40);\n free(m);\n int* z = (int*)malloc(8);\n delete z;\n}\n`);
    assert.ok(r.snapshot.issues.some((i) => i.message.includes("free()")), "malloc/delete mismatch");
  });

  it("struct layout: exact offsets + padding (fallback table)", async () => {
    const r = await snap(`struct Foo {\n int x;\n char c;\n};\nint main() {\n Foo f;\n}\n`);
    const stack = blocksOf(r.snapshot, "stack");
    const f = stack.find((b) => b.name === "f")!;
    assert.ok(f.layout, "layout attached");
    assert.deepEqual(
      f.layout!.map((l) => [l.name, l.offset, l.size, l.paddingAfter]),
      [
        ["x", 0, 4, 0],
        ["c", 4, 1, 3],
      ],
    );
    assert.equal(f.sizeBytes, 8);
  });

  it("large-padding hint", async () => {
    const r = await snap(`struct Padded {\n char a;\n double d;\n char b;\n};\nint main() {\n Padded p;\n}\n`);
    assert.ok(r.snapshot.issues.some((i) => i.kind === "large-padding"), "padding hint");
  });

  it("broken code yields partial stale snapshot, never throws", async () => {
    const r = await snap(`int main() {\n int x;\n int* p = new int[10];\n`, 9);
    assert.equal(r.partial, true);
    assert.equal(r.snapshot.stale, true);
    assert.ok(blocksOf(r.snapshot, "stack").length > 0, "partial model retained");
  });

  it("smart pointers are RAII (no leak), containers approximated", async () => {
    const r = await snap(
      `int main() {\n auto p = std::make_unique<int>(5);\n std::vector<int> v;\n}\n`,
    );
    assert.ok(!r.snapshot.issues.some((i) => i.kind === "leak"), "no leak for RAII");
    const stack = blocksOf(r.snapshot, "stack");
    assert.ok(stack.some((b) => b.name === "v" && b.sizeBytes === 24), "vector approx 24");
  });

  it("dangling return + use-after-free heuristics", async () => {
    const r = await snap(
      `int* f() {\n int x = 1;\n return &x;\n}\nint main() {\n int* p = new int(1);\n delete p;\n int y = *p;\n}\n`,
    );
    assert.ok(r.snapshot.issues.some((i) => i.kind === "dangling-ref"), "dangling");
    assert.ok(r.snapshot.issues.some((i) => i.kind === "use-after-free"), "uaf");
  });

  it("layout cache + clang fallback path", async () => {
    const text = `struct Q { int a; };\nint main() { Q q; }\n`;
    const parsed = new RegexParser().parseFull(text, URI);
    const a = await getLayouts(text, parsed.records, { compilerPath: "definitely-not-a-compiler-xyz" });
    assert.equal(a.accurate, false);
    assert.ok(a.layouts.has("Q"));
  });
});
