package httpapi

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"loft/backend/internal/auth"
	"loft/backend/internal/domain"
	"loft/backend/internal/livekit"
)

const (
	testSecret  = "12345678901234567890123456789012"
	testAdminID = "4ff036f8-834c-4cb5-9097-30710442e19e"
	testUserID  = "11111111-1111-4111-8111-111111111111"
	testOtherID = "22222222-2222-4222-8222-222222222222"
	testRoomID  = "33333333-3333-4333-8333-333333333333"
)

func signedToken(t *testing.T, userID, aal string) string {
	t.Helper()
	claims := jwt.MapClaims{"sub": userID, "iss": "https://test.supabase.co/auth/v1", "aud": "authenticated", "role": "authenticated", "exp": time.Now().Add(time.Hour).Unix()}
	if aal != "" {
		claims["aal"] = aal
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// reportFixture backs the admin, report, account and visit interfaces.
type reportFixture struct {
	adminFixture
	mu        sync.Mutex
	reports   []domain.Report
	resolved  map[int64]domain.ReportStatus
	audit     domain.AdminAuditFilter
	auditRows []domain.AdminAuditEntry
	scheduled map[string]time.Time
	settings  map[string]domain.ProfileSettings
	visits    []string
}

func newReportFixture() *reportFixture {
	room := domain.Room{ID: testRoomID, Slug: "123456", Name: "Hangout", OwnerID: testOtherID, AllowGuests: true}
	return &reportFixture{adminFixture: adminFixture{fakeStore: &fakeStore{room: room}}, resolved: map[int64]domain.ReportStatus{},
		scheduled: map[string]time.Time{}, settings: map[string]domain.ProfileSettings{}}
}

func (f *reportFixture) ActiveAccountBan(context.Context, string) (*domain.AccountBan, error) {
	return nil, nil
}
func (f *reportFixture) BanAccount(context.Context, domain.AccountBan) error { return nil }
func (f *reportFixture) LiftAccountBan(context.Context, string, string) error {
	return nil
}
func (f *reportFixture) ListAdminAudit(_ context.Context, filter domain.AdminAuditFilter, limit, _ int) ([]domain.AdminAuditEntry, int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.audit = filter
	return f.auditRows, len(f.auditRows), nil
}
func (f *reportFixture) CreateReport(_ context.Context, report domain.Report) (domain.Report, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, existing := range f.reports {
		if existing.ReporterID == report.ReporterID && existing.TargetID == report.TargetID && existing.Status == domain.ReportOpen {
			return domain.Report{}, domain.ErrConflict
		}
	}
	report.ID = int64(len(f.reports) + 1)
	report.Status = domain.ReportOpen
	f.reports = append(f.reports, report)
	return report, nil
}
func (f *reportFixture) ListReports(_ context.Context, status domain.ReportStatus, _, _ int) ([]domain.Report, int, error) {
	return f.reports, len(f.reports), nil
}
func (f *reportFixture) ResolveReport(_ context.Context, id int64, _ string, status domain.ReportStatus, _ string) (domain.Report, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id < 1 || int(id) > len(f.reports) {
		return domain.Report{}, domain.ErrNotFound
	}
	if _, done := f.resolved[id]; done {
		return domain.Report{}, domain.ErrConflict
	}
	f.resolved[id] = status
	report := f.reports[id-1]
	report.Status = status
	return report, nil
}
func (f *reportFixture) ProfileOverrides(context.Context, string) (domain.ProfileOverrides, error) {
	return domain.ProfileOverrides{}, nil
}
func (f *reportFixture) AccountProfile(_ context.Context, id string) (domain.AccountProfile, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	profile := domain.AccountProfile{ID: id, CustomDisplayName: f.settings[id].CustomDisplayName}
	if at, ok := f.scheduled[id]; ok {
		profile.DeletionScheduledFor = &at
	}
	return profile, nil
}
func (f *reportFixture) UpdateProfileSettings(_ context.Context, identity domain.Identity, settings domain.ProfileSettings) error {
	f.mu.Lock()
	f.settings[identity.ID] = settings
	f.mu.Unlock()
	return nil
}
func (f *reportFixture) ScheduleAccountDeletion(_ context.Context, id string, at time.Time) (time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if existing, ok := f.scheduled[id]; ok {
		return existing, nil
	}
	f.scheduled[id] = at
	return at, nil
}
func (f *reportFixture) CancelAccountDeletion(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.scheduled[id]; !ok {
		return domain.ErrNotFound
	}
	delete(f.scheduled, id)
	return nil
}
func (f *reportFixture) ExportAccount(_ context.Context, id string) (domain.AccountExport, error) {
	return domain.AccountExport{Profile: domain.AccountProfile{ID: id}}, nil
}
func (f *reportFixture) DueAccountDeletions(context.Context, time.Time, int) ([]domain.DueDeletion, error) {
	return nil, nil
}
func (f *reportFixture) OwnedRoomIDs(context.Context, string) ([]string, error) { return nil, nil }
func (f *reportFixture) PostponeAccountDeletion(context.Context, domain.DueDeletion, time.Time) error {
	return nil
}
func (f *reportFixture) PurgeAccount(context.Context, domain.DueDeletion, time.Time, []string) error {
	return nil
}
func (f *reportFixture) RecordRoomVisit(_ context.Context, userID, roomID string) error {
	f.mu.Lock()
	f.visits = append(f.visits, userID+":"+roomID)
	f.mu.Unlock()
	return nil
}
func (f *reportFixture) ListRecentRooms(context.Context, string, int) ([]domain.RecentRoom, error) {
	return []domain.RecentRoom{}, nil
}
func (f *reportFixture) ForgetRoomVisit(context.Context, string, string) error { return nil }

type reportAdmission struct{ fakeDeletionGuard }

func (reportAdmission) CanIssueMediaToken(_ context.Context, roomID string, identity domain.Identity) (bool, error) {
	return roomID == testRoomID && identity.ID == testOtherID && identity.Type == domain.IdentityUser, nil
}

func newFixtureServer(t *testing.T, fixture *reportFixture) http.Handler {
	t.Helper()
	server := New(fixture, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", testSecret), auth.NewGuestTokens(testSecret, time.Hour), livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)), &reportAdmission{})
	server.ConfigureAdminUserIDs([]string{testAdminID})
	return server.Routes(http.NotFoundHandler())
}

func do(t *testing.T, handler http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, reader)
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func TestAdminGateRequiresMFAWhenConfigured(t *testing.T) {
	fixture := newReportFixture()
	server := New(fixture, auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", testSecret), nil, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server.ConfigureAdminUserIDs([]string{testAdminID})
	server.ConfigureAdminMFA(true)
	handler := server.Routes(http.NotFoundHandler())
	if w := do(t, handler, "GET", "/api/v1/admin/overview", signedToken(t, testAdminID, ""), ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "ADMIN_MFA_REQUIRED") {
		t.Fatalf("aal1 admin: %d %s", w.Code, w.Body.String())
	}
	if w := do(t, handler, "GET", "/api/v1/admin/overview", signedToken(t, testAdminID, "aal2"), ""); w.Code != http.StatusOK {
		t.Fatalf("aal2 admin: %d %s", w.Code, w.Body.String())
	}
	// A non-admin learns nothing about the MFA policy.
	if w := do(t, handler, "GET", "/api/v1/admin/overview", signedToken(t, testUserID, "aal2"), ""); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "ADMIN_REQUIRED") {
		t.Fatalf("non-admin: %d %s", w.Code, w.Body.String())
	}
}

func TestAdminRequestChecksAccountOnce(t *testing.T) {
	users := auth.NewSupabaseVerifier("https://test.supabase.co", "authenticated", testSecret)
	checks := 0
	users.SetAccountLookup(func(context.Context, string) (bool, error) {
		checks++
		return true, nil
	})
	server := New(newReportFixture(), users, nil, livekit.New("", ""), nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	server.ConfigureAdminUserIDs([]string{testAdminID})
	token := signedToken(t, testAdminID, "")
	handler := server.Routes(http.NotFoundHandler())
	for i := 1; i <= 2; i++ {
		if w := do(t, handler, "GET", "/api/v1/admin/overview", token, ""); w.Code != http.StatusOK || checks != i {
			t.Fatalf("request %d: status=%d account checks=%d", i, w.Code, checks)
		}
	}
}

func TestAdminGateRateLimitsWrites(t *testing.T) {
	handler := newFixtureServer(t, newReportFixture())
	token := signedToken(t, testAdminID, "")
	limited := false
	for i := 0; i < 15; i++ {
		if w := do(t, handler, "PATCH", "/api/v1/admin/reports/999", token, `{"status":"dismissed"}`); w.Code == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatal("admin writes were never rate limited")
	}
}

func TestReportFlowFromRoomToAdminQueue(t *testing.T) {
	fixture := newReportFixture()
	handler := newFixtureServer(t, fixture)
	reporter := signedToken(t, testUserID, "")
	path := "/api/v1/rooms/" + testRoomID + "/reports"
	for _, tc := range []struct {
		name, body string
		want       int
	}{
		{"self report", `{"target_type":"user","target_id":"` + testUserID + `","target_name":"Me","reason":"spam"}`, 400},
		{"bad reason", `{"target_type":"user","target_id":"` + testOtherID + `","target_name":"Other","reason":"rude"}`, 400},
		{"bad target type", `{"target_type":"message","target_id":"` + testOtherID + `","target_name":"Other","reason":"spam"}`, 400},
		{"too long", `{"target_type":"user","target_id":"` + testOtherID + `","target_name":"Other","reason":"spam","details":"` + strings.Repeat("x", 1001) + `"}`, 400},
		{"unrelated target", `{"target_type":"user","target_id":"` + testAdminID + `","target_name":"Admin","reason":"spam"}`, 400},
		{"valid", `{"target_type":"user","target_id":"` + testOtherID + `","target_name":"Other","reason":"spam","details":"links"}`, 201},
		{"duplicate", `{"target_type":"user","target_id":"` + testOtherID + `","target_name":"Other","reason":"spam"}`, 409},
		{"room", `{"target_type":"room","target_id":"","target_name":"","reason":"policy"}`, 201},
	} {
		if w := do(t, handler, "POST", path, reporter, tc.body); w.Code != tc.want {
			t.Fatalf("%s: got %d want %d: %s", tc.name, w.Code, tc.want, w.Body.String())
		}
	}
	if w := do(t, handler, "POST", path, "", `{"target_type":"room","reason":"policy"}`); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous report: %d", w.Code)
	}
	if got := fixture.reports[1]; got.TargetID != testRoomID || got.TargetName != "Hangout" {
		t.Fatalf("room report target not taken from the server: %+v", got)
	}

	admin := signedToken(t, testAdminID, "")
	if w := do(t, handler, "GET", "/api/v1/admin/reports?status=open", reporter, ""); w.Code != http.StatusForbidden {
		t.Fatalf("member read queue: %d", w.Code)
	}
	if w := do(t, handler, "GET", "/api/v1/admin/reports?status=bogus", admin, ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad status: %d", w.Code)
	}
	if w := do(t, handler, "GET", "/api/v1/admin/reports", admin, ""); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"total":2`) {
		t.Fatalf("queue: %d %s", w.Code, w.Body.String())
	}
	if w := do(t, handler, "PATCH", "/api/v1/admin/reports/1", admin, `{"status":"actioned","note":"short"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("actioned without note: %d", w.Code)
	}
	if w := do(t, handler, "PATCH", "/api/v1/admin/reports/1", admin, `{"status":"actioned","note":"Suspended for spam links"}`); w.Code != http.StatusOK {
		t.Fatalf("resolve: %d %s", w.Code, w.Body.String())
	}
	if w := do(t, handler, "PATCH", "/api/v1/admin/reports/1", admin, `{"status":"dismissed"}`); w.Code != http.StatusConflict {
		t.Fatalf("second resolve: %d", w.Code)
	}
	if w := do(t, handler, "PATCH", "/api/v1/admin/reports/abc", admin, `{"status":"dismissed"}`); w.Code != http.StatusNotFound {
		t.Fatalf("bad id: %d", w.Code)
	}
}

func TestAdminAuditFiltersAndCSVExport(t *testing.T) {
	fixture := newReportFixture()
	fixture.auditRows = []domain.AdminAuditEntry{{ID: 7, ActorID: testAdminID, ActorName: "=HYPERLINK(\"x\")", Action: "account.suspend", TargetType: "user", TargetID: testUserID, Reason: "spam", Note: "+1 note, with comma", CreatedAt: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)}}
	handler := newFixtureServer(t, fixture)
	admin := signedToken(t, testAdminID, "")
	for _, query := range []string{"action=drop.tables", "actor=nope", "from=2026-13-01", "from=2026-11-05&to=2026-11-01"} {
		if w := do(t, handler, "GET", "/api/v1/admin/audit?"+query, admin, ""); w.Code != http.StatusBadRequest {
			t.Fatalf("%s: got %d", query, w.Code)
		}
	}
	w := do(t, handler, "GET", "/api/v1/admin/audit?action=account.suspend&actor="+strings.ToUpper(testAdminID)+"&target="+testUserID+"&from=2026-11-01&to=2026-11-01", admin, "")
	if w.Code != http.StatusOK {
		t.Fatalf("filtered audit: %d %s", w.Code, w.Body.String())
	}
	if fixture.audit.ActorID != testAdminID || fixture.audit.Action != "account.suspend" || fixture.audit.To.Sub(*fixture.audit.From) != 24*time.Hour {
		t.Fatalf("filter not passed: %+v", fixture.audit)
	}
	w = do(t, handler, "GET", "/api/v1/admin/audit/export", admin, "")
	body := w.Body.String()
	if w.Code != http.StatusOK || !strings.HasPrefix(w.Header().Get("Content-Type"), "text/csv") || !strings.HasPrefix(body, "\xef\xbb\xbf") {
		t.Fatalf("export: %d %q", w.Code, w.Header().Get("Content-Type"))
	}
	if !strings.Contains(body, `'=HYPERLINK`) || !strings.Contains(body, `"'+1 note, with comma"`) {
		t.Fatalf("formula cells not neutralized: %s", body)
	}
}

func TestAccountDeletionRequiresConfirmationAndCanBeCancelled(t *testing.T) {
	fixture := newReportFixture()
	handler := newFixtureServer(t, fixture)
	token := signedToken(t, testUserID, "")
	if w := do(t, handler, "POST", "/api/v1/users/me/deletion", token, `{"confirm":"delete"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("lowercase confirm: %d", w.Code)
	}
	w := do(t, handler, "POST", "/api/v1/users/me/deletion", token, `{"confirm":"DELETE"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("schedule: %d %s", w.Code, w.Body.String())
	}
	scheduled := fixture.scheduled[testUserID]
	if grace := time.Until(scheduled); grace < domain.AccountDeletionGrace-time.Minute || grace > domain.AccountDeletionGrace {
		t.Fatalf("grace = %v", grace)
	}
	if w := do(t, handler, "GET", "/api/v1/users/me/account", token, ""); !strings.Contains(w.Body.String(), "deletion_scheduled_for") {
		t.Fatalf("account: %s", w.Body.String())
	}
	if w := do(t, handler, "DELETE", "/api/v1/users/me/deletion", token, ""); w.Code != http.StatusNoContent {
		t.Fatalf("cancel: %d", w.Code)
	}
	if _, still := fixture.scheduled[testUserID]; still {
		t.Fatal("deletion not cancelled")
	}
	if w := do(t, handler, "DELETE", "/api/v1/users/me/deletion", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous cancel: %d", w.Code)
	}
}

func TestProfileUpdateValidatesAndResets(t *testing.T) {
	fixture := newReportFixture()
	handler := newFixtureServer(t, fixture)
	token := signedToken(t, testUserID, "")
	if w := do(t, handler, "PATCH", "/api/v1/users/me", token, `{"display_name":"x"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("short name: %d", w.Code)
	}
	if w := do(t, handler, "PATCH", "/api/v1/users/me", token, `{"display_name":"  Mai   Anh ","hide_avatar":true}`); w.Code != http.StatusOK {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}
	if got := fixture.settings[testUserID]; got.CustomDisplayName == nil || *got.CustomDisplayName != "Mai Anh" || !got.HideAvatar {
		t.Fatalf("settings = %+v", got)
	}
	if w := do(t, handler, "PATCH", "/api/v1/users/me", token, `{"display_name":null}`); w.Code != http.StatusOK {
		t.Fatalf("reset: %d", w.Code)
	}
	if got := fixture.settings[testUserID]; got.CustomDisplayName != nil {
		t.Fatalf("name not reset: %+v", got)
	}
}
