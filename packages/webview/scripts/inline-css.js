// Copies src/styles.css → dist/webview.css after esbuild.
import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
await cp(join(here, "..", "src", "styles.css"), join(here, "..", "dist", "webview.css"));
console.log("css copied");
