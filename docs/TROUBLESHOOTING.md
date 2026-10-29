# Troubleshooting

## "stale / parse error" badge never goes away
Your file doesn't parse *and* the layout compiler fails. Check: unbalanced
braces, an unclosed `/*`, or a missing `compile_commands.json` entry. The view
shows the last-good model — fix the syntax error and it refreshes.

## Layouts look wrong (sizes don't match `sizeof`)
The fallback LP64 table is in use (`layoutAccurate: false`, confidence capped
at 0.6). Install clang and set `memlens.compilerPath`; ensure the file's flags
are in `compile_commands.json` (extra flags: `memlens.extraFlags`).
Note: `long` is 8 bytes on Linux/macOS (LP64) but 4 on Windows (LLP64) —
without clang, Windows layouts for `long` are approximate.

## Where is traced mode?
Allocation tracing lives in `packages/tracer` as a library and is not part of
the Marketplace extension. To use it from source, build the shim
(`g++ -shared -fPIC -o libmemlens_shim.so shim.cpp -ldl -rdynamic` in
`packages/tracer/shim`), set `MEMLENS_SHIM` to the output path, and call
`runTraced({ filePath, optIn: true })`. Linux and macOS only.

## Webview is empty
Open a C or C++ file first, then press Ctrl+Alt+M (or run
`MemLens: Open Memory View`). If the status bar item shows an error icon, run
`MemLens: Show Log`. The **MemLens** output channel has the full error; set its
log level to *Trace* (gear icon) to see per-analysis timings.

## No live frames while debugging
MemLens listens to `cppdbg`, `cppvsdbg`, `lldb`/`codelldb` and `gdb` sessions.
Check that `memlens.preferDebuggerSnapshots` is on, that the program is
*paused* (breakpoint or step), and that the paused frame is in a file with
source (frames without source are skipped). Use the Static/Debugger switch at
the top of the view.

## High CPU while typing
Raise `memlens.debounceMs` (e.g. 600) and lower `memlens.historyLength`.
Analysis runs off the UI thread; sustained load means very large TUs —
`compile_commands.json` scoping helps the layout cache hit.
