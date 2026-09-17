export type SpotifyConnectionStatus =
  | "DISCONNECTED"
  | "CONNECTED"
  | "EXPIRED"
  | "REVOKED"
  | "UNAVAILABLE";

export type SpotifyPlaybackCapability =
  | "UNKNOWN"
  | "AVAILABLE"
  | "PREMIUM_REQUIRED"
  | "UNSUPPORTED"
  | "DEVICE_UNAVAILABLE";

export interface SpotifyConnectionState {
  status: SpotifyConnectionStatus;
  scopes: string[];
  playback: SpotifyPlaybackCapability;
  connectedAt?: string;
  product?: string;
}

export interface SpotifyRoomVisibility {
  roomId: string;
  sharing: boolean;
  updatedAt?: string;
}
