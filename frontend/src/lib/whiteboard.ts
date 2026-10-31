import { b64Vecs, type TLRecord, type TLStore, type TLShape } from "tldraw";
export interface BoardSnapshot {
  version: number;
  records: Record<string, TLRecord>;
}
export interface BoardPatch {
  version: number;
  put: TLRecord[];
  remove: string[];
}

export function boardDraftKey(roomID: string) {
  return `loft.room.${roomID}.board-draft`;
}

export function readBoardDraft(raw: string | null): Map<string, TLRecord | null> {
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(
      parsed.filter(
        (entry): entry is [string, TLRecord | null] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          (entry[1] === null ||
            (typeof entry[1] === "object" &&
              entry[1] !== null &&
              (entry[1] as TLRecord).id === entry[0])),
      ),
    );
  } catch {
    return new Map();
  }
}

export function writeBoardDraft(records: ReadonlyMap<string, TLRecord | null>) {
  return JSON.stringify([...records]);
}
// Keep local edits while a newer authoritative snapshot arrives, including during a save.
export function mergeBoardRecords(
  snapshot: BoardSnapshot,
  pending: ReadonlyMap<string, TLRecord | null>,
): TLRecord[] {
  const records = new Map(Object.entries(snapshot.records));
  for (const [id, record] of pending) {
    if (record) records.set(id, record);
    else records.delete(id);
  }
  return [...records.values()];
}

// SDK record validation does not decode draw paths; check both before rendering.
export function isSafeBoardRecord(store: TLStore, record: TLRecord): boolean {
 try {
  store.schema.validateRecord(store,record,"updateRecord",null);
  if(record.typeName === "shape" && (record.type === "draw" || record.type === "highlight")) {
   for(const segment of record.props.segments) {
    const points=b64Vecs.decodePoints(segment.path,segment.dim);
    if(!points.every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y)&&Number.isFinite(point.z ?? 0)))return false;
   }
  }
  if(record.typeName === "shape" && "richText" in record.props && !isSafeBoardText(record.props.richText))return false;
  return true;
 } catch {return false;}
}

function isSafeBoardText(value: unknown,parent="",depth=0): boolean {
 if(depth>32||!value||typeof value!=="object"||Array.isArray(value))return false;
 const node=value as Record<string,unknown>;
 const allowed:Record<string,string[]>={"": ["doc"],doc:["paragraph","heading","bulletList","orderedList"],listItem:["paragraph","heading","bulletList","orderedList"],bulletList:["listItem"],orderedList:["listItem"],paragraph:["text","hardBreak"],heading:["text","hardBreak"]};
 if(typeof node.type!=="string"||!allowed[parent]?.includes(node.type))return false;
 if(Object.keys(node).some(key=>!["type","content","attrs","text","marks"].includes(key)))return false;
 if(node.attrs!==undefined) {
  if(!node.attrs||typeof node.attrs!=="object"||Array.isArray(node.attrs))return false;
  const level=(node.attrs as Record<string,unknown>).level;
  if(level!==undefined&&(typeof level!=="number"||!Number.isInteger(level)||level<1||level>6))return false;
 }
 if(node.marks!==undefined) {
  if(!Array.isArray(node.marks))return false;
  for(const value of node.marks) {
   if(!value||typeof value!=="object"||Array.isArray(value))return false;
   const mark=value as Record<string,unknown>;
   if(typeof mark.type!=="string"||!["bold","italic","strike","code","underline","link","highlight"].includes(mark.type)||Object.keys(mark).some(key=>key!=="type"&&key!=="attrs"))return false;
  }
 }
 if(node.type==="text")return typeof node.text==="string"&&node.text.length>0&&node.content===undefined;
 if(node.text!==undefined)return false;
 if(node.type==="hardBreak")return node.content===undefined;
 if(node.content!==undefined&&!Array.isArray(node.content))return false;
 const children=(node.content??[]) as unknown[];
 if(["doc","bulletList","orderedList","listItem"].includes(node.type)&&children.length===0)return false;
 if(node.type==="listItem"&&(!children[0]||typeof children[0]!=="object"||(children[0] as Record<string,unknown>).type!=="paragraph"))return false;
 return children.every(child=>isSafeBoardText(child,node.type as string,depth+1));
}

// Exclude a whole parent chain if it reaches a cycle, including descendants.
export function withoutBoardCycles(records: TLRecord[]): TLRecord[] {
 const parents=new Map(records.filter((r):r is TLShape=>r.typeName==="shape").map(r=>[r.id,r.parentId]));
 const safe=new Map<string,boolean>();
 for(const id of parents.keys()) {
  const path=new Set<string>();let current:string=id;
  while(parents.has(current as TLShape["id"])&&!safe.has(current)&&!path.has(current)) {
   path.add(current);current=parents.get(current as TLShape["id"])!;
  }
  const valid=!path.has(current)&&safe.get(current)!==false;
  for(const node of path)safe.set(node,valid);
 }
 return records.filter(r=>safe.get(r.id)!==false);
}
