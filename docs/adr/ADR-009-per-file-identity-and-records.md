# ADR-009: Per-file snapshot identity, record summaries, editor sync

## Decision

Additive protocol minor `1.4.0`:

- `MemorySnapshot.uri?` and URI-qualified snapshot ids — histories are kept
  per document so switching files never mixes or collides snapshots.
- `MemorySnapshot.records?: RecordInfo[]` — every struct/class/union in the
  file with its (compiler or fallback) layout and per-field source lines.
  Drives CodeLens ("sizeof 24 B · 7 B padding") and the "reorder fields to
  minimise padding" quick fix without re-running analysis.
- `MemorySnapshot.layoutAccurate?` — surfaced in the status bar tooltip.
- `AnalyzeParams.compilerPath?` — the `memlens.compilerPath` setting now
  reaches the layout engine (it was previously ignored).
- Host → webview `history` (replace history on file switch) and `select`
  (editor cursor selects a block).

## Compatibility

All fields optional / new message variants. 1.3.0 consumers ignore them.
