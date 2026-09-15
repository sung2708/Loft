export type IdentityType = "user" | "guest";

export interface ApiRoom {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  allow_guests: boolean;
  max_participants: number;
  is_locked: boolean;
  version: number;
  created_at: string;
}

export type ApiRoomPreview = Pick<
  ApiRoom,
  "id" | "slug" | "name" | "allow_guests" | "max_participants" | "is_locked"
>;

export interface ApiIdentity {
  id: string;
  type: IdentityType;
  display_name: string;
  avatar_url?: string;
}

export interface ApiParticipant {
  connection_id: string;
  identity_id: string;
  identity_type: IdentityType;
  display_name: string;
  avatar_url?: string;
  role: "host" | "member" | "guest";
  livekit_identity: string;
  joined_at: string;
}

export interface ApiMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_type: IdentityType;
  sender_display_name: string;
  sender_avatar_url?: string;
  content: string;
  created_at: string;
}

export type ConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "RESYNCING"
  | "FAILED";

export interface RoomSnapshot {
  room: ApiRoom;
  self: ApiParticipant;
  participants: ApiParticipant[];
  messages: ApiMessage[];
  media?: RoomMediaState;
}

export interface YouTubeTrack {
  id: string;
  video_id: string;
  added_by: string;
  title?: string;
  channel?: string;
  duration_sec?: number;
}

export interface RoomMediaState {
  current: YouTubeTrack | null;
  queue: YouTubeTrack[];
  repeat: boolean;
  status: "IDLE" | "PAUSED" | "PLAYING";
  position_ms: number;
  started_at: string;
  version: number;
}

export type ServerEvent =
  | {
      type: "room.snapshot";
      version: 1;
      event_id: string;
      room_id: string;
      payload: RoomSnapshot;
    }
  | {
      type: "participant.joined";
      version: 1;
      event_id: string;
      room_id: string;
      payload: ApiParticipant;
    }
  | {
      type: "participant.left";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { connection_id: string };
    }
  | {
      type: "room.locked";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { locked: boolean; locked_by: string; version: number };
    }
  | {
      type: "chat.message";
      version: 1;
      event_id: string;
      room_id: string;
      payload: ApiMessage;
    }
  | {
      type: "media.state";
      version: 1;
      event_id: string;
      room_id: string;
      payload: RoomMediaState;
    }
  | {
      type: "reaction.sent";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { connection_id: string; display_name: string; emoji: string };
    }
  | {
      type: "connection.pong";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { client_time: number; server_time: number };
    }
  | {
      type: "error";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { code: string; message: string };
    };

export interface RoomCredential {
  token: string;
  type: IdentityType;
  roomId: string;
  displayName: string;
}
