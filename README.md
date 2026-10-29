# MemLens — live C++ memory visualizer for VS Code

See a live picture of your program's memory **as you type**: stack frames, heap
allocations, globals/statics, object layouts with exact offsets and padding —
plus what **changed** since your last edit, and leak/lifetime hazards inline.

Three fidelity levels, always labelled so you know how trustworthy a number is:

| Level | When | Trust |
|---|---|---|
| **Static** (live, per keystroke) | incremental tolerant parse + compiler layouts | approximate for dynamic behaviour; unknown sizes shown symbolic (`4·n bytes`), never invented |
| **Traced** (on save / on demand) | instrumented build, real allocation events replayed | measured |
| **Debugger** (attached) | real memory via GDB/LLDB (DAP) | live |

## Install

**From source (this repo):**

```sh
npm install
npm run build
npm run test
```

Then open `packages/extension` in VS Code (`F5` → "Run Extension"), or install
the packaged build:

```sh
npm run package -w memlens-extension   # produces memlens-extension-0.1.0.vsix
code --install-extension packages/extension/memlens-extension-0.1.0.vsix
```

Requirements: VS Code ≥ 1.90, Node ≥ 18. Clang/GCC optional but recommended
(exact struct layouts; without clang a builtin LP64 table is used and labelled
lower-confidence). Linux/macOS first-class; Windows best-effort
(see `packages/tracer/README.md`).

## Usage

1. Open any C++ file → `MemLens: Open Memory View` (or the MemLens activity icon).
2. Type. After you pause briefly, the memory map updates (debounced, default 400 ms,
   setting `memlens.debounceMs`); broken code keeps the last-good view with a
   **stale** badge instead of going blank.
3. Click a block (or Tab + Enter) to inspect field offsets/padding; scrub the
   timeline (←/→) to review diffs; check the Issues panel for leaks,
   double-frees, mismatched `new[]/delete`, use-after-free hints, dangling refs.
4. **Debugger mode**: start a GDB/LLDB debug session; stepping refreshes the
   map with real addresses (adapter must support `readMemory`/variables).

Settings: see the extension README (`packages/extension/README.md`).

## Architecture

```
packages/protocol   frozen contract v1.0.0 (snapshots, events, diffs, RPC)
packages/analysis   tolerant parse → static model → clang layouts (worker thread)
packages/extension  watcher (debounce/cancel) → client → MemoryStore → webview
packages/tracer     allocator shim + build-and-run library (not shipped in the extension)
packages/debugger   DAP reducer + variable→block mapping (debugger mode)
packages/webview    SVG memory map, struct layout, timeline, issues (no framework)
fixtures/           11 C++ samples + golden snapshots
docs/adr/           frozen decisions (parser, layouts, worker, shim, mock-first UI)
```

Full contract and decisions: `docs/ARCHITECTURE.md`, `docs/adr/`.
Troubleshooting: `docs/TROUBLESHOOTING.md`. What's deferred: `docs/BACKLOG.md`.

## Benchmarks (this machine, static layer, 1,952-line file)

- keystroke → snapshot: **p50 8.4 ms / p95 11.8 ms** (budget ≤ 150 ms) —
  `npm run bench -w @memlens/analysis`
- 100k-block LOD collapse: ~32 ms, ≤ 500 SVG nodes (`@memlens/webview` tests)

## Test & CI

`npm run test` — 34 tests across 6 packages + 11 golden fixtures; CI runs
Linux/macOS/Windows (`.github/workflows/ci.yml`).
