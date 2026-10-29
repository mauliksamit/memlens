/**
 * VS Code webview entry. The host is the source of truth: it
 * sends a `history` for the file being shown, then incremental `snapshot`s.
 * Each section re-renders only when its HTML changes (scroll + focus are
 * kept), and one delegated listener handles every interaction.
 */
import { diffSnapshots } from "@memlens/protocol";
import type { Fidelity, HostToWebviewMessage, MemorySnapshot, SnapshotDiff, UiStatus, WebviewToHostMessage } from "@memlens/protocol";
import { mockSnapshot } from "./mock.js";
import { paletteVars } from "./palette.js";
import {
  changesFromDiff,
  recordId,
  renderChanges,
  renderInspector,
  renderIssues,
  renderMemoryMap,
  renderRecords,
  renderRelationships,
  renderScrubber,
  renderToolbar,
} from "./render.js";

interface PersistedState {
  selectedId: string | null;
  filter: string;
  collapsed: string[];
  showChanges: boolean;
}

interface VsCodeApi {
  postMessage: (m: WebviewToHostMessage) => void;
  getState: () => PersistedState | undefined;
  setState: (s: PersistedState) => void;
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const standalone = typeof acquireVsCodeApi !== "function";
const vscode: VsCodeApi = standalone
  ? { postMessage: () => {}, getState: () => undefined, setState: () => {} }
  : acquireVsCodeApi!();

const saved = vscode.getState();
const ui: PersistedState = {
  selectedId: saved?.selectedId ?? null,
  filter: saved?.filter ?? "",
  collapsed: saved?.collapsed ?? [],
  showChanges: saved?.showChanges ?? false,
};

let history: MemorySnapshot[] = [];
let activeIndex = -1;
let fileUri = "";
let fidelity: Fidelity = "static";
let available: Fidelity[] = ["static"];
let status: UiStatus | null = null;
let palette = "colorblind-safe";
let followLatest = true;

const rendered = new Map<string, string>();

function persist(): void {
  vscode.setState(ui);
}

function post(m: WebviewToHostMessage): void {
  vscode.postMessage(m);
}

function current(): MemorySnapshot | null {
  return history[activeIndex] ?? null;
}

function activeDiff(): SnapshotDiff | null {
  return activeIndex > 0 ? diffSnapshots(history[activeIndex - 1], history[activeIndex]) : null;
}

function fileName(): string {
  const u = fileUri || current()?.uri || "";
  try {
    return decodeURIComponent(u.split(/[\\/]/).pop() ?? u);
  } catch {
    return u;
  }
}

/** Replace a section's HTML only when it changed; restore focus inside it. */
function patch(id: string, html: string): void {
  if (rendered.get(id) === html) return;
  const host = document.getElementById(id);
  if (!host) return;
  const active = document.activeElement as HTMLElement | null;
  const hadFocus = active && host.contains(active);
  const focusKey = hadFocus ? `${active.getAttribute("data-action") ?? ""}|${active.getAttribute("data-id") ?? active.getAttribute("data-index") ?? active.id}` : null;
  host.innerHTML = html;
  host.hidden = html === "";
  rendered.set(id, html);
  if (focusKey) {
    const match = Array.from(host.querySelectorAll<HTMLElement>("button, input")).find(
      (e) => `${e.getAttribute("data-action") ?? ""}|${e.getAttribute("data-id") ?? e.getAttribute("data-index") ?? e.id}` === focusKey,
    );
    match?.focus({ preventScroll: true });
  }
}

function card(title: string, hint: string, body: string, extra = ""): string {
  return `<div class="ml-card-heading"><h2>${title}</h2>${hint ? `<span class="ml-muted">${hint}</span>` : ""}${extra}</div>${body}`;
}

function render(): void {
  const snap = current();
  patch("ml-tb", renderToolbar(snap, { fileName: fileName(), fidelity, available, phase: status?.phase, message: status?.message }));
  if (!snap) {
    const empty =
      fidelity === "debugger"
        ? `<strong>Waiting for the debugger</strong><span>Pause at a breakpoint in a C or C++ file to see the live frame.</span>`
        : `<strong>Open a C or C++ file</strong><span>MemLens shows where each variable lives, how big it is, and how structs are laid out, updating as you type.</span>`;
    patch("ml-empty", `<div class="ml-empty">${empty}</div>`);
    for (const id of ["ml-scrubber", "ml-changes", "ml-issues", "ml-map", "ml-types", "ml-inspector", "ml-links"]) patch(id, "");
    return;
  }
  patch("ml-empty", "");
  const diff = activeDiff();
  const blocks = snap.regions.flatMap((r) => r.blocks);
  if (ui.selectedId && !ui.selectedId.startsWith("record:") && !blocks.some((b) => b.id === ui.selectedId)) {
    // Keep the selection across edits when the same name still exists.
    const oldName = ui.selectedId.split(":").pop();
    ui.selectedId = blocks.find((b) => b.id.split(":").pop() === oldName)?.id ?? null;
  }
  patch("ml-scrubber", renderScrubber(history, activeIndex, diff));
  const changes = changesFromDiff(diff);
  patch("ml-changes", ui.showChanges && changes.length ? card("Changes", "compared with the previous snapshot", renderChanges(changes, snap)) : "");
  patch("ml-issues", snap.issues.length ? card("Issues", "click to go to the line", renderIssues(snap.issues)) : "");
  patch(
    "ml-map",
    card(
      "Memory",
      snap.fidelity === "static" ? "estimated from source" : snap.fidelity === "debugger" ? "live from the paused frame" : "measured at runtime",
      renderMemoryMap(snap, { palette, selectedId: ui.selectedId ?? undefined, diff, filter: ui.filter, collapsed: new Set(ui.collapsed) }),
      `<span class="ml-legend"><i class="ml-dot ml-dot-stack"></i>stack <i class="ml-dot ml-dot-heap"></i>heap <i class="ml-dot ml-dot-global"></i>globals</span>`,
    ),
  );
  patch("ml-types", snap.records?.length ? card("Types", "struct, class and union layouts", renderRecords(snap.records, ui.selectedId)) : "");
  patch("ml-inspector", card("Inspector", "", renderInspector(snap, ui.selectedId)));
  const sel = blocks.find((b) => b.id === ui.selectedId);
  patch("ml-links", sel ? card("Relationships", "", renderRelationships(snap, ui.selectedId)) : "");
}

function select(id: string | null, notifyHost = true): void {
  ui.selectedId = id;
  persist();
  render();
  if (id && notifyHost) post({ type: "selectBlock", blockId: id });
}

function openSource(id: string): void {
  const snap = current();
  if (!snap) return;
  if (id.startsWith("record:")) {
    const rec = snap.records?.find((r) => recordId(r.name) === id);
    if (rec) post({ type: "openSource", sourceRange: rec.sourceRange });
    return;
  }
  const b = snap.regions.flatMap((r) => r.blocks).find((x) => x.id === id);
  if (b) post({ type: "openSource", sourceRange: b.sourceRange });
}

function step(index: number): void {
  if (index < 0 || index >= history.length || index === activeIndex) return;
  activeIndex = index;
  followLatest = index === history.length - 1;
  post({ type: "scrub", snapshotId: history[index].id });
  render();
}

// --- interaction (delegated) -------------------------------------------------

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!t || (t as HTMLButtonElement).disabled) return;
  const id = t.getAttribute("data-id") ?? "";
  switch (t.getAttribute("data-action")) {
    case "select":
      select(id);
      break;
    case "open":
      openSource(id);
      break;
    case "open-issue": {
      const issue = current()?.issues[Number(t.getAttribute("data-index"))];
      if (issue) post({ type: "openSource", sourceRange: issue.sourceRange });
      break;
    }
    case "step":
      step(Number(t.getAttribute("data-index")));
      break;
    case "fidelity": {
      const f = t.getAttribute("data-fidelity") as Fidelity;
      if (f && f !== fidelity) post({ type: "setFidelity", fidelity: f });
      break;
    }
    case "toggle-changes":
      ui.showChanges = !ui.showChanges;
      persist();
      render();
      break;
    case "toggle-region": {
      const key = t.getAttribute("data-region-key") ?? "";
      ui.collapsed = ui.collapsed.includes(key) ? ui.collapsed.filter((k) => k !== key) : [...ui.collapsed, key];
      persist();
      render();
      break;
    }
    case "jump-issues":
      document.getElementById("ml-issues")?.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
  }
});

