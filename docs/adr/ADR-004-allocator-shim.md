# ADR-004: Runtime truth via allocator shim + sanitizer cross-check

- Status: accepted (Phase 0)
- Date: 2026-10-02

## Context

Static analysis cannot know runtime values. Runtime truth needs real
allocation events with size/address/thread/stack.

## Decision

- **Traced mode**: `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES` allocator shim
  (`packages/tracer/shim`) interposing `malloc/free/new/delete/realloc`,
  emitting NDJSON `MemoryEvent`s. Windows: best-effort via Detours/ETW
  documented gap; fallback to ASan/LSan log parsing where interposition
  is unavailable.
- ASan/LSan/Valgrind output used as **cross-check**, not primary source.
- Traced mode requires explicit per-workspace opt-in, a build timeout and an
  output cap; never auto-runs on workspace open (safety NFR).

## Consequences

- Linux/macOS first-class; Windows best-effort (support matrix in tracer README).
- Exactly one event-stream format (protocol NDJSON) regardless of platform.
