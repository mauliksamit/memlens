# Changelog

## 0.2.0: first Marketplace release

### New
- **Problems panel and squiggles** for possible leaks, double frees, mismatched
  `new[]`/`delete`, use after free, dangling references and large padding
  (`memlens.diagnostics.*`).
- **Quick fixes**: rewrite to `delete[]` / `delete` / `free()`, and *Reorder
  fields to save N B* (moves whole lines; refuses when unsafe).
- **CodeLens** above every struct/class/union: `sizeof`, padding and layout
  provenance, plus a one-click reorder when it would shrink the type.
- **Hovers** with size, region, lifetime and field offsets.
- **Live debugger frames**: when a `cppdbg`/`cppvsdbg`/CodeLLDB session pauses,
  the view shows locals with real addresses and pointer → heap edges, with one
  history step per stop. A Static/Debugger switch sits at the top of the view.
- Allocation tracing is no longer part of the extension (it only worked on
  Linux/macOS with a hand-built shim). It remains available as the
  `packages/tracer` library.
- Redesigned memory view: sticky summary toolbar, one history scrubber,
  collapsible regions, filter (`/`), **Types** list with byte maps (hatched
  padding), sticky inspector, clickable issues, double-click to jump to source,
  editor cursor selects the matching block, state survives reloads.
- Walkthrough, keybinding (Ctrl/Cmd+Alt+M), editor title button, context menu,
  status bar summary with tooltip, `MemLens` output channel.

### Fixed
- **Compiler layouts were wrong or missing.** The clang input rebuilt each
  struct from its parsed fields, dropping base classes, `virtual`, `alignas`
  and bit-fields, so clang either failed or returned the layout of a different
  type labelled "compiler-verified". MemLens now compiles your real file (with
  one `sizeof` per record to force layout), recovers layouts even when the code
  you're typing has errors, ignores nested members when reading clang's dump,
  and only re-runs clang when something outside function bodies changes.
  Verified in CI against real GCC and clang output on Linux, macOS and Windows.
- Structs declared as `struct __attribute__((packed)) S` / `struct alignas(N) S`
  were not recognised.
- `memlens.compilerPath`, `memlens.extraFlags` and `memlens.themePalette` were
  ignored; they now take effect.
- Histories from different files mixed and snapshot ids collided. History is now
  kept per file and per data source, and the last good snapshot per file.
- A failed analysis no longer pops an error toast on every keystroke.
- Class members after an access label (`public: int x;`) were dropped from
  fallback layouts.
- Lifetime findings follow simple pointer copies (`b = a;`, `p = nullptr;`):
  frees count against the allocation the pointer holds, and an allocation whose
  last pointer is overwritten is reported as a leak on the right variable
  (previously a false "mismatched delete" plus a leak on the wrong variable).
- Struct/class fields were listed as global variables.
- `auto p = std::make_unique<T>()` / `make_shared` / `new T` now get real sizes
  instead of `sizeof(auto)`.
- Heap blocks use C++ spelling (`new int[5]`, `make_unique<T>`) instead of
  internal names (`newArray int`).
- Timeline step buttons were wired N times (or not at all).
- The CSP nonce is now cryptographically random; C files activate the extension.

### Protocol
- `@memlens/protocol` 1.4.0 (ADR-009, additive): `MemorySnapshot.uri`,
  `records`, `layoutAccurate`; `AnalyzeParams.compilerPath`; `history` and
  `select` host messages; shared `planReorder` helpers.

## 0.2.0-pre: hardening

### Layout accuracy proven vs real compiler (done, verified below)
- `scripts/layout-truth/probes.cpp` + `scripts/gen-layout-truth.mjs`: oracle
  covering padding/reordering, alignas, pack, bitfields, EBO, single/multiple/
  virtual inheritance, vptr, unions, `[[no_unique_address]]`, nesting, and
  five standard containers. Truth committed at
  `fixtures/truth/g++-*-win32-x64.json` (real GCC 16.1.0, MSYS2 UCRT64;
  ABI recorded: ptr=8, long=4, long double=16, libstdc++ 16).
- Caught and fixed by the oracle: `long` was 8 in the fallback table on
  Windows (LLP64 = 4) → platform-aware table with per-entry ABI annotations.
- Fallback engine now refuses unmodelable records (bases, virtuals,
  bit-fields, alignas/pack, no_unique_address, nested, unknown members) —
  measured: **15 exact matches / 0 mismatches / 10 honest refusals**
  (`docs/reports/fallback-accuracy.md`).
- Protocol 1.0.0 → **1.1.0** (ADR-006, additive): `Block.layoutSource`;
  webview shows "compiler-verified" vs "estimated — no compiler data" badges.
- Fixture goldens are now fallback-path baselines on every machine
  (tripwires, human-reviewed on regen); the compiler oracle lives in
  `layout-truth.test.ts`. Fixed fallout: inheritance/templates goldens now
  use symbolic sizes instead of fabricated layouts.
- New CI workflow `layout-truth.yml` (ubuntu gcc+clang, macOS clang,
  Windows LLVM) — **unverified** (cannot run GitHub Actions here); run:
  push to GitHub and read the `layout-truth` job logs.

## 0.1.0 (2026-10-02) — release candidate (M0–M5 skeleton + static/traced/debugger core)

- Frozen protocol `@memlens/protocol` v1.0.0 (snapshots, events, diffs, RPC, NDJSON).
- Live static view: tolerant parse, symbolic sizes, clang layouts w/ cache + fallback.
- Diffs + timeline scrubber + issues (leak, double-free, mismatched-delete,
  use-after-free, dangling-ref, large-padding).
- Traced mode: allocator shim (Linux/macOS), ASan fallback, opt-in + caps.
- Debugger mode: DAP reducer, variable→block mapping, real addresses.
- Webview: SVG map, struct view, colour-blind-safe palette, keyboard nav, LOD.
- QA: 11 fixtures + goldens, 34 tests, latency harness (p95 ≈ 12 ms), CI trio.
