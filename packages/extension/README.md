# MemLens: Memory Layout Visualizer

See where your C and C++ variables live, how many bytes they take, and how your structs are padded, updated as you type. MemLens also flags likely leaks, double frees and mismatched `delete`s, and while you debug it shows the paused frame with real addresses.

![MemLens memory view: a leaked allocation found through a pointer copy](https://raw.githubusercontent.com/mauliksamit/memlens/main/packages/extension/resources/screenshots/lifetime-issues.png)

## Features

### A live memory map
Press **Ctrl+Alt+M** (**Cmd+Alt+M** on macOS) in any C or C++ file, or click the MemLens icon in the editor title bar. The view groups every variable and allocation by **stack frame**, **heap** and **globals**:

- Blocks show name, type and size. Dashed outlines mark sizes that depend on runtime values (`new int[n]` shows as `4·n bytes`, never a made-up number).
- Click a block to select it and highlight its line; double-click to jump to it. Moving the editor cursor selects the matching block.
- Filter with `/`, collapse regions, and scrub back through recent edits with the history slider (← / →). New and changed blocks are marked.

### Struct layout and padding
Every `struct`, `class` and `union` gets:

- a **CodeLens** with `sizeof`, padding bytes and whether the layout is compiler-verified or estimated
- a **byte map** in the view, with padding holes hatched
- a **one-click reorder** when sorting fields by alignment would shrink the type, also offered as a quick fix (**Ctrl+.**)

```cpp
struct Particle {   // sizeof 24 B · 9 B padding (38%) · Reorder fields to save 8 B
  char   alive;
  double mass;
  short  id;
  int    charge;
};
```

![Struct layout with padding holes and the reorder suggestion](https://raw.githubusercontent.com/mauliksamit/memlens/main/packages/extension/resources/screenshots/struct-layout.png)

The reorder only moves whole declaration lines, and it is offered only when that is unambiguous: one field per line and no access labels.

### Lifetime problems in the Problems panel
MemLens reports what it can see in the file as squiggles and Problems entries:

| Finding | Severity | Quick fix |
|---|---|---|
| Mismatched `new[]` / `delete` (or `malloc` / `delete`) | Error | Rewrites to `delete[]`, `delete` or `free()` |
| Double free | Error | |
| Possible leak | Warning | |
| Possible use after free | Warning | |
| Returning a reference or pointer to a local | Warning | |
| Large padding | Info | Reorder fields |

These come from analysing source text, so they are labelled *possible*. Tune them with `memlens.diagnostics.minSeverity`.

### Hovers
Hover a variable for its size, region, lifetime and field offsets, or a type name for its full layout table.

### Live frames while debugging
Start a debug session with the [Microsoft C/C++](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) debugger or [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) and pause at a breakpoint. The view switches to the **Debugger** source:

- real addresses for each local
- heap blocks reached through pointers, joined by **points to** edges
- one history step per stop, so you can see what changed between breakpoints

Switch between **Static** and **Debugger** at the top of the view.

## How accurate is it?

Every snapshot is labelled with where its data came from:

| Label | Source | What to trust |
|---|---|---|
| **STATIC · approx** | Your source text | Region, type and lifetime. Sizes are exact for built-in types and estimated or symbolic for others. |
| **compiler layouts** | `clang -fdump-record-layouts` | Field offsets and `sizeof`, exactly as your compiler lays them out. |
| **estimated layouts** | Built-in size table for your platform | Plain structs of built-in types. MemLens declines to guess for bases, virtual members, bit-fields and `alignas`. |
| **DEBUGGER · live** | The paused debug session | Addresses and values. |

For exact layouts, install clang and either put it on `PATH` or set `memlens.compilerPath`. Flags come from `compile_commands.json`, or set them in `memlens.extraFlags`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `memlens.compilerPath` | `""` | clang used for exact layouts (empty means `clang` on `PATH`) |
| `memlens.extraFlags` | `[]` | Extra flags for layout extraction |
| `memlens.diagnostics.enabled` | `true` | Squiggles and Problems entries |
| `memlens.diagnostics.minSeverity` | `info` | `error`, `warning` or `info` |
| `memlens.codeLens.enabled` | `true` | sizeof / padding CodeLens |
| `memlens.hover.enabled` | `true` | Size and layout hovers |
| `memlens.followCursor` | `true` | Editor cursor selects the matching block |
| `memlens.preferDebuggerSnapshots` | `true` | Show live frames while paused |
| `memlens.themePalette` | `colorblind-safe` | `colorblind-safe`, `default`, `high-contrast` |
| `memlens.debounceMs` | `300` | Delay after typing before re-analysis |
| `memlens.historyLength` | `50` | Snapshots kept per file |

## Commands

| Command | Keybinding |
|---|---|
| MemLens: Open Memory View | Ctrl+Alt+M / Cmd+Alt+M |
| MemLens: Show Symbol at Cursor in Memory View | editor context menu |
| MemLens: Clear History | |
| MemLens: Show Log | |

## Known limitations

- Analysis covers one file at a time. Types defined in headers show symbolic sizes unless clang can see them.
- Lifetime findings come from source patterns, not control flow, so expect some false positives in branchy code.

## Privacy

MemLens runs entirely on your machine. It collects no telemetry and makes no network requests. Your code is only passed to clang when you have it installed for layouts, and only with `-fsyntax-only`: nothing is built or executed.

## License

MIT
