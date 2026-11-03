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
	mu          sync.Mutex
	picks       map[string]store.YouTubeRoomPick
	voters      map[string]map[string]bool
	createErr   error
	voteErr     error
	promErr     error
	settingsErr error
	settings    store.YouTubeMediaSettings
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

func (s *youtubeRealtimeMockStore) SetAutoplay(_ context.Context, settings store.YouTubeMediaSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settingsErr != nil {
		return s.settingsErr
	}
	s.settings = settings
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

func TestWebSocketDuplicatePickVoteKeepsServerAlive(t *testing.T) {
	room := domain.Room{ID: uuid.NewString(), Name: "Picks Vote", AllowGuests: true}
	server, hub, guests := setupRealtimeTestServer(newYouTubeRealtimeMockStore(room))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn := connectAndAuthGuest(t, ctx, server.URL, guests, room.ID, "Guest A")
	defer conn.Close(websocket.StatusNormalClosure, "done")
	pickID := uuid.NewString()
	hub.mu.Lock()
	state := hub.rooms[room.ID]
	var voter string
	for _, participant := range state.clients {
		voter = participant.identity.ID
	}
	state.picks = append(state.picks, youtubeRoomPick{ID: pickID, Voters: map[string]struct{}{voter: {}}, Votes: 1})
	hub.mu.Unlock()
	payload, _ := json.Marshal(map[string]string{"pick_id": pickID})
	if err := wsjson.Write(ctx, conn, Envelope{Type: "youtube.pick.vote", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: payload}); err != nil {
		t.Fatal(err)
	}
	var response Envelope
	if err := wsjson.Read(ctx, conn, &response); err != nil || response.Type != "error" || !strings.Contains(string(response.Payload), "already voted") {
		t.Fatalf("duplicate vote response: event=%+v err=%v", response, err)
	}
	if err := wsjson.Write(ctx, conn, Envelope{Type: "connection.ping", Version: 1, EventID: uuid.NewString(), RoomID: room.ID, Payload: json.RawMessage(`{"client_time":1}`)}); err != nil {
		t.Fatal(err)
	}
	if err := wsjson.Read(ctx, conn, &response); err != nil || response.Type != "connection.pong" {
		t.Fatalf("socket stopped after duplicate vote: event=%+v err=%v", response, err)
	}
}

func TestForwardedAutoplayCommitsBeforeRemovingPick(t *testing.T) {
	for _, rejected := range []bool{false, true} {
		t.Run(fmt.Sprint(rejected), func(t *testing.T) {
			room := domain.Room{ID: "autoplay", OwnerID: "owner"}
			repo := newYouTubeRealtimeMockStore(room)
			repo.picks["best"] = store.YouTubeRoomPick{ID: "best", RoomID: room.ID, VideoID: "9bZkp7q19f0", Active: true, Votes: 3}
			hub := New(repo, nil, nil, nil, nil)
			bus := &mediaAuthorityStub{}
			if rejected {
				bus.commitErr = ErrMediaOwnerLost
			}
			hub.SetBus(bus)
			listener := &client{id: "listener", roomID: room.ID, send: make(chan []byte, 16)}
			state := &roomState{room: room, clients: map[string]*client{listener.id: listener}, media: mediaState{Current: &youtubeTrack{ID: "old", VideoID: "dQw4w9WgXcQ"}, Status: "PLAYING", Version: 1, Autoplay: true}, picks: []youtubeRoomPick{{ID: "other", VideoID: "M7lc1UVf-VE", Votes: 1}, {ID: "best", VideoID: "9bZkp7q19f0", Votes: 3}}}
			hub.rooms[room.ID] = state
			payload, _ := json.Marshal(mediaCommand{ExpectedVersion: 1})
			response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "queue.next", Payload: payload, Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			if rejected {
				if response.Error == "" || state.media.Current.ID != "old" || len(state.picks) != 2 || !repo.picks["best"].Active {
					t.Fatalf("rejected selection leaked: %+v %+v", state.media, state.picks)
				}
			} else {
				if response.Error != "" || state.media.Current.VideoID != "9bZkp7q19f0" || state.media.Status != "PLAYING" || state.media.Version != 2 || len(state.picks) != 1 || repo.picks["best"].Active {
					t.Fatalf("forwarded autoplay failed: %s %+v", response.Error, state.media)
				}
			}
			for len(listener.send) > 0 {
				var message Envelope
				json.Unmarshal(<-listener.send, &message)
				if rejected && message.Type == "youtube.pick.promoted" {
					t.Fatal("uncommitted pick announced")
				}
			}
		})
	}
}

func TestTimerAutoplayUsesSamePickSelection(t *testing.T) {
	room := domain.Room{ID: "timer-autoplay", OwnerID: "owner"}
	repo := newYouTubeRealtimeMockStore(room)
	repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, VideoID: "9bZkp7q19f0", Active: true}
	hub := New(repo, nil, nil, nil, nil)
	listener := &client{id: "listener", send: make(chan []byte, 16)}
	state := &roomState{room: room, mediaOwner: true, clients: map[string]*client{listener.id: listener}, media: mediaState{Current: &youtubeTrack{ID: "old", VideoID: "dQw4w9WgXcQ", DurationSec: 1}, Status: "PLAYING", StartedAt: time.Now().Add(-990 * time.Millisecond), Version: 4, Autoplay: true}, picks: []youtubeRoomPick{{ID: "pick", VideoID: "9bZkp7q19f0"}}}
	hub.mu.Lock()
	hub.rooms[room.ID] = state
	hub.scheduleMediaEnd(room.ID, state)
	hub.mu.Unlock()
	timer := time.NewTimer(time.Second)
	defer timer.Stop()
	for {
		select {
		case data := <-listener.send:
			var message Envelope
			json.Unmarshal(data, &message)
			if message.Type == "youtube.pick.promoted" {
				hub.mu.RLock()
				media := state.media.snapshot()
				remaining := len(state.picks)
				hub.mu.RUnlock()
				if media.Current == nil || media.Current.VideoID != "9bZkp7q19f0" || media.Version != 5 || remaining != 0 {
					t.Fatalf("timer autoplay failed: %+v", media)
				}
				repo.mu.Lock()
				active := repo.picks["pick"].Active
				repo.mu.Unlock()
				if active {
					t.Fatal("pick was not persisted")
				}
				return
			}
		case <-timer.C:
			t.Fatal("autoplay did not advance")
		}
	}
}

