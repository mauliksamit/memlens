/** Level-of-detail: keep rendering bounded at 100k+ blocks. */
import type { Block } from "@memlens/protocol";
import { blockMagnitude } from "./format.js";

export interface LodOptions {
  /** Max SVG nodes per region before collapsing. */
  maxNodes?: number;
  /** Blocks smaller than this fraction of the region total get collapsed. */
  collapseBelowFraction?: number;
}

export interface LodBucket {
  blocks: Block[];
  collapsedCount: number;
  collapsedBytes: number;
}

/**
 * Stable LOD: big blocks stay individual; tiny ones collapse into one
 * "N small blocks (X B)" bucket. Size decides what collapses; kept blocks
 * stay in source (declaration) order.
 */
export function applyLod(blocks: Block[], opts: LodOptions = {}): LodBucket {
  const order = new Map(blocks.map((b, i) => [b, i]));
  const bySource = (list: Block[]) => list.sort((a, b) => order.get(a)! - order.get(b)!);
  const r = applyLodBySize(blocks, opts);
  return { ...r, blocks: bySource(r.blocks) };
}

function applyLodBySize(blocks: Block[], opts: LodOptions): LodBucket {
  const maxNodes = opts.maxNodes ?? 500;
  const frac = opts.collapseBelowFraction ?? 0.002;
  if (blocks.length <= maxNodes) {
    // Still collapse dust so the map stays readable.
    const total = blocks.reduce((s, b) => s + (b.sizeBytes ?? 16), 0);
    const big = blocks.filter((b) => (b.sizeBytes ?? 16) >= Math.max(1, total * frac));
    const small = blocks.filter((b) => (b.sizeBytes ?? 16) < Math.max(1, total * frac));
    if (small.length <= 1) return { blocks: [...blocks].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)), collapsedCount: 0, collapsedBytes: 0 };
    void blockMagnitude;
    return {
      blocks: [...big].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)),
      collapsedCount: small.length,
      collapsedBytes: small.reduce((s, b) => s + (b.sizeBytes ?? 0), 0),
    };
  }
  const sorted = [...blocks].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const keep = sorted.slice(0, maxNodes - 1);
  const rest = sorted.slice(maxNodes - 1);
  return {
    blocks: keep,
    collapsedCount: rest.length,
    collapsedBytes: rest.reduce((s, b) => s + (b.sizeBytes ?? 0), 0),
  };
}
