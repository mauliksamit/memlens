/**
 * Golden snapshot generator: fixtures/*.cpp → fixtures/expected/*.snapshot.json.
 * Run: npm run gen-goldens -w @memlens/analysis
 * Normalizes volatile fields (timestamp, id) so goldens are deterministic.
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeText } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "..", "..", "..", "fixtures");
const expectedDir = join(fixturesDir, "expected");

await mkdir(expectedDir, { recursive: true });
const files = (await readdir(fixturesDir)).filter((f) => f.endsWith(".cpp")).sort();
for (const f of files) {
  const text = await readFile(join(fixturesDir, f), "utf8");
  const uri = `file:///fixtures/${f}`;
  const res = await analyzeText({ requestId: "golden", uri, docVersion: 1, text, languageId: "cpp", fidelity: "static" });
  const golden = { ...res.snapshot, id: "golden", timestamp: 0 };
  await writeFile(join(expectedDir, `${basename(f, ".cpp")}.snapshot.json`), JSON.stringify(golden, null, 2) + "\n");
  const blocks = res.snapshot.regions.reduce((n, r) => n + r.blocks.length, 0);
  console.log(`${f}: ${blocks} blocks, ${res.snapshot.issues.length} issues, layoutAccurate=${res.layoutAccurate}, partial=${res.partial}`);
}
console.log(`wrote ${files.length} goldens to fixtures/expected/`);
