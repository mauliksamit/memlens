/**
 * Builtin size/alignment table with platform-aware fundamental types.
 *
 * ABI rules (verified against
 * fixtures/truth/g++-*-win32-x64.json from real GCC 16.1.0):
 * - LP64 (Linux/macOS): long = 8.  - LLP64 (Windows): long = 4.
 * - long double = 16 on SysV/MinGW; MSVC uses 8 (documented gap — needs clang).
 * - pointer = 8 on x64 (both ABIs).
 */

/** True on Windows (LLP64: long is 4 bytes). Overridable in tests via env. */
export function isLLP64(): boolean {
  if (process.env["MEMLENS_ABI"] === "lp64") return false;
  if (process.env["MEMLENS_ABI"] === "llp64") return true;
  return process.platform === "win32";
}

export interface TypeInfo {
  size: number;
  align: number;
}

/** [size, align] — LP64 base; `long` patched per platform below. */
const TABLE_LP64: Record<string, TypeInfo> = {
  void: { size: 0, align: 1 }, // ABI: void has no storage; size 0 by convention
  bool: { size: 1, align: 1 }, // Itanium/SysV: 1 byte
  char: { size: 1, align: 1 },
  "signed char": { size: 1, align: 1 },
  "unsigned char": { size: 1, align: 1 },
  short: { size: 2, align: 2 }, // 2-byte aligned (both ABIs)
  "unsigned short": { size: 2, align: 2 },
  int: { size: 4, align: 4 }, // 4 bytes (both ABIs)
  unsigned: { size: 4, align: 4 },
  "unsigned int": { size: 4, align: 4 },
  long: { size: 8, align: 8 }, // LP64 only; patched to 4 on LLP64
  "unsigned long": { size: 8, align: 8 },
  "long long": { size: 8, align: 8 }, // 8 bytes (both ABIs)
  "unsigned long long": { size: 8, align: 8 },
  float: { size: 4, align: 4 }, // IEEE-754 single
  double: { size: 8, align: 8 }, // IEEE-754 double
  "long double": { size: 16, align: 16 }, // SysV/MinGW 80-bit extended in 16 B; MSVC = 8 (gap)
  size_t: { size: 8, align: 8 }, // = unsigned long (LP64) / unsigned long long (LLP64): 8 either way on x64
  ssize_t: { size: 8, align: 8 },
  ptrdiff_t: { size: 8, align: 8 },
};

function table(): Record<string, TypeInfo> {
  if (!isLLP64()) return TABLE_LP64;
  // LLP64 (Windows): long is 32-bit. Truth: fixtures/truth/*win32*.json abi.long=4.
  return { ...TABLE_LP64, long: { size: 4, align: 4 }, "unsigned long": { size: 4, align: 4 } };
}

const CONTAINER_APPROX: Record<string, TypeInfo> = {
  // libstdc++ / libc++ typical object sizes (object itself, not elements).
  "std::string": { size: 32, align: 8 },
  "std::vector": { size: 24, align: 8 },
  "std::map": { size: 48, align: 8 },
  "std::unordered_map": { size: 56, align: 8 },
  "std::set": { size: 48, align: 8 },
  "std::unique_ptr": { size: 8, align: 8 },
  "std::shared_ptr": { size: 16, align: 8 },
};

export function builtinTypeInfo(type: string): TypeInfo | null {
  const t = type.trim();
  const T = table();
  if (T[t]) return T[t];
  // pointer / reference decay (x64: 8 bytes, both ABIs — truth abi.pointer=8)
  if (/[*&]\s*(\[.*\])?$/.test(t) || /\*$/.test(t)) return { size: 8, align: 8 };
  // strip qualifiers and retry
  const stripped = t.replace(/^(const|constexpr|volatile|mutable|static|extern)\s+/g, "").trim();
  if (T[stripped]) return T[stripped];
  const base = stripped.split("<")[0].trim();
  if (T[base]) return T[base];
  if (CONTAINER_APPROX[base]) return CONTAINER_APPROX[base];
  return null;
}

export function isContainerType(type: string): boolean {
  return type.includes("std::vector") || type.includes("std::string") || type.includes("std::map") || type.includes("std::set");
}

/** True when the count expression is a plain non-negative integer. */
export function isNumericCount(expr: string): boolean {
  return /^\d+$/.test(expr.trim());
}

export function numericValue(expr: string): number | null {
  const t = expr.trim();
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  // sizeof(T)*K or K*sizeof(T)
  const m = t.match(/sizeof\s*\(\s*([\w:]+)\s*\)\s*\*\s*(\d+)|\b(\d+)\s*\*\s*sizeof\s*\(\s*([\w:]+)\s*\)/);
  if (m) {
    const k = parseInt(m[2] ?? m[3], 10);
    const ty = m[1] ?? m[4];
    const info = builtinTypeInfo(ty);
    if (info) return info.size * k;
  }
  return null;
}

/** "4·n bytes" style symbolic size; never invents a number. */
export function symbolicSize(elemSize: number, expr: string): string {
  return `${elemSize}·(${expr}) bytes`;
}
