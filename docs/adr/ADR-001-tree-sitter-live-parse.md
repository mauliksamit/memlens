# ADR-001: Incremental parsing via tree-sitter-cpp with tolerant fallback

- Status: accepted (Phase 0)
- Date: 2026-10-02

## Context

Live-per-keystroke analysis must tolerate uncompilable code. The real
compiler (clang/gcc) fails on most keystroke states.

## Decision

- Live structure comes from an **incremental, error-tolerant parser**
  (`tree-sitter-cpp`) in the analysis worker.
- `sizeof`/alignment/padding **never** come from the parser; they come from
  the compiler via `clang -Xclang -fdump-record-layouts` on debounced,
  syntactically-valid snapshots (see ADR-002).
- The parser interface is abstracted (`ParserAdapter`) so a regex-based
  tolerant fallback can stand in where the native tree-sitter binding is
  unavailable (e.g. Windows CI without prebuilds), with degraded fidelity
  clearly labelled low-confidence.

## Consequences

- Typing never blocks on compilation.
- Layout numbers shown live may be stale; UI must show a "stale" badge
  (protocol `MemorySnapshot.stale`).
