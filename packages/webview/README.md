# @memlens/webview — visualization

Vanilla TypeScript + SVG (no framework; see ADR-005). `npm run build`
bundles `src/main.ts` → `dist/webview.js` (+ `webview.css`); the extension
copies both into `media/` for the `.vsix`.

- `render.ts` — DOM-free SVG/table builders (memory map, struct layout,
  timeline, issues); unit-tested in Node.
- `lod.ts` — level-of-detail collapse (100k+ blocks → ≤ 500 nodes).
- `palette.ts` — colour-blind-safe default (Okabe–Ito), high-contrast option.
- `main.ts` — runtime: protocol messages, history scrubber, keyboard nav
  (Tab + Enter on blocks, ←/→ on timeline), `vscode` CSS-variable theming.
- `mock.ts` — mock MemoryStore snapshot; also used standalone for UI dev.

## Known limitations

- Canvas virtualization (vs SVG) is a follow-up if real-world profiles show
  SVG pressure; current LOD keeps node counts bounded.
- Trace-event replay animation reuses the snapshot path (per-event blocks
  arrive via `events` messages; full replay UI lives in the extension).
