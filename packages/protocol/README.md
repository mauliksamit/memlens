# @memlens/protocol v1.3.0 — shared contract

> **Frozen in Phase 0.** Any change requires an ADR (`docs/adr/`) + semver bump.

Contents:

- `src/index.ts` — TypeScript types: `MemorySnapshot`, `Region`, `Block`, `FieldLayout`,
  `MemoryEvent`, `SnapshotDiff`, `Issue`, webview⇄host messages, JSON-RPC `analyze`/`getLayouts`/`cancel`.
- `src/validate.ts` — runtime validators, `parseTraceLine` (NDJSON), `diffSnapshots`.
- `schema.json` — JSON Schema mirror for cross-language validation (C++ shim, external tools).

Trace stream: newline-delimited JSON, one `MemoryEvent` per line (see `TRACE_STREAM`).

## Version history

- `1.1.0` — additive: `Block.layoutSource?: "compiler" | "fallback"` (ADR-006).
- `1.2.0` — additive: `Block.pointsTo?: PointerRelationship[]` (ADR-007).
- `1.3.0` — additive: execution-step/change types and relationship certainty metadata (ADR-008).
- `1.0.0` — initial frozen contract (Phase 0).
