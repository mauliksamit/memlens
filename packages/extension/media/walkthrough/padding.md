# Shrink a struct

```cpp
struct Particle {      // sizeof 24 B · 9 B padding (38%)
  char   alive;        // 1 B + 7 B padding
  double mass;         // 8 B
  short  id;           // 2 B + 2 B padding
  int    charge;       // 4 B   → reordered: 16 B
};
```

MemLens shows the size and padding above every struct. When ordering the fields by alignment would save bytes, a **Reorder fields to save N B** action appears. It moves whole declaration lines and does nothing when that isn't clearly safe (access labels, several fields on one line, unknown layouts).
