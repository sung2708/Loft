export type IdentityType = "user" | "guest";
export type RoomAtmosphere = "minimal" | "ambient" | "focus" | "party";
export type RoomAccent = "blue" | "purple" | "green" | "orange" | "rose";

export interface RoomAppearance {
  atmosphere: RoomAtmosphere;
  accent: RoomAccent;
  adaptive_media_background: boolean;
  version: number;
  autoplay?: boolean;
  unavailable?: string;
}

export interface ApiRoom {
  id: string;
  slug: string;
  name: string;
  owner_id: string;
  allow_guests: boolean;
  max_participants: number;
  is_locked: boolean;
  password_required: boolean;
  atmosphere: RoomAtmosphere;
  accent: RoomAccent;
  adaptive_media_background: boolean;
  version: number;
  created_at: string;
}

export type ApiRoomPreview = Pick<
  ApiRoom,
  "id" | "slug" | "name" | "allow_guests" | "max_participants" | "is_locked" | "password_required"
>;

export interface ApiIdentity {
  id: string;
  type: IdentityType;
  display_name: string;
  avatar_url?: string;
}

export interface AdminOverview {
  open_rooms: number;
  ended_rooms: number;
  new_users: number;
  new_rooms: number;
  users: number;
  rooms: number;
}

export interface AdminUser {
  id: string;
  display_name: string;
  created_at: string;
  room_count: number;
  suspension?: AccountSuspension;
}

export interface AccountSuspension {
  user_id: string;
  actor_id: string;
  reason: string;
  note: string;
  /** Absent for a permanent suspension. */
  expires_at?: string;
  created_at: string;
}

export interface AdminAuditEntry {
  id: number;
  actor_id: string;
  actor_name?: string;
  action: string;
  target_type: string;
  target_id: string;
  reason?: string;
  note?: string;
  expires_at?: string;
  created_at: string;
}

export interface AdminRoom {
  deleted?: boolean;
  moderation?: { actor_id: string; reason: string; note: string; created_at: string };
  id: string;
  code: string;
  name: string;
  owner_id: string;
  owner_name: string;
  allow_guests: boolean;
  is_locked: boolean;
  password_required: boolean;
  ended: boolean;
  created_at: string;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
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
  raised_hand?: boolean;
  social_version?: number;
}

export interface HostAuthority {
  connection_id: string;
  identity_id: string;
  identity_type: IdentityType;
  generation: number;
  version: number;
  state: "connected" | "grace-period" | "failed-over" | string;
}

export interface ApiMessage {
  revision?: number;
  id: string;
  room_id: string;
  sender_id: string;
  sender_type: IdentityType;
  sender_display_name: string;
  sender_avatar_url?: string;
  content: string;
  created_at: string;
  reply_to?: ApiMessageReply;
  edited_at?: string;
  /** Deleted messages arrive with empty content. */
  deleted?: boolean;
}

export interface ApiMessageReply {
  revision?: number;
  id: string;
  sender_display_name: string;
  content: string;
  deleted?: boolean;
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
  host: HostAuthority;
  self: ApiParticipant;
  participants: ApiParticipant[];
  messages: ApiMessage[];
  media?: RoomMediaState;
  picks?: YouTubeRoomPick[];
}
export interface YouTubeRoomPick { id:string; video_id:string; title:string; channel:string; suggested_by:string; votes:number }

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
  autoplay?: boolean;
  status: "IDLE" | "PAUSED" | "PLAYING";
  position_ms: number;
  started_at: string;
  version: number;
  /** LiveKit identities voting to skip the track whose id is skip_votes_for. */
  skip_votes?: string[];
  skip_votes_for?: string;
}

export type ServerEvent =
 | { type:"board.changed"; version:1; event_id:string; room_id:string; payload:{version:number; put?:unknown[]; remove?:string[]} }
 | { type:"board.cursor"; version:1; event_id:string; room_id:string; payload:{connection_id:string;name:string;x:number;y:number;drawing:boolean;visible:boolean;draft?:unknown} }
  | {type:"room.ended";version:1;event_id:string;room_id:string;payload:Record<string,never>}
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
      type: "host.changed";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { host: HostAuthority; reason: string };
    }
  | {
      type: "room.locked";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { locked: boolean; locked_by: string; version: number };
    }
  | {
      type: "room.appearance.updated";
      version: 1;
      event_id: string;
      room_id: string;
      payload: RoomAppearance;
    }
  | {
      type: "room.access_changed";
      version: 1;
      event_id: string;
      room_id: string;
      payload: ApiRoom;
    }
  | {
      type: "chat.message" | "chat.updated";
      version: 1;
      event_id: string;
      room_id: string;
      payload: ApiMessage;
    }
  | {
      type: "chat.typing";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { connection_id: string; display_name: string };
    }
  | {
      type: "media.state";
      version: 1;
      event_id: string;
      room_id: string;
      payload: RoomMediaState;
    }
  | { type: "youtube.pick.created" | "youtube.pick.voted"; version: 1; event_id: string; room_id: string; payload: YouTubeRoomPick }
  | { type: "youtube.pick.promoted"; version: 1; event_id: string; room_id: string; payload: YouTubeRoomPick }
  | {
      type: "reaction.sent";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { connection_id: string; display_name: string; emoji: string };
    }
  | {
      type: "wave.sent";
      version: 1;
      event_id: string;
      room_id: string;
      payload: { connection_id: string; display_name: string; emitted_at: string };
    }
  | {
      type: "participant.hand_changed";
      version: 1;
      event_id: string;
      room_id: string;
      payload: {
        connection_id: string;
        identity_id: string;
        generation: number;
        raised: boolean;
        social_version: number;
      };
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

export type CallFeedbackTag =
  | "echo"
  | "choppy_audio"
  | "frozen_video"
  | "lag"
  | "disconnects"
  | "other";

export interface CallFeedbackPayload {
  rating: number;
  tags: CallFeedbackTag[];
  duration_seconds: number;
  samples_good: number;
  samples_poor: number;
  samples_lost: number;
  reconnects: number;
}

export interface CallQualitySummary {
  responses: number;
  average_rating: number;
  low_ratings: number;
  poor_share: number;
  tags: Partial<Record<CallFeedbackTag, number>>;
}

export interface RoomCredential {
  token: string;
  type: IdentityType;
  roomId: string;
  displayName: string;
}
