"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  AlignLeft,
  ArrowUpRight,
  ChevronDown,
  Circle,
  Diamond,
  Eraser,
  Hand,
  Highlighter,
  Map as MapIcon,
  Minus,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Square,
  StickyNote,
  Trash2,
  Triangle,
  Type,
  Undo2,
  Download,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import {
  b64Vecs,
  boardDraftKey,
  boardIndexAbove,
  createTLStore,
  isSafeBoardRecord,
  mergeBoardRecords,
  readBoardDraft,
  repairBoardIndexes,
  savePendingBoard,
  withoutBoardCycles,
  writeBoardDraft,
  type BoardSnapshot,
  type TLRecord,
  type TLShape,
  type VecPoint,
} from "@/lib/whiteboard";
import { useBoardStore } from "@/stores/useBoardStore";
import { createBoardHistory } from "@/lib/boardHistory";
import { useRoomStore } from "@/stores/useRoomStore";
import { useRoomSession } from "./RoomSession";
import { useUIStore } from "@/stores/useUIStore";
import { useTranslation } from "@/lib/i18n/useTranslation";

interface BoardEditor {
  pageToScreen(pt: { x: number; y: number }): { x: number; y: number };
  screenToPage(pt: { x: number; y: number }): { x: number; y: number };
  user: { updateUserPreferences(prefs: { colorScheme: "light" | "dark" }): void };
}

const PALETTE: Record<string, { hex: string; fill: string; label: string }> = {
  black: {
    hex: "var(--text-loft-primary, #101113)",
    fill: "color-mix(in srgb, var(--text-loft-primary, #101113) 14%, transparent)",
    label: "Adaptive Ink",
  },
  grey: { hex: "#626977", fill: "rgba(98, 105, 119, 0.18)", label: "Grey" },
  "light-violet": { hex: "#b8a9ff", fill: "#f2eeff", label: "Light violet" },
  violet: { hex: "#896fff", fill: "#ebe5ff", label: "Violet" },
  blue: { hex: "#3b82f6", fill: "#dbeafe", label: "Blue" },
  "light-blue": { hex: "#7fc6ff", fill: "#e6f4ff", label: "Light blue" },
  green: { hex: "#22c55e", fill: "#dcfce7", label: "Green" },
  "light-green": { hex: "#84cc16", fill: "#ecfccb", label: "Light green" },
  yellow: { hex: "#eab308", fill: "#fef9c3", label: "Yellow" },
  orange: { hex: "#d5b98a", fill: "#f7f1e6", label: "Warm" },
  "light-red": { hex: "#f472b6", fill: "#fce7f3", label: "Pink" },
  red: { hex: "#ef4444", fill: "#fee2e2", label: "Red" },
  white: {
    hex: "var(--bg-loft-surface, #ffffff)",
    fill: "var(--bg-loft-base, #f4f5f7)",
    label: "Surface",
  },
};

const INSPECTOR_COLORS = [
  "black",
  "grey",
  "light-violet",
  "violet",
  "blue",
  "green",
  "yellow",
  "red",
] as const;

const STROKE_SIZES: Record<string, { stroke: number; font: number }> = {
  s: { stroke: 2, font: 13 },
  m: { stroke: 3.5, font: 16 },
  l: { stroke: 6, font: 24 },
  xl: { stroke: 10, font: 32 },
};

type ToolKind =
  | "select"
  | "hand"
  | "draw"
  | "highlight"
  | "eraser"
  | "rect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "arrow"
  | "text"
  | "note";

const isDocument = (r: TLRecord) =>
  ["shape", "binding", "page", "document"].includes(r.typeName);

function toRichText(text: string) {
  const clean = text.trim();
  return {
    type: "doc",
    content: [
      clean
        ? { type: "paragraph", content: [{ type: "text", text: clean }] }
        : { type: "paragraph" },
    ],
  };
}

function fromRichText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as Record<string, unknown>;
  if (typeof value.text === "string") return value.text;
  if (!Array.isArray(value.content)) return "";
  return value.content.map(fromRichText).join(value.type === "doc" ? "\n" : "");
}

// ~8 base64 chars per point keeps a thinned preview well under 16 KiB.
const MAX_PREVIEW_POINTS = 1200;

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

function buildShapeRecord(
  tool: ToolKind,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pts: VecPoint[],
  style: {
    color: string;
    fill: string;
    dash: string;
    size: string;
    opacity: number;
  },
  index: string,
  textVal = "",
): TLShape {
  const id = `shape:${uid()}`;
  const base = {
    id,
    typeName: "shape" as const,
    x: x1,
    y: y1,
    rotation: 0,
    index,
    parentId: "page:page",
    isLocked: false,
    opacity: style.opacity,
    meta: {},
  };

  if (tool === "draw" || tool === "highlight") {
    const rel = (
      pts.length ? pts : [{ x: x1, y: y1 }, { x: x2, y: y2 }]
    ).map((p) => ({
      x: p.x - x1,
      y: p.y - y1,
      z: 0.5,
    }));
    if (tool === "highlight") {
      return {
        ...base,
        type: "highlight",
        props: {
          segments: [{ type: "free", path: b64Vecs.encodePoints(rel) }],
          color: style.color,
          size: style.size,
          isComplete: true,
          isPen: false,
          scale: 1,
          scaleX: 1,
          scaleY: 1,
        },
      };
    }
    return {
      ...base,
      type: "draw",
      props: {
        segments: [{ type: "free", path: b64Vecs.encodePoints(rel) }],
        color: style.color,
        fill: style.fill,
        dash: style.dash,
        size: style.size,
        isComplete: true,
        isClosed: false,
        isPen: false,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
      },
    };
  }
  if (tool === "arrow") {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return {
      ...base,
      type: "arrow",
      props: {
        kind: "arc",
        elbowMidPoint: 0.5,
        dash: style.dash,
        size: style.size,
        fill: style.fill,
        color: style.color,
        labelColor: "black",
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: dx === 0 && dy === 0 ? 2 : dx, y: dy },
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
        richText: toRichText(""),
        labelPosition: 0.5,
        font: "draw",
        scale: 1,
      },
    };
  }
  if (tool === "text") {
    return {
      ...base,
      type: "text",
      props: {
        color: style.color,
        size: style.size,
        w: 156,
        font: "draw",
        textAlign: "start",
        autoSize: true,
        scale: 1,
        richText: toRichText(textVal || "Text"),
      },
    };
  }
  if (tool === "note") {
    return {
      ...base,
      type: "note",
      props: {
        color: style.color,
        richText: toRichText(textVal || "Note"),
        size: style.size,
        font: "draw",
        align: "middle",
        verticalAlign: "middle",
        labelColor: "black",
        growY: 0,
        fontSizeAdjustment: 1,
        url: "",
        scale: 1,
        textLastEditedBy: null,
      },
    };
  }
  const geoMap: Record<string, string> = {
    rect: "rectangle",
    ellipse: "ellipse",
    triangle: "triangle",
    diamond: "diamond",
  };
  return {
    ...base,
    type: "geo",
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    props: {
      w: Math.max(12, Math.abs(x2 - x1)),
      h: Math.max(12, Math.abs(y2 - y1)),
      geo: geoMap[tool] ?? "rectangle",
      dash: style.dash,
      growY: 0,
      url: "",
      scale: 1,
      flipX: false,
      flipY: false,
      color: style.color,
      labelColor: "black",
      fill: style.fill,
      size: style.size,
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: toRichText(""),
    },
  };
}

