export type StageMode = "stage" | "screenshare" | "video" | "preflight";

export type DrawerType = "chat" | "people" | "music" | "settings" | null;

export type ThemeMode = "system" | "dark" | "light";

/**
 * Commands accepted by the room WebSocket. Keeping this at the protocol
 * boundary prevents UI surfaces from silently drifting away from the room
 * authority as new controls are added.
 */
export type RoomSocketMessageType =
  | "chat.send"
  | "connection.ping"
  | "room.leave"
  | "queue.add"
  | "queue.next"
  | "queue.select"
  | "queue.remove"
  | "queue.clear"
  | "queue.shuffle"
  | "queue.reorder"
  | "media.play_now"
  | "media.play"
  | "media.pause"
  | "media.seek"
  | "media.duration"
  | "media.repeat"
  | "media.autoplay.set"
  | "media.ended"
  | "media.unavailable"
  | "youtube.pick.create"
  | "youtube.pick.vote"
  | "youtube.pick.promote"
  | "reaction.send"
  | "wave.send"
  | "participant.hand.set"
  | "room.lock"
  | "room.appearance.update"
  | "participant.kick"
  | "participant.ban"
  | "host.transfer";

export type RoomCommandType = Exclude<
  RoomSocketMessageType,
  "chat.send" | "connection.ping" | "room.leave"
>;

export interface Participant {
  id: string;
  name: string;
  avatar: string;
  role: "host" | "moderator" | "member" | "guest";
  isSpeaking: boolean;
  isMuted: boolean;
  isVideoOn: boolean;
  isScreenSharing: boolean;
  pingMs: number;
}

export interface RoomDetails {
  id: string;
  slug: string;
  title: string;
  isPrivate: boolean;
  hostId: string;
  participantCount: number;
  maxParticipants: number;
}