document.addEventListener("dblclick", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action="select"]');
  if (t) openSource(t.getAttribute("data-id") ?? "");
});

document.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "ml-range") step(Number(t.value));
  else if (t.id === "ml-filter") {
    ui.filter = t.value.trim();
    persist();
    render();
  }
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement;
  const inText = target.tagName === "INPUT" && (target as HTMLInputElement).type !== "range";
  if (e.key === "Escape") {
    if (inText && ui.filter) {
      (target as HTMLInputElement).value = "";
      ui.filter = "";
    } else ui.selectedId = null;
    persist();
    render();
    return;
  }
  if (inText) return;
  if (e.key === "/") {
    e.preventDefault();
    document.getElementById("ml-filter")?.focus();
  } else if (e.key === "Enter" && e.shiftKey && target.getAttribute("data-action") === "select") {
    e.preventDefault();
    openSource(target.getAttribute("data-id") ?? "");
  } else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target.id !== "ml-range") {
    e.preventDefault();
    step(activeIndex + (e.key === "ArrowLeft" ? -1 : 1));
  }
});

// --- host messages -------------------------------------------------------------

function applyPalette(name: string): void {
  palette = name;
  for (const [k, v] of Object.entries(paletteVars(name))) document.documentElement.style.setProperty(k, v);
}

