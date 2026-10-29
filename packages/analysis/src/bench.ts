/**
 * Typing-latency benchmark harness (static layer).
 * Measures keystroke → snapshot time on a generated ~2,000-line file and a
 * small incremental edit, printing p50/p95. Budget: ≤ 150 ms p95.
 */
import { analyzeText } from "./index.js";

function genFile(lines: number): string {
  let out = `#include <vector>\nstruct Rec { int a; char b; double c; };\n`;
  out += `int helper(int n) { int t = n * 2; return t; }\n`;
  for (let i = 0; i < lines; i++) {
    out += `int gvar${i} = ${i};\n`;
  }
  out += `int main() {\n  int x = 0;\n  Rec r;\n  std::vector<int> v;\n  int* p = new int[10];\n`;
  for (let i = 0; i < 40; i++) out += `  int local${i} = ${i} + x;\n`;
  out += `  delete[] p;\n  return x;\n}\n`;
  return out;
}

async function time(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  const big = genFile(1900);
  console.log(`fixture: ${big.split("\n").length} lines, ${(big.length / 1024).toFixed(1)} KiB`);
  // warmup (layout cache, JIT)
  await analyzeText({ requestId: "w", uri: "file:///bench.cpp", docVersion: 0, text: big, languageId: "cpp", fidelity: "static" });

  const fullTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    fullTimes.push(await time(() => analyzeText({ requestId: `f${i}`, uri: "file:///bench.cpp", docVersion: i + 1, text: big, languageId: "cpp", fidelity: "static" })));
  }
  fullTimes.sort((a, b) => a - b);

  // incremental keystroke: append one local inside main
  const keystrokeTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    const edited = big.replace("  delete[] p;", `  int ks${i} = ${i};\n  delete[] p;`);
    keystrokeTimes.push(await time(() => analyzeText({ requestId: `k${i}`, uri: "file:///bench.cpp", docVersion: 100 + i, text: edited, languageId: "cpp", fidelity: "static" })));
  }
  keystrokeTimes.sort((a, b) => a - b);

  console.log(`full-file   p50=${pct(fullTimes, 50).toFixed(1)}ms p95=${pct(fullTimes, 95).toFixed(1)}ms`);
  console.log(`keystroke   p50=${pct(keystrokeTimes, 50).toFixed(1)}ms p95=${pct(keystrokeTimes, 95).toFixed(1)}ms`);
  const p95 = pct(keystrokeTimes, 95);
  console.log(p95 <= 150 ? "BUDGET PASS (≤150ms p95)" : `BUDGET FAIL (>150ms p95): ${p95.toFixed(1)}ms`);
}

await main();
