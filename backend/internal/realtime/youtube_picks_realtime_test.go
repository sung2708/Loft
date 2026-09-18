package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/store"
)

type youtubeRealtimeMockStore struct {
	realtimeStore
	mu        sync.Mutex
	picks     map[string]store.YouTubeRoomPick
	voters    map[string]map[string]bool
	createErr error
	voteErr   error
	promErr   error
}

func newYouTubeRealtimeMockStore(room domain.Room) *youtubeRealtimeMockStore {
	return &youtubeRealtimeMockStore{
		realtimeStore: realtimeStore{room: room},
		picks:         make(map[string]store.YouTubeRoomPick),
		voters:        make(map[string]map[string]bool),
	}
}

func (s *youtubeRealtimeMockStore) GetRoom(_ context.Context, identifier string) (domain.Room, error) {
	if s.room.ID == identifier || s.room.Slug == identifier {
		return s.room, nil
	}
	return domain.Room{}, domain.ErrNotFound
}

func (s *youtubeRealtimeMockStore) CreateRoomPick(_ context.Context, pick store.YouTubeRoomPick) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.createErr != nil {
		return s.createErr
	}
	activeCount := 0
	for _, p := range s.picks {
		if p.RoomID == pick.RoomID && p.Active {
			activeCount++
		}
	}
	if activeCount >= store.MaxActivePicks {
		return store.ErrPickCapacityReached
	}
	s.picks[pick.ID] = pick
	return nil
}

func (s *youtubeRealtimeMockStore) ListRoomPicks(_ context.Context, roomID string) ([]store.YouTubeRoomPick, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var list []store.YouTubeRoomPick
	for _, p := range s.picks {
		if p.RoomID == roomID && p.Active {
			list = append(list, p)
		}
	}
	return list, nil
}

func (s *youtubeRealtimeMockStore) ListRoomPickVoters(_ context.Context, roomID string) (map[string][]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	res := make(map[string][]string)
	for pickID, voters := range s.voters {
		p, ok := s.picks[pickID]
		if ok && p.RoomID == roomID && p.Active {
			for uid := range voters {
				res[pickID] = append(res[pickID], uid)
			}
		}
	}
	return res, nil
}

func (s *youtubeRealtimeMockStore) VoteRoomPick(_ context.Context, roomID, pickID, userID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.voteErr != nil {
		return s.voteErr
	}
	p, ok := s.picks[pickID]
	if !ok || p.RoomID != roomID || !p.Active {
		return domain.ErrNotFound
	}
	if s.voters[pickID] == nil {
		s.voters[pickID] = make(map[string]bool)
	}
	if s.voters[pickID][userID] {
		return store.ErrAlreadyVoted
	}
	s.voters[pickID][userID] = true
	p.Votes++
	s.picks[pickID] = p
	return nil
}

func (s *youtubeRealtimeMockStore) PromoteRoomPick(_ context.Context, roomID, pickID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.promErr != nil {
		return s.promErr
	}
	p, ok := s.picks[pickID]
	if !ok || p.RoomID != roomID || !p.Active {
		return domain.ErrNotFound
	}
	p.Active = false
	s.picks[pickID] = p
	return nil
}

func (s *youtubeRealtimeMockStore) SetAutoplay(_ context.Context, _ store.YouTubeMediaSettings) error {
	return nil
}

func (s *youtubeRealtimeMockStore) GetMediaSettings(_ context.Context, roomID string) (store.YouTubeMediaSettings, error) {
	return store.YouTubeMediaSettings{RoomID: roomID, AutoplayEnabled: false}, nil
}

