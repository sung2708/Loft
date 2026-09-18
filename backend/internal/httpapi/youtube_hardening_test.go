package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/store"
)

type youtubeMockStore struct {
	*fakeStore
	mu        sync.Mutex
	rooms     map[string]domain.Room
	picks     map[string]store.YouTubeRoomPick
	voters    map[string]map[string]bool
	createErr error
	voteErr   error
	settings  map[string]store.YouTubeMediaSettings
}

func newYouTubeMockStore() *youtubeMockStore {
	return &youtubeMockStore{
		fakeStore: &fakeStore{},
		rooms:     make(map[string]domain.Room),
		picks:     make(map[string]store.YouTubeRoomPick),
		voters:    make(map[string]map[string]bool),
		settings:  make(map[string]store.YouTubeMediaSettings),
	}
}

func (s *youtubeMockStore) GetRoom(_ context.Context, identifier string) (domain.Room, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range s.rooms {
		if r.ID == identifier || r.Slug == identifier {
			return r, nil
		}
	}
	if s.room.ID == identifier || s.room.Slug == identifier {
		return s.room, nil
	}
	return domain.Room{}, domain.ErrNotFound
}

func (s *youtubeMockStore) CreateRoomPick(_ context.Context, pick store.YouTubeRoomPick) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.createErr != nil {
		return s.createErr
	}
	activeCount := 0
	for _, p := range s.picks {
		if p.RoomID == pick.RoomID && p.Active {
			activeCount++
			if p.VideoID == pick.VideoID {
				return domain.ErrConflict
			}
		}
	}
	if activeCount >= store.MaxActivePicks {
		return store.ErrPickCapacityReached
	}
	s.picks[pick.ID] = pick
	return nil
}

func (s *youtubeMockStore) ListRoomPicks(_ context.Context, roomID string) ([]store.YouTubeRoomPick, error) {
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

func (s *youtubeMockStore) ListRoomPickVoters(_ context.Context, roomID string) (map[string][]string, error) {
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

func (s *youtubeMockStore) VoteRoomPick(_ context.Context, roomID, pickID, userID string) error {
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

func (s *youtubeMockStore) PromoteRoomPick(_ context.Context, roomID, pickID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.picks[pickID]
	if !ok || p.RoomID != roomID || !p.Active {
		return domain.ErrNotFound
	}
	p.Active = false
	s.picks[pickID] = p
	return nil
}

func (s *youtubeMockStore) SetAutoplay(_ context.Context, settings store.YouTubeMediaSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.settings[settings.RoomID] = settings
	return nil
}

func (s *youtubeMockStore) GetMediaSettings(_ context.Context, roomID string) (store.YouTubeMediaSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.settings[roomID]
	if !ok {
		return store.YouTubeMediaSettings{RoomID: roomID, AutoplayEnabled: false}, nil
	}
	return st, nil
}

func setupYouTubeTestServer(mock *youtubeMockStore) (http.Handler, string, *auth.SupabaseVerifier, *auth.GuestTokens) {
	secret := "01234567890123456789012345678901"
	users := auth.NewSupabaseVerifier("https://example.supabase.co", "authenticated", secret)
	guests := auth.NewGuestTokens(secret, time.Hour)
	livekitSvc := livekit.New("", "")
	srv := New(mock, users, guests, livekitSvc, []string{"http://localhost:3000"}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return srv.Routes(http.NotFoundHandler()), secret, users, guests
}

func generateUserToken(secret, userID string) string {
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"iss":  "https://example.supabase.co/auth/v1",
		"sub":  userID,
		"aud":  "authenticated",
		"role": "authenticated",
		"exp":  time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte(secret))
	return token
}

func extractErrorCode(t *testing.T, body []byte) string {
	t.Helper()
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("failed to parse error response: %v, body: %s", err, string(body))
	}
	return resp.Error.Code
}

func TestYouTubePicksCrossRoomVoteIDOR(t *testing.T) {
	mock := newYouTubeMockStore()
	srv, secret, _, _ := setupYouTubeTestServer(mock)

	roomAID := uuid.NewString()
	roomBID := uuid.NewString()
	userID := uuid.NewString()

	mock.rooms[roomAID] = domain.Room{ID: roomAID, Name: "Room A", AllowGuests: true}
	mock.rooms[roomBID] = domain.Room{ID: roomBID, Name: "Room B", AllowGuests: true}

	pickID := uuid.NewString()
	mock.picks[pickID] = store.YouTubeRoomPick{
		ID:          pickID,
		RoomID:      roomAID,
		VideoID:     "dQw4w9WgXcQ",
		Title:       "Never Gonna Give You Up",
		Channel:     "Rick Astley",
		SuggestedBy: userID,
		Active:      true,
	}

	token := generateUserToken(secret, userID)

	// Attempt to vote on pickID (which belongs to Room A) using Room B's endpoint
	payload, _ := json.Marshal(map[string]string{"pick_id": pickID})
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks/vote", roomBID), bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404 for cross-room IDOR vote, got %d: %s", w.Code, w.Body.String())
	}
	if code := extractErrorCode(t, w.Body.Bytes()); code != "PICK_NOT_FOUND" {
		t.Fatalf("expected error code PICK_NOT_FOUND, got %q", code)
	}

	// Vote on Room A's endpoint should succeed
	reqA := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks/vote", roomAID), bytes.NewReader(payload))
	reqA.Header.Set("Authorization", "Bearer "+token)
	reqA.Header.Set("Content-Type", "application/json")
	wA := httptest.NewRecorder()

	srv.ServeHTTP(wA, reqA)

	if wA.Code != http.StatusOK {
		t.Fatalf("expected status 200 for valid room vote, got %d: %s", wA.Code, wA.Body.String())
	}
}

