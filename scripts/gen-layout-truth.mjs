// Ground-truth generator. Compiles scripts/layout-truth/probes.cpp
// with every REAL compiler found on PATH (g++, clang++, cl) and writes the
// probe program's stdout to fixtures/truth/<id>.json with a provenance header.
// These files are the oracle for layout tests. They are produced by real
// compilers — never by MemLens code (no self-grading).
// Usage: node scripts/gen-layout-truth.mjs [--force]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "fixtures", "truth");
mkdirSync(outDir, { recursive: true });

function have(cmd, args = ["--version"]) {
  try {
    execFileSync(cmd, args, { stdio: "pipe", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

const compilers = [];
if (have("g++")) compilers.push({ id: "g++", compile: (src, bin) => execFileSync("g++", ["-std=c++20", "-O0", src, "-o", bin], { stdio: "pipe" }) });
if (have("clang++")) compilers.push({ id: "clang++", compile: (src, bin) => execFileSync("clang++", ["-std=c++20", "-O0", src, "-o", bin], { stdio: "pipe" }) });
if (platform() === "win32" && have("cl", [])) compilers.push({ id: "cl", compile: (src, bin) => execFileSync("cl", ["/std:c++20", "/EHsc", src, `/Fe${bin}.exe`], { stdio: "pipe" }) });

if (compilers.length === 0) {
  console.error("No real compiler found on PATH (need g++, clang++ or cl). Truth NOT generated.");
  process.exit(2);
}

const force = process.argv.includes("--force");
for (const c of compilers) {
  let version = "unknown";
  try {
    if (c.id === "cl") version = execFileSync("cl", [], { stdio: "pipe" }).toString().split("\n")[0].trim();
    else version = execFileSync(c.id, ["--version"], { stdio: "pipe" }).toString().split("\n")[0].trim();
  } catch { /* keep unknown */ }
  const safeVer = version.replace(/[^A-Za-z0-9.]+/g, "-").slice(0, 60);
  const fileId = `${c.id}-${safeVer}-${platform()}-${arch()}.json`;
  const outFile = join(outDir, fileId);
  if (existsSync(outFile) && !force) {
    console.log(`KEEP  ${fileId} (use --force to regenerate)`);
    continue;
  }
  const bin = join(outDir, `.probe-${c.id}${platform() === "win32" ? ".exe" : ""}`);
  c.compile(join(here, "layout-truth", "probes.cpp"), bin);
  const stdout = execFileSync(bin, { encoding: "utf8", timeout: 30000 });
  const truth = JSON.parse(stdout);
  let target = "unknown";
  try {
    target = c.id === "cl" ? `${arch() === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc` : execFileSync(c.id, ["-dumpmachine"], { encoding: "utf8" }).trim();
  } catch { /* keep unknown */ }
  truth.provenance = {
    generator: "scripts/gen-layout-truth.mjs",
    compilerCommand: c.id,
    compilerVersion: version,
    target,
    platform: `${platform()}-${arch()}`,
    producedBy: "real compiler probe program (scripts/layout-truth/probes.cpp), NOT MemLens",
    note: "Oracle for layout tests. Field offsets absent where ill-formed in C++ (bit-fields).",
  };
  writeFileSync(outFile, JSON.stringify(truth, null, 2) + "\n");
  console.log(`WROTE ${fileId}`);
}