func setupRealtimeTestServer(mock *youtubeRealtimeMockStore) (*httptest.Server, *Hub, *auth.GuestTokens) {
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	hub := New(mock, guests, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server := httptest.NewServer(hub)
	return server, hub, guests
}

func connectAndAuthGuest(t *testing.T, ctx context.Context, serverURL string, guests *auth.GuestTokens, roomID, name string) *websocket.Conn {
	t.Helper()
	raw, _, _, err := guests.Issue(roomID, name)
	if err != nil {
		t.Fatalf("issue guest token: %v", err)
	}
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(serverURL, "http"), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{"http://localhost:3000"}},
	})
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	payload := []byte(`{"token":"` + raw + `","room_id":"` + roomID + `"}`)
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.auth", Version: 1, EventID: uuid.NewString(), RoomID: roomID, Payload: payload}); err != nil {
		t.Fatalf("ws auth: %v", err)
	}
	var snapshot Envelope
	if err := wsjson.Read(ctx, conn, &snapshot); err != nil {
		t.Fatalf("ws read snapshot: %v", err)
	}
	if snapshot.Type != "room.snapshot" {
		t.Fatalf("expected room.snapshot, got %s", snapshot.Type)
	}
	return conn
}

func TestWebSocketPickCreateDBPersistenceFailure(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Picks Room", AllowGuests: true}
	mock := newYouTubeRealtimeMockStore(room)
	mock.createErr = errors.New("db connection down")

	server, hub, guests := setupRealtimeTestServer(mock)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Guest A")
	defer conn.Close(websocket.StatusNormalClosure, "done")

	cmdPayload, _ := json.Marshal(map[string]string{
		"video_id": "dQw4w9WgXcQ",
		"title":    "Track Title",
		"channel":  "Channel",
	})
	if err := wsjson.Write(ctx, conn, Envelope{
		Type:    "youtube.pick.create",
		Version: 1,
		EventID: uuid.NewString(),
		RoomID:  room.ID,
		Payload: cmdPayload,
	}); err != nil {
		t.Fatalf("write pick create: %v", err)
	}

	var errResp Envelope
	if err := wsjson.Read(ctx, conn, &errResp); err != nil {
		t.Fatalf("read error event: %v", err)
	}
	if errResp.Type != "error" {
		t.Fatalf("expected error event, got %s", errResp.Type)
	}
	var errData struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(errResp.Payload, &errData)
	if errData.Code != "YOUTUBE_PICK_REJECTED" {
		t.Fatalf("expected code YOUTUBE_PICK_REJECTED, got %s", errData.Code)
	}

	// Verify in-memory state remained completely pristine
	hub.mu.Lock()
	defer hub.mu.Unlock()
	state := hub.rooms[room.ID]
	if state == nil {
		t.Fatal("room state not found")
	}
	if len(state.picks) != 0 {
		t.Fatalf("in-memory picks state diverged on DB failure: %d picks present", len(state.picks))
	}
}

func TestWebSocketPickCreateCapacityLimit(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Picks Capacity", AllowGuests: true}
	mock := newYouTubeRealtimeMockStore(room)

	server, hub, guests := setupRealtimeTestServer(mock)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Guest A")
	defer conn.Close(websocket.StatusNormalClosure, "done")

	// Pre-fill 50 active picks in memory
	hub.mu.Lock()
	state := hub.rooms[room.ID]
	for i := 0; i < store.MaxActivePicks; i++ {
		state.picks = append(state.picks, youtubeRoomPick{
			ID:          uuid.NewString(),
			VideoID:     fmt.Sprintf("vid_%05d", i),
			Title:       fmt.Sprintf("Track %d", i),
			Channel:     "Channel",
			SuggestedBy: "other",
			Votes:       0,
			Voters:      make(map[string]struct{}),
		})
	}
	hub.mu.Unlock()

	cmdPayload, _ := json.Marshal(map[string]string{
		"video_id": "dQw4w9WgXcQ",
		"title":    "Track 51",
		"channel":  "Channel",
	})
	if err := wsjson.Write(ctx, conn, Envelope{
		Type:    "youtube.pick.create",
		Version: 1,
		EventID: uuid.NewString(),
		RoomID:  room.ID,
		Payload: cmdPayload,
	}); err != nil {
		t.Fatalf("write pick create: %v", err)
	}

	var errResp Envelope
	if err := wsjson.Read(ctx, conn, &errResp); err != nil {
		t.Fatalf("read error event: %v", err)
	}
	if errResp.Type != "error" {
		t.Fatalf("expected error event, got %s", errResp.Type)
	}
	var errData struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(errResp.Payload, &errData)
	if errData.Code != "YOUTUBE_PICK_REJECTED" || !strings.Contains(errData.Message, "capacity reached") {
		t.Fatalf("expected capacity rejection, got: %+v", errData)
	}

	hub.mu.Lock()
	defer hub.mu.Unlock()
	if len(state.picks) != store.MaxActivePicks {
		t.Fatalf("expected picks to remain at %d, got %d", store.MaxActivePicks, len(state.picks))
	}
}

