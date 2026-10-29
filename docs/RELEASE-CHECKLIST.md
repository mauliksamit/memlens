# Release checklist: MemLens 0.2.0

## Automated
- [x] `npm run build` green (protocol → analysis → tracer → debugger → webview → extension)
- [x] GitHub CI green on ubuntu, macOS and Windows: `ci` and `layout-truth` (clang layouts match real GCC/clang/MSVC-ABI output on every probe)
- [x] `npm run test` green: protocol self-test, analysis 22 (+1 clang-oracle skip without clang),
      tracer 5, debugger 5, webview 14, extension 11
- [x] Goldens regenerated for protocol 1.4.0; regions and issues verified identical to 0.1.0
      (only `uri`, `records` and `layoutAccurate` added)
- [x] `npm run package` produces `packages/extension/memlens-0.2.0.vsix`

## Manual (needs a person in VS Code)
- [ ] Install the `.vsix` and open `fixtures/padding.cpp`: CodeLens shows
      `sizeof 24 B · 10 B padding`, and *Reorder fields to save 8 B* works.
- [ ] `fixtures/mismatch.cpp`: error squiggle; the quick fix rewrites to `delete[]`.
- [ ] `fixtures/leak.cpp`, `double_free.cpp`: Problems panel entries; clicking
      an issue in the view jumps to the line.
- [ ] Ctrl+Alt+M opens the view beside the editor; switching files switches history;
      reloading the window keeps the panel.
- [ ] Debug `fixtures/heap_basic.cpp` (`g++ -g`, cppdbg or CodeLLDB) and break in
      `main`: the view shows **DEBUGGER · live** with addresses and *points to* edges.
      Stopping the session returns to Static.
- [x] Screenshots in `packages/extension/resources/screenshots/` (rendered from real analysis)

## Publishing
- [x] Publisher set to `mauliksamit`
- [ ] Upload the `.vsix` at marketplace.visualstudio.com/manage (or `vsce publish --no-dependencies`)
