// Copies the built webview bundle (packages/webview/dist) into the extension's
// media/ dir so the .vsix is self-contained. No-op until the webview builds.
import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = dirname(here);
const webviewDist = join(extDir, "..", "webview", "dist");
const mediaDir = join(extDir, "media");

if (!existsSync(join(webviewDist, "webview.js"))) {
  console.log("copy-webview: webview not built yet — skipping");
  process.exit(0);
}
await mkdir(mediaDir, { recursive: true });
await cp(join(webviewDist, "webview.js"), join(mediaDir, "webview.js"));
await cp(join(webviewDist, "webview.css"), join(mediaDir, "webview.css")).catch(() => {});
console.log("copy-webview: done");