func TestForwardedAutoplayPersistsOnlyAfterCommit(t *testing.T) {
	for _, rejected := range []bool{false, true} {
		t.Run(fmt.Sprint(rejected), func(t *testing.T) {
			room := domain.Room{ID: "settings", OwnerID: "owner"}
			repo := newYouTubeRealtimeMockStore(room)
			hub := New(repo, nil, nil, nil, nil)
			bus := &mediaAuthorityStub{}
			if rejected {
				bus.commitErr = ErrMediaOwnerLost
			}
			hub.SetBus(bus)
			hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "IDLE"}}
			response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "media.autoplay.set", Payload: json.RawMessage(`{"autoplay":true,"expected_version":0}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			if rejected {
				if response.Error == "" || repo.settings.AutoplayEnabled {
					t.Fatal("rejected setting persisted")
				}
			} else if response.Error != "" || !repo.settings.AutoplayEnabled || repo.settings.UpdatedBy != "owner" {
				t.Fatalf("forwarded setting not saved: %+v %s", repo.settings, response.Error)
			}
		})
	}
}

func TestManualPickPromotionPreservesPickOnFenceAndDatabaseFailures(t *testing.T) {
	for _, failure := range []string{"fence", "database", "queue-full", "success"} {
		t.Run(failure, func(t *testing.T) {
			room := domain.Room{ID: "promote", OwnerID: "owner"}
			repo := newYouTubeRealtimeMockStore(room)
			pick := youtubeRoomPick{ID: "pick", VideoID: "dQw4w9WgXcQ"}
			repo.picks[pick.ID] = store.YouTubeRoomPick{ID: pick.ID, RoomID: room.ID, Active: true}
			hub := New(repo, nil, nil, nil, nil)
			initial := mediaState{Status: "PAUSED", Current: &youtubeTrack{ID: "old", VideoID: "aaaaaaaaaaa"}}
			if failure == "queue-full" {
				initial.Queue = make([]youtubeTrack, 50)
			}
			hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: initial, picks: []youtubeRoomPick{pick}}
			if failure == "fence" {
				hub.SetBus(&mediaAuthorityStub{commitErr: ErrMediaOwnerLost})
			}
			if failure == "database" {
				repo.promErr = errors.New("database unavailable")
			}
			response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "youtube.pick.promote", Payload: json.RawMessage(`{"pick_id":"pick"}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			state := hub.rooms[room.ID]
			if failure == "success" {
				if response.Error != "" || len(state.picks) != 0 || repo.picks[pick.ID].Active || state.media.Current.VideoID != pick.VideoID {
					t.Fatal("promotion failed", response)
				}
			} else if response.Error == "" || len(state.picks) != 1 || !repo.picks[pick.ID].Active || state.media.Current.ID != "old" {
				t.Fatalf("failed promotion lost selection: %+v %+v", response, state.media)
			}
		})
	}
}
func TestAutoplayPersistenceFailureRestoresSettingAndSelection(t *testing.T) {
	for _, failure := range []string{"settings", "pick"} {
		t.Run(failure, func(t *testing.T) {
			room := domain.Room{ID: "autoplay-failure", OwnerID: "owner"}
			repo := newYouTubeRealtimeMockStore(room)
			hub := New(repo, nil, nil, nil, nil)
			state := &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "IDLE"}}
			hub.rooms[room.ID] = state
			kind := "media.autoplay.set"
			payload := json.RawMessage(`{"autoplay":true}`)
			if failure == "settings" {
				repo.settingsErr = errors.New("write failed")
			} else {
				repo.promErr = errors.New("write failed")
				state.media.Autoplay = true
				state.picks = []youtubeRoomPick{{ID: "pick", VideoID: "dQw4w9WgXcQ"}}
				repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, Active: true}
				kind = "queue.next"
				payload = json.RawMessage(`{"expected_version":0}`)
				state.media.Current = &youtubeTrack{ID: "old", VideoID: "aaaaaaaaaaa"}
			}
			previous := state.media.snapshot()
			response := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: kind, Payload: payload, Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
			if response.Error == "" || state.media.Autoplay != previous.Autoplay || state.media.Version != 2 {
				t.Fatalf("persistence failure hidden: %+v %+v", response, state.media)
			}
			if failure == "pick" && (len(state.picks) != 1 || !repo.picks["pick"].Active || state.media.Current.ID != "old") {
				t.Fatal("autoplay pick lost")
			}
		})
	}
}

