# ADR-003: Analysis off the UI thread over JSON-RPC (stdio)

- Status: accepted (Phase 0)
- Date: 2026-10-02

## Context

Analysis must never block the extension host (> 16 ms budget) and must be
cancellable + debounced.

## Decision

- Analysis runs in a **worker thread** (`packages/analysis`), spoken to via
  JSON-RPC 2.0 (`analyze`, `getLayouts`, `cancel`) over newline-delimited
  stdio-equivalent message framing (worker `postMessage` in-process;
  same framing reused for a native sidecar later).
- `EditorWatcher` debounces (default 120 ms), sends full-text snapshots with
  incrementing `docVersion`, cancels superseded `requestId`s.
- `MemoryStore` is the single source of truth; the webview only renders what
  the store posts (`snapshot` / `diff` / `events` / `status` messages).

## Consequences

- Typing latency is decoupled from analysis cost.
- The protocol package can be reused unchanged if the worker becomes a
  native sidecar process.
