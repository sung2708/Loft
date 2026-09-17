export type SpotifyRoomEvent =
  | { type: "spotify.pick.added"; roomId: string; pickId: string; track: SpotifyTrackSummary; suggestedBy: string }
  | { type: "spotify.pick.voted"; roomId: string; pickId: string; votes: number; voterId: string }
  | { type: "spotify.visibility.changed"; roomId: string; sharing: boolean };

export interface SpotifyTrackSummary {
  uri: string;
  name: string;
  artists: string[];
  albumImageUrl?: string;
}

const forbiddenKeys = ["accessToken", "refreshToken", "clientSecret", "audio", "deviceId"] as const;

export function assertSafeSpotifyEvent(event: unknown): asserts event is SpotifyRoomEvent {
  if (!event || typeof event !== "object") throw new Error("invalid spotify event");
  for (const key of forbiddenKeys) {
    if (key in (event as Record<string, unknown>)) throw new Error(`forbidden spotify event field: ${key}`);
  }
}
