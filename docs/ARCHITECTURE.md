# MemLens — architecture (frozen Phase 0)

```
VS Code Extension Host (TypeScript)          packages/extension
 ├─ EditorWatcher        onDidChangeTextDocument → debounce → snapshot
 ├─ AnalysisClient       JSON-RPC (analyze/getLayouts/cancel) → analysis worker
 ├─ TraceRunner          build + run instrumented binary, stream NDJSON events
 ├─ DebugBridge          DAP tracker → memory reads / variable layouts
 ├─ MemoryStore          single source of truth: snapshots, events, diffs
 └─ WebviewPanel         posts MemoryStore updates (protocol messages)

Analysis Worker (Node worker thread)         packages/analysis
 ├─ ParserAdapter        tree-sitter-cpp incremental (regex fallback w/ same API)
 ├─ Static model builder declarations, allocations, scopes, lifetimes
 └─ Layout provider      clang record-layout dump, cached by content hash

Webview UI (TypeScript + SVG)                packages/webview
 ├─ Memory map view     stack / heap / static regions, blocks sized by bytes
 ├─ Struct layout view  field offsets, padding holes, alignment
 ├─ Timeline view       scrubbable history of snapshots/events, diff overlay
 └─ Issues panel        leaks, double free, use-after-free hints, dangling refs
```

Contracts: `packages/protocol` v1.0.0 (frozen). Protocol changes need an ADR +
version bump. See `docs/adr/`.

Platform matrix: Linux + macOS first-class (shim via LD_PRELOAD /
DYLD_INSERT_LIBRARIES, clang/gcc). Windows best-effort (no interposition shim
yet; ASan-log fallback; clang layout via clang-cl when present, else table).