func TestWebSocketPickVoteDBPersistenceFailure(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Picks Vote", AllowGuests: true}
	mock := newYouTubeRealtimeMockStore(room)
	mock.voteErr = errors.New("db error on vote")

	server, hub, guests := setupRealtimeTestServer(mock)
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Guest A")
	defer conn.Close(websocket.StatusNormalClosure, "done")

	pickID := uuid.NewString()
	hub.mu.Lock()
	state := hub.rooms[room.ID]
	state.picks = append(state.picks, youtubeRoomPick{
		ID:          pickID,
		VideoID:     "dQw4w9WgXcQ",
		Title:       "Rick Astley",
		Channel:     "Rick Astley",
		SuggestedBy: "other",
		Votes:       0,
		Voters:      make(map[string]struct{}),
	})
	hub.mu.Unlock()

	cmdPayload, _ := json.Marshal(map[string]string{
		"pick_id": pickID,
	})
	if err := wsjson.Write(ctx, conn, Envelope{
		Type:    "youtube.pick.vote",
		Version: 1,
		EventID: uuid.NewString(),
		RoomID:  room.ID,
		Payload: cmdPayload,
	}); err != nil {
		t.Fatalf("write pick vote: %v", err)
	}

	var errResp Envelope
	if err := wsjson.Read(ctx, conn, &errResp); err != nil {
		t.Fatalf("read error event: %v", err)
	}
	if errResp.Type != "error" {
		t.Fatalf("expected error event, got %s", errResp.Type)
	}

	// Verify in-memory pick was NOT voted on
	hub.mu.Lock()
	defer hub.mu.Unlock()
	for _, p := range state.picks {
		if p.ID == pickID {
			if p.Votes != 0 || len(p.Voters) != 0 {
				t.Fatalf("in-memory vote count diverged after DB failure: votes=%d voters=%+v", p.Votes, p.Voters)
			}
		}
	}
}

func TestAutoplayPickRestorationOnRollback(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Autoplay Rollback", AllowGuests: true}
	mock := newYouTubeRealtimeMockStore(room)

	hub := New(mock, nil, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil)))

	pickID := uuid.NewString()
	testPick := youtubeRoomPick{
		ID:          pickID,
		VideoID:     "dQw4w9WgXcQ",
		Title:       "Test Track",
		Channel:     "Test Channel",
		SuggestedBy: "suggested",
		Votes:       5,
		Voters:      map[string]struct{}{"user1": {}},
	}

	hub.mu.Lock()
	state := &roomState{
		room:    room,
		clients: make(map[string]*client),
		picks:   []youtubeRoomPick{testPick},
		media: mediaState{
			Autoplay: true,
			Version:  1,
		},
	}
	hub.rooms[room.ID] = state
	hub.mu.Unlock()

	// Simulate media command that pops best pick and sets it as current
	hub.mu.Lock()
	previousState := state.media.snapshot()
	bestPick := state.picks[0]
	state.picks = state.picks[1:]
	state.media.Current = &youtubeTrack{ID: uuid.NewString(), VideoID: bestPick.VideoID, Title: bestPick.Title}
	state.media.Version++
	newVersion := state.media.Version
	hub.mu.Unlock()

	// Simulate rollback due to ErrMediaOwnerLost
	hub.rollbackMediaState(room.ID, newVersion, previousState)
	hub.mu.Lock()
	if s := hub.rooms[room.ID]; s != nil {
		s.picks = append([]youtubeRoomPick{bestPick}, s.picks...)
	}
	hub.mu.Unlock()

	// Verify pick is safely restored
	hub.mu.Lock()
	defer hub.mu.Unlock()
	if len(state.picks) != 1 || state.picks[0].ID != pickID {
		t.Fatalf("pick was not restored on rollback: %+v", state.picks)
	}
	if state.media.Current != nil {
		t.Fatalf("media was not rolled back: %+v", state.media)
	}
}
