"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Tldraw,
  createTLStore,
  type Editor,
  type TLRecord,
  type TLComponents,
  type TLUiOverrides,
} from "tldraw";
import "tldraw/tldraw.css";
import { api, ApiError } from "@/lib/api";
import { boardDraftKey, mergeBoardRecords, isSafeBoardRecord, readBoardDraft, withoutBoardCycles, writeBoardDraft } from "@/lib/whiteboard";
import { useBoardStore } from "@/stores/useBoardStore";
import { useRoomStore } from "@/stores/useRoomStore";
import { useRoomSession } from "./RoomSession";
import { useUIStore } from "@/stores/useUIStore";
import { useTranslation } from "@/lib/i18n/useTranslation";

const components: TLComponents = {
  SharePanel: null,
  MainMenu: null,
  PageMenu: null,
};
const overrides: TLUiOverrides = {
  tools: (_editor, tools) => {
    delete tools.asset;
    delete tools.embed;
    return tools;
  },
};
const isDocument = (r: TLRecord) =>
  ["shape", "binding", "page", "document"].includes(r.typeName);

export default function Whiteboard({ active }: { active: boolean }) {
  const { credential, sendCommand } = useRoomSession();
  const roomID = useRoomStore((s) => s.room?.id);
  const connection = useRoomStore((s) => s.connectionState);
  const theme = useUIStore((s) => s.theme);
  const { locale } = useTranslation();
  const [store] = useState(() => createTLStore());
  const editorRef = useRef<Editor | null>(null);
  const pending = useRef(new Map<string, TLRecord | null>());
  const boardVersion = useRef(0);
  const [ready, setReady] = useState(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const discard = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const lastCursor = useRef(0);
  const pointerState = useRef({ x: 0, y: 0, drawing: false, visible: false });
  const [cursorViews, setCursorViews] = useState<
    Array<{
      id: string;
      name: string;
      drawing: boolean;
      left: number;
      top: number;
    }>
  >([]);
  const changed = useBoardStore((s) => s.version);
  const wake = useRef<() => void>(() => {});
  const mounted = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.registerExternalContentHandler("files", null);
    editor.registerExternalContentHandler("url", null);
    editor.registerExternalContentHandler("tldraw", null);
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
    for (const [id, record] of readBoardDraft(storedDraft))
      if (record === null || isSafeBoardRecord(store, record))
        pending.current.set(id, record);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    let failed = false;
    let hydrated = false;
    let halted = false;
    const reconcile = (snapshot: import("@/lib/whiteboard").BoardSnapshot | undefined) => {
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
      // Validate against the installed SDK schema before applying untrusted document records.
      const valid = withoutBoardCycles(records.filter((record) => isSafeBoardRecord(store,record)));
      // Isolate malformed legacy records so one bad record cannot block the room.
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
          const batch = new Map<string, TLRecord | null>();
          let bytes = 0;
          for (const [id, record] of pending.current) {
            const size = new TextEncoder().encode(
              JSON.stringify(record ?? id),
            ).length;
            if (batch.size && (batch.size >= 180 || bytes + size > 200_000))
              break;
            batch.set(id, record);
            bytes += size;
          }
          const snapshot = await api.saveBoard(
            roomID,
            credential,
            {
              version: boardVersion.current,
              put: [...batch.values()].filter((r): r is TLRecord => r !== null),
              remove: [...batch]
                .filter(([, r]) => r === null)
                .map(([id]) => id),
            },
            abort.signal,
          );
          if (stopped) return;
          const outstanding = new Map(pending.current);
          for (const [id, record] of batch)
            if (outstanding.get(id) === record) outstanding.delete(id);
          const saved = pending.current;
          pending.current = outstanding;
          saveDraft();
          try { reconcile(snapshot); } catch (error) { pending.current = saved; throw error; }
        } else if (document.visibilityState === "visible") {
          const snapshot = await api.board(roomID, credential, abort.signal, hydrated ? boardVersion.current : undefined);
          if (stopped) return;
          if (snapshot && (!hydrated || snapshot.version > boardVersion.current))
            reconcile(snapshot);
        }
        hydrated = true;
        setReady(true);
        setSaveBlocked(false);
        setError(null);
      } catch (caught) {
        if (stopped) return;
        failed = true;
        if (caught instanceof ApiError && [400, 401, 403, 413].includes(caught.status)) {
          halted = true;
          setSaveBlocked(true);
        }
        if (caught instanceof ApiError && caught.status === 409) {
          try {
            reconcile(await api.board(roomID, credential, abort.signal));
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
        if (!stopped && !halted)
          timer = setTimeout(
            () => void sync(),
            !failed && pending.current.size ? 200 : 2000,
          );
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
          timer = setTimeout(() => void sync(), 150);
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
    wake.current();
  }, [changed]);
  useEffect(() => {
    const timer = setInterval(() => {
      const editor = editorRef.current;
      const bounds = wrapper.current?.getBoundingClientRect();
      if (!editor || !bounds) return;
      const participants = useRoomStore.getState().participants;
      setCursorViews(
        Object.values(useBoardStore.getState().cursors)
          .filter(
            (c) =>
              c.visible &&
              Date.now() - c.at < 4000 &&
              participants.some((p) => p.connection_id === c.connection_id),
          )
          .map((c) => {
            const point = editor.pageToScreen({ x: c.x, y: c.y });
            return {
              id: c.connection_id,
              name: c.name,
              drawing: c.drawing,
              left: point.x - bounds.left,
              top: point.y - bounds.top,
            };
          }),
      );
    }, 100);
    return () => clearInterval(timer);
  }, []);
  const pointer = (
    event: React.PointerEvent<HTMLDivElement>,
    visible = true,
  ) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (
      visible &&
      event.type === "pointermove" &&
      Date.now() - lastCursor.current < 100
    )
      return;
    lastCursor.current = Date.now();
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    pointerState.current = {
      x: point.x,
      y: point.y,
      drawing: visible && event.buttons === 1,
      visible,
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
  return (
    <div
      ref={wrapper}
      className="relative h-full min-h-0 w-full overflow-hidden rounded-[12px] bg-[var(--bg-loft-surface)]"
      onPointerMove={pointer}
      onPointerDown={pointer}
      onPointerUp={pointer}
      onPointerLeave={(e) => pointer(e, false)}
    >
      <Tldraw
        store={store}
        onMount={mounted}
        components={components}
        overrides={overrides}
        licenseKey={process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
        options={{ maxShapesPerPage: 1400, maxPages: 1 }}
      />
      {!ready && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-[var(--bg-loft-base)]">
          {error ??
            (locale === "vi" ? "Đang tải bảng vẽ…" : "Loading whiteboard…")}
        </div>
      )}
      {ready && error && (
        <div
          role="alert"
          className="absolute right-3 top-16 z-[500] max-w-xs rounded-lg bg-[var(--bg-loft-card)] p-3 text-sm"
        >
          {error}
          {saveBlocked && <button type="button" className="mt-2 block underline" onClick={() => discard.current()}>{locale === "vi" ? "Bỏ thay đổi" : "Discard changes"}</button>}
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
                fill="#2563eb"
                stroke="white"
              />
            </svg>
            <span className="ml-3 whitespace-nowrap rounded bg-blue-600 px-2 py-1 text-xs text-white">
              {c.name}
              {c.drawing ? (locale === "vi" ? " · đang vẽ" : " · drawing") : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
