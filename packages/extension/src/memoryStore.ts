/**
 * MemoryStore: single source of truth (snapshots, events, diffs).
 *
 * One ring-buffer history per (document, fidelity): static edits, traced runs
 * and debugger stops for a file never mix, so every diff compares like with
 * like and switching files never collides snapshot ids.
 */
import { diffSnapshots } from "@memlens/protocol";
import type { Fidelity, MemoryEvent, MemorySnapshot, SnapshotDiff } from "@memlens/protocol";

export type StoreListener = (snap: MemorySnapshot, diff: SnapshotDiff | null) => void;
export type EventListener = (events: MemoryEvent[]) => void;

const FIDELITY_ORDER: Fidelity[] = ["static", "traced", "debugger"];

function keyOf(uri: string, fidelity: Fidelity): string {
  return `${fidelity}|${uri}`;
}

export class MemoryStore {
  private histories = new Map<string, MemorySnapshot[]>();
  private events: MemoryEvent[] = [];
  private listeners = new Set<StoreListener>();
  private eventListeners = new Set<EventListener>();
  private lastUri = "";
  private lastFidelity: Fidelity = "static";

  constructor(public historyCap = 50) {}

  push(snapshot: MemorySnapshot): SnapshotDiff | null {
    const uri = snapshot.uri ?? "";
    const key = keyOf(uri, snapshot.fidelity);
    const history = this.histories.get(key) ?? [];
    const prev = history.length > 0 ? history[history.length - 1] : null;
    const diff = prev ? diffSnapshots(prev, snapshot) : null;
    if (prev && prev.id === snapshot.id) history[history.length - 1] = snapshot;
    else history.push(snapshot);
    if (history.length > this.historyCap) history.splice(0, history.length - this.historyCap);
    this.histories.set(key, history);
    this.lastUri = uri;
    this.lastFidelity = snapshot.fidelity;
    for (const l of this.listeners) l(snapshot, diff);
    return diff;
  }

  appendEvents(events: MemoryEvent[]): void {
    this.events.push(...events);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    for (const l of this.eventListeners) l(events);
  }

  /** Latest snapshot for a document (default: the most recently updated one). */
  latest(uri?: string, fidelity?: Fidelity): MemorySnapshot | null {
    const h = this.getHistory(uri, fidelity);
    return h.length > 0 ? h[h.length - 1] : null;
  }

  getHistory(uri?: string, fidelity?: Fidelity): readonly MemorySnapshot[] {
    const u = uri ?? this.lastUri;
    const f = fidelity ?? (uri === undefined ? this.lastFidelity : "static");
    return this.histories.get(keyOf(u, f)) ?? [];
  }

  /** Fidelities that have at least one snapshot for this document. */
  fidelitiesFor(uri: string): Fidelity[] {
    return FIDELITY_ORDER.filter((f) => (this.histories.get(keyOf(uri, f))?.length ?? 0) > 0);
  }

  getById(id: string): MemorySnapshot | undefined {
    for (const h of this.histories.values()) {
      const s = h.find((x) => x.id === id);
      if (s) return s;
    }
    return undefined;
  }

  /** Drop every history of one fidelity (e.g. a new debug session starts). */
  clearFidelity(fidelity: Fidelity): void {
    for (const k of [...this.histories.keys()]) if (k.startsWith(`${fidelity}|`)) this.histories.delete(k);
  }

  /** Clear one document (all fidelities) or everything. */
  clear(uri?: string): void {
    if (uri === undefined) {
      this.histories.clear();
      this.events = [];
      return;
    }
    for (const f of FIDELITY_ORDER) this.histories.delete(keyOf(uri, f));
  }

  onSnapshot(l: StoreListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  onEvents(l: EventListener): () => void {
    this.eventListeners.add(l);
    return () => {
      this.eventListeners.delete(l);
    };
  }
}
