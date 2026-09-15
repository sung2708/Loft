"use client";

import { create } from "zustand";
import type {
  ApiParticipant,
  ApiRoom,
  ConnectionState,
  HostAuthority,
  RoomSnapshot,
} from "@/types/api";

interface RoomStoreState {
  room: ApiRoom | null;
  self: ApiParticipant | null;
  host: HostAuthority | null;
  participants: ApiParticipant[];
  connectionState: ConnectionState;
  connectionError: string | null;
  governanceError: string | null;
  applySnapshot: (snapshot: RoomSnapshot) => void;
  participantJoined: (participant: ApiParticipant) => void;
  participantLeft: (connectionId: string) => void;
  roomLocked: (locked: boolean, version: number) => void;
  hostChanged: (host: HostAuthority) => void;
  handChanged: (connectionId: string, raised: boolean, socialVersion: number) => void;
  setGovernanceError: (error: string | null) => void;
  setConnectionState: (state: ConnectionState, error?: string | null) => void;
  reset: () => void;
}

const initial = {
  room: null,
  self: null,
  host: null,
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
      self: normalizeParticipant(snapshot.self),
      host: snapshot.host ?? null,
      participants: snapshot.participants.map(normalizeParticipant),
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
  hostChanged: (host) =>
    set((state) => {
      if (state.host && host.version < state.host.version) return state;
      const roleFor = (participant: ApiParticipant) =>
        participant.connection_id === host.connection_id
          ? "host" as const
          : participant.identity_type === "guest"
            ? "guest" as const
            : "member" as const;
      return {
        host,
        self: state.self ? { ...state.self, role: roleFor(state.self) } : null,
        participants: state.participants.map((participant) => ({ ...participant, role: roleFor(participant) })),
      };
    }),
  handChanged: (connectionId, raisedHand, socialVersion) =>
    set((state) => {
      const update = (participant: ApiParticipant) =>
        participant.connection_id === connectionId &&
        socialVersion > (participant.social_version ?? 0)
          ? { ...participant, raised_hand: raisedHand, social_version: socialVersion }
          : participant;
      return {
        self: state.self ? update(state.self) : null,
        participants: state.participants.map(update),
      };
    }),
  setGovernanceError: (governanceError) => set({ governanceError }),
  setConnectionState: (connectionState, connectionError = null) =>
    set({ connectionState, connectionError }),
  reset: () => set(initial),
}));

function normalizeParticipant(participant: ApiParticipant): ApiParticipant {
  return {
    ...participant,
    raised_hand: participant.raised_hand ?? false,
    social_version: participant.social_version ?? 0,
  };
}
