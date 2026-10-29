/**
 * Tolerant C++ structure parser.
 *
 * Exposes the `ParserAdapter` interface (ADR-001) that the production
 * tree-sitter-cpp binding will implement. The default `RegexParser` below is
 * a dependency-free, error-tolerant fallback with the same output shape, so
 * the model builder never blocks on native modules (Windows CI, etc.).
 */

export interface FieldDecl {
  name: string;
  type: string;
  line: number;
  col: number;
}

export interface RecordDecl {
  name: string;
  kind: "struct" | "class" | "union";
  fields: FieldDecl[];
  bases: string[];
  line: number;
  /** 0-based line of the closing `};`. */
  endLine: number;
  /** Body contains public:/private:/protected: labels. */
  hasAccessSpecifiers: boolean;
  /** Honesty flags: the fallback layout engine cannot model these. */
  hasVirtualFn: boolean;
  hasVirtualBase: boolean;
  hasBitfields: boolean;
  hasAlignas: boolean;
  hasPacked: boolean;
  hasNoUniqueAddress: boolean;
  /** Nested record definition inside the body (old parser truncates at inner };). */
  hasNested: boolean;
}

export interface VarDecl {
  name: string;
  type: string;
  /** Owning function or "global". */
  scope: string;
  line: number;
  col: number;
  init: string;
  isPointer: boolean;
  arraySize?: string;
  isGlobal: boolean;
}

export type AllocKind = "new" | "newArray" | "malloc" | "calloc" | "realloc" | "make_unique" | "make_shared";
export type FreeKind = "delete" | "deleteArray" | "free" | "reset";

export interface AllocSite {
  varName: string;
  kind: AllocKind;
  typeArg: string;
  /** Raw count/size expression, e.g. "10", "n", "sizeof(int)*n". */
  countExpr: string;
  scope: string;
  line: number;
  col: number;
}

export interface FreeSite {
  varName: string;
  kind: FreeKind;
  scope: string;
  line: number;
  col: number;
}

export interface ParsedFile {
  functions: { name: string; startLine: number; endLine: number; returnsPointer: boolean }[];
  globals: VarDecl[];
  locals: VarDecl[];
  records: RecordDecl[];
  allocs: AllocSite[];
  frees: FreeSite[];
  /** Non-fatal syntax problems; model is still usable (partial). */
  parseErrors: string[];
}

export interface ParserAdapter {
  parseFull(text: string, uri: string): ParsedFile;
}

function stripCommentsAndStrings(src: string): string {
  // Remove strings/chars first so comment markers inside them are kept safe.
  const noStrings = src
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  return noStrings
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => "\n".repeat((m.match(/\n/g) ?? []).length));
}

function lineOf(index: number, text: string): number {
  let l = 0;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") l++;
  return l; // 0-based
}

const FUNC_RE = /(?:^|[;\n}])\s*[A-Za-z_][\w:<>]*(?:\s*[*&]\s*|\s+)([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[\w:<>*& ]+)?\s*\{/g;
// Attributes may sit between the keyword and the name: `struct __attribute__((packed)) P`,
// `struct alignas(16) P`, `struct [[nodiscard]] P`.
const RECORD_RE = /(struct|class|union)\s+((?:(?:__attribute__\s*\(\([^;{}]*?\)\)|__declspec\s*\([^)]*\)|alignas\s*\([^)]*\)|\[\[[^\]]*\]\])\s*)*)([A-Za-z_]\w*)\s*(?:final\s*)?(?::\s*([^{};]+?))?\s*\{([\s\S]*?)\};/g;
// Heuristic local/global declaration: "<type> <name> [= ...] [, ...] ;" outside of control statements.
const DECL_RE =
  /^(?:const\s+|constexpr\s+|static\s+|extern\s+|thread_local\s+|mutable\s+|volatile\s+)*(unsigned\s+|signed\s+)?(void|bool|char|short|int|long|float|double|size_t|ssize_t|auto|std::[A-Za-z_:]+(?:<[^;{}]*>)?|[A-Za-z_]\w*(?:::\w+)?(?:<[^;{}]*>)?)\s*([*&]+)?\s*([A-Za-z_]\w*)(\s*\[[^\];{}]*\])?\s*(=\s*(?:\{[^;]*\}|[^;{}]+)|\([^;{}]*\))?;/;

