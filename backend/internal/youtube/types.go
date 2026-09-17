package youtube

type SearchResult struct {
	VideoID     string `json:"video_id"`
	Title       string `json:"title"`
	Channel     string `json:"channel"`
	DurationSec int64  `json:"duration_sec,omitempty"`
	Thumbnail   string `json:"thumbnail,omitempty"`
}

type SearchResponse struct {
	Items []SearchResult `json:"items"`
	Query string         `json:"query"`
}

type RoomPick struct {
	ID      string `json:"id"`
	VideoID string `json:"video_id"`
	Title   string `json:"title"`
	Channel string `json:"channel"`
}