window.addEventListener("message", (e: MessageEvent<HostToWebviewMessage>) => {
  const msg = e.data;
  switch (msg.type) {
    case "history": {
      const fileChanged = msg.uri !== fileUri;
      fileUri = msg.uri;
      history = msg.snapshots.slice(-200);
      activeIndex = history.length - 1;
      followLatest = true;
      if (msg.fidelity) fidelity = msg.fidelity;
      if (msg.available) available = msg.available;
      if (fileChanged) ui.selectedId = null;
      status = null;
      render();
      break;
    }
    case "snapshot": {
      const snap = msg.snapshot;
      const i = history.findIndex((s) => s.id === snap.id);
      if (i >= 0) history[i] = snap;
      else history.push(snap);
      if (history.length > 200) history.shift();
      if (followLatest) activeIndex = history.length - 1;
      else activeIndex = Math.min(activeIndex, history.length - 1);
      if (status?.phase !== "error") status = null;
      render();
      break;
    }
    case "status":
      status = msg.state.phase === "idle" && !msg.state.message ? null : msg.state;
      render();
      break;
    case "config":
      applyPalette(msg.config.palette);
      render();
      break;
    case "select":
      if (msg.blockId !== ui.selectedId) select(msg.blockId, false);
      break;
    default:
      break;
  }
});

// --- boot ------------------------------------------------------------------------

function boot(): void {
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML =
    `<header class="ml-toolbar"><div id="ml-tb"></div>` +
    `<div class="ml-filter-row"><input id="ml-filter" type="search" placeholder="Filter blocks by name or type" aria-label="Filter blocks" value=""><kbd title="Press / to filter">/</kbd></div>` +
    `<div id="ml-scrubber"></div></header>` +
    `<div id="ml-empty"></div>` +
    `<div class="ml-layout"><div class="ml-col-main">` +
    `<section id="ml-changes" class="ml-card" aria-label="Changes" hidden></section>` +
    `<section id="ml-issues" class="ml-card ml-issues-card" aria-label="Issues" hidden></section>` +
    `<section id="ml-map" class="ml-card" aria-label="Memory map" hidden></section>` +
    `<section id="ml-types" class="ml-card" aria-label="Types" hidden></section>` +
    `</div><aside class="ml-col-side">` +
    `<section id="ml-inspector" class="ml-card" aria-label="Inspector" hidden></section>` +
    `<section id="ml-links" class="ml-card" aria-label="Relationships" hidden></section>` +
    `</aside></div>`;
  (document.getElementById("ml-filter") as HTMLInputElement).value = ui.filter;
  const toolbar = app.querySelector<HTMLElement>(".ml-toolbar");
  if (toolbar && typeof ResizeObserver === "function") {
    new ResizeObserver(() => document.documentElement.style.setProperty("--ml-toolbar-h", `${toolbar.offsetHeight + 12}px`)).observe(toolbar);
  }
  applyPalette(palette);
  if (standalone) {
    const m = mockSnapshot();
    history = [m];
    activeIndex = 0;
    fileUri = m.uri ?? "file:///main.cpp";
  }
  render();
  post({ type: "ready" });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
