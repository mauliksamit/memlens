/**
 * Pure record-layout helpers shared by the webview (savings hint) and the
 * extension (reorder quick fix). Not part of the wire contract.
 */
import type { FieldLayout } from "./index.js";

export interface ReorderPlan {
  /** Fields in the suggested declaration order (largest alignment first). */
  order: FieldLayout[];
  /** sizeof after reordering (Itanium/MSVC-style sequential layout). */
  size: number;
  /** sizeof as currently declared. */
  currentSize: number;
}

/** Sequential layout of fields in the given order; returns sizeof. */
export function sequentialSize(fields: Pick<FieldLayout, "size" | "align">[]): number {
  let offset = 0;
  let maxAlign = 1;
  for (const f of fields) {
    const a = Math.max(1, f.align);
    maxAlign = Math.max(maxAlign, a);
    offset += (a - (offset % a)) % a;
    offset += f.size;
  }
  return offset + ((maxAlign - (offset % maxAlign)) % maxAlign);
}

/** Total padding bytes in a layout (holes + tail). */
export function paddingBytes(fields: Pick<FieldLayout, "paddingAfter">[]): number {
  return fields.reduce((s, f) => s + f.paddingAfter, 0);
}

/**
 * Suggest a field order that minimises padding: stable sort by alignment
 * desc, then size desc. Returns null when it would not shrink the record
 * (or for unions / overlapping members, where order is irrelevant).
 */
export function planReorder(layout: FieldLayout[], currentSize: number): ReorderPlan | null {
  if (layout.length < 2) return null;
  if (layout.some((f, i) => i > 0 && f.offset < layout[i - 1].offset + layout[i - 1].size)) return null; // union-like
  const order = layout
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.align - a.f.align || b.f.size - a.f.size || a.i - b.i)
    .map((x) => x.f);
  const size = sequentialSize(order);
  return size < currentSize ? { order, size, currentSize } : null;
}
