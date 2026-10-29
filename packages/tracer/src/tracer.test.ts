import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeEvents, eventsToSnapshot, parseAsanLog, shimSupported } from "./index.js";
import { validateMemoryEvent, validateSnapshot } from "@memlens/protocol";

const ev = (kind: "alloc" | "free", addr: string, size = 8, seq = 0) => ({
  seq,
  kind,
  addr,
  size,
  thread: "t1",
  stack: [],
  timestamp: 1,
});

describe("tracer", () => {
  it("requires explicit opt-in", async () => {
    const { runTraced } = await import("./index.js");
    await assert.rejects(() => runTraced({ filePath: "x.cpp" }), /opt-in/);
  });

  it("analyzeEvents finds leaks + double-frees", () => {
    const events = [
      ev("alloc", "0x1", 16, 0),
      ev("alloc", "0x2", 32, 1),
      ev("free", "0x1", 0, 2),
      ev("free", "0x1", 0, 3),
    ];
    const { leaks, doubleFrees } = analyzeEvents(events);
    assert.equal(leaks.length, 1);
    assert.equal(leaks[0].addr, "0x2");
    assert.equal(doubleFrees.length, 1);
  });

  it("parses ASan logs (Windows fallback)", () => {
    const log = [
      "ERROR: AddressSanitizer: heap-use-after-free on address 0x602000000010",
      "SUMMARY: AddressSanitizer: 40 byte(s) leaked in 1 allocation(s).",
    ].join("\n");
    const events = parseAsanLog(log);
    assert.equal(events.length, 2);
    assert.deepEqual(
      events.flatMap((e) => {
        const errs = validateMemoryEvent(e);
        return errs;
      }),
      [],
    );
  });

  it("reports platform support honestly", () => {
    const s = shimSupported();
    assert.equal(typeof s.ok, "boolean");
  });
  it("folds a trace into a valid traced snapshot with leaks and double frees", () => {
    const events = [ev("alloc", "0x10", 40, 0), ev("alloc", "0x20", 8, 1), ev("free", "0x20", 0, 2), ev("free", "0x20", 0, 3)];
    const snap = eventsToSnapshot(events, "file:///a.cpp", 1, 5);
    assert.deepEqual(validateSnapshot(snap), []);
    assert.equal(snap.fidelity, "traced");
    assert.equal(snap.regions[0].blocks.length, 1);
    assert.equal(snap.regions[0].blocks[0].address, "0x10");
    assert.deepEqual(snap.issues.map((i) => i.kind).sort(), ["double-free", "leak"]);
  });
});
