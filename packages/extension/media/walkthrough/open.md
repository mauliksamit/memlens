# The memory view

Open a `.c` or `.cpp` file and press **Ctrl+Alt+M** (**Cmd+Alt+M** on macOS), or click the MemLens icon in the editor title bar.

- **Memory** shows every variable and allocation, grouped by stack frame, heap and globals. Dashed outlines mean the size depends on runtime values.
- **Types** lists each struct, class and union with a byte map. Hatched cells are padding.
- **Inspector** shows the selected block's size, lifetime and field offsets.

Click a block to select it, double-click to jump to the code. Moving the cursor in the editor selects the matching block. The history scrubber steps back through your recent edits.