function shapeBounds(s: TLShape): { x: number; y: number; w: number; h: number } {
  if (
    (s.type === "draw" || s.type === "highlight") &&
    Array.isArray(s.props?.segments)
  ) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const seg of s.props.segments) {
      try {
        for (const p of b64Vecs.decodePoints(seg.path, seg.dim ?? 3)) {
          const px = s.x + p.x,
            py = s.y + p.y;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      } catch {
        /* ignore invalid segment */
      }
    }
    if (Number.isFinite(minX)) {
      return {
        x: minX,
        y: minY,
        w: Math.max(8, maxX - minX),
        h: Math.max(8, maxY - minY),
      };
    }
  }
  if (s.type === "arrow") {
    const sx = s.x + (s.props?.start?.x ?? 0);
    const sy = s.y + (s.props?.start?.y ?? 0);
    const ex = s.x + (s.props?.end?.x ?? 0);
    const ey = s.y + (s.props?.end?.y ?? 0);
    return {
      x: Math.min(sx, ex),
      y: Math.min(sy, ey),
      w: Math.max(8, Math.abs(ex - sx)),
      h: Math.max(8, Math.abs(ey - sy)),
    };
  }
  const w =
    typeof s.props?.w === "number"
      ? s.props.w
      : s.type === "note"
        ? 156
        : 136;
  const h =
    typeof s.props?.h === "number"
      ? s.props.h
      : s.type === "note"
        ? 156
        : 40;
  return { x: s.x, y: s.y, w, h };
}

function hitShape(s: TLShape, pt: { x: number; y: number }, pad = 8): boolean {
  const b = shapeBounds(s);
  return (
    pt.x >= b.x - pad &&
    pt.x <= b.x + b.w + pad &&
    pt.y >= b.y - pad &&
    pt.y <= b.y + b.h + pad
  );
}

/**
 * Loft / Mingly Design System Tokens:
 * - primary: #101113 (--text-loft-primary) | on-primary: #ffffff (--bg-loft-surface)
 * - background: #f4f5f7 (--bg-loft-base) | surface: #ffffff (--bg-loft-surface)
 * - border: #d9dce1 (--border-loft) | text-muted: #626977 (--text-loft-muted)
 * - radius: sm=4px, md=10px, lg=16px
 * - shadows: inset 0 1px 0 rgba(255, 255, 255, 0.72) (--shadow-contact)
 * - motion: 150ms / 200ms cubic-bezier(0.4, 0, 0.2, 1)
 */
const LOFT_SURFACE =
  "border border-[var(--border-loft)] bg-[var(--bg-loft-surface)] text-[var(--text-loft-primary)] shadow-[var(--shadow-contact)]";
const LOFT_BTN =
  "rounded-[10px] text-[13px] font-medium leading-[1.5] text-[var(--text-loft-muted)] transition-colors duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-[color-mix(in_srgb,var(--text-loft-primary)_8%,transparent)] hover:text-[var(--text-loft-primary)]";
const LOFT_BTN_ACTIVE =
  "rounded-[10px] text-[13px] font-medium leading-[1.5] bg-[var(--text-loft-primary)] text-[var(--bg-loft-surface)] shadow-[var(--shadow-contact)] transition-colors duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)]";

