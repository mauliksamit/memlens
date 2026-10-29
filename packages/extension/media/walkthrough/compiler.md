# Exact layouts with clang

Without a compiler, MemLens computes layouts from a built-in table of type sizes for your platform. Those layouts are labelled **estimated**, and it refuses to guess for types with base classes, virtual functions, bit-fields or alignment attributes.

With `clang` installed (on `PATH`, or set `memlens.compilerPath`), MemLens asks the compiler for each record's real layout (`-fdump-record-layouts`) and labels it **compiler-verified**. Flags come from `compile_commands.json` or `memlens.extraFlags`.