func (s *youtubeRealtimeMockStore) CommitYouTubeSelection(_ context.Context, roomID string, settings *store.YouTubeMediaSettings, pickID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if settings != nil && s.settingsErr != nil {
		return s.settingsErr
	}
	if pickID != "" {
		if s.promErr != nil {
			return s.promErr
		}
		p, ok := s.picks[pickID]
		if !ok || !p.Active || p.RoomID != roomID {
			return domain.ErrNotFound
		}
	}
	if settings != nil {
		s.settings = *settings
	}
	if pickID != "" {
		p := s.picks[pickID]
		p.Active = false
		s.picks[pickID] = p
	}
	return nil
}
func TestAutoplaySettingAndSelectionFailTogether(t *testing.T) {
	room := domain.Room{ID: "atomic", OwnerID: "owner"}
	repo := newYouTubeRealtimeMockStore(room)
	repo.promErr = errors.New("write failed")
	repo.picks["pick"] = store.YouTubeRoomPick{ID: "pick", RoomID: room.ID, Active: true}
	hub := New(repo, nil, nil, nil, nil)
	hub.rooms[room.ID] = &roomState{room: room, clients: map[string]*client{}, media: mediaState{Status: "IDLE"}, picks: []youtubeRoomPick{{ID: "pick", VideoID: "dQw4w9WgXcQ"}}}
	result := hub.handleForwardedMedia(context.Background(), mediaRPCRequest{RoomID: room.ID, Kind: "media.autoplay.set", Payload: json.RawMessage(`{"autoplay":true}`), Actor: domain.Identity{ID: "owner", Type: domain.IdentityUser}})
	if result.Error == "" || repo.settings.AutoplayEnabled || hub.rooms[room.ID].media.Autoplay || !repo.picks["pick"].Active {
		t.Fatal("partial durable autoplay transition")
	}
}
