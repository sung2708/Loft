export type YouTubeSearchResult = {
  videoId: string;
  title: string;
  channel: string;
  durationSec?: number;
  thumbnail?: string;
};

export type YouTubeSearchResponse = {
  query: string;
  items: YouTubeSearchResult[];
};

export type YouTubeUnavailableReason = "private" | "removed" | "embed_disabled" | "provider_error";
