/** Palettes: colour-blind-safe default (Okabe–Ito inspired). */
export type PaletteName = "default" | "colorblind-safe" | "high-contrast";

export const PALETTES: Record<PaletteName, { stack: string; heap: string; global: string; static: string; added: string; removed: string; changed: string }> = {
  default: { stack: "#4c9aff", heap: "#f5a623", global: "#9b51e0", static: "#6f777f", added: "#2ecc71", removed: "#e74c3c", changed: "#f1c40f" },
  "colorblind-safe": { stack: "#0072b2", heap: "#e69f00", global: "#cc79a7", static: "#999999", added: "#009e73", removed: "#d55e00", changed: "#f0e442" },
  "high-contrast": { stack: "#ffffff", heap: "#ffff00", global: "#00ffff", static: "#c0c0c0", added: "#00ff00", removed: "#ff0000", changed: "#ff00ff" },
};

export function paletteFor(name: string) {
  return PALETTES[(name as PaletteName) ?? "colorblind-safe"] ?? PALETTES["colorblind-safe"];
}

/** CSS custom properties for a palette, applied to :root by the runtime. */
export function paletteVars(name: string): Record<string, string> {
  const p = paletteFor(name);
  return {
    "--ml-stack": p.stack,
    "--ml-heap": p.heap,
    "--ml-global": p.global,
    "--ml-static": p.static,
    "--ml-added": p.added,
    "--ml-removed": p.removed,
    "--ml-changed": p.changed,
  };
}
