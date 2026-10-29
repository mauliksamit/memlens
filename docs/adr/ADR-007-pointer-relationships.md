# ADR-007: Explicit pointer relationships

## Decision

Add an optional `Block.pointsTo` field containing stable target block ids and
an optional display label. The field is additive and remains absent when the
analysis or debugger cannot prove a relationship.

## Rationale

The UI should not infer edges from variable names, addresses, or display text.
Explicit relationships let the visualizer explain pointer ownership and
references without drawing misleading arrows. The webview can still render a
useful memory map when no edges are available.

## Compatibility

This is a backward-compatible protocol minor version (`1.2.0`). Producers may
omit the field; consumers must treat omission as “relationship unknown”, not
“no relationship”.