const CONTROL_KW = new Set(["if", "for", "while", "switch", "return", "typedef", "using", "catch", "sizeof", "decltype", "new", "delete", "case"]);

export class RegexParser implements ParserAdapter {
  parseFull(text: string, _uri: string): ParsedFile {
    const clean = stripCommentsAndStrings(text);
    const lines = clean.split("\n");
    const parseErrors: string[] = [];

    // --- functions (brace matched) ---
    const functions: ParsedFile["functions"] = [];
    let m: RegExpExecArray | null;
    FUNC_RE.lastIndex = 0;
    while ((m = FUNC_RE.exec(clean)) !== null) {
      const name = m[1];
      if (CONTROL_KW.has(name)) continue;
      // Anchor the start line at the function NAME (the match may begin with
      // a preceding delimiter/newline, which would mis-scope globals).
      const nameRel = m[0].search(new RegExp(`\\b${name}\\s*\\(`));
      const nameAbs = nameRel >= 0 ? m.index + nameRel : m.index;
      const prefix = nameRel >= 0 ? m[0].slice(0, nameRel) : "";
      const returnsPointer = /[*&]\s*$/.test(prefix);
      const openIdx = m.index + m[0].length - 1;
      let depth = 1;
      let i = openIdx + 1;
      for (; i < clean.length && depth > 0; i++) {
        if (clean[i] === "{") depth++;
        else if (clean[i] === "}") depth--;
      }
      const startLine = lineOf(nameAbs, clean);
      const endLine = lineOf(Math.min(i, clean.length), clean);
      functions.push({ name, startLine, endLine, returnsPointer });
    }

    // --- records ---
    const records: RecordDecl[] = [];
    RECORD_RE.lastIndex = 0;
    while ((m = RECORD_RE.exec(clean)) !== null) {
      const kind = m[1] as RecordDecl["kind"];
      const attrs = m[2] ?? "";
      const name = m[3];
      const baseClause = (m[4] ?? "").trim();
      const body = m[5];
      const bases = baseClause
        ? baseClause.split(",").map((b) => b.replace(/\b(virtual|public|protected|private)\b/g, "").trim()).filter(Boolean)
        : [];
      const fields: FieldDecl[] = [];
      const bodyStart = m.index + m[0].indexOf("{") + 1;
      let partStart = bodyStart;
      for (const part of body.split(";")) {
        const partOffset = partStart;
        partStart += part.length + 1;
        // Access labels share a part with the following member ("public: int x").
        const t = part.trim().replace(/^(?:(?:public|private|protected)\s*:\s*)+/, "");
        if (!t) continue;
        if (/^(public|private|protected)\s*:?$/.test(t)) continue;
        if (t.includes("(")) continue; // skip methods/ctors
        const fm = /^(?:const\s+|static\s+|mutable\s+)*(unsigned\s+)?([\w:]+(?:<[^<>]*>)?)\s*([*&]*)\s*(\w+)(\s*\[[^\]]*\])?$/.exec(t);
        if (fm) {
          const type = `${fm[1] ?? ""}${fm[2]}${fm[3] ? " " + fm[3].replace(/\s+/g, "") : ""}${fm[5] ?? ""}`.trim();
          const at = partOffset + part.indexOf(t);
          const fieldLine = lineOf(at, clean);
          const col = at - (clean.lastIndexOf("\n", at - 1) + 1);
          fields.push({ name: fm[4], type, line: fieldLine, col });
        }
      }
      const mStartLine = clean.lastIndexOf("\n", m.index - 1) + 1;
      // Same-line declaration prefix (struct-level attributes live here).
      const declPrefix = clean.slice(mStartLine, m.index);
      // The single line above (MSVC-style #pragma pack regions).
      const prevLineEnd = mStartLine - 1;
      const prevLineStart = clean.lastIndexOf("\n", prevLineEnd - 1) + 1;
      const prevLine = prevLineEnd > 0 ? clean.slice(prevLineStart, prevLineEnd) : "";
      records.push({
        name,
        kind,
        fields,
        bases,
        line: lineOf(m.index, clean),
        endLine: lineOf(m.index + m[0].length - 1, clean),
        hasAccessSpecifiers: /\b(public|private|protected)\s*:/.test(body),
        hasVirtualFn: /\bvirtual\b/.test(body),
        hasVirtualBase: /\bvirtual\b/.test(baseClause),
        hasBitfields: body.split(";").some((s) => /^\s*(?:unsigned\s+|int\s+|bool\s+|short\s+|long\s+|char\s+)?\w+\s*:\s*\d+\s*$/.test(s)),
        hasAlignas: /\balignas\s*\(|\baligned\b/.test(body) || /\balignas\s*\(|\baligned\b/.test(declPrefix + attrs),
        hasPacked: /\bpacked\b/.test(declPrefix + attrs) || /#?\s*pragma\s+pack\b/.test(prevLine),
        hasNoUniqueAddress: /\bno_unique_address\b/.test(body),
        hasNested: /\b(struct|class|union)\s+[A-Za-z_]\w*\s*[{<:]/.test(body),
      });
    }

    // --- per-line scan for vars / allocs / frees ---
    const globals: VarDecl[] = [];
    const locals: VarDecl[] = [];
    const allocs: AllocSite[] = [];
    const frees: FreeSite[] = [];

    const scopeAt = (line: number): string => {
      let best = "";
      let bestStart = -1;
      for (const f of functions) {
        if (line >= f.startLine && line <= f.endLine && f.startLine >= bestStart) {
          best = f.name;
          bestStart = f.startLine;
        }
      }
      return best || "global";
    };

    lines.forEach((raw, idx) => {
      const line = raw.trim();
      if (!line || line.startsWith("#")) return;

      // -- frees --
      let fm: RegExpMatchArray | null;
      if ((fm = line.match(/delete\s*\[\s*\]\s*(\w+)/))) {
        frees.push({ varName: fm[1], kind: "deleteArray", scope: scopeAt(idx), line: idx, col: raw.indexOf("delete") });
        return;
      }
      if ((fm = line.match(/\bdelete\s+(\w+)/))) {
        frees.push({ varName: fm[1], kind: "delete", scope: scopeAt(idx), line: idx, col: raw.indexOf("delete") });
        return;
      }
      if ((fm = line.match(/\bfree\s*\(\s*(\w+)\s*\)/))) {
        frees.push({ varName: fm[1], kind: "free", scope: scopeAt(idx), line: idx, col: raw.indexOf("free") });
        return;
      }
      if ((fm = line.match(/(\w+)\s*\.\s*reset\s*\(\s*\)/))) {
        frees.push({ varName: fm[1], kind: "reset", scope: scopeAt(idx), line: idx, col: 0 });
      }

      // -- allocs: new / new[] --
      if ((fm = line.match(/=\s*new\s+([A-Za-z_][\w:]*(?:<[^;>]*>)?)\s*\[\s*([^\];]+?)\s*\]/))) {
        const lhs = line.match(/([A-Za-z_]\w*)\s*=\s*new/)?.[1] ?? "tmp";
        allocs.push({ varName: lhs, kind: "newArray", typeArg: fm[1], countExpr: fm[2].trim(), scope: scopeAt(idx), line: idx, col: raw.indexOf("new") });
      } else if ((fm = line.match(/=\s*new\s+([A-Za-z_][\w:]*(?:<[^;>]*>)?)\s*(\([^;]*\))?/))) {
        if (!line.includes("new[")) {
          const lhs = line.match(/([A-Za-z_]\w*)\s*=\s*new/)?.[1] ?? "tmp";
          allocs.push({ varName: lhs, kind: "new", typeArg: fm[1], countExpr: "1", scope: scopeAt(idx), line: idx, col: raw.indexOf("new") });
        }
      }
      // -- malloc/calloc/realloc --
      if ((fm = line.match(/([A-Za-z_]\w*)\s*=\s*.*\bmalloc\s*\(\s*([^;]+?)\s*\)/))) {
        allocs.push({ varName: fm[1], kind: "malloc", typeArg: "void", countExpr: fm[2].trim(), scope: scopeAt(idx), line: idx, col: raw.indexOf("malloc") });
      } else if ((fm = line.match(/([A-Za-z_]\w*)\s*=\s*.*\bcalloc\s*\(\s*([^,;]+?)\s*,\s*([^;]+?)\s*\)/))) {
        allocs.push({ varName: fm[1], kind: "calloc", typeArg: "void", countExpr: `${fm[2].trim()}*${fm[3].trim()}`, scope: scopeAt(idx), line: idx, col: raw.indexOf("calloc") });
      } else if ((fm = line.match(/([A-Za-z_]\w*)\s*=\s*.*\brealloc\s*\(\s*\w+\s*,\s*([^;]+?)\s*\)/))) {
        allocs.push({ varName: fm[1], kind: "realloc", typeArg: "void", countExpr: fm[2].trim(), scope: scopeAt(idx), line: idx, col: raw.indexOf("realloc") });
      }
      if ((fm = line.match(/std::make_unique\s*<\s*([^>]+?)\s*>/))) {
        const lhs = line.match(/([A-Za-z_]\w*)\s*=/)?.[1] ?? "tmp";
        allocs.push({ varName: lhs, kind: "make_unique", typeArg: fm[1].trim(), countExpr: "1", scope: scopeAt(idx), line: idx, col: 0 });
      }
      if ((fm = line.match(/std::make_shared\s*<\s*([^>]+?)\s*>/))) {
        const lhs = line.match(/([A-Za-z_]\w*)\s*=/)?.[1] ?? "tmp";
        allocs.push({ varName: lhs, kind: "make_shared", typeArg: fm[1].trim(), countExpr: "1", scope: scopeAt(idx), line: idx, col: 0 });
      }

      // -- var decls -- (members inside a struct/class/union body are fields, not variables)
      if (records.some((r) => idx > r.line && idx <= r.endLine)) return;
      const dm = DECL_RE.exec(line);
      if (dm) {
        let base = `${dm[1] ?? ""}${dm[2]}`.trim();
        if (base === "auto" && !dm[3] && dm[6]) {
          // Deduce the obvious cases so `auto p = std::make_unique<T>()` gets a real size.
          const init = dm[6];
          const mk = /std::make_(unique|shared)\s*<\s*([^>]+?)\s*>/.exec(init);
          const nw = /\bnew\s+([A-Za-z_][\w:]*(?:<[^;>]*>)?)/.exec(init);
          if (mk) base = `std::${mk[1]}_ptr<${mk[2].trim()}>`;
          else if (nw) base = `${nw[1]} *`;
        }
        const ptrStars = dm[3] ?? "";
        const name = dm[4];
        if (CONTROL_KW.has(name) || CONTROL_KW.has(base)) return;
        const arr = dm[5]?.trim();
        const init = (dm[6] ?? "").replace(/^=\s*/, "").trim();
        const scope = scopeAt(idx);
        const type = arr ? `${base}${ptrStars ? " " + ptrStars : ""}${arr}` : `${base}${ptrStars ? " " + ptrStars : ""}`;
        const v: VarDecl = {
          name,
          type: type.trim(),
          scope,
          line: idx,
          col: raw.indexOf(name),
          init,
          isPointer: ptrStars.includes("*") || init.includes("new ") || init.includes("malloc"),
          arraySize: arr?.replace(/[\[\]\s]/g, ""),
          isGlobal: scope === "global",
        };
        if (v.isGlobal) globals.push(v);
        else locals.push(v);
      }
    });

    // --- brace balance check ---
    let depth = 0;
    for (const ch of clean) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth < 0) {
          parseErrors.push("unbalanced closing brace");
          depth = 0;
        }
      }
    }
    if (depth !== 0) parseErrors.push(`unbalanced braces (depth ${depth} at EOF)`);
    const opens = (clean.match(/\(/g) ?? []).length;
    const closes = (clean.match(/\)/g) ?? []).length;
    if (opens !== closes) parseErrors.push(`unbalanced parentheses (${opens} vs ${closes})`);

    return { functions, globals, locals, records, allocs, frees, parseErrors };
  }
}
