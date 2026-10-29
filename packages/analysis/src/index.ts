/**
 * Debounced-snapshot analysis pipeline + JSON-RPC worker.
 *
 * `analyzeText()` is the pure, testable core (also used by benchmarks and
 * golden-snapshot tests). `packages/extension` drives it through
 * `AnalysisClient`, which spawns this file as a worker thread.
 */
import { createHash } from "node:crypto";
import type { AnalyzeParams, AnalyzeResult, GetLayoutsParams, GetLayoutsResult } from "@memlens/protocol";
import { RegexParser } from "./parser.js";
import { buildSnapshot } from "./model.js";
import { getLayouts, layoutKeyText } from "./layout.js";

const parser = new RegexParser();

/** Last-good cache per document: on failed input keep serving that file's previous snapshot. */
const lastGoodByUri = new Map<string, AnalyzeResult>();

export async function analyzeText(params: AnalyzeParams): Promise<AnalyzeResult> {
  const { uri, docVersion, text } = params;
  const parsed = parser.parseFull(text, uri);
  const partial = parsed.parseErrors.length > 0;
  try {
    const { layouts, accurate, errors } = await getLayouts(text, parsed.records, {
      projectDir: params.projectDir,
      compileArgs: params.compileArgs?.length ? params.compileArgs : undefined,
      compilerPath: params.compilerPath || undefined,
      cacheKeyText: layoutKeyText(text, parsed.functions),
    });
    const snapshot = buildSnapshot(parsed, text, {
      uri,
      docVersion,
      layoutAccurate: accurate,
      layouts,
      partial,
      note: [...parsed.parseErrors, ...errors].join("; ") || undefined,
    });
    const result: AnalyzeResult = { snapshot, layoutAccurate: accurate, partial };
    if (!partial) {
      lastGoodByUri.set(uri, result);
      if (lastGoodByUri.size > 64) lastGoodByUri.delete(lastGoodByUri.keys().next().value as string);
    }
    // Even partial results are returned (with stale flag) so typing feedback
    // never goes blank; lastGood is retained for catastrophic failures.
    return result;
  } catch (e) {
    const lastGood = lastGoodByUri.get(uri);
    if (lastGood) {
      return {
        snapshot: { ...lastGood.snapshot, stale: true, note: `analysis error — showing last good: ${(e as Error).message}` },
        layoutAccurate: lastGood.layoutAccurate,
        partial: true,
      };
    }
    throw e;
  }
}

export async function getLayoutsRpc(params: GetLayoutsParams): Promise<GetLayoutsResult> {
  const parsed = parser.parseFull(params.tuText, "tu");
  const want = new Set(params.typeNames);
  const recs = parsed.records.filter((r) => want.has(r.name));
  const { layouts, accurate, errors } = await getLayouts(params.tuText, recs, {
    projectDir: params.projectDir,
    compileArgs: params.compileArgs,
  });
  const out: GetLayoutsResult["layouts"] = {};
  for (const [k, v] of layouts) out[k] = v;
  return { layouts: out, accurate, errors };
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

// --- worker thread entry: JSON-RPC over parentPort --------------------------
import { parentPort } from "node:worker_threads";

if (parentPort) {
  parentPort.on("message", async (msg: { id: string | number; method: string; params: AnalyzeParams | GetLayoutsParams }) => {
    try {
      if (msg.method === "analyze") {
        const result = await analyzeText(msg.params as AnalyzeParams);
        parentPort!.postMessage({ jsonrpc: "2.0", id: msg.id, result });
      } else if (msg.method === "getLayouts") {
        const result = await getLayoutsRpc(msg.params as GetLayoutsParams);
        parentPort!.postMessage({ jsonrpc: "2.0", id: msg.id, result });
      } else if (msg.method === "cancel") {
        parentPort!.postMessage({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
      } else {
        parentPort!.postMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
      }
    } catch (e) {
      parentPort!.postMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: (e as Error).message } });
    }
  });
}
