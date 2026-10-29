# @memlens/debugger — debugger mode

Pure, testable DAP core: `reduceDapEvent` (stopped/continued/terminated),
`variableToBlock` (variables → protocol Blocks with real addresses),
`snapshotFromVariables` (debugger-fidelity snapshots). The VS Code glue
(`vscode.debug.onDidReceiveDebugSessionCustomEvent` + `readMemory` requests)
lives in `packages/extension` (DebugBridge wiring).

## Known limitations

- Symbolication of raw addresses needs debug info (`-g`); without it,
  addresses are shown but unattributed (low confidence).
- `readMemory` support depends on the debug adapter (GDB/LLDB via cpptools
  or CodeLLDB); unsupported adapters degrade to variable inspection only.
