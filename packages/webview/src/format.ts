/** Pure formatting helpers (tested, DOM-free). */
import type { Block, Fidelity } from "@memlens/protocol";

export function formatSize(b: Block): string {
  if (b.sizeBytes !== undefined) return `${b.sizeBytes} B`;
  return b.sizeSymbolic ?? "?";
}

/** Numeric magnitude for area-proportional rendering; symbolic → estimate flag. */
export function blockMagnitude(b: Block): { px: number; estimated: boolean } {
  if (b.sizeBytes !== undefined) return { px: b.sizeBytes, estimated: false };
  // Symbolic: render a fixed placeholder width so layout never lies by scale.
  return { px: 16, estimated: true };
}

export function fidelityBadge(f: Fidelity): string {
  return f === "static" ? "STATIC · approx" : f === "traced" ? "TRACED · measured" : "DEBUGGER · live";
}

export function confidenceLabel(c: number): string {
  if (c >= 0.85) return "high";
  if (c >= 0.6) return "medium";
  return "low";
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Human byte count: 512 B, 4.0 KiB, 1.2 MiB. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}
