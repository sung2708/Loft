export type StageMode = "stage" | "screenshare" | "video" | "preflight";

export type DrawerType = "chat" | "people" | "music" | null;

export type ThemeMode = "system" | "dark" | "light";

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
