# @memlens/analysis — static model + layout engine

Worker-thread JSON-RPC (`analyze`, `getLayouts`, `cancel`) + pure testable core.

- `parser.ts` — `ParserAdapter` + tolerant `RegexParser` fallback (ADR-001).
  The tree-sitter-cpp binding implements the same interface when available.
- `model.ts` — declarations → `MemorySnapshot`; symbolic sizes; issue heuristics
  (leak, double-free, mismatched-delete, use-after-free, dangling-ref).
- `layout.ts` — clang `-fdump-record-layouts` + SHA-256 cache + fallback table;
  reads `compile_commands.json`.
- `sizes.ts` — LP64 builtin table + container approximations.
- `bench.ts` — latency harness (`npm run bench`, budget 150 ms p95).

## Known limitations

- Regex fallback mis-parses exotic template/macro-heavy code → low confidence,
  never a crash (last-good retained, `stale` badge).
- `long` assumed 8 bytes (LP64); Windows LLP64 needs clang for exactness.
- Issue heuristics are path-insensitive (may false-positive on complex CFGs).
