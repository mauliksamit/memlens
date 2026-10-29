# ADR-002: Compiler-accurate layouts with content-hash cache

- Status: accepted (Phase 0)
- Date: 2026-10-02

## Context

Accurate `sizeof`, alignment and padding must come from the compiler, not
guesses. Running clang per keystroke is too slow and fails on broken code.

## Decision

- `LayoutProvider` shells out to
  `clang -Xclang -fdump-record-layouts -fsyntax-only` (fallback: gcc
  `-fdump-lang-*` / builtin table) on a **debounced snapshot** of the
  compilable TU (extracted includes + record definitions + `compile_commands.json`
  flags when present).
- Results cached by **SHA-256 of (normalized TU text + compiler flags)**.
- On compile failure: keep last-good result, mark snapshot `stale: true`,
  surface compiler stderr in the output channel (not as a crash).
- Unknown/dynamic sizes are **symbolic** (`4·n`), never fabricated.

## Consequences

- Layout numbers are trustworthy when `layoutAccurate === true`.
- Extra clang invocation cost is amortized; typing path stays < 150 ms p95.
