import { validateBlock, validateSnapshot, validateMemoryEvent, parseTraceLine, diffSnapshots } from "./validate.js";
import type { MemorySnapshot } from "./index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

const snap: MemorySnapshot = {
  id: "snap-1",
  docVersion: 3,
  fidelity: "static",
  timestamp: Date.now(),
  regions: [
    {
      kind: "stack",
      label: "stack: main()",
      blocks: [
        {
          id: "stack:main.cpp:1:x",
          name: "x",
          type: "int",
          sizeBytes: 4,
          sourceRange: { uri: "file:///main.cpp", startLine: 1, startCol: 4, endLine: 1, endCol: 9 },
          lifetime: { start: "main:1", end: "main:9", scopeBound: true },
          pointsTo: [{ targetId: "heap:main.cpp:2:p", label: "owns" }],
          confidence: 0.9,
          fidelity: "static",
        },
      ],
    },
  ],
  issues: [],
};

const errs = validateSnapshot(snap);
assert(errs.length === 0, `snapshot valid, got ${errs.join(",")}`);

assert(validateBlock({}).length > 0, "empty block invalid");
assert(validateMemoryEvent({ kind: "alloc" }).length > 0, "partial event invalid");

const ev = parseTraceLine(
  JSON.stringify({ seq: 1, kind: "alloc", addr: "0xabc", size: 32, thread: "t1", stack: [], timestamp: 1 }),
);
assert(ev.addr === "0xabc", "trace parse");

const snap2: MemorySnapshot = {
  ...snap,
  id: "snap-2",
  docVersion: 4,
  regions: [
    {
      kind: "stack",
      label: "stack: main()",
      blocks: [
        { ...snap.regions[0].blocks[0], type: "long", sizeBytes: 8 },
        {
          id: "heap:main.cpp:2:p",
          name: "p",
          type: "int[10]",
          sizeBytes: 40,
          sourceRange: { uri: "file:///main.cpp", startLine: 2, startCol: 0, endLine: 2, endCol: 20 },
          lifetime: { start: "main:2", scopeBound: false },
          confidence: 0.8,
          fidelity: "static",
        },
      ],
    },
  ],
  issues: [],
};
const d = diffSnapshots(snap, snap2);
assert(d.added.length === 1 && d.changed.length === 1 && d.removed.length === 0, "diff works");

console.log("protocol self-test OK (validators + diff)");
