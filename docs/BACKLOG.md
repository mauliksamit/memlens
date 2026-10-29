# Backlog (explicitly out of M0–M5 scope — do not start without an ADR)

## Added in 0.2.0 hardening (with minimal repros / pointers)
- MSVC `long double` = 8 vs table's MinGW 16 on win32 (`sizes.ts`
  assumes MinGW; MSVC needs the clang path for exactness).
- cross-record member lookup in fallback (e.g. member of a known empty
  record, `P_NoEbo.e`) — currently honest refusal + symbolic sizeof.
  Repro: `scripts/layout-truth/probes-clean.cpp` P_NoEbo.
- libc++ container sizes differ from the libstdc++-based table
  (libc++ `std::string` = 24, table says 32) — needs per-stdlib table keyed
  off the truth `abi.stdlib`, or the clang path.
- verify `.github/workflows/layout-truth.yml` on a real push
  (unverified locally — no ability to run GitHub Actions here).
- nested-record parsing (`P_Nested` refused by old parser;
  tree-sitter rewrite must model or explicitly refuse with reason).

## Original 0.1.0 items

- tree-sitter-cpp native binding behind `ParserAdapter` (regex fallback ships).
- React/Svelte webview migration (vanilla SVG ships; migrate only on profile evidence).
- Canvas virtualization renderer (SVG + LOD ships; revisit past 500-node pressure).
- Windows allocator interposition (Detours/ETW); project-dir ASan fallback.
- Shim stack symbolication via `addr2line` (frames carry raw addresses today).
- `readMemory` live-bytes view in debugger mode.
- Multi-TU / whole-program static model (current: single-file + includes).
- Template/macro-heavy CFG-sensitive analysis (current: path-insensitive heuristics).
- Marketplace auto-publish workflow (manual `vsce publish`, see docs/PUBLISHING.md).
- Multi-level pointer expansion and struct members in debugger snapshots (one level today).
- Docs anchors per diagnostic code (needs a public repo URL).
