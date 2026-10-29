import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePointerValue, reduceDapEvent, snapshotFromFrame, snapshotFromVariables, variableToBlock } from "./index.js";
import { validateSnapshot } from "@memlens/protocol";

describe("debugger bridge", () => {
  it("maps pointer variables to heap blocks with real addresses", () => {
    const b = variableToBlock(
      { name: "p", type: "int *", value: "0x7FFEE1A2B3C0", sourceRange: { uri: "f", startLine: 1, startCol: 0, endLine: 1, endCol: 1 } },
      "thread:1",
      3,
      "file:///a.cpp",
    );
    assert.equal(b.address, "0x7ffee1a2b3c0");
    assert.equal(b.fidelity, "debugger");
    assert.ok(b.confidence >= 0.9);
  });

  it("pointer size known; opaque size stays symbolic (never fabricated)", () => {
    const ptr = variableToBlock({ name: "p", type: "char *", value: "0xABC" }, "t", 1, "u");
    assert.equal(ptr.sizeBytes, 8);
    const opaque = variableToBlock({ name: "u", type: "Incomplete", value: "{...}" }, "t", 1, "u");
    assert.ok(opaque.sizeSymbolic, "symbolic, not fabricated");
  });

  it("stopped → refresh, continued → quiet, terminated → detach", () => {
    let s = { attached: true, threadId: null as number | null, frameId: "" };
    let r = reduceDapEvent(s, { event: "stopped", threadId: 2, reason: "step" });
    assert.equal(r.refreshView, true);
    assert.equal(r.state.frameId, "thread:2");
    r = reduceDapEvent(r.state, { event: "continued" });
    assert.equal(r.refreshView, false);
    r = reduceDapEvent(r.state, { event: "terminated" });
    assert.equal(r.state.attached, false);
    s = r.state;
    void s;
  });

  it("parses pointer values + frame snapshot validates", () => {
    assert.equal(parsePointerValue("0x1234 <_x>"), "0x1234");
    assert.equal(parsePointerValue("42"), null);
    const snap = snapshotFromVariables(
      [
        { name: "x", type: "int", value: "42" },
        { name: "p", type: "int *", value: "0xFF00" },
      ],
      { attached: true, threadId: 1, frameId: "thread:1" },
      7,
      "file:///a.cpp",
      1234,
    );
    assert.equal(snap.fidelity, "debugger");
    assert.deepEqual(validateSnapshot(snap), []);
  });
  it("frame snapshot links pointers to heap targets with debugger certainty", () => {
    const snap = snapshotFromFrame(
      [
        { name: "n", type: "int", value: "3" },
        { name: "p", type: "int *", value: "0x1000", pointee: { name: "*p", type: "int", value: "42" } },
        { name: "q", type: "int *", value: "0x0" },
      ],
      { attached: true, threadId: 1, frameId: "main" },
      2,
      "file:///a.cpp",
      7,
    );
    assert.deepEqual(validateSnapshot(snap), []);
    const p = snap.regions[0].blocks.find((b) => b.name === "p");
    assert.equal(p?.pointsTo?.[0].targetId, "debug:heap:0x1000");
    assert.equal(p?.pointsTo?.[0].confidence, "debugger");
    assert.equal(snap.regions[1].blocks[0].address, "0x1000");
    assert.equal(snap.regions[0].blocks.find((b) => b.name === "q")?.pointsTo, undefined);
  });
});
