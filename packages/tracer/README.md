# @memlens/tracer — traced mode

- `shim/shim.cpp` — `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES` allocator shim
  (`malloc/calloc/realloc/free`, `new/delete`) emitting NDJSON `MemoryEvent`s
  to `$MEMLENS_TRACE_OUT`. Build:
  `g++ -shared -fPIC -o libmemlens_shim.so shim.cpp -ldl -rdynamic`.
- `src/index.ts` — `runTraced()` orchestration: single-file or CMake project
  build, shim run with timeout + output cap, NDJSON parsing; ASan-log fallback
  (`parseAsanLog`); `analyzeEvents()` leak/double-free detection.

## Platform support matrix

| Platform | Shim | ASan fallback |
|----------|------|---------------|
| Linux | ✅ first-class | ✅ |
| macOS | ✅ (`DYLD_INSERT_LIBRARIES`, SIP caveats) | ✅ |
| Windows | ❌ not supported (Detours/ETW = backlog) | ✅ best-effort |

## Known limitations

- Call stacks in shim events are raw addresses; symbolication via `addr2line`
  is a backlog item — frames carry `function: "<addr>"` today.
- Project-dir ASan fallback only supports single-file rebuilds so far.
- Traced mode never runs without `optIn: true` (workspace `traceOptIn`).
