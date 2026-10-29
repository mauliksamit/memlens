// Copies LICENSE and CHANGELOG.md from the repo root so the .vsix (and the
// Marketplace "Changelog" tab) ship them.
import { copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(extDir, "..", "..");
for (const f of ["LICENSE", "CHANGELOG.md"]) await copyFile(join(root, f), join(extDir, f));
console.log("copy-docs: LICENSE, CHANGELOG.md");
