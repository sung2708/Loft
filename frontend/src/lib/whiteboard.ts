export interface VecPoint {
  x: number;
  y: number;
  z?: number;
}

export interface TLBaseRecord {
  id: string;
  typeName: "page" | "document" | "binding" | "shape" | string;
  meta: Record<string, unknown>;
}

export interface TLShape extends TLBaseRecord {
  typeName: "shape";
  type: "draw" | "geo" | "text" | "note" | "arrow" | "line" | "highlight" | "frame" | "group" | string;
  x: number;
  y: number;
  rotation: number;
  index: string;
  parentId: string;
  isLocked: boolean;
  opacity: number;
  props: Record<string, unknown> & {
    color?: string;
    size?: string;
    segments?: Array<{ type: string; path: string; dim?: number }>;
    start?: VecPoint;
    end?: VecPoint;
  };
}

export type TLRecord = TLShape | (TLBaseRecord & Record<string, unknown>);

export interface TLStoreChangeEntry {
  changes: {
    added: Record<string, TLRecord>;
    updated: Record<string, [TLRecord, TLRecord]>;
    removed: Record<string, TLRecord>;
  };
  source: "user" | "remote";
}

export interface TLStore {
  allRecords(): TLRecord[];
  get(id: string): TLRecord | undefined;
  put(records: TLRecord[], source?: "user" | "remote"): void;
  remove(ids: string[], source?: "user" | "remote"): void;
  mergeRemoteChanges(fn: () => void): void;
  listen(
    listener: (entry: TLStoreChangeEntry) => void,
    options?: { source?: "user" | "remote" | "all"; scope?: string },
  ): () => void;
  schema: {
    validateRecord(
      store: TLStore,
      record: TLRecord,
      phase: string,
      recordBefore: TLRecord | null,
    ): TLRecord;
  };
}

export interface BoardSnapshot {
  version: number;
  records: Record<string, TLRecord>;
}
export interface BoardPatch {
  version: number;
  put: TLRecord[];
  remove: string[];
}

export async function savePendingBoard(
  pending: Map<string, TLRecord | null>,
  version: number,
  save: (patch: BoardPatch) => Promise<BoardSnapshot>,
) {
  const batch = new Map<string, TLRecord | null>();
  let bytes = 0;
  for (const [id, record] of pending) {
    const size = new TextEncoder().encode(JSON.stringify(record ?? id)).length;
    if (batch.size && (batch.size >= 180 || bytes + size > 200_000)) break;
    batch.set(id, record);
    bytes += size;
  }
  const snapshot = await save({
    version,
    put: [...batch.values()].filter((record): record is TLRecord => record !== null),
    remove: [...batch].filter(([, record]) => record === null).map(([id]) => id),
  });
  const outstanding = new Map(pending);
  for (const [id, record] of batch)
    if (outstanding.get(id) === record) outstanding.delete(id);
  return { snapshot, outstanding };
}

function f32ToF16(val: number): number {
  const f32 = new Float32Array([val]);
  const u32 = new Uint32Array(f32.buffer)[0];
  const sign = (u32 >> 16) & 0x8000;
  const exp = ((u32 >> 23) & 0xff) - 127 + 15;
  const frac = u32 & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7c00;
  return sign | (exp << 10) | (frac >> 13);
}

