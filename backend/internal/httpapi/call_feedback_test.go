package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
)

type feedbackFixture struct {
	fakeStore
	saved []domain.CallFeedback
}

func (f *feedbackFixture) InsertCallFeedback(_ context.Context, feedback domain.CallFeedback) error {
	f.saved = append(f.saved, feedback)
	return nil
}
func (f *feedbackFixture) CallQualitySummary(context.Context, time.Time) (domain.CallQualitySummary, error) {
	return domain.CallQualitySummary{}, nil
}

func TestCallFeedbackFromGuestAfterRoomEnded(t *testing.T) {
	const roomID = "58bb9fe4-79bc-41c7-9d63-61c04815b668"
	guests := auth.NewGuestTokens("12345678901234567890123456789012", time.Hour)
	fixture := &feedbackFixture{fakeStore: fakeStore{room: domain.Room{ID: roomID, AllowGuests: true}}}
	server := New(fixture, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", ""), guests, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	routes := server.Routes(http.NotFoundHandler())
	token, _, _, err := guests.Issue(roomID, "Guest")
	if err != nil {
		t.Fatal(err)
	}
	other, _, _, _ := guests.Issue("11111111-1111-1111-1111-111111111111", "Elsewhere")
	post := func(guest, body string) int {
		r := httptest.NewRequest("POST", "/api/v1/rooms/"+roomID+"/call-feedback", strings.NewReader(body))
		r.Header.Set("X-Guest-Token", guest)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		routes.ServeHTTP(w, r)
		return w.Code
	}
	valid := `{"rating":2,"tags":["echo","echo","lag"],"duration_seconds":600,"samples_good":100,"samples_poor":20,"samples_lost":0,"reconnects":1}`
	if code := post(other, valid); code != http.StatusUnauthorized {
		t.Fatalf("guest from another room accepted: %d", code)
	}
	for _, bad := range []string{
		`{"rating":6,"tags":[],"duration_seconds":1}`,
		`{"rating":3,"tags":["<script>"],"duration_seconds":1}`,
		`{"rating":3,"tags":[],"duration_seconds":-1}`,
	} {
		if code := post(token, bad); code != http.StatusBadRequest {
			t.Fatalf("invalid feedback %s accepted: %d", bad, code)
		}
	}
	if code := post(token, valid); code != http.StatusNoContent {
		t.Fatalf("valid feedback rejected: %d", code)
	}
	if len(fixture.saved) != 1 || len(fixture.saved[0].Tags) != 2 || fixture.saved[0].Identity.Type != domain.IdentityGuest || fixture.saved[0].RoomID != roomID {
		t.Fatalf("unexpected saved feedback: %+v", fixture.saved)
	}
}
