import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RegexParser } from "./parser.js";
import { getLayouts } from "./layout.js";
import type { ResolvedLayout } from "./layout.js";
import { builtinTypeInfo } from "./sizes.js";
import { validateSnapshot } from "@memlens/protocol";
import type { FieldLayout } from "@memlens/protocol";
import { analyzeText } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const truthDir = join(root, "fixtures", "truth");
const cleanTu = readFileSync(join(root, "scripts", "layout-truth", "probes-clean.cpp"), "utf8");

function loadTruth(): { file: string; truth: Record<string, { sizeof: number; align: number; [f: string]: unknown }> }[] {
  return readdirSync(truthDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((file) => ({ file, truth: JSON.parse(readFileSync(join(truthDir, file), "utf8")) as Record<string, { sizeof: number; align: number }> }));
}

function detectClangPath(): string | null {
  // PATH lookup only (ignores MEMLENS_CLANG, which other test files override).
  for (const bin of ["clang", "clang++"]) {
    try {
      execFileSync(bin, ["--version"], { stdio: "pipe", timeout: 15000 });
      return bin;
    } catch {
      /* try next */
    }
  }
  return null;
}

const CLANG_BIN = detectClangPath();

/**
 * Probes the fallback table CAN model, with the ABI rule for each.
 * Everything else must be refused (asserted below) — never miscomputed.
 */
const FALLBACK_SUPPORTED = [
  "P_Plain", // SysV place-each-member-aligned; truth gcc16/win64: 8/4
  "P_Reordered", // padding trap; truth: 24/8
  "P_ReorderedOpt", // reordered; truth: 16/8
  "P_Base", // single member; truth: 4/4
  "P_B1", // truth: 4/4
  "P_B2", // double member; truth: 8/8
  "P_VBase", // plain member; truth: 4/4 (used virtually elsewhere — alone it is plain)
  "P_Empty", // C++: complete object type has nonzero size → 1/1
  "P_Union", // all members at offset 0, size = max aligned; truth: 16/8
] as const;

/** Probes that must be REFUSED by the fallback engine, with the reason. */
const FALLBACK_REFUSED: Record<string, string> = {
  P_AlignAs: "member alignas(16) changes placement",
  P_Packed: "record never parses (attribute before name) → absent",
  P_Bits: "no offsetof on bit-fields possible",
  P_Ebo: "base class (EBO rules unknowable to table)",
  P_NoEbo: "member of unknown-type record (offsets would shift)",
  P_Single: "base class",
  P_Multi: "multiple bases",
  P_Virt: "vptr (virtual fn)",
  P_Virtual: "virtual base + vptr",
  P_Nouaddr: "[[no_unique_address]] elision unknowable",
  P_Nested: "nested record definition (truncated body)",
};

describe("layout truth (oracle: real compilers, fixtures/truth/*.json)", () => {
  it("fallback matches truth exactly on the supported subset", async () => {
    const files = loadTruth();
    assert.ok(files.length > 0, "need at least one truth file (run node scripts/gen-layout-truth.mjs)");
    const parsed = new RegexParser().parseFull(cleanTu, "probes-clean");
    const { layouts, accurate } = await getLayouts(cleanTu, parsed.records, { compilerPath: "definitely-not-a-compiler-xyz" });
    assert.equal(accurate, false, "forced fallback path");
    for (const { file, truth } of files) {
      for (const probe of FALLBACK_SUPPORTED) {
        const want = truth[probe] as { sizeof: number; align: number; [f: string]: { offset: number; size: number } | number };
        const got = layouts.get(probe);
        assert.ok(got, `${file}: ${probe} must have a fallback layout`);
        assert.equal(got.totalSize, want.sizeof, `${file}: ${probe} sizeof`);
        assert.equal(got.align, want.align, `${file}: ${probe} align`);
        for (const [fname, f] of Object.entries(want)) {
          if (fname === "sizeof" || fname === "align") continue;
          const lay: ResolvedLayout = got!;
          const g: FieldLayout | undefined = lay.fields.find((x) => x.name === fname);
          assert.ok(g, `${file}: ${probe}.${fname} present`);
          assert.equal(g!.offset, (f as { offset: number }).offset, `${file}: ${probe}.${fname} offset`);
          assert.equal(g!.size, (f as { size: number }).size, `${file}: ${probe}.${fname} size`);
        }
      }
    }
  });

  it("fallback refuses (never miscomputes) the unmodelable set", async () => {
    const parsed = new RegexParser().parseFull(cleanTu, "probes-clean");
    const { layouts } = await getLayouts(cleanTu, parsed.records, { compilerPath: "definitely-not-a-compiler-xyz" });
    for (const [probe, reason] of Object.entries(FALLBACK_REFUSED)) {
      assert.ok(!layouts.has(probe), `${probe} must be refused (${reason}), got a layout`);
    }
  });

  it("ABI fundamentals match truth (LLP64 vs LP64 platform table)", () => {
    const files = loadTruth();
    assert.ok(files.length > 0);
    for (const { file, truth } of files) {
      const abi = truth["abi"] as unknown as { pointer: number; long: number; stdlib: string };
      // Only assert when the truth file matches THIS machine's platform —
      // otherwise the table is (correctly) platform-specific.
      const here = `${process.platform}-${process.arch}`;
      if (!file.includes(here)) continue;
      assert.equal(builtinTypeInfo("void*")!.size, abi.pointer, `${file}: pointer size`);
      assert.equal(builtinTypeInfo("long")!.size, abi.long, `${file}: long size (LLP64=${abi.long === 4})`);
    }
  });

  it("container approximations match libstdc++ truth", () => {
    const files = loadTruth().filter(({ truth }) => String((truth["abi"] as unknown as { stdlib: string }).stdlib).startsWith("libstdc++"));
    assert.ok(files.length > 0, "need a libstdc++ truth file for container checks");
    const cases: [string, string][] = [
      ["std::string", "std::string"],
      ["std::vector<int>", "std::vector"],
      ["std::unique_ptr<int>", "std::unique_ptr"],
      ["std::shared_ptr<int>", "std::shared_ptr"],
      ["std::map<int,int>", "std::map"],
    ];
    for (const { file, truth } of files) {
      for (const [probe, tableKey] of cases) {
        const want = truth[probe] as { sizeof: number; align: number };
        const got = builtinTypeInfo(tableKey)!;
        assert.equal(got.size, want.sizeof, `${file}: ${probe} size (stdlib ${String((truth["abi"] as unknown as { stdlib: string }).stdlib)})`);
        assert.equal(got.align, want.align, `${file}: ${probe} align`);
      }
    }
  });

  it("model blocks carry layoutSource + validate (fallback here)", async () => {
    const res = await analyzeText({
      requestId: "truth",
      uri: "file:///truth.cpp",
      docVersion: 1,
      text: "struct Foo { int x; char c; };\nint main() {\n Foo f;\n}\n",
      languageId: "cpp",
      fidelity: "static",
    });
    const withLayout = res.snapshot.regions.flatMap((r) => r.blocks).filter((b) => b.layout);
    assert.ok(withLayout.length > 0, "expected a block with layout");
    for (const b of withLayout) {
      assert.equal(b.layoutSource, res.layoutAccurate ? "compiler" : "fallback");
      assert.ok(b.confidence <= 0.6 || res.layoutAccurate, "fallback confidence capped");
    }
    assert.deepEqual(validateSnapshot(res.snapshot), []);
  });

  it("clang path matches truth on ALL probes (incl. inheritance/vptr)", { skip: CLANG_BIN === null }, async () => {
    const files = loadTruth();
    const parsed = new RegexParser().parseFull(cleanTu, "probes-clean");
    // Each truth file comes from one ABI (MinGW GCC, Linux GCC, MSVC, …) and
    // layouts legitimately differ between them (MSVC ignores
    // [[no_unique_address]], for one). Compile for the truth file's own target
    // so we compare like with like. probes-clean.cpp has no #includes, so
    // retargeting needs no extra headers.
    for (const { file, truth } of files) {
      const prov = (truth as { provenance?: { target?: string; compilerCommand?: string; platform?: string } }).provenance ?? {};
      const target =
        prov.target && prov.target !== "unknown"
          ? prov.target
          : prov.platform?.startsWith("win32") && prov.compilerCommand !== "cl"
            ? "x86_64-w64-windows-gnu"
            : undefined;
      const compileArgs = target ? [`--target=${target}`] : [];
      // Cold CI runners can take several seconds for the first clang start.
      const { layouts, accurate, errors } = await getLayouts(cleanTu, parsed.records, { compilerPath: CLANG_BIN!, compileArgs, timeoutMs: 60000 });
      assert.equal(accurate, true, `${file}: clang path must be accurate (target ${target ?? "default"}); errors: ${errors.join("; ")}`);
      for (const [probe, want] of Object.entries(truth)) {
        if (probe === "abi" || probe === "provenance" || probe === "P_Fund" || probe === "P_Bits" || probe.startsWith("std::")) continue;
        const w = want as { sizeof: number; align: number; [f: string]: { offset: number; size: number } | number };
        const got = layouts.get(probe);
        assert.ok(got, `${file}: clang layout for ${probe}`);
        assert.equal(got!.totalSize, w.sizeof, `${file}: ${probe} sizeof`);
        for (const [fname, f] of Object.entries(w)) {
          if (fname === "sizeof" || fname === "align") continue;
          const lay: ResolvedLayout = got!;
          const g: FieldLayout | undefined = lay.fields.find((x) => x.name === fname);
          assert.ok(g, `${file}: ${probe}.${fname}`);
          assert.equal(g!.offset, (f as { offset: number }).offset, `${file}: ${probe}.${fname} offset`);
        }
      }
    }
  });
});

if (CLANG_BIN === null) {
  console.log("Note: clang NOT on PATH — clang-path truth test skipped. To verify:\n  1. install clang (winget install LLVM.LLVM / apt install clang)\n  2. node scripts/gen-layout-truth.mjs --force   (adds a clang truth file)\n  3. npm run test -w @memlens/analysis            (clang test runs, asserts exact match)");
}
