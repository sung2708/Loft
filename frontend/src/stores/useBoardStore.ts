import { create } from "zustand";
export interface BoardCursor {
  connection_id: string;
  name: string;
  x: number;
  y: number;
  drawing: boolean;
  visible: boolean;
}
export const useBoardStore = create<{
  version: number;
  cursors: Record<string, BoardCursor & { at: number }>;
  changed: (version: number) => void;
  cursor: (cursor: BoardCursor) => void;
  reset: () => void;
}>((set) => ({
  version: 0,
  cursors: {},
  changed: (version) =>
    set((state) => ({ version: Math.max(version, state.version) })),
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
  reset: () => set({ version: 0, cursors: {} }),
}));
