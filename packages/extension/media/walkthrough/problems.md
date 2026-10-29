# Lifetime problems

MemLens flags patterns it can see in a single file:

| Finding | Example |
|---|---|
| Possible leak | `int* p = new int[10];` with no `delete[] p` |
| Double free | `delete p; … delete p;` |
| Mismatched delete | `new int[10]` released with `delete` (quick fix: `delete[]`) |
| Use after free | `p` read after `delete p` |
| Dangling reference | returning `&local` |

These are heuristics over the source, labelled *possible*. Debugging or traced runs give measured results.
