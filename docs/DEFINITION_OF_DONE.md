# Definition of Done (global, all milestones)

- [ ] Code + tests + per-package `README` + known-limitations note.
- [ ] Protocol untouched, or changed via ADR + version bump + announcement.
- [ ] `npm run build` green; `npm run test` green; CI green.
- [ ] Static analysis/layout packages ≥ 80% line coverage on new code.
- [ ] No fabricated numbers: every block shows fidelity + confidence;
      unknown sizes are symbolic.
- [ ] Typing path: keystroke → UI ≤ 150 ms p95 on 2,000-line file
      (benchmark harness); host main thread never blocked > 16 ms.
- [ ] Malformed input never crashes the worker; last-good retained + `stale` badge.
- [ ] Traced mode: explicit opt-in, timeout + output cap, never auto-runs.

## Milestone exit criteria

- M0 Skeleton: extension loads, webview shows (mock) snapshot, CI green.
- M1 Live static: typing `int x; int* p = new int[10];` updates stack+heap
  within budget; struct view shows compiler offsets/padding.
- M2 Diffs/history: timeline scrubber, change highlighting, issues
  (leak candidates, mismatched new[]/delete).
- M3 Traced: "Run with MemLens" replays real events; leaks with sources.
- M4 Debugger: attach reflects real addresses; stepping updates the view.
- M5 Release: perf + a11y + cross-platform pass, docs, `.vsix`.