func TestYouTubePicksCapacityLimit(t *testing.T) {
	mock := newYouTubeMockStore()
	srv, secret, _, _ := setupYouTubeTestServer(mock)

	roomID := uuid.NewString()
	userID := uuid.NewString()
	mock.rooms[roomID] = domain.Room{ID: roomID, Name: "Room Capacity", AllowGuests: true}
	token := generateUserToken(secret, userID)

	// Populate 50 active picks
	for i := 0; i < store.MaxActivePicks; i++ {
		pID := uuid.NewString()
		mock.picks[pID] = store.YouTubeRoomPick{
			ID:          pID,
			RoomID:      roomID,
			VideoID:     fmt.Sprintf("video_%05d", i),
			Title:       fmt.Sprintf("Track %d", i),
			Channel:     "Artist",
			SuggestedBy: userID,
			Active:      true,
		}
	}

	// Attempt to create 51st pick
	payload, _ := json.Marshal(map[string]string{
		"VideoID": "dQw4w9WgXcQ",
		"Title":   "Track 51",
		"Channel": "Artist",
	})
	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	srv.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected status 409 ROOM_PICKS_FULL on capacity limit, got %d: %s", w.Code, w.Body.String())
	}
	if code := extractErrorCode(t, w.Body.Bytes()); code != "ROOM_PICKS_FULL" {
		t.Fatalf("expected error code ROOM_PICKS_FULL, got %q", code)
	}
}