export default function Whiteboard({ active }: { active: boolean }) {
  const { credential, sendCommand } = useRoomSession();
  const roomID = useRoomStore((s) => s.room?.id);
  const connection = useRoomStore((s) => s.connectionState);
  const theme = useUIStore((s) => s.theme);
  const { locale } = useTranslation();
  const [store] = useState(() => createTLStore());
  const editorRef = useRef<BoardEditor | null>(null);
  const pending = useRef(new Map<string, TLRecord | null>());
  const boardVersion = useRef(0);
  const [ready, setReady] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const discard = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const lastCursor = useRef(0);
  const pointerState = useRef<{
    x: number;
    y: number;
    drawing: boolean;
    visible: boolean;
    draft?: TLShape;
  }>({ x: 0, y: 0, drawing: false, visible: false });
  const [cursorViews, setCursorViews] = useState<
    Array<{
      id: string;
      name: string;
      drawing: boolean;
      left: number;
      top: number;
      draft?: TLShape;
    }>
  >([]);
  const changed = useBoardStore((s) => s.version);
  const lastPatch = useBoardStore((s) => s.lastPatch);
  const rawCursors = useBoardStore((s) => s.cursors);
  const participants = useRoomStore((s) => s.participants);
  const wake = useRef<() => void>(() => {});

  const [shapes, setShapes] = useState<TLShape[]>(() =>
    withoutBoardCycles(store.allRecords().filter((r) => isSafeBoardRecord(store, r)))
      .filter((r): r is TLShape => r.typeName === "shape"),
  );
  const [tool, setTool] = useState<ToolKind>("select");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [camera, setCamera] = useState({ x: 0, y: 0, z: 1 });
  const cameraRef = useRef(camera);
  useEffect(() => { cameraRef.current = camera; }, [camera]);
  const [style, setStyle] = useState({
    color: "black",
    fill: "none",
    dash: "draw",
    size: "m",
    opacity: 1,
  });
  const [draftShape, setDraftShape] = useState<TLShape | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [editingShape, setEditingShape] = useState<{
    id: string;
    x: number;
    y: number;
    text: string;
  } | null>(null);

  // Per-user history: only this client's own edits can be undone.
  const [history] = useState(() => createBoardHistory());
  useEffect(
    () => store.listen((entry) => history.record(entry), { source: "user" }),
    [store, history],
  );
  const dragRef = useRef<{
    kind: "pan" | "move" | "create" | "erase";
    sx: number;
    sy: number;
    pts: VecPoint[];
    moved?: boolean;
    index?: string;
  } | null>(null);

  // New shapes stack above everything already on the board, including
  // unsaved local records, with an index the server accepts.
  const nextShapeIndex = useCallback(
    () =>
      boardIndexAbove(
        store
          .allRecords()
          .filter((r): r is TLShape => r.typeName === "shape")
          .map((r) => r.index),
      ),
    [store],
  );

  const syncShapesFromStore = useCallback(() => {
    const valid = withoutBoardCycles(
      store.allRecords().filter((r) => isSafeBoardRecord(store, r)),
    ).filter((r): r is TLShape => r.typeName === "shape");
    setShapes(valid);
  }, [store]);

  useEffect(() => {
    return store.listen(() => syncShapesFromStore(), { source: "all" });
  }, [store, syncShapesFromStore]);

  useEffect(() => {
    editorRef.current = {
      pageToScreen: (pt) => {
        const rect = wrapper.current?.getBoundingClientRect();
        const cam = cameraRef.current;
        return {
          x: (rect?.left ?? 0) + pt.x * cam.z + cam.x,
          y: (rect?.top ?? 0) + pt.y * cam.z + cam.y,
        };
      },
      screenToPage: (pt) => {
        const rect = wrapper.current?.getBoundingClientRect();
        const cam = cameraRef.current;
        return {
          x: (pt.x - (rect?.left ?? 0) - cam.x) / cam.z,
          y: (pt.y - (rect?.top ?? 0) - cam.y) / cam.z,
        };
      },
      user: { updateUserPreferences: () => {} },
    };
    return () => {
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    editor.user.updateUserPreferences({ colorScheme: dark ? "dark" : "light" });
  }, [theme, ready]);

  useEffect(() => {
    if (!credential || !roomID) return;
    const abort = new AbortController();
    const draftKey = boardDraftKey(roomID);
    const saveDraft = () => {
      try {
        if (pending.current.size)
          sessionStorage.setItem(draftKey, writeBoardDraft(pending.current));
        else sessionStorage.removeItem(draftKey);
      } catch {
        // Storage can be unavailable in private browsing; server sync remains authoritative.
      }
    };
    let storedDraft: string | null = null;
    try {
      storedDraft = sessionStorage.getItem(draftKey);
    } catch {
      // Storage can be unavailable in private browsing; server sync remains authoritative.
    }
    const restored = readBoardDraft(storedDraft);
    // Drafts saved by older builds can carry indexes the server rejects
    // (e.g. "a110"), which used to wedge every later save behind a 400.
    repairBoardIndexes(
      restored,
      store
        .allRecords()
        .filter((r): r is TLShape => r.typeName === "shape")
        .map((r) => r.index),
    );
    for (const [id, record] of restored)
      if (record === null || isSafeBoardRecord(store, record))
        pending.current.set(id, record);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let failed = false;
    let hydrated = false;
    let halted = false;
    let retryDelay = 0;
    let chased = 0;
    const reconcile = (
      snapshot: import("@/lib/whiteboard").BoardSnapshot | undefined,
    ) => {
      if (!snapshot) return;
      if (snapshot.version < boardVersion.current) return;

      if (
        snapshot.version === 0 &&
        Object.keys(snapshot.records).length === 0 &&
        pending.current.size === 0
      ) {
        for (const record of store.allRecords())
          if (record.typeName === "page" || record.typeName === "document")
            pending.current.set(record.id, record);
      }
      saveDraft();
      const records = mergeBoardRecords(snapshot, pending.current);
      const valid = withoutBoardCycles(
        records.filter((record) => isSafeBoardRecord(store, record)),
      );
      const safeRecords = valid.length === records.length ? records : valid;
      const ids = new Set(safeRecords.map((r) => r.id));
      store.mergeRemoteChanges(() => {
        store.remove(
          store
            .allRecords()
            .filter((r) => isDocument(r) && !ids.has(r.id))
            .map((r) => r.id),
        );
        store.put(safeRecords);
      });
      boardVersion.current = snapshot.version;
    };
    const sync = async () => {
      if (stopped || busy || halted) return;
      busy = true;
      failed = false;
      try {
        if (hydrated && pending.current.size) {
          const { snapshot, outstanding } = await savePendingBoard(
            pending.current,
            boardVersion.current,
            (patch) => api.saveBoard(roomID, credential, patch, abort.signal),
          );
          if (stopped) return;
          const saved = pending.current;
          pending.current = outstanding;
          saveDraft();
          if (!snapshot.records) {
            // Minimal ack: the server applied our patch on top of the version
            // we already hold, so local state is already authoritative.
            if (snapshot.version > boardVersion.current)
              boardVersion.current = snapshot.version;
          } else {
            try {
              reconcile(snapshot as BoardSnapshot);
            } catch (error) {
              pending.current = saved;
              throw error;
            }
          }
        } else if (document.visibilityState === "visible") {
          const snapshot = await api.board(
            roomID,
            credential,
            abort.signal,
            hydrated ? boardVersion.current : undefined,
          );
          if (stopped) return;
          if (
            snapshot &&
            (!hydrated || snapshot.version > boardVersion.current)
          )
            reconcile(snapshot);
        }
        hydrated = true;
        setReady(true);
        setSaveBlocked(false);
        setError(null);
      } catch (caught) {
        if (stopped) return;
        failed = true;
        if (
          caught instanceof ApiError &&
          [400, 401, 403, 413].includes(caught.status)
        ) {
          halted = true;
          setSaveBlocked(true);
        }
        if (caught instanceof ApiError && caught.status === 429) {
          // Transient throttling: keep the edits queued and retry shortly
          // instead of flashing a save error at the user.
          failed = false;
          retryDelay = 400;
        } else if (caught instanceof ApiError && caught.status === 409) {
          try {
            reconcile(await api.board(roomID, credential, abort.signal));
            // Rebased onto the latest board; resend pending edits right away
            // rather than waiting out the 2 s failure backoff.
            failed = false;
          } catch {
            setError(
              locale === "vi"
                ? "Không thể đồng bộ bảng vẽ"
                : "Could not sync whiteboard",
            );
          }
        } else
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not sync whiteboard",
          );
      } finally {
        busy = false;
        if (!stopped && !halted) {
          // A board.changed event that arrived mid-request could not be
          // applied in order; catch up immediately instead of on the next poll.
          // Chase each announced version once so a stale announcement can't
          // turn into a tight polling loop.
          const announced = useBoardStore.getState().version;
          const behind =
            announced > boardVersion.current && announced !== chased;
          if (behind) chased = announced;
          const delay = retryDelay
            ? retryDelay
            : !failed && (pending.current.size || behind)
              ? 60
              : 2000;
          retryDelay = 0;
          timer = setTimeout(() => void sync(), delay);
        }
      }
    };
    discard.current = () => {
      if (busy) return;
      pending.current.clear();
      saveDraft();
      halted = false;
      hydrated = false;
      setSaveBlocked(false);
      void sync();
    };
    wake.current = () => {
      if (timer) clearTimeout(timer);
      void sync();
    };
    const unlisten = store.listen(
      (entry) => {
        halted = false;
        for (const record of Object.values(entry.changes.added))
          if (isDocument(record)) pending.current.set(record.id, record);
        for (const [, record] of Object.values(entry.changes.updated))
          if (isDocument(record)) pending.current.set(record.id, record);
        for (const record of Object.values(entry.changes.removed))
          if (isDocument(record)) pending.current.set(record.id, null);
        saveDraft();
        if (!busy) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void sync(), 40);
        }
      },
      { source: "user", scope: "document" },
    );
    void sync();
    return () => {
      stopped = true;
      saveDraft();
      abort.abort();
      if (timer) clearTimeout(timer);
      unlisten();
      wake.current = () => {};
      discard.current = () => {};
    };
  }, [store, credential, roomID, locale, connection]);

  useEffect(() => {
    if (
      lastPatch &&
      lastPatch.version === boardVersion.current + 1 &&
      (Array.isArray(lastPatch.put) || Array.isArray(lastPatch.remove))
    ) {
      const safePut = (lastPatch.put ?? []).filter(
        (r): r is TLRecord =>
          isSafeBoardRecord(store, r as TLRecord) &&
          !pending.current.has((r as TLRecord).id),
      );
      const safeRemove = (lastPatch.remove ?? []).filter(
        (id) => typeof id === "string" && !pending.current.has(id),
      );
      store.mergeRemoteChanges(() => {
        if (safeRemove.length) store.remove(safeRemove);
        if (safePut.length) store.put(safePut);
      });
      boardVersion.current = lastPatch.version;
      return;
    }
    if (changed > boardVersion.current) {
      wake.current();
    }
  }, [changed, lastPatch, store]);

  const updateCursorViews = useCallback(() => {
    const editor = editorRef.current;
    const bounds = wrapper.current?.getBoundingClientRect();
    if (!editor || !bounds) return;
    const currentParticipants = useRoomStore.getState().participants;
    const cursorsMap = useBoardStore.getState().cursors;
    setCursorViews(
      Object.values(cursorsMap)
        .filter(
          (c) =>
            c.visible &&
            Date.now() - c.at < 4000 &&
            currentParticipants.some(
              (p) => p.connection_id === c.connection_id,
            ),
        )
        .map((c) => {
          const point = editor.pageToScreen({ x: c.x, y: c.y });
          const validDraft =
            c.drawing &&
            c.draft &&
            isSafeBoardRecord(store, c.draft as TLRecord) &&
            (c.draft as TLRecord).typeName === "shape"
              ? (c.draft as TLShape)
              : undefined;
          return {
            id: c.connection_id,
            name: c.name,
            drawing: c.drawing,
            left: point.x - bounds.left,
            top: point.y - bounds.top,
            draft: validDraft,
          };
        }),
    );
  }, [store]);

  useEffect(() => {
    updateCursorViews();
  }, [rawCursors, participants, camera, updateCursorViews]);

  useEffect(() => {
    const timer = setInterval(updateCursorViews, 1000);
    return () => clearInterval(timer);
  }, [updateCursorViews]);

  const pushHistory = useCallback(() => history.begin(), [history]);
  const handleUndo = useCallback(() => {
    history.undo(store);
  }, [history, store]);
  const handleRedo = useCallback(() => {
    history.redo(store);
  }, [history, store]);

  const handleDelete = useCallback(() => {
    if (!selectedIds.length) return;
    pushHistory();
    store.remove(selectedIds, "user");
    setSelectedIds([]);
  }, [selectedIds, pushHistory, store]);

  const updateStyle = useCallback(
    (patch: Partial<typeof style>) => {
      setStyle((prev) => ({ ...prev, ...patch }));
      if (selectedIds.length) {
        pushHistory();
        const updated = shapes
          .filter((s) => selectedIds.includes(s.id))
          .map((s) => {
            const next = structuredClone(s);
            if (patch.opacity !== undefined) next.opacity = patch.opacity;
            if (patch.color && "color" in next.props)
              next.props.color = patch.color;
            if (patch.fill && "fill" in next.props)
              next.props.fill = patch.fill;
            if (patch.dash && "dash" in next.props)
              next.props.dash = patch.dash;
            if (patch.size && "size" in next.props)
              next.props.size = patch.size;
            return next;
          });
        if (updated.length) store.put(updated, "user");
      }
    },
    [pushHistory, selectedIds, shapes, store],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!active || editingShape) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const cmd = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (cmd && k === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        handleDelete();
        return;
      }
      const keyMap: Record<string, ToolKind> = {
        v: "select",
        h: "hand",
        d: "draw",
        e: "eraser",
        a: "arrow",
        t: "text",
        n: "note",
        r: "rect",
        o: "ellipse",
      };
      if (!cmd && keyMap[k]) setTool(keyMap[k]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, editingShape, handleDelete, handleRedo, handleUndo]);

  const pointer = (
    event: React.PointerEvent<HTMLDivElement>,
    visible = true,
  ) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (
      visible &&
      event.type === "pointermove" &&
      Date.now() - lastCursor.current < 40
    )
      return;
    lastCursor.current = Date.now();
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    const isDrawing = visible && event.buttons === 1;
    pointerState.current = {
      x: point.x,
      y: point.y,
      drawing: isDrawing,
      visible,
      draft: isDrawing ? pointerState.current.draft : undefined,
    };
    sendCommand("board.cursor", pointerState.current);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      if (active && pointerState.current.visible)
        sendCommand("board.cursor", pointerState.current);
    }, 1500);
    if (!active) {
      pointerState.current.visible = false;
      sendCommand("board.cursor", {
        x: 0,
        y: 0,
        drawing: false,
        visible: false,
      });
    }
    return () => {
      clearInterval(timer);
      sendCommand("board.cursor", {
        x: 0,
        y: 0,
        drawing: false,
        visible: false,
      });
    };
  }, [active, sendCommand]);

  const onCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const editor = editorRef.current;
    if (!editor) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });

    if (tool === "hand" || e.button === 1) {
      dragRef.current = {
        kind: "pan",
        sx: e.clientX - camera.x,
        sy: e.clientY - camera.y,
        pts: [],
      };
      return;
    }
    if (tool === "eraser") {
      dragRef.current = { kind: "erase", sx: pt.x, sy: pt.y, pts: [] };
      const hit = [...shapes].reverse().find((s) => hitShape(s, pt));
      if (hit) {
        pushHistory();
        store.remove([hit.id], "user");
      }
      return;
    }
    if (tool === "select") {
      const hit = [...shapes].reverse().find((s) => hitShape(s, pt));
      if (hit) {
        setSelectedIds([hit.id]);
        dragRef.current = { kind: "move", sx: pt.x, sy: pt.y, pts: [] };
      } else {
        setSelectedIds([]);
        dragRef.current = null;
      }
      return;
    }
    if (tool === "text" || tool === "note") {
      pushHistory();
      const shape = buildShapeRecord(
        tool,
        pt.x,
        pt.y,
        pt.x + 156,
        pt.y + 80,
        [],
        style,
        nextShapeIndex(),
      );
      store.put([shape], "user");
      setSelectedIds([shape.id]);
      setTool("select");
      const bounds = wrapper.current?.getBoundingClientRect();
      setEditingShape({
        id: shape.id,
        x: e.clientX - (bounds?.left ?? 0),
        y: e.clientY - (bounds?.top ?? 0),
        text: fromRichText(shape.props.richText),
      });
      return;
    }

    const index = nextShapeIndex();
    dragRef.current = { kind: "create", sx: pt.x, sy: pt.y, pts: [pt], index };
    setDraftShape(
      buildShapeRecord(
        tool,
        pt.x,
        pt.y,
        pt.x + 1,
        pt.y + 1,
        [pt],
        style,
        index,
      ),
    );
  };

  const onCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const editor = editorRef.current;
    if (!d || !editor) return;
    const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });

    if (d.kind === "pan") {
      setCamera((c) => ({ ...c, x: e.clientX - d.sx, y: e.clientY - d.sy }));
      return;
    }
    if (d.kind === "erase") {
      const hit = [...shapes].reverse().find((s) => hitShape(s, pt));
      if (hit) store.remove([hit.id], "user");
      return;
    }
    if (d.kind === "move") {
      const dx = pt.x - d.sx;
      const dy = pt.y - d.sy;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      if (!d.moved) {
        pushHistory();
        d.moved = true;
      }
      d.sx = pt.x;
      d.sy = pt.y;
      const picked = shapes
        .filter((s) => selectedIds.includes(s.id))
        .map((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
      if (picked.length) store.put(picked, "user");
      return;
    }
    if (d.kind === "create") {
      // Sub-pixel jitter adds bytes (and save/broadcast cost) without
      // changing what anyone sees, so keep only points ~1 screen px apart.
      const last = d.pts[d.pts.length - 1];
      const minGap = 1 / Math.max(cameraRef.current.z, 0.01);
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < minGap) return;
      d.pts.push(pt);
      const index = d.index ?? nextShapeIndex();
      const nextDraft = buildShapeRecord(
        tool,
        d.sx,
        d.sy,
        pt.x,
        pt.y,
        d.pts,
        style,
        index,
      );
      setDraftShape(nextDraft);
      // Live preview for peers rides on board.cursor, whose events are capped
      // at 16 KiB; thin long strokes so the preview never gets dropped.
      const stride = Math.ceil(d.pts.length / MAX_PREVIEW_POINTS);
      pointerState.current.draft =
        stride <= 1
          ? nextDraft
          : {
              ...buildShapeRecord(
                tool,
                d.sx,
                d.sy,
                pt.x,
                pt.y,
                d.pts.filter(
                  (_, i) => i % stride === 0 || i === d.pts.length - 1,
                ),
                style,
                index,
              ),
              id: nextDraft.id,
            };
    }
  };

  const onCanvasPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const editor = editorRef.current;
    dragRef.current = null;
    pointerState.current.draft = undefined;
    pointerState.current.drawing = false;
    if (!d || !editor) return;
    if (d.kind === "create") {
      const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });
      d.pts.push(pt);
      pushHistory();
      const created = buildShapeRecord(
        tool,
        d.sx,
        d.sy,
        pt.x,
        pt.y,
        d.pts,
        style,
        d.index ?? nextShapeIndex(),
      );
      setDraftShape(null);
      store.put([created], "user");
      sendCommand("board.cursor", pointerState.current);
      if (tool !== "draw" && tool !== "highlight") {
        setSelectedIds([created.id]);
        setTool("select");
      }
    }
  };

  const [exporting, setExporting] = useState(false);
  // Rasterizes only committed shapes (no grid, cursors or selection) at 2x.
  const exportPng = async () => {
    if (!shapes.length || exporting) return;
    setExporting(true);
    try {
      const pad = 32;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const shape of shapes) {
        const b = shapeBounds(shape);
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w);
        maxY = Math.max(maxY, b.y + b.h);
      }
      const width = Math.max(1, Math.ceil(maxX - minX + pad * 2));
      const height = Math.max(1, Math.ceil(maxY - minY + pad * 2));
      const host = document.createElement("div");
      const root = createRoot(host);
      flushSync(() =>
        root.render(
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            viewBox={`${minX - pad} ${minY - pad} ${width} ${height}`}
          >
            <rect x={minX - pad} y={minY - pad} width={width} height={height} fill="#ffffff" />
            {shapes.map((shape) => renderShapeNode(shape, false))}
          </svg>,
        ),
      );
      const markup = host.innerHTML;
      root.unmount();
      const image = new Image();
      image.decoding = "async";
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      await image.decode();
      // Stay under common canvas limits on large boards.
      const scale = Math.min(2, 8192 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
      if (!blob) throw new Error("export failed");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `loft-board-${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(locale === "vi" ? "Không thể xuất ảnh bảng trắng" : "Couldn’t export the whiteboard");
    } finally {
      setExporting(false);
    }
  };

  const renderShapeNode = (s: TLShape, isDraft = false) => {
    const pal = PALETTE[s.props?.color ?? "black"] ?? PALETTE.black;
    const sz = STROKE_SIZES[s.props?.size ?? "m"] ?? STROKE_SIZES.m;
    const sw = sz.stroke;
    const dash =
      s.props?.dash === "dashed"
        ? `${sw * 3} ${sw * 2}`
        : s.props?.dash === "dotted"
          ? `${sw * 0.6} ${sw * 2.2}`
          : undefined;
    const fill =
      s.props?.fill === "solid"
        ? pal.hex
        : s.props?.fill === "semi"
          ? pal.fill
          : "none";

    let body: React.ReactNode = null;
    if (s.type === "draw" || s.type === "highlight") {
      const segs = Array.isArray(s.props?.segments) ? s.props.segments : [];
      body = segs.map((seg: { path: string; dim?: number }, idx: number) => {
        try {
          const pts = b64Vecs.decodePoints(seg.path, seg.dim ?? 3);
          if (!pts.length) return null;
          const d = pts
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"}${(s.x + p.x).toFixed(1)},${(s.y + p.y).toFixed(1)}`,
            )
            .join(" ");
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke={pal.hex}
              strokeWidth={s.type === "highlight" ? sw * 3.2 : sw}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={dash}
              opacity={s.type === "highlight" ? 0.4 : s.opacity}
            />
          );
        } catch {
          return null;
        }
      });
    } else if (s.type === "geo" || s.type === "frame") {
      const b = shapeBounds(s);
      if (s.props?.geo === "ellipse") {
        body = (
          <ellipse
            cx={b.x + b.w / 2}
            cy={b.y + b.h / 2}
            rx={b.w / 2}
            ry={b.h / 2}
            fill={fill}
            stroke={pal.hex}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
        );
      } else if (s.props?.geo === "triangle") {
        const pts = `${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h} ${b.x},${b.y + b.h}`;
        body = (
          <polygon
            points={pts}
            fill={fill}
            stroke={pal.hex}
            strokeWidth={sw}
            strokeLinejoin="round"
            strokeDasharray={dash}
          />
        );
      } else if (s.props?.geo === "diamond") {
        const pts = `${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`;
        body = (
          <polygon
            points={pts}
            fill={fill}
            stroke={pal.hex}
            strokeWidth={sw}
            strokeLinejoin="round"
            strokeDasharray={dash}
          />
        );
      } else {
        body = (
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={4}
            fill={fill}
            stroke={pal.hex}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
        );
      }
    } else if (s.type === "arrow") {
      const x1 = s.x + (s.props?.start?.x ?? 0);
      const y1 = s.y + (s.props?.start?.y ?? 0);
      const x2 = s.x + (s.props?.end?.x ?? 0);
      const y2 = s.y + (s.props?.end?.y ?? 0);
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const hl = 10 + sw * 1.5;
      const hx1 = x2 - hl * Math.cos(ang - Math.PI / 6);
      const hy1 = y2 - hl * Math.sin(ang - Math.PI / 6);
      const hx2 = x2 - hl * Math.cos(ang + Math.PI / 6);
      const hy2 = y2 - hl * Math.sin(ang + Math.PI / 6);
      body = (
        <>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={pal.hex}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
          <path
            d={`M${hx1},${hy1} L${x2},${y2} L${hx2},${hy2}`}
            fill="none"
            stroke={pal.hex}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    } else if (s.type === "line") {
      const ptsObj = s.props?.points ?? {};
      const pts = Object.values(ptsObj) as Array<{ x: number; y: number }>;
      if (pts.length >= 2) {
        const d = pts
          .map((p, i) => `${i === 0 ? "M" : "L"}${s.x + p.x},${s.y + p.y}`)
          .join(" ");
        body = (
          <path
            d={d}
            fill="none"
            stroke={pal.hex}
            strokeWidth={sw}
            strokeLinecap="round"
            strokeDasharray={dash}
          />
        );
      }
    } else if (s.type === "note") {
      const b = shapeBounds(s);
      const label = fromRichText(s.props?.richText);
      body = (
        <>
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx={10}
            fill={
              s.props?.color === "black"
                ? "var(--bg-loft-surface, #ffffff)"
                : pal.fill
            }
            stroke={pal.hex}
            strokeWidth={1.5}
          />
          <text
            x={b.x + 12}
            y={b.y + 28}
            fill={
              s.props?.color === "black"
                ? "var(--text-loft-primary, #101113)"
                : "#101113"
            }
            fontSize={sz.font}
            fontWeight={500}
          >
            {label}
          </text>
        </>
      );
    } else if (s.type === "text") {
      const label = fromRichText(s.props?.richText);
      body = (
        <text
          x={s.x}
          y={s.y + sz.font}
          fill={pal.hex}
          fontSize={sz.font}
          fontWeight={500}
        >
          {label}
        </text>
      );
    }

    return (
      <g
        key={s.id}
        className={isDraft ? "tl-shape-draft" : "tl-shape"}
        data-shape-id={s.id}
        opacity={s.opacity}
      >
        {body}
      </g>
    );
  };

  const leftTools: Array<{
    id: ToolKind;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    label: string;
  }> = [
    { id: "select", icon: MousePointer2, label: "Select — V" },
    { id: "hand", icon: Hand, label: "Hand — H" },
    { id: "draw", icon: Pencil, label: "Draw — D" },
    { id: "highlight", icon: Highlighter, label: "Highlight" },
    { id: "eraser", icon: Eraser, label: "Eraser — E" },
    { id: "rect", icon: Square, label: "Rectangle — R" },
    { id: "ellipse", icon: Circle, label: "Ellipse — O" },
    { id: "triangle", icon: Triangle, label: "Triangle" },
    { id: "diamond", icon: Diamond, label: "Diamond" },
    { id: "arrow", icon: ArrowUpRight, label: "Arrow — A" },
    { id: "text", icon: Type, label: "Text — T" },
    { id: "note", icon: StickyNote, label: "Note — N" },
  ];

  const zoomPercent = Math.round(camera.z * 100);

  return (
    <div
      ref={wrapper}
      className="relative h-full min-h-0 w-full overflow-hidden rounded-[16px] bg-[var(--bg-loft-surface)]"
      onPointerMove={pointer}
      onPointerDown={pointer}
      onPointerUp={pointer}
      onPointerLeave={(e) => pointer(e, false)}
    >
      <div className="tl-container relative h-full w-full select-none overflow-hidden bg-[var(--bg-loft-base)]">
        {/* Left Vertical Tool Slab (spacing: 12px offset, 4px padding/gap, 16px outer radius, 10px button radius) */}
        <div
          role="toolbar"
          aria-label="Tools"
          className={`${LOFT_SURFACE} absolute left-3 top-3 z-20 flex max-h-[calc(100%-24px)] flex-col items-center gap-1 overflow-y-auto rounded-[16px] p-1`}
        >
          {leftTools.map(({ id, icon: Icon, label }) => {
            const activeTool = tool === id;
            return (
              <button
                key={id}
                type="button"
                aria-label={label}
                title={label}
                aria-pressed={activeTool}
                onClick={() => setTool(id)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center ${
                  activeTool ? LOFT_BTN_ACTIVE : LOFT_BTN
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.85} />
              </button>
            );
          })}

          <div className="my-1 h-px w-6 shrink-0 bg-[var(--border-loft)]" />

          <button
            type="button"
            onClick={handleUndo}
            aria-label="Undo"
            title="Undo (⌘Z)"
            className={`flex h-9 w-9 shrink-0 items-center justify-center ${LOFT_BTN}`}
          >
            <Undo2 className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            aria-label="Redo"
            title="Redo (⌘⇧Z)"
            className={`flex h-9 w-9 shrink-0 items-center justify-center ${LOFT_BTN}`}
          >
            <Redo2 className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <button
            type="button"
            onClick={() => void exportPng()}
            disabled={!shapes.length || exporting}
            aria-label={locale === "vi" ? "Xuất PNG" : "Export PNG"}
            title={locale === "vi" ? "Xuất PNG" : "Export PNG"}
            className={`flex h-9 w-9 shrink-0 items-center justify-center disabled:opacity-40 ${LOFT_BTN}`}
          >
            <Download className="h-4 w-4" strokeWidth={1.85} />
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete"
              title="Delete (⌫)"
              className={`flex h-9 w-9 shrink-0 items-center justify-center ${LOFT_BTN}`}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.85} />
            </button>
          )}
          <button
            type="button"
            aria-label="Toggle style inspector"
            title="Style Inspector"
            aria-pressed={inspectorOpen}
            onClick={() => setInspectorOpen((v) => !v)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center ${
              inspectorOpen ? LOFT_BTN_ACTIVE : LOFT_BTN
            }`}
          >
            <AlignLeft className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>

        {/* Right Style Inspector Slab (16px radius, 12px padding/gap, 1px #d9dce1 border, contact inset shadow) */}
        {inspectorOpen && (
          <aside
            aria-label="Style inspector"
            className={`${LOFT_SURFACE} absolute right-3 top-3 z-20 flex w-[188px] flex-col gap-3 rounded-[16px] p-3`}
          >
            {/* 2x4 Color Swatches */}
            <div
              role="toolbar"
              aria-label="Color"
              className="grid grid-cols-4 place-items-center gap-2"
            >
              {INSPECTOR_COLORS.map((c) => {
                const selected = style.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Color — ${PALETTE[c].label}`}
                    aria-pressed={selected}
                    onClick={() => updateStyle({ color: c })}
                    className={`h-6 w-6 rounded-full border border-[var(--border-loft)] transition-transform duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
                      selected
                        ? "scale-110 ring-2 ring-[var(--text-loft-primary)] ring-offset-2 ring-offset-[var(--bg-loft-surface)]"
                        : "hover:scale-105"
                    }`}
                    style={{ backgroundColor: PALETTE[c].hex }}
                  />
                );
              })}
            </div>

            {/* Opacity Slider */}
            <div className="flex items-center px-1 py-0.5">
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(style.opacity * 100)}
                aria-label="Opacity"
                onChange={(e) =>
                  updateStyle({ opacity: Number(e.target.value) / 100 })
                }
                className="h-1 w-full cursor-pointer appearance-none rounded-[4px] bg-[var(--border-loft)] accent-[var(--text-loft-primary)]"
              />
            </div>

            {/* Fill Selector Row (None, Semi, Solid/Hatched) */}
            <div
              role="toolbar"
              aria-label="Fill"
              className="grid grid-cols-3 gap-1"
            >
              {(["none", "semi", "solid"] as const).map((f) => {
                const activeFill = style.fill === f;
                return (
                  <button
                    key={f}
                    type="button"
                    aria-label={`Fill — ${f}`}
                    aria-pressed={activeFill}
                    onClick={() => updateStyle({ fill: f })}
                    className={`flex h-8 items-center justify-center ${
                      activeFill ? LOFT_BTN_ACTIVE : LOFT_BTN
                    }`}
                  >
                    {f === "none" && (
                      <span className="h-4 w-4 rounded-[4px] border-[1.75px] border-current" />
                    )}
                    {f === "semi" && (
                      <span className="h-3.5 w-3.5 rounded-[4px] border-[1.75px] border-current bg-current/25" />
                    )}
                    {f === "solid" && (
                      <span
                        className="h-4 w-4 rounded-[4px] border-[1.75px] border-current"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(135deg, currentColor 0, currentColor 1.5px, transparent 1.5px, transparent 4px)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Dash Selector Row (Solid/Draw, Dashed, Dotted) */}
            <div
              role="toolbar"
              aria-label="Dash"
              className="grid grid-cols-3 gap-1"
            >
              {(["draw", "dashed", "dotted"] as const).map((d) => {
                const activeDash = style.dash === d;
                return (
                  <button
                    key={d}
                    type="button"
                    aria-label={`Dash — ${d}`}
                    aria-pressed={activeDash}
                    onClick={() => updateStyle({ dash: d })}
                    className={`flex h-8 items-center justify-center ${
                      activeDash ? LOFT_BTN_ACTIVE : LOFT_BTN
                    }`}
                  >
                    <svg className="h-4 w-4" viewBox="0 0 20 20">
                      <circle
                        cx="10"
                        cy="10"
                        r="7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeDasharray={
                          d === "dashed"
                            ? "4 3"
                            : d === "dotted"
                              ? "1.5 2.5"
                              : undefined
                        }
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                );
              })}
            </div>

            {/* Size Row (S, M, L, XL) */}
            <div
              role="toolbar"
              aria-label="Size"
              className="grid grid-cols-4 gap-1"
            >
              {(["s", "m", "l", "xl"] as const).map((sz) => {
                const activeSize = style.size === sz;
                return (
                  <button
                    key={sz}
                    type="button"
                    aria-label={`Size — ${sz.toUpperCase()}`}
                    aria-pressed={activeSize}
                    onClick={() => updateStyle({ size: sz })}
                    className={`flex h-8 items-center justify-center uppercase ${
                      activeSize ? LOFT_BTN_ACTIVE : LOFT_BTN
                    }`}
                  >
                    {sz}
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {/* Bottom-Right Minimap & Zoom Slab */}
        <div className="absolute bottom-3 right-3 z-20 hidden items-center gap-2 sm:flex">
          <button
            type="button"
            aria-label="Toggle minimap"
            aria-pressed={minimapOpen}
            onClick={() => setMinimapOpen((v) => !v)}
            className={`${LOFT_SURFACE} flex h-10 w-10 items-center justify-center ${
              minimapOpen ? LOFT_BTN_ACTIVE : LOFT_BTN
            }`}
          >
            <MapIcon className="h-4 w-4" strokeWidth={1.85} />
          </button>

          <div
            className={`${LOFT_SURFACE} flex h-10 items-center gap-1 rounded-[10px] p-1`}
          >
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() =>
                setCamera((c) => ({ ...c, z: Math.max(0.2, c.z * 0.85) }))
              }
              className={`flex h-8 w-8 items-center justify-center ${LOFT_BTN}`}
            >
              <Minus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={`Zoom — ${zoomPercent}%`}
              onClick={() => setCamera({ x: 0, y: 0, z: 1 })}
              className={`flex h-8 items-center gap-1 px-2 text-[var(--text-loft-primary)] ${LOFT_BTN}`}
            >
              <span>{zoomPercent}%</span>
              <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() =>
                setCamera((c) => ({ ...c, z: Math.min(4, c.z * 1.15) }))
              }
              className={`flex h-8 w-8 items-center justify-center ${LOFT_BTN}`}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* Minimap Preview Overlay */}
        {minimapOpen && (
          <div
            className={`${LOFT_SURFACE} pointer-events-none absolute bottom-16 right-3 z-20 h-28 w-44 overflow-hidden rounded-[16px]`}
          >
            <svg viewBox="-200 -150 1400 1000" className="h-full w-full">
              {shapes.map((s) => renderShapeNode(s, false))}
            </svg>
          </div>
        )}

        {/* Inline Text Editor for Text & Sticky Note */}
        {editingShape && (
          <textarea
            autoFocus
            value={editingShape.text}
            onChange={(e) =>
              setEditingShape((prev) =>
                prev ? { ...prev, text: e.target.value } : null,
              )
            }
            onBlur={() => {
              const target = shapes.find((s) => s.id === editingShape.id);
              if (target) {
                const updated = structuredClone(target);
                updated.props.richText = toRichText(
                  editingShape.text || "Text",
                );
                store.put([updated], "user");
              }
              setEditingShape(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey)) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            style={{ left: editingShape.x, top: editingShape.y }}
            className={`${LOFT_SURFACE} absolute z-30 min-h-[40px] min-w-[136px] rounded-[10px] p-2 text-[13px] font-medium leading-[1.5] outline-none`}
          />
        )}

        {/* SVG Drawing Surface with subtle 48px drafting grid */}
        <svg
          className="h-full w-full touch-none"
          style={{
            cursor:
              tool === "hand"
                ? "grab"
                : tool === "select"
                  ? "default"
                  : "crosshair",
          }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onCanvasPointerMove}
          onPointerUp={onCanvasPointerUp}
          onDoubleClick={(e) => {
            const editor = editorRef.current;
            if (!editor) return;
            const pt = editor.screenToPage({ x: e.clientX, y: e.clientY });
            const hit = [...shapes]
              .reverse()
              .find(
                (s) =>
                  hitShape(s, pt) && (s.type === "text" || s.type === "note"),
              );
            if (hit) {
              const bounds = wrapper.current?.getBoundingClientRect();
              setEditingShape({
                id: hit.id,
                x: e.clientX - (bounds?.left ?? 0),
                y: e.clientY - (bounds?.top ?? 0),
                text: fromRichText(hit.props?.richText),
              });
            }
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              const factor = e.deltaY < 0 ? 1.1 : 0.9;
              setCamera((c) => ({
                ...c,
                z: Math.min(4, Math.max(0.2, c.z * factor)),
              }));
            } else {
              setCamera((c) => ({
                ...c,
                x: c.x - e.deltaX,
                y: c.y - e.deltaY,
              }));
            }
          }}
        >
          <defs>
            <pattern
              id="loft-drafting-grid"
              width={48 * camera.z}
              height={48 * camera.z}
              patternUnits="userSpaceOnUse"
              patternTransform={`translate(${camera.x % (48 * camera.z)},${camera.y % (48 * camera.z)})`}
            >
              <circle
                cx="1"
                cy="1"
                r="1"
                fill="var(--border-loft)"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#loft-drafting-grid)" />
          <g
            transform={`translate(${camera.x},${camera.y}) scale(${camera.z})`}
          >
            {shapes.map((s) => renderShapeNode(s, false))}
            {cursorViews.map(
              (c) => c.draft && renderShapeNode(c.draft, true),
            )}
            {draftShape && renderShapeNode(draftShape, true)}
            {shapes
              .filter((s) => selectedIds.includes(s.id))
              .map((s) => {
                const b = shapeBounds(s);
                return (
                  <rect
                    key={`sel-${s.id}`}
                    x={b.x - 4}
                    y={b.y - 4}
                    width={b.w + 8}
                    height={b.h + 8}
                    rx={4}
                    fill="none"
                    stroke="var(--text-loft-primary)"
                    strokeWidth={1.5 / camera.z}
                    strokeDasharray={`${4 / camera.z}`}
                  />
                );
              })}
          </g>
        </svg>
      </div>

      {!ready && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-[var(--bg-loft-base)] text-[13px] font-medium text-[var(--text-loft-muted)]">
          {error ??
            (locale === "vi" ? "Đang tải bảng vẽ…" : "Loading whiteboard…")}
        </div>
      )}
      {ready && error && (
        <div
          role="alert"
          className={`${LOFT_SURFACE} absolute right-3 top-16 z-[500] max-w-xs rounded-[10px] p-3 text-[13px] font-medium leading-[1.5]`}
        >
          {error}
          {saveBlocked && (
            <button
              type="button"
              className="mt-2 block underline"
              onClick={() => discard.current()}
            >
              {locale === "vi" ? "Bỏ thay đổi" : "Discard changes"}
            </button>
          )}
        </div>
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[400] overflow-hidden"
      >
        {cursorViews.map((c) => (
          <div
            key={c.id}
            className="absolute left-0 top-0"
            style={{ transform: `translate(${c.left}px,${c.top}px)` }}
          >
            <svg width="16" height="22" viewBox="0 0 16 22">
              <path
                d="M1 1v17l4-5 4 8 3-2-4-8h6z"
                fill="var(--text-loft-primary)"
                stroke="var(--bg-loft-surface)"
              />
            </svg>
            <span className="ml-3 whitespace-nowrap rounded-[4px] bg-[var(--text-loft-primary)] px-2 py-1 text-[13px] font-medium leading-[1.5] text-[var(--bg-loft-surface)]">
              {c.name}
              {c.drawing ? (locale === "vi" ? " · đang vẽ" : " · drawing") : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
