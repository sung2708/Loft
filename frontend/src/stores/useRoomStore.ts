"use client";

import { create } from "zustand";
import type {
  ApiParticipant,
  ApiRoom,
  ConnectionState,
  HostAuthority,
  RoomSnapshot,
  RoomAppearance,
} from "@/types/api";

interface RoomStoreState {
  room: ApiRoom | null;
  self: ApiParticipant | null;
  host: HostAuthority | null;
  participants: ApiParticipant[];
  pendingAvatars: Map<string, string>;
  connectionState: ConnectionState;
  connectionError: string | null;
  governanceError: string | null;
  applySnapshot: (snapshot: RoomSnapshot) => void;
  participantJoined: (participant: ApiParticipant) => void;
  participantAvatar: (connectionId: string, avatarUrl: string) => void;
  participantLeft: (connectionId: string) => void;
  roomLocked: (locked: boolean, version: number) => void;
  roomAppearanceUpdated: (appearance: RoomAppearance) => void;
  roomUpdated: (room: ApiRoom) => void;
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
  pendingAvatars: new Map<string, string>(),
  connectionState: "DISCONNECTED" as ConnectionState,
  connectionError: null,
  governanceError: null,
};

export const useRoomStore = create<RoomStoreState>((set, _get, api) => {
  api.getInitialState = () => api.getState();
  return {
  ...initial,
  applySnapshot: (snapshot) =>
    set({
      room: snapshot.room,
      self: snapshot.self ? normalizeParticipant(snapshot.self) : null,
      host: snapshot.host ?? null,
      participants: snapshot.participants.map(normalizeParticipant),
      pendingAvatars: new Map(),
      connectionState: "CONNECTED",
      connectionError: null,
      governanceError: null,
    }),
  participantJoined: (participant) =>
    set((state) => {
      const pendingAvatars = new Map(state.pendingAvatars);
      const pending = pendingAvatars.get(participant.connection_id);
      pendingAvatars.delete(participant.connection_id);
      const existing = state.participants.find((item) => item.connection_id === participant.connection_id);
      const updated = pending !== undefined || existing
        ? { ...participant, avatar_url: pending !== undefined ? pending || undefined : existing?.avatar_url }
        : participant;
      const matches = (item: ApiParticipant) =>
        item.connection_id === updated.connection_id ||
        (item.identity_id === updated.identity_id && item.identity_type === updated.identity_type);
      return {
        pendingAvatars,
        participants: state.participants.some(matches)
          ? state.participants.map((item) => matches(item) ? updated : item)
          : [...state.participants, updated],
      };
    }),
  participantAvatar: (connectionId, avatarUrl) =>
    set((state) => {
      if (state.self?.connection_id !== connectionId &&
          !state.participants.some((item) => item.connection_id === connectionId)) {
        const pendingAvatars = new Map(state.pendingAvatars);
        pendingAvatars.delete(connectionId);
        // shortcut: retain 64 unmatched updates, use versioned snapshots if admission bursts outgrow this.
        if (pendingAvatars.size >= 64) {
          const oldest = pendingAvatars.keys().next().value;
          if (oldest !== undefined) pendingAvatars.delete(oldest);
        }
        pendingAvatars.set(connectionId, avatarUrl);
        return { pendingAvatars };
      }
      const update = (participant: ApiParticipant) =>
        participant.connection_id === connectionId
          ? { ...participant, avatar_url: avatarUrl || undefined }
          : participant;
      return {
        self: state.self ? update(state.self) : null,
        participants: state.participants.map(update),
      };
    }),
  participantLeft: (connectionId) =>
    set((state) => {
      const pendingAvatars = new Map(state.pendingAvatars);
      pendingAvatars.delete(connectionId);
      return {
        pendingAvatars,
        participants: state.participants.filter((item) => item.connection_id !== connectionId),
      };
    }),
  roomLocked: (locked, version) =>
    set((state) => state.room && version > state.room.version
      ? { room: { ...state.room, is_locked: locked, version }, governanceError: null }
      : state),
  roomAppearanceUpdated: (appearance) =>
    set((state) => state.room && appearance.version > state.room.version
      ? { room: { ...state.room, ...appearance }, governanceError: null }
      : state),
  roomUpdated: (updated) =>
    set((state) => state.room && updated.version < state.room.version ? state : ({
      room: state.room ? { ...state.room, ...updated } : updated,
      governanceError: null,
    })),
  hostChanged: (host) =>
    set((state) => {
      if (state.host && (host.version < state.host.version ||
        (host.version === state.host.version && host.connection_id <= state.host.connection_id))) return state;
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
  };
});

function normalizeParticipant(participant: ApiParticipant): ApiParticipant {
  return {
    ...participant,
    raised_hand: participant.raised_hand ?? false,
    social_version: participant.social_version ?? 0,
  };
}