function f16ToF32(u16: number): number {
  const sign = (u16 & 0x8000) ? -1 : 1;
  const exp = (u16 >> 10) & 0x1f;
  const frac = u16 & 0x03ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
  if (exp === 31) return frac ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) {
    throw new Error("Invalid base64 path");
  }
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const b64Vecs = {
  encodePoints(points: VecPoint[]): string {
    if (!points.length) return "";
    const buf = new ArrayBuffer(12 + (points.length - 1) * 6);
    const view = new DataView(buf);
    let cx = Math.fround(points[0].x);
    let cy = Math.fround(points[0].y);
    let cz = Math.fround(points[0].z ?? 0.5);
    view.setFloat32(0, cx, true);
    view.setFloat32(4, cy, true);
    view.setFloat32(8, cz, true);
    for (let i = 1; i < points.length; i++) {
      const off = 12 + (i - 1) * 6;
      const hx = f32ToF16(points[i].x - cx);
      const hy = f32ToF16(points[i].y - cy);
      const hz = f32ToF16((points[i].z ?? 0.5) - cz);
      view.setUint16(off, hx, true);
      view.setUint16(off + 2, hy, true);
      view.setUint16(off + 4, hz, true);
      cx += f16ToF32(hx);
      cy += f16ToF32(hy);
      cz += f16ToF32(hz);
    }
    return toBase64(new Uint8Array(buf));
  },
  decodePoints(path: string, dim = 3): VecPoint[] {
    if (path === "") return [];
    const bytes = fromBase64(path);
    const first = dim * 4;
    const delta = dim * 2;
    if (bytes.length < first || (bytes.length - first) % delta !== 0) {
      throw new Error("Invalid draw path byte length");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let x = view.getFloat32(0, true);
    let y = view.getFloat32(4, true);
    let z = dim === 3 ? view.getFloat32(8, true) : 0.5;
    const pts: VecPoint[] = [{ x, y, z }];
    for (let off = first; off < bytes.length; off += delta) {
      x += f16ToF32(view.getUint16(off, true));
      y += f16ToF32(view.getUint16(off + 2, true));
      if (dim === 3) z += f16ToF32(view.getUint16(off + 4, true));
      pts.push({ x, y, z });
    }
    return pts;
  },
};

type PropRule = {
  kind: string;
  values?: string[];
  zero?: boolean;
  negative?: boolean;
  nullable?: boolean;
};

const COLOR_VALUES = ["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red", "white"];
const FILL_VALUES = ["none", "semi", "solid", "pattern", "fill", "lined-fill"];
const DASH_VALUES = ["draw", "solid", "dashed", "dotted", "none"];
const SIZE_VALUES = ["s", "m", "l", "xl"];
const FONT_VALUES = ["draw", "sans", "serif", "mono"];
const ALIGN_VALUES = ["start", "middle", "end", "start-legacy", "end-legacy", "middle-legacy"];
const VALIGN_VALUES = ["start", "middle", "end"];
const ARROWHEAD_VALUES = ["arrow", "triangle", "square", "dot", "pipe", "diamond", "inverted", "bar", "none"];

const BOARD_PROPS: Record<string, Record<string, PropRule>> = {
  draw: { segments: { kind: "segments" }, color: { kind: "enum", values: COLOR_VALUES }, fill: { kind: "enum", values: FILL_VALUES }, dash: { kind: "enum", values: DASH_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, isComplete: { kind: "boolean" }, isClosed: { kind: "boolean" }, isPen: { kind: "boolean" }, scale: { kind: "number", zero: false, negative: false, nullable: false }, scaleX: { kind: "number", zero: false, negative: true, nullable: false }, scaleY: { kind: "number", zero: false, negative: true, nullable: false } },
  geo: { w: { kind: "number", zero: false, negative: false, nullable: false }, h: { kind: "number", zero: false, negative: false, nullable: false }, geo: { kind: "enum", values: ["cloud", "rectangle", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "octagon", "star", "rhombus", "rhombus-2", "oval", "trapezoid", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "x-box", "check-box", "heart"] }, dash: { kind: "enum", values: DASH_VALUES }, growY: { kind: "number", zero: true, negative: false, nullable: false }, url: { kind: "url" }, scale: { kind: "number", zero: false, negative: false, nullable: false }, flipX: { kind: "boolean" }, flipY: { kind: "boolean" }, color: { kind: "enum", values: COLOR_VALUES }, labelColor: { kind: "enum", values: COLOR_VALUES }, fill: { kind: "enum", values: FILL_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, font: { kind: "enum", values: FONT_VALUES }, align: { kind: "enum", values: ALIGN_VALUES }, verticalAlign: { kind: "enum", values: VALIGN_VALUES }, richText: { kind: "richText" } },
  text: { color: { kind: "enum", values: COLOR_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, w: { kind: "number", zero: false, negative: false, nullable: false }, font: { kind: "enum", values: FONT_VALUES }, textAlign: { kind: "enum", values: VALIGN_VALUES }, autoSize: { kind: "boolean" }, scale: { kind: "number", zero: false, negative: false, nullable: false }, richText: { kind: "richText" } },
  note: { color: { kind: "enum", values: COLOR_VALUES }, richText: { kind: "richText" }, size: { kind: "enum", values: SIZE_VALUES }, font: { kind: "enum", values: FONT_VALUES }, align: { kind: "enum", values: ALIGN_VALUES }, verticalAlign: { kind: "enum", values: VALIGN_VALUES }, labelColor: { kind: "enum", values: COLOR_VALUES }, growY: { kind: "number", zero: true, negative: false, nullable: false }, fontSizeAdjustment: { kind: "number", zero: true, negative: false, nullable: true }, url: { kind: "url" }, scale: { kind: "number", zero: false, negative: false, nullable: false }, textLastEditedBy: { kind: "textLastEditedBy" } },
  arrow: { kind: { kind: "enum", values: ["arc", "elbow"] }, elbowMidPoint: { kind: "number", zero: true, negative: true, nullable: false }, dash: { kind: "enum", values: DASH_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, fill: { kind: "enum", values: FILL_VALUES }, color: { kind: "enum", values: COLOR_VALUES }, labelColor: { kind: "enum", values: COLOR_VALUES }, bend: { kind: "number", zero: true, negative: true, nullable: false }, start: { kind: "start" }, end: { kind: "end" }, arrowheadStart: { kind: "enum", values: ARROWHEAD_VALUES }, arrowheadEnd: { kind: "enum", values: ARROWHEAD_VALUES }, richText: { kind: "richText" }, labelPosition: { kind: "number", zero: true, negative: true, nullable: false }, font: { kind: "enum", values: FONT_VALUES }, scale: { kind: "number", zero: false, negative: false, nullable: false } },
  line: { dash: { kind: "enum", values: DASH_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, color: { kind: "enum", values: COLOR_VALUES }, spline: { kind: "enum", values: ["cubic", "line"] }, points: { kind: "points" }, scale: { kind: "number", zero: false, negative: false, nullable: false } },
  highlight: { segments: { kind: "segments" }, color: { kind: "enum", values: COLOR_VALUES }, size: { kind: "enum", values: SIZE_VALUES }, isComplete: { kind: "boolean" }, isPen: { kind: "boolean" }, scale: { kind: "number", zero: false, negative: false, nullable: false }, scaleX: { kind: "number", zero: false, negative: true, nullable: false }, scaleY: { kind: "number", zero: false, negative: true, nullable: false } },
  frame: { w: { kind: "number", zero: false, negative: false, nullable: false }, h: { kind: "number", zero: false, negative: false, nullable: false }, name: { kind: "string" }, color: { kind: "enum", values: COLOR_VALUES } },
  group: {},
};

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasFields(o: unknown, req: string[], opt: string[] = []): o is Record<string, unknown> {
  if (!isPlainObj(o)) return false;
  for (const k of req) if (!(k in o)) return false;
  const allowed = new Set([...req, ...opt]);
  for (const k of Object.keys(o)) if (!allowed.has(k)) return false;
  return true;
}

function validId(id: unknown, prefix: string): boolean {
  return typeof id === "string" && id.startsWith(prefix + ":") && id.length > prefix.length + 1 && id.length <= 128;
}

function validIndex(s: unknown): boolean {
  if (typeof s !== "string" || s.length < 2) return false;
  const c0 = s.charCodeAt(0);
  let len = 0;
  if (c0 >= 97 && c0 <= 122) len = c0 - 97 + 2;
  else if (c0 >= 65 && c0 <= 90) len = 90 - c0 + 2;
  if (len === 0 || s.length < len || (s.length > len && s.endsWith("0")) || s === "A" + "0".repeat(26)) return false;
  return /^[0-9A-Za-z]+$/.test(s.slice(1));
}

function validVec(v: unknown): boolean {
  if (!hasFields(v, ["x", "y"], ["z"])) return false;
  if (typeof v.x !== "number" || !Number.isFinite(v.x) || typeof v.y !== "number" || !Number.isFinite(v.y)) return false;
  if ("z" in v && (typeof v.z !== "number" || !Number.isFinite(v.z))) return false;
  return true;
}

function validProp(val: unknown, rule: PropRule): boolean {
  switch (rule.kind) {
    case "string":
      return typeof val === "string";
    case "boolean":
      return typeof val === "boolean";
    case "number":
      if (val === null) return Boolean(rule.nullable);
      return typeof val === "number" && Number.isFinite(val) && (rule.zero || val !== 0) && (rule.negative || val >= 0);
    case "enum":
      return typeof val === "string" && Boolean(rule.values?.includes(val));
    case "textLastEditedBy":
      return val === null || typeof val === "string";
    case "start":
    case "end":
      return validVec(val);
    case "url":
      if (typeof val !== "string") return false;
      if (val === "") return true;
      try {
        const u = new URL(val);
        return (u.protocol === "https:" || u.protocol === "http:") && u.host !== "";
      } catch {
        return false;
      }
    case "richText":
      return isSafeBoardText(val);
    case "segments":
      if (!Array.isArray(val)) return false;
      for (const item of val) {
        if (!hasFields(item, ["type", "path"], ["dim"])) return false;
        if (typeof item.path !== "string" || (item.type !== "free" && item.type !== "straight")) return false;
        const dim = "dim" in item ? item.dim : 3;
        if (dim !== 2 && dim !== 3) return false;
        try {
          const pts = b64Vecs.decodePoints(item.path, dim);
          if (!pts.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z ?? 0))) return false;
        } catch {
          return false;
        }
      }
      return true;
    case "points":
      if (!isPlainObj(val)) return false;
      for (const pt of Object.values(val)) {
        if (!hasFields(pt, ["id", "index", "x", "y"])) return false;
        if (typeof pt.id !== "string" || !validIndex(pt.index) || typeof pt.x !== "number" || !Number.isFinite(pt.x) || typeof pt.y !== "number" || !Number.isFinite(pt.y)) return false;
      }
      return true;
    default:
      return false;
  }
}

export function validateBoardRecord(record: unknown): TLRecord {
  if (!isPlainObj(record)) throw new Error("Record must be an object");
  const kind = record.typeName;
  if (typeof kind !== "string" || !validId(record.id, kind) || !isPlainObj(record.meta)) {
    throw new Error("Invalid record identity or meta");
  }
  if (kind === "page") {
    if (!hasFields(record, ["id", "typeName", "name", "index", "meta"]) || typeof record.name !== "string" || !validIndex(record.index)) {
      throw new Error("Invalid page record");
    }
    return record as TLRecord;
  }
  if (kind === "document") {
    if (!hasFields(record, ["id", "typeName", "name", "gridSize", "meta"]) || record.id !== "document:document" || typeof record.name !== "string" || typeof record.gridSize !== "number" || !Number.isFinite(record.gridSize)) {
      throw new Error("Invalid document record");
    }
    return record as TLRecord;
  }
  if (kind === "binding") {
    if (!hasFields(record, ["id", "typeName", "type", "fromId", "toId", "props", "meta"]) || record.type !== "arrow" || !validId(record.fromId, "shape") || !validId(record.toId, "shape")) {
      throw new Error("Invalid binding record");
    }
    const p = record.props;
    if (!hasFields(p, ["terminal", "normalizedAnchor", "isExact", "isPrecise", "snap"]) || (p.terminal !== "start" && p.terminal !== "end") || !validVec(p.normalizedAnchor) || typeof p.isExact !== "boolean" || typeof p.isPrecise !== "boolean" || typeof p.snap !== "string" || !["edge-point", "none", "edge", "center"].includes(p.snap)) {
      throw new Error("Invalid binding props");
    }
    return record as TLRecord;
  }
  if (kind === "shape") {
    if (!hasFields(record, ["id", "typeName", "type", "x", "y", "rotation", "index", "parentId", "isLocked", "opacity", "props", "meta"])) {
      throw new Error("Missing shape fields");
    }
    const rules = typeof record.type === "string" ? BOARD_PROPS[record.type] : undefined;
    if (!rules || !validIndex(record.index) || typeof record.isLocked !== "boolean" || !(validId(record.parentId, "shape") || validId(record.parentId, "page"))) {
      throw new Error("Invalid shape topology");
    }
    if (typeof record.x !== "number" || !Number.isFinite(record.x) || typeof record.y !== "number" || !Number.isFinite(record.y) || typeof record.rotation !== "number" || !Number.isFinite(record.rotation)) {
      throw new Error("Invalid shape coordinates");
    }
    if (typeof record.opacity !== "number" || !Number.isFinite(record.opacity) || record.opacity < 0 || record.opacity > 1) {
      throw new Error("Invalid shape opacity");
    }
    if (!isPlainObj(record.props) || Object.keys(record.props).length !== Object.keys(rules).length) {
      throw new Error("Invalid shape props count");
    }
    for (const [k, rule] of Object.entries(rules)) {
      if (!(k in record.props) || !validProp(record.props[k], rule)) {
        throw new Error(`Invalid shape prop: ${k}`);
      }
    }
    return record as TLRecord;
  }
  throw new Error(`Unsupported record typeName: ${kind}`);
}

export function createTLStore(): TLStore {
  const map = new Map<string, TLRecord>([
    ["document:document", { id: "document:document", typeName: "document", name: "", gridSize: 10, meta: {} }],
    ["page:page", { id: "page:page", typeName: "page", name: "Page 1", index: "a1", meta: {} }],
  ]);
  const listeners = new Set<{
    fn: (entry: TLStoreChangeEntry) => void;
    source?: string;
  }>();
  let currentSource: "user" | "remote" = "user";

  const emit = (entry: TLStoreChangeEntry) => {
    if (
      !Object.keys(entry.changes.added).length &&
      !Object.keys(entry.changes.updated).length &&
      !Object.keys(entry.changes.removed).length
    ) {
      return;
    }
    for (const sub of listeners) {
      if (!sub.source || sub.source === "all" || sub.source === entry.source) {
        sub.fn(entry);
      }
    }
  };

  const store: TLStore = {
    allRecords: () => [...map.values()],
    get: (id: string) => map.get(id),
    put: (records: TLRecord[], source = currentSource) => {
      const added: Record<string, TLRecord> = {};
      const updated: Record<string, [TLRecord, TLRecord]> = {};
      for (const r of records) {
        const prev = map.get(r.id);
        map.set(r.id, r);
        if (prev) updated[r.id] = [prev, r];
        else added[r.id] = r;
      }
      emit({ changes: { added, updated, removed: {} }, source });
    },
    remove: (ids: string[], source = currentSource) => {
      const removed: Record<string, TLRecord> = {};
      for (const id of ids) {
        const prev = map.get(id);
        if (prev) {
          map.delete(id);
          removed[id] = prev;
        }
      }
      emit({ changes: { added: {}, updated: {}, removed }, source });
    },
    mergeRemoteChanges: (fn: () => void) => {
      const prev = currentSource;
      currentSource = "remote";
      try {
        fn();
      } finally {
        currentSource = prev;
      }
    },
    listen: (fn, options) => {
      const sub = { fn, source: options?.source };
      listeners.add(sub);
      return () => {
        listeners.delete(sub);
      };
    },
    schema: {
      validateRecord: (_store, record) => validateBoardRecord(record),
    },
  };
  return store;
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
    store.schema.validateRecord(store, record, "updateRecord", null);
    if (record.typeName === "shape" && (record.type === "draw" || record.type === "highlight")) {
      for (const segment of (record as TLShape).props.segments ?? []) {
        const points = b64Vecs.decodePoints(segment.path, segment.dim);
        if (!points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z ?? 0))) return false;
      }
    }
    if (record.typeName === "shape" && "richText" in (record as TLShape).props && !isSafeBoardText((record as TLShape).props.richText)) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafeBoardText(value: unknown, parent = "", depth = 0): boolean {
  if (depth > 32 || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  const allowed: Record<string, string[]> = { "": ["doc"], doc: ["paragraph", "heading", "bulletList", "orderedList"], listItem: ["paragraph", "heading", "bulletList", "orderedList"], bulletList: ["listItem"], orderedList: ["listItem"], paragraph: ["text", "hardBreak"], heading: ["text", "hardBreak"] };
  if (typeof node.type !== "string" || !allowed[parent]?.includes(node.type)) return false;
  if (Object.keys(node).some(key => !["type", "content", "attrs", "text", "marks"].includes(key))) return false;
  if (node.attrs !== undefined) {
    if (!node.attrs || typeof node.attrs !== "object" || Array.isArray(node.attrs)) return false;
    const level = (node.attrs as Record<string, unknown>).level;
    if (level !== undefined && (typeof level !== "number" || !Number.isInteger(level) || level < 1 || level > 6)) return false;
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) return false;
    for (const value of node.marks) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const mark = value as Record<string, unknown>;
      if (typeof mark.type !== "string" || !["bold", "italic", "strike", "code", "underline", "link", "highlight"].includes(mark.type) || Object.keys(mark).some(key => key !== "type" && key !== "attrs")) return false;
    }
  }
  if (node.type === "text") return typeof node.text === "string" && node.text.length > 0 && node.content === undefined;
  if (node.text !== undefined) return false;
  if (node.type === "hardBreak") return node.content === undefined;
  if (node.content !== undefined && !Array.isArray(node.content)) return false;
  const children = (node.content ?? []) as unknown[];
  if (["doc", "bulletList", "orderedList", "listItem"].includes(node.type) && children.length === 0) return false;
  if (node.type === "listItem" && (!children[0] || typeof children[0] !== "object" || (children[0] as Record<string, unknown>).type !== "paragraph")) return false;
  return children.every(child => isSafeBoardText(child, node.type as string, depth + 1));
}

// Exclude a whole parent chain if it reaches a cycle, including descendants.
export function withoutBoardCycles(records: TLRecord[]): TLRecord[] {
  const parents = new Map(records.filter((r): r is TLShape => r.typeName === "shape").map(r => [r.id, r.parentId]));
  const safe = new Map<string, boolean>();
  for (const id of parents.keys()) {
    const path = new Set<string>();
    let current: string = id;
    while (parents.has(current as TLShape["id"]) && !safe.has(current) && !path.has(current)) {
      path.add(current);
      current = parents.get(current as TLShape["id"])!;
    }
    const valid = !path.has(current) && safe.get(current) !== false;
    for (const node of path) safe.set(node, valid);
  }
  return records.filter(r => safe.get(r.id) !== false);
}
