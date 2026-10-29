import type { MemorySnapshot } from "@memlens/protocol";

export function mockSnapshot(): MemorySnapshot {
  const uri = "file:///main.cpp";
  const sr = (l: number, c0: number, c1: number) => ({ uri, startLine: l, startCol: c0, endLine: l, endCol: c1 });
  return {
    id: "snap-mock-1",
    uri,
    docVersion: 1,
    fidelity: "static",
    timestamp: Date.now(),
    regions: [
      {
        kind: "stack",
        label: "stack: main()",
        blocks: [
          { id: "stack:main.cpp:2:x", name: "x", type: "int", sizeBytes: 4, sourceRange: sr(1, 6, 7), lifetime: { start: "main:2", end: "main:6", scopeBound: true }, confidence: 0.9, fidelity: "static" },
          { id: "stack:main.cpp:3:p", name: "p", type: "int *", sizeBytes: 8, pointsTo: [{ targetId: "heap:main.cpp:3:p", label: "owns", kind: "owns", confidence: "inferred", source: "heuristic" }], sourceRange: sr(2, 6, 7), lifetime: { start: "main:3", end: "main:6", scopeBound: true }, confidence: 0.9, fidelity: "static" },
          {
            id: "stack:main.cpp:4:f",
            name: "f",
            type: "Foo",
            sizeBytes: 8,
            sourceRange: sr(3, 6, 7),
            lifetime: { start: "main:4", end: "main:6", scopeBound: true },
            layout: [
              { name: "x", type: "int", offset: 0, size: 4, align: 4, paddingAfter: 0 },
              { name: "c", type: "char", offset: 4, size: 1, align: 1, paddingAfter: 3 },
            ],
            totalSizeBytes: 8,
            layoutSource: "fallback",
            confidence: 0.9,
            fidelity: "static",
          },
        ],
      },
      {
        kind: "heap",
        label: "heap",
        blocks: [
          { id: "heap:main.cpp:3:p", name: "p (new int[10])", type: "int[10]", sizeBytes: 40, sourceRange: sr(2, 8, 9), lifetime: { start: "main:3", scopeBound: false }, confidence: 0.8, fidelity: "static" },
        ],
      },
    ],
    records: [
      {
        name: "Foo",
        kind: "struct",
        sourceRange: sr(0, 0, 6),
        endLine: 3,
        fields: [
          { name: "x", type: "int", line: 1 },
          { name: "c", type: "char", line: 2 },
        ],
        layout: [
          { name: "x", type: "int", offset: 0, size: 4, align: 4, paddingAfter: 0 },
          { name: "c", type: "char", offset: 4, size: 1, align: 1, paddingAfter: 3 },
        ],
        totalSizeBytes: 8,
        align: 4,
        layoutSource: "fallback",
      },
    ],
    layoutAccurate: false,
    issues: [
      { kind: "large-padding", severity: "info", sourceRange: sr(0, 0, 5), message: "struct Foo: 3 padding bytes in 8 total — consider reordering fields" },
    ],
  };
}
