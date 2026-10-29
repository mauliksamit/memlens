# ADR-008: Execution steps and relationship certainty

## Decision

Add optional `ExecutionStep` and `MemoryChange` contracts for source-linked
step navigation, and enrich pointer relationships with semantic kind and
certainty/source metadata. Existing snapshots and relationships remain valid.

Static edit snapshots are not runtime execution traces. A consumer must label
steps according to fidelity and may only derive changes from known
before/after snapshots.

## Rationale

MemLens needs a causal learning flow—source context, current state, and what
changed—without turning heuristic analysis into false runtime certainty.

## Compatibility

This additive protocol minor version is `1.3.0`. All new fields are optional
or new message payload types.
