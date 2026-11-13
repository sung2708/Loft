import { describe, expect, it } from "vitest";
import { createBoardHistory } from "./boardHistory";
import { createTLStore, type TLRecord } from "./whiteboard";

const shape = (id: string, x = 0): TLRecord =>
  ({
    id,
    typeName: "shape",
    type: "geo",
    x,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:page",
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {},
  }) as TLRecord;

function setup() {
  const store = createTLStore();
  const history = createBoardHistory();
  store.listen((entry) => history.record(entry), { source: "user" });
  return { store, history };
}

describe("board history", () => {
  it("undoes only this user's changes, leaving remote shapes untouched", () => {
    const { store, history } = setup();
    history.begin();
    store.put([shape("shape:mine")], "user");
    store.mergeRemoteChanges(() => store.put([shape("shape:theirs")]));

    expect(history.undo(store)).toBe(true);
    expect(store.get("shape:mine")).toBeUndefined();
    expect(store.get("shape:theirs")).toBeDefined();

    expect(history.redo(store)).toBe(true);
    expect(store.get("shape:mine")).toBeDefined();
    expect(store.get("shape:theirs")).toBeDefined();
  });

  it("collapses a drag into one step and restores the original position", () => {
    const { store, history } = setup();
    history.begin();
    store.put([shape("shape:a", 0)], "user");
    history.begin();
    for (let x = 1; x <= 5; x++) store.put([shape("shape:a", x)], "user");

    history.undo(store);
    expect((store.get("shape:a") as { x: number }).x).toBe(0);
    history.undo(store);
    expect(store.get("shape:a")).toBeUndefined();
    expect(history.canUndo).toBe(false);
  });

  it("restores deleted shapes and clears redo after a new edit", () => {
    const { store, history } = setup();
    history.begin();
    store.put([shape("shape:a")], "user");
    history.begin();
    store.remove(["shape:a"], "user");

    history.undo(store);
    expect(store.get("shape:a")).toBeDefined();
    expect(history.canRedo).toBe(true);

    history.begin();
    store.put([shape("shape:b")], "user");
    expect(history.canRedo).toBe(false);
  });
});

it("skips remote edits during undo and never adds skipped records to redo", () => {
  const { store, history } = setup();
  store.mergeRemoteChanges(() => store.put([shape("shape:a", 0)]));
  history.begin();
  store.put([shape("shape:a", 10)], "user");
  store.mergeRemoteChanges(() => store.put([shape("shape:a", 100)]));
  expect(history.undo(store)).toBe(false);
  expect((store.get("shape:a") as { x: number }).x).toBe(100);
  expect(history.redo(store)).toBe(false);
});

it("does not resurrect remote deletions or overwrite edits during redo", () => {
  const { store, history } = setup();
  store.mergeRemoteChanges(() => store.put([shape("shape:a", 0)]));
  history.begin();
  store.put([shape("shape:a", 10)], "user");
  history.undo(store);
  store.mergeRemoteChanges(() => store.put([shape("shape:a", 100)]));
  expect(history.redo(store)).toBe(false);
  expect((store.get("shape:a") as { x: number }).x).toBe(100);
  history.begin();
  store.put([shape("shape:a", 200)], "user");
  store.mergeRemoteChanges(() => store.remove(["shape:a"]));
  expect(history.undo(store)).toBe(false);
  expect(store.get("shape:a")).toBeUndefined();
});

it("undoes untouched records in a mixed group after snapshot key reordering", () => {
  const { store, history } = setup();
  history.begin();
  store.put([shape("shape:a"), shape("shape:b")], "user");
  const b = shape("shape:b");
  store.mergeRemoteChanges(() =>
    store.put([
      shape("shape:a", 100),
      Object.fromEntries(Object.entries(b).reverse()) as TLRecord,
    ]),
  );
  expect(history.undo(store)).toBe(true);
  expect(store.get("shape:a")).toBeDefined();
  expect(store.get("shape:b")).toBeUndefined();
  history.redo(store);
  expect((store.get("shape:a") as { x: number }).x).toBe(100);
  expect(store.get("shape:b")).toBeDefined();
});
