import type { TLRecord, TLStore, TLStoreChangeEntry } from "./whiteboard";

/**
 * Per-user undo for a shared board. Only this client's own changes are
 * recorded (the store listener is subscribed to source "user"), so undo never
 * reverts shapes another participant drew. Each group stores the before/after
 * state of just the records it touched; null means "absent".
 */
interface HistoryGroup {
  before: Map<string, TLRecord | null>;
  after: Map<string, TLRecord | null>;
}

export interface BoardHistory {
  /** Start a new undo step; the next recorded change opens a fresh group. */
  begin(): void;
  record(entry: TLStoreChangeEntry): void;
  undo(store: TLStore): boolean;
  redo(store: TLStore): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

// PostgreSQL JSON can reorder object keys between save and snapshot.
const canonical = (record: TLRecord | null) =>
  JSON.stringify(record, (_, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );

const isStructural = (record: TLRecord) =>
  record.typeName === "document" || record.typeName === "page";

export function createBoardHistory(limit = 60): BoardHistory {
  const past: HistoryGroup[] = [];
  let future: HistoryGroup[] = [];
  let current: HistoryGroup | null = null;
  let startNew = true;
  let applying = false;

  const track = (
    id: string,
    before: TLRecord | null,
    after: TLRecord | null,
  ) => {
    if (!current) return;
    // Keep the earliest "before" and the latest "after" within one step.
    if (!current.before.has(id)) current.before.set(id, before);
    current.after.set(id, after);
  };

  const apply = (
    target: Map<string, TLRecord | null>,
    expected: Map<string, TLRecord | null>,
    store: TLStore,
  ) => {
    const put: TLRecord[] = [];
    const remove: string[] = [];
    for (const [id, record] of target) {
      if (
        canonical(store.get(id) ?? null) !== canonical(expected.get(id) ?? null)
      ) {
        target.delete(id);
        expected.delete(id);
        continue;
      }
      if (record) put.push(record);
      else if (store.get(id)) remove.push(id);
    }
    applying = true;
    try {
      if (remove.length) store.remove(remove, "user");
      if (put.length) store.put(put, "user");
    } finally {
      applying = false;
    }
  };

  return {
    begin() {
      startNew = true;
    },
    record({ changes }) {
      if (applying) return;
      const touched =
        Object.values(changes.added).some((r) => !isStructural(r)) ||
        Object.values(changes.updated).some(([, r]) => !isStructural(r)) ||
        Object.values(changes.removed).some((r) => !isStructural(r));
      if (!touched) return;
      if (startNew || !current) {
        current = { before: new Map(), after: new Map() };
        past.push(current);
        if (past.length > limit) past.shift();
        startNew = false;
      }
      future = [];
      for (const record of Object.values(changes.added))
        if (!isStructural(record)) track(record.id, null, record);
      for (const [from, to] of Object.values(changes.updated))
        if (!isStructural(to)) track(to.id, from, to);
      for (const record of Object.values(changes.removed))
        if (!isStructural(record)) track(record.id, record, null);
    },
    undo(store) {
      const group = past.pop();
      if (!group) return false;
      current = null;
      apply(group.before, group.after, store);
      if (group.before.size) future.push(group);
      return group.before.size > 0;
    },
    redo(store) {
      const group = future.pop();
      if (!group) return false;
      current = null;
      apply(group.after, group.before, store);
      if (group.after.size) past.push(group);
      return group.after.size > 0;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
  };
}