func TestYouTubePicksAlreadyVoted(t *testing.T) {
	mock := newYouTubeMockStore()
	srv, secret, _, _ := setupYouTubeTestServer(mock)

	roomID := uuid.NewString()
	userID := uuid.NewString()
	mock.rooms[roomID] = domain.Room{ID: roomID, Name: "Room Votes", AllowGuests: true}
	token := generateUserToken(secret, userID)

	pickID := uuid.NewString()
	mock.picks[pickID] = store.YouTubeRoomPick{
		ID:          pickID,
		RoomID:      roomID,
		VideoID:     "dQw4w9WgXcQ",
		Title:       "Never Gonna Give You Up",
		Channel:     "Rick Astley",
		SuggestedBy: userID,
		Active:      true,
	}

	payload, _ := json.Marshal(map[string]string{"pick_id": pickID})

	// Vote 1: success
	req1 := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks/vote", roomID), bytes.NewReader(payload))
	req1.Header.Set("Authorization", "Bearer "+token)
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	srv.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("vote 1 failed: %d %s", w1.Code, w1.Body.String())
	}

	// Vote 2: conflict
	req2 := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks/vote", roomID), bytes.NewReader(payload))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	srv.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("vote 2 expected 409 conflict, got %d: %s", w2.Code, w2.Body.String())
	}
	if code := extractErrorCode(t, w2.Body.Bytes()); code != "ALREADY_VOTED" {
		t.Fatalf("expected error code ALREADY_VOTED, got %q", code)
	}
}

func TestYouTubePicksDuplicateVideo(t *testing.T) {
	mock := newYouTubeMockStore()
	srv, secret, _, _ := setupYouTubeTestServer(mock)

	roomID := uuid.NewString()
	userID := uuid.NewString()
	mock.rooms[roomID] = domain.Room{ID: roomID, Name: "Room Duplicate", AllowGuests: true}
	token := generateUserToken(secret, userID)

	payload, _ := json.Marshal(map[string]string{
		"VideoID": "dQw4w9WgXcQ",
		"Title":   "Track 1",
		"Channel": "Artist",
	})

	// Add 1
	req1 := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), bytes.NewReader(payload))
	req1.Header.Set("Authorization", "Bearer "+token)
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	srv.ServeHTTP(w1, req1)
	if w1.Code != http.StatusCreated {
		t.Fatalf("pick 1 creation failed: %d %s", w1.Code, w1.Body.String())
	}

	// Add duplicate
	req2 := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), bytes.NewReader(payload))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	srv.ServeHTTP(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("duplicate pick expected 409, got %d: %s", w2.Code, w2.Body.String())
	}
	if code := extractErrorCode(t, w2.Body.Bytes()); code != "DUPLICATE_PICK" {
		t.Fatalf("expected error code DUPLICATE_PICK, got %q", code)
	}
}

func TestYouTubePicksPrivateRoomAuthorization(t *testing.T) {
	mock := newYouTubeMockStore()
	srv, secret, _, guests := setupYouTubeTestServer(mock)

	roomID := uuid.NewString()
	ownerID := uuid.NewString()
	mock.rooms[roomID] = domain.Room{
		ID:          roomID,
		Name:        "Private Room",
		OwnerID:     ownerID,
		AllowGuests: false,
	}

	// Guest token for roomID should be rejected since AllowGuests is false
	guestTok, _, _, err := guests.Issue(roomID, "Guest User")
	if err != nil {
		t.Fatalf("failed to issue guest token: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), nil)
	req.Header.Set("X-Guest-Token", guestTok)
	w := httptest.NewRecorder()

	srv.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized for guest in private room, got %d: %s", w.Code, w.Body.String())
	}

	// Non-member user without membership in private room
	nonMemberID := uuid.NewString()
	nonMemberToken := generateUserToken(secret, nonMemberID)

	reqUser := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), nil)
	reqUser.Header.Set("Authorization", "Bearer "+nonMemberToken)
	wUser := httptest.NewRecorder()

	srv.ServeHTTP(wUser, reqUser)

	if wUser.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 unauthorized for non-member in private room, got %d: %s", wUser.Code, wUser.Body.String())
	}

	// Room owner should succeed
	ownerToken := generateUserToken(secret, ownerID)
	reqOwner := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/rooms/%s/youtube/picks", roomID), nil)
	reqOwner.Header.Set("Authorization", "Bearer "+ownerToken)
	wOwner := httptest.NewRecorder()

	srv.ServeHTTP(wOwner, reqOwner)

	if wOwner.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for owner in private room, got %d: %s", wOwner.Code, wOwner.Body.String())
	}
}
