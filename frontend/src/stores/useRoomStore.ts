"use client";

import { create } from "zustand";
import type {
  ApiParticipant,
  ApiRoom,
  ConnectionState,
  RoomSnapshot,
} from "@/types/api";

interface RoomStoreState {
  room: ApiRoom | null;
  self: ApiParticipant | null;
  participants: ApiParticipant[];
  connectionState: ConnectionState;
  connectionError: string | null;
  governanceError: string | null;
  applySnapshot: (snapshot: RoomSnapshot) => void;
  participantJoined: (participant: ApiParticipant) => void;
  participantLeft: (connectionId: string) => void;
  roomLocked: (locked: boolean, version: number) => void;
  setGovernanceError: (error: string | null) => void;
  setConnectionState: (state: ConnectionState, error?: string | null) => void;
  reset: () => void;
}

const initial = {
  room: null,
  self: null,
  participants: [],
  connectionState: "DISCONNECTED" as ConnectionState,
  connectionError: null,
  governanceError: null,
};

export const useRoomStore = create<RoomStoreState>((set) => ({
  ...initial,
  applySnapshot: (snapshot) =>
    set({
      room: snapshot.room,
      self: snapshot.self,
      participants: snapshot.participants,
      connectionState: "CONNECTED",
      connectionError: null,
      governanceError: null,
    }),
  participantJoined: (participant) =>
    set((state) => ({
      participants: state.participants.some(
        (item) =>
          item.identity_id === participant.identity_id ||
          item.connection_id === participant.connection_id,
      )
        ? state.participants.map((item) =>
            item.identity_id === participant.identity_id ||
            item.connection_id === participant.connection_id
              ? participant
              : item,
          )
        : [...state.participants, participant],
    })),
  participantLeft: (connectionId) =>
    set((state) => ({
      participants: state.participants.filter(
        (item) => item.connection_id !== connectionId,
      ),
    })),
  roomLocked: (locked, version) =>
    set((state) => state.room && version > state.room.version
      ? { room: { ...state.room, is_locked: locked, version }, governanceError: null }
      : state),
  setGovernanceError: (governanceError) => set({ governanceError }),
  setConnectionState: (connectionState, connectionError = null) =>
    set({ connectionState, connectionError }),
  reset: () => set(initial),
}));
