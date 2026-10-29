# ADR-005: Webview UI renders from mock MemoryStore from day one

- Status: accepted (Phase 0)
- Date: 2026-10-02

## Context

UI work must not block on analysis/extension completion.

## Decision

- `packages/webview` builds against a **mock MemoryStore** fixture
  (`mockSnapshot.ts`) implementing the frozen protocol.
- Rendering uses SVG (+ canvas path for > 10k blocks via LOD/virtualization);
  no heavy framework required for M0–M2 — plain TypeScript + SVG keeps the
  build (`esbuild`) dependency-light and testable in jsdom-less unit tests.
  (A React/Svelte migration is explicitly backlogged, not M0 scope.)
- Palette is colour-blind-safe by default; theming via VS Code CSS variables;
  keyboard navigation for blocks and timeline.

## Consequences

- M0 (extension loads + webview shows mock snapshot) is achievable in Phase 1.
- Real-store wiring is a message-protocol swap, not a rewrite.
