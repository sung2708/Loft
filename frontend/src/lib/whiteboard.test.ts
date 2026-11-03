import { describe, it, expect } from "vitest";
import { boardDraftKey, createTLStore, mergeBoardRecords, isSafeBoardRecord, readBoardDraft, savePendingBoard, writeBoardDraft, type TLRecord, type TLShape } from "./whiteboard";
const record = (id: string) =>
  ({ id, typeName: "shape", type: "draw" }) as unknown as TLRecord;
describe("whiteboard snapshot recovery", () => {
  it("keeps edits after a failed save and retries without losing a newer edit", async () => {
    const first = record("shape:local");
    const newer = record("shape:newer");
    const pending = new Map<string, TLRecord | null>([[first.id, first]]);
    await expect(savePendingBoard(pending, 0, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(pending.get(first.id)).toBe(first);
    const saved = await savePendingBoard(pending, 0, async (patch) => {
      expect(patch.put).toEqual([first]);
      pending.set(newer.id, newer);
      return { version: 1, records: { [first.id]: first } };
    });
    expect(saved.outstanding).toEqual(new Map([[newer.id, newer]]));
    expect(mergeBoardRecords(saved.snapshot, saved.outstanding).map((r) => r.id).sort()).toEqual([first.id, newer.id]);
  });
  it("preserves pending local edits while merging another participant", () => {
    const local = record("shape:local"),
      other = record("shape:other"),
      deleted = record("shape:deleted");
    const snapshot = {
      version: 4,
      records: { [other.id]: other, [deleted.id]: deleted },
    };
    const pending = new Map<string, TLRecord | null>([
      [local.id, local],
      [deleted.id, null],
    ]);
    expect(
      mergeBoardRecords(snapshot, pending)
        .map((r) => r.id)
        .sort(),
    ).toEqual(["shape:local", "shape:other"]);
    expect(snapshot.records[deleted.id]).toBe(deleted);
  });
});

it("keeps an unsynced draft scoped to its room and ignores malformed storage", () => {
  const local = record("shape:local");
  const draft = new Map<string, TLRecord | null>([[local.id, local], ["shape:gone", null]]);
  expect(boardDraftKey("room-a")).not.toBe(boardDraftKey("room-b"));
  expect(readBoardDraft(writeBoardDraft(draft))).toEqual(draft);
  expect(readBoardDraft('[ ["shape:a", {"id":"shape:b"}] ]')).toEqual(new Map());
});

// The same pinned SDK fixtures are accepted by Go's trust-boundary tests.
import { readFileSync } from "node:fs";
const fixtures = JSON.parse(readFileSync(new URL("../../../backend/internal/store/testdata/board_records.json", import.meta.url), "utf8")) as TLShape[];
it("keeps the server fixtures compatible with the installed SDK", () => {
 const store=createTLStore();
 for(const record of fixtures) expect(()=>store.schema.validateRecord(store,record as TLShape,"updateRecord",null)).not.toThrow();
 expect(()=>store.schema.validateRecord(store,{id:"shape:a",typeName:"shape",type:"draw"} as TLShape,"updateRecord",null)).toThrow();
});

it("isolates malformed legacy records and paths while retaining valid shapes",()=>{
 const store=createTLStore();
 const good=fixtures[0] as TLRecord;
 const bad={...good,typeName:"shape",type:"draw",props:{...fixtures[0].props,segments:[{type:"free",path:"AA=="}]}} as unknown as TLRecord;
 expect(isSafeBoardRecord(store,good)).toBe(true);
 expect(isSafeBoardRecord(store,bad)).toBe(false);
 expect(isSafeBoardRecord(store,record("shape:missing-fields"))).toBe(false);
});

import { withoutBoardCycles } from "./whiteboard";
it("quarantines cycles and their descendants but retains unrelated shapes",()=>{
 const shape=(id:string,parentId:string)=>({...fixtures[7],id,parentId}) as TLShape;
 const self=shape("shape:self","shape:self");
 const a=shape("shape:a","shape:b"),b=shape("shape:b","shape:a"),child=shape("shape:child","shape:a");
 const good=shape("shape:good","page:page"),nested=shape("shape:nested","shape:good");
 expect(withoutBoardCycles([self,a,b,child,good,nested]).map(r=>r.id)).toEqual([good.id,nested.id]);
 expect(withoutBoardCycles([child,b,a,self])).toEqual([]);
});
it("rejects unsupported rich text marks before SDK rendering",()=>{
 const store=createTLStore();
 const shape=(mark:string)=>({...fixtures[2],props:{...fixtures[2].props,richText:{type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"hi",marks:[{type:mark}]}]}]}}}) as TLShape;
 expect(isSafeBoardRecord(store,shape("bold italic"))).toBe(false);
 expect(isSafeBoardRecord(store,shape("unknown"))).toBe(false);
 expect(isSafeBoardRecord(store,shape("bold"))).toBe(true);
});
