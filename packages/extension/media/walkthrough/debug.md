# Live frames while debugging

Start a debug session with the **Microsoft C/C++** extension (`cppdbg` / `cppvsdbg`) or **CodeLLDB**, and pause at a breakpoint.

MemLens reads the paused frame's locals and shows:

- real addresses for every variable
- heap blocks reached through pointers, with **points to** edges
- one history step per stop, so you can scrub through what changed between breakpoints

Use the **Static / Debugger** switch at the top of the view to compare with the source-level picture. Turn this off with `memlens.preferDebuggerSnapshots`.
