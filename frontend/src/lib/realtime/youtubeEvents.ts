export type YouTubePickCommand = {
  pick_id?: string;
  video_id?: string;
  title?: string;
  channel?: string;
  expected_version?: number;
};

export type YouTubePickEvent = {
  type: "youtube.pick.created" | "youtube.pick.voted" | "youtube.pick.promoted";
  pick_id: string;
  video_id: string;
  vote_count?: number;
};
