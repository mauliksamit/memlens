# Fixture list (golden snapshots in `fixtures/expected/`)

| # | Fixture | Covers |
|---|---------|--------|
| 01 | `stack_only.cpp` | locals, arrays, scope lifetimes |
| 02 | `heap_basic.cpp` | `new/delete`, `new[]/delete[]`, `malloc/free` |
| 03 | `leak.cpp` | missing `delete` → `leak` issue |
| 04 | `double_free.cpp` | double `delete` → `double-free` issue |
| 05 | `mismatch.cpp` | `new[]` + `delete` → `mismatched-delete` |
| 06 | `padding.cpp` | struct padding holes → `large-padding` hint + exact offsets |
| 07 | `inheritance.cpp` | base + vptr layout |
| 08 | `templates.cpp` | unresolved sizes → symbolic, low confidence |
| 09 | `containers.cpp` | `vector/string/map` approximations |
| 10 | `threads.cpp` | threaded alloc sites (traced mode) |
| 11 | `broken.cpp` | syntax error → partial snapshot + `stale` badge |

Each fixture has `fixtures/expected/<name>.snapshot.json` (golden, fidelity
`static`) produced by the analysis package. `npm run test -w @memlens/analysis`
asserts deep-equality modulo `timestamp`/`id`.
