import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTuSnapshot,
  cacheSize,
  clearLayoutCache,
  discoverCompileArgs,
  getLayouts,
  parseClangRecordDump,
} from "./layout.js";
import { RegexParser } from "./parser.js";
import { contentHash, getLayoutsRpc } from "./index.js";

const DUMP = `*** Dumping AST Record Layout
         0 | struct Foo
         0 |   int x
         4 |   char c
           | [sizeof=8, align=4]

         0 | struct Bar
         0 |   double d
         8 |   int i
           | [sizeof=16, align=8]
`;

describe("layout engine", () => {
  it("parses clang record dumps (offsets + sizeof from compiler)", () => {
    const m = parseClangRecordDump(DUMP);
    const foo = m.get("Foo")!;
    assert.ok(foo, "Foo parsed");
    assert.deepEqual(foo.fields.map((f) => [f.name, f.offset]), [["x", 0], ["c", 4]]);
    assert.equal(foo.totalSize, 8);
    assert.equal(foo.align, 4);
    assert.equal(foo.fields[1].paddingAfter, 3);
    assert.equal(m.get("Bar")!.totalSize, 16);
  });

  it("builds the TU from the real file plus a sizeof per record", () => {
    const tu = buildTuSnapshot(`#include <vector>\nint main(){}\n`, [
      { name: "R", kind: "struct", fields: [{ name: "a", type: "int", line: 0, col: 0 }], bases: [], line: 0, endLine: 0, hasAccessSpecifiers: false, hasVirtualFn: false, hasVirtualBase: false, hasBitfields: false, hasAlignas: false, hasPacked: false, hasNoUniqueAddress: false, hasNested: false },
    ]);
    assert.ok(tu.startsWith("#include <vector>\nint main(){}"), "original text kept verbatim");
    assert.ok(tu.includes("sizeof(R)"), "layout of R is forced");
  });

  it("parses real clang dumps: bases, vptrs and nested members are not fields", () => {
    const dump = [
      "*** Dumping AST Record Layout",
      "         0 | struct Inner",
      "         0 |   int x",
      "           | [sizeof=4, dsize=4, align=4,",
      "           |  nvsize=4, nvalign=4]",
      "",
      "*** Dumping AST Record Layout",
      "         0 | struct Derived",
      "         0 |   (Derived vtable pointer)",
      "         8 |   struct Base (base)",
      "         8 |     int a",
      "        12 |   char c",
      "        16 |   struct Inner in",
      "        16 |     int x",
      "           | [sizeof=24, dsize=20, align=8,",
      "           |  nvsize=20, nvalign=8]",
      "",
    ].join("\n");
    const m = parseClangRecordDump(dump);
    const d = m.get("Derived")!;
    assert.deepEqual(d.fields.map((f) => [f.name, f.offset, f.size]), [["c", 12, 1], ["in", 16, 4]]);
    assert.equal(d.totalSize, 24);
    assert.equal(d.align, 8);
    assert.equal(d.fields[0].paddingAfter, 3);
    assert.equal(d.fields[1].paddingAfter, 4, "tail padding from compiler sizeof");
    assert.equal(m.get("Inner")!.totalSize, 4);
  });

  it("discovers compile flags / caches by content hash", async () => {
    assert.deepEqual(await discoverCompileArgs(undefined), []);
    assert.deepEqual(await discoverCompileArgs("C:\\definitely\\not\\a\\project"), []);
    clearLayoutCache();
    assert.equal(cacheSize(), 0);
    const text = `struct Q { int a; };\nint main() { Q q; }\n`;
    const parsed = new RegexParser().parseFull(text, "u");
    const a = await getLayouts(text, parsed.records, { compilerPath: "definitely-not-a-compiler-xyz" });
    assert.equal(a.accurate, false);
    assert.ok(a.layouts.has("Q"));
  });

  it("getLayouts RPC + contentHash helpers", async () => {
    assert.equal(contentHash("abc").length, 16);
    const res = await getLayoutsRpc({
      requestId: "r",
      typeNames: ["Missing"],
      tuText: "struct Q { int a; };\n",
    });
    assert.deepEqual(res.layouts, {});
  });
});
