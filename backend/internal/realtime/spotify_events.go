package realtime

// Spotify room events carry metadata only. Provider credentials, device IDs,
// and audio payloads are intentionally not part of these wire contracts.
type SpotifyTrackSummary struct {
	URI           string   `json:"uri"`
	Name          string   `json:"name"`
	Artists       []string `json:"artists"`
	AlbumImageURL string   `json:"album_image_url,omitempty"`
}

type SpotifyPickAdded struct {
	RoomID      string              `json:"room_id"`
	PickID      string              `json:"pick_id"`
	Track       SpotifyTrackSummary `json:"track"`
	SuggestedBy string              `json:"suggested_by"`
}

type SpotifyPickVoted struct {
	RoomID  string `json:"room_id"`
	PickID  string `json:"pick_id"`
	Votes   int    `json:"votes"`
	VoterID string `json:"voter_id"`
}

type SpotifyVisibilityChanged struct {
	RoomID  string `json:"room_id"`
	Sharing bool   `json:"sharing"`
}
