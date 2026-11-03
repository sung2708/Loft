import { create } from "zustand";
export interface BoardCursor {
  connection_id: string;
  name: string;
  x: number;
  y: number;
  drawing: boolean;
  visible: boolean;
  draft?: unknown;
}
export interface BoardInlinePatch {
  version: number;
  put?: unknown[];
  remove?: string[];
}
export const useBoardStore = create<{
  version: number;
  lastPatch: BoardInlinePatch | null;
  cursors: Record<string, BoardCursor & { at: number }>;
  changed: (version: number, put?: unknown[], remove?: string[]) => void;
  cursor: (cursor: BoardCursor) => void;
  reset: () => void;
}>((set) => ({
  version: 0,
  lastPatch: null,
  cursors: {},
  changed: (version, put, remove) =>
    set((state) => ({
      version: Math.max(version, state.version),
      lastPatch:
        version >= state.version ? { version, put, remove } : state.lastPatch,
    })),
  cursor: (cursor) =>
    set((state) => ({
      cursors: {
        ...Object.fromEntries(
          Object.entries(state.cursors).filter(
            ([, v]) => Date.now() - v.at < 5000,
          ),
        ),
        [cursor.connection_id]: { ...cursor, at: Date.now() },
      },
    })),
  reset: () => set({ version: 0, lastPatch: null, cursors: {} }),
}));
