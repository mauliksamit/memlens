# ADR-006: Block.layoutSource ("compiler" vs "fallback") — protocol 1.1.0

- Status: accepted (0.2.0)
- Date: 2026-10-02
- Supersedes: nothing (additive to ADR-002)

## Context

We proved layout accuracy against a real compiler (GCC 16.1.0,
`fixtures/truth/`). Two layout provenances exist: exact compiler dumps and the
fallback table. The UI previously showed both under one "STATIC · approx"
badge, so users could not tell a measured offset from a table estimate.

## Decision

- Add optional `Block.layoutSource?: "compiler" | "fallback"`, set whenever a
  block carries a `layout`. `compiler` = clang record-layout dump (or a
  platform-verified builtin hit? No — strictly the dump path);
  `fallback` = builtin-table computation.
- Protocol **1.0.0 → 1.1.0** (minor: purely additive optional field;
  1.0.0 readers ignore it; 1.1.0 readers treat absence as "unknown").
- Webview renders a distinct badge: "compiler-verified" vs
  "estimated — no compiler data". Fallback blocks keep the capped confidence
  (≤ 0.6) from ADR-002.
- The fallback engine now *refuses* (no layout, symbolic size) records it
  cannot model — bases, virtuals, bit-fields, alignas/pack, no_unique_address —
  instead of emitting wrong offsets. Refusal lists are asserted in tests.

## Consequences

- Every layout number in the UI is traceable to its provenance.
- `docs/reports/fallback-accuracy.md` records per-probe fallback-vs-truth results.
