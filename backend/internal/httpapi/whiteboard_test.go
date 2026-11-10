package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
	"loft/backend/internal/store"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type boardTestStore struct {
	*fakeStore
	mu    sync.Mutex
	board store.BoardSnapshot
	loads int
}

type failingBoardRoomStore struct{ *boardTestStore }

func (s *failingBoardRoomStore) GetRoom(context.Context, string) (domain.Room, error) {
	return domain.Room{}, errors.New("database unavailable")
}

func (s *boardTestStore) BoardVersion(context.Context, string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.board.Version, nil
}
func (s *boardTestStore) LoadBoard(context.Context, string) (store.BoardSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.loads++
	return s.board, nil
}
func (s *boardTestStore) PatchBoard(_ context.Context, _ string, patch store.BoardPatch) (store.BoardSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next, err := store.ApplyBoardPatch(s.board, patch)
	if err == nil {
		s.board = next
	}
	return next, err
}
func TestWhiteboardRequiresRoomCredentialAndCAS(t *testing.T) {
	room := domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", AllowGuests: true}
	repo := &boardTestStore{fakeStore: &fakeStore{room: room}, board: store.BoardSnapshot{Records: map[string]json.RawMessage{}}}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, err := guests.Issue(room.ID, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	server := New(repo, nil, guests, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	handler := server.Routes(http.NotFoundHandler())
	call := func(method, body, credential string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/v1/rooms/"+room.ID+"/whiteboard", strings.NewReader(body))
		if credential != "" {
			req.Header.Set("X-Guest-Token", credential)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	// Guest credential from another room cannot read or modify this board.
	other, _, _, _ := guests.Issue("other-room", "Bob")
	if got := call("GET", "", other); got.Code != 401 {
		t.Fatalf("cross-room access allowed: %d", got.Code)
	}
	raw, err := os.ReadFile("../store/testdata/board_records.json")
	if err != nil {
		t.Fatal(err)
	}
	var records []json.RawMessage
	if err = json.Unmarshal(raw, &records); err != nil {
		t.Fatal(err)
	}
	patch := `{"version":0,"put":[` + strings.Replace(string(records[0]), "shape:draw", "shape:a", 1) + `],"remove":[]}`
	if got := call("PATCH", patch, token); got.Code != 200 {
		t.Fatalf("save failed: %d %s", got.Code, got.Body.String())
	}
	if got := call("PATCH", patch, token); got.Code != 409 {
		t.Fatalf("stale write accepted: %d", got.Code)
	}
	if got := call("PATCH", `{"version":1,"put":[],"remove":[]} {}`, token); got.Code != 400 {
		t.Fatalf("trailing JSON accepted: %d", got.Code)
	}
	if got := call("PATCH", `{"version":1,"put":[],"remove":[]}`+strings.Repeat(" ", 256<<10), token); got.Code != 400 {
		t.Fatalf("oversized trailing data accepted: %d", got.Code)
	}
	if got := call("PATCH", `{"version":1,"put":[{"id":"shape:asset","typeName":"shape","type":"image"}],"remove":[]}`, token); got.Code != 400 {
		t.Fatalf("unsafe content accepted: %d", got.Code)
	}
	if got := call("GET", "", token); got.Code != 200 || !strings.Contains(got.Body.String(), "shape:a") {
		t.Fatal("saved snapshot missing")
	}
}

func TestWhiteboardConditionalReadAvoidsSnapshotLoad(t *testing.T) {
	room := domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", AllowGuests: true}
	repo := &boardTestStore{fakeStore: &fakeStore{room: room}, board: store.BoardSnapshot{Version: 7, Records: map[string]json.RawMessage{}}}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, err := guests.Issue(room.ID, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	server := New(repo, nil, guests, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/"+room.ID+"/whiteboard", nil)
	request.Header.Set("X-Guest-Token", token)
	request.Header.Set("If-None-Match", `"board-7"`)
	response := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != http.StatusNotModified || response.Body.Len() != 0 || repo.loads != 0 {
		t.Fatalf("unchanged board loaded: status=%d bytes=%d loads=%d", response.Code, response.Body.Len(), repo.loads)
	}
	request.Header.Set("If-None-Match", `"board-6"`)
	response = httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != http.StatusOK || response.Header().Get("ETag") != `"board-7"` || repo.loads != 1 {
		t.Fatal("changed snapshot not returned")
	}
}

func TestWhiteboardRoomLookupFailureIsServerError(t *testing.T) {
	room := domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", AllowGuests: true}
	repo := &failingBoardRoomStore{&boardTestStore{fakeStore: &fakeStore{room: room}}}
	server := New(repo, nil, auth.NewGuestTokens("12345678901234567890123456789012", time.Hour), livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodGet, "/api/v1/rooms/"+room.ID+"/whiteboard", nil)
	response := httptest.NewRecorder()
	server.Routes(http.NotFoundHandler()).ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("room lookup failure returned %d", response.Code)
	}
}

func TestWhiteboardMinimalAckOmitsSnapshot(t *testing.T) {
	room := domain.Room{ID: "58bb9fe4-79bc-41c7-9d63-61c04815b668", AllowGuests: true}
	repo := &boardTestStore{fakeStore: &fakeStore{room: room}, board: store.BoardSnapshot{Records: map[string]json.RawMessage{}}}
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	token, _, _, err := guests.Issue(room.ID, "Alice")
	if err != nil {
		t.Fatal(err)
	}
	server := New(repo, nil, guests, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	handler := server.Routes(http.NotFoundHandler())
	raw, err := os.ReadFile("../store/testdata/board_records.json")
	if err != nil {
		t.Fatal(err)
	}
	var records []json.RawMessage
	if err = json.Unmarshal(raw, &records); err != nil {
		t.Fatal(err)
	}
	patch := func(version int, id, query string) *httptest.ResponseRecorder {
		body := `{"version":` + strconv.Itoa(version) + `,"put":[` + strings.Replace(string(records[0]), "shape:draw", id, 1) + `],"remove":[]}`
		req := httptest.NewRequest("PATCH", "/api/v1/rooms/"+room.ID+"/whiteboard"+query, strings.NewReader(body))
		req.Header.Set("X-Guest-Token", token)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		return response
	}
	got := patch(0, "shape:a", "?ack=minimal")
	if got.Code != 200 || strings.TrimSpace(got.Body.String()) != `{"version":1}` {
		t.Fatalf("minimal ack not returned: %d %s", got.Code, got.Body.String())
	}
	// Legacy clients still receive the full snapshot.
	got = patch(1, "shape:b", "")
	if got.Code != 200 || !strings.Contains(got.Body.String(), "shape:a") || !strings.Contains(got.Body.String(), "shape:b") {
		t.Fatalf("full snapshot missing: %d %s", got.Code, got.Body.String())
	}
	// A stale minimal writer still gets the authoritative snapshot on conflict.
	got = patch(1, "shape:c", "?ack=minimal")
	if got.Code != 409 || !strings.Contains(got.Body.String(), "shape:b") {
		t.Fatalf("conflict snapshot missing: %d %s", got.Code, got.Body.String())
	}
}
