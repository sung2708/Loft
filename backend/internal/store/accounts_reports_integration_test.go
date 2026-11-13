package store

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"loft/backend/internal/domain"
)

// Opt-in: LOFT_STORE_DB_TEST=1 with DATABASE_URL pointing at a disposable
// database that has every migration and testdata/release-auth.sql applied.
// Rows use fresh UUIDs, so the test can run repeatedly against one database.
func openDisposable(t *testing.T) (*Postgres, context.Context) {
	t.Helper()
	if os.Getenv("LOFT_STORE_DB_TEST") != "1" {
		t.Skip("set LOFT_STORE_DB_TEST=1 and DATABASE_URL to a disposable database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	db, err := Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	return db, ctx
}

func newMember(t *testing.T, ctx context.Context, db *Postgres, name string) domain.Identity {
	t.Helper()
	id := uuid.NewString()
	if _, err := db.pool.Exec(ctx, `INSERT INTO auth.users (id) VALUES ($1)`, id); err != nil {
		t.Fatal(err)
	}
	identity := domain.Identity{ID: id, Type: domain.IdentityUser, DisplayName: name, AvatarURL: "https://example.com/a.png", ProviderName: name, ProviderAvatar: "https://example.com/a.png"}
	if err := db.UpsertProfile(ctx, identity); err != nil {
		t.Fatal(err)
	}
	return identity
}

func TestAccountSettingsVisitsAndPurge(t *testing.T) {
	db, ctx := openDisposable(t)
	owner := newMember(t, ctx, db, "Owner Person")
	visitor := newMember(t, ctx, db, "Visitor Person")

	name := "Chosen Name"
	if err := db.UpdateProfileSettings(ctx, owner, domain.ProfileSettings{CustomDisplayName: &name, HideAvatar: true}); err != nil {
		t.Fatal(err)
	}
	overrides, err := db.ProfileOverrides(ctx, owner.ID)
	if err != nil || overrides.DisplayName != name || !overrides.HideAvatar {
		t.Fatalf("overrides = %+v, %v", overrides, err)
	}
	// An instance with stale claims must not overwrite the saved choices.
	if err := db.UpsertProfile(ctx, owner); err != nil {
		t.Fatal(err)
	}
	profile, err := db.AccountProfile(ctx, owner.ID)
	if err != nil || profile.DisplayName != name || profile.AvatarURL != "" || profile.CustomDisplayName == nil {
		t.Fatalf("profile = %+v, %v", profile, err)
	}

	if err := db.UpdateProfileSettings(ctx, owner, domain.ProfileSettings{}); err != nil {
		t.Fatal(err)
	}
	profile, err = db.AccountProfile(ctx, owner.ID)
	if err != nil || profile.DisplayName != owner.ProviderName || profile.AvatarURL != owner.ProviderAvatar {
		t.Fatalf("provider profile not restored: %+v, %v", profile, err)
	}
	if err := db.UpdateProfileSettings(ctx, owner, domain.ProfileSettings{CustomDisplayName: &name, HideAvatar: true}); err != nil {
		t.Fatal(err)
	}

	ownRoom, err := db.CreateRoom(ctx, domain.CreateRoomParams{Name: "Owner room", Owner: owner, AllowGuests: true})
	if err != nil {
		t.Fatal(err)
	}
	otherRoom, err := db.CreateRoom(ctx, domain.CreateRoomParams{Name: "Visitor room", Owner: visitor, AllowGuests: true})
	if err != nil {
		t.Fatal(err)
	}
	// The visitor enters the owner's room; the owner's own room is never "recent".
	if err := db.RecordRoomVisit(ctx, visitor.ID, ownRoom.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordRoomVisit(ctx, owner.ID, ownRoom.ID); err != nil {
		t.Fatal(err)
	}
	recent, err := db.ListRecentRooms(ctx, visitor.ID, 10)
	if err != nil || len(recent) != 1 || recent[0].ID != ownRoom.ID || recent[0].OwnerName != name {
		t.Fatalf("recent = %+v, %v", recent, err)
	}
	if mine, _ := db.ListRecentRooms(ctx, owner.ID, 10); len(mine) != 0 {
		t.Fatalf("own room listed as recent: %+v", mine)
	}
	if err := db.ForgetRoomVisit(ctx, visitor.ID, ownRoom.ID); err != nil {
		t.Fatal(err)
	}

	if recent, _ := db.ListRecentRooms(ctx, visitor.ID, 10); len(recent) != 0 {
		t.Fatalf("forgotten room still listed: %+v", recent)
	}
	if err := db.RecordRoomVisit(ctx, visitor.ID, ownRoom.ID); err != nil {
		t.Fatal(err)
	}
	if recent, _ := db.ListRecentRooms(ctx, visitor.ID, 10); len(recent) != 1 {
		t.Fatal("entering again did not restore the room")
	}

	// The owner messages in the visitor's room and bans a guest there as host.
	if message, err := db.InsertMessage(ctx, otherRoom.ID, owner, "hello there"); err != nil || message.SenderAvatarURL != "" {
		t.Fatalf("stale identity published a hidden avatar: %+v, %v", message, err)
	}
	if _, err := db.pool.Exec(ctx, `INSERT INTO room_bans (room_id, identity_type, identity_id, banned_by) VALUES ($1, 'guest', $2, $3)`, otherRoom.ID, uuid.NewString(), owner.ID); err != nil {
		t.Fatal(err)
	}

	export, err := db.ExportAccount(ctx, owner.ID)
	if err != nil || len(export.Messages) != 1 || len(export.Rooms) != 1 || export.Profile.ID != owner.ID {
		t.Fatalf("export = %+v, %v", export, err)
	}

	now := time.Now().UTC()
	scheduled, err := db.ScheduleAccountDeletion(ctx, owner.ID, now.Add(domain.AccountDeletionGrace))
	if err != nil {
		t.Fatal(err)
	}
	again, err := db.ScheduleAccountDeletion(ctx, owner.ID, now.Add(time.Hour))
	if err != nil || !again.Equal(scheduled) {
		t.Fatalf("second schedule moved the date: %v -> %v (%v)", scheduled, again, err)
	}
	if err := db.PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, []string{ownRoom.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("purge before due = %v", err)
	}
	if err := db.CancelAccountDeletion(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.CancelAccountDeletion(ctx, owner.ID); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("second cancel = %v", err)
	}

	due := now.Add(-time.Minute)
	if _, err := db.ScheduleAccountDeletion(ctx, owner.ID, due); err != nil {
		t.Fatal(err)
	}
	ids, err := db.DueAccountDeletions(ctx, now, 100)
	if err != nil || dueDeletion(ids, owner.ID).UserID == "" {
		t.Fatalf("due = %v, %v", ids, err)
	}
	old := dueDeletion(ids, owner.ID)
	if err := db.CancelAccountDeletion(ctx, owner.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ScheduleAccountDeletion(ctx, owner.ID, due); err != nil {
		t.Fatal(err)
	}
	if err := db.PurgeAccount(ctx, old, now, []string{ownRoom.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("stale purge targeted a new request: %v", err)
	}
	if err := db.PostponeAccountDeletion(ctx, old, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if ids, err = db.DueAccountDeletions(ctx, now, 100); err != nil || dueDeletion(ids, owner.ID).UserID == "" {
		t.Fatalf("a stale retry postponed the current request: %v, %v", ids, err)
	}
	if err := db.PostponeAccountDeletion(ctx, dueDeletion(ids, owner.ID), now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	profile, err = db.AccountProfile(ctx, owner.ID)
	if err != nil || profile.DeletionScheduledFor == nil || !profile.DeletionScheduledFor.Equal(due.Truncate(time.Microsecond)) {
		t.Fatalf("retry changed the original schedule: %+v, %v", profile, err)
	}
	if ids, err := db.DueAccountDeletions(ctx, now, 100); err != nil || dueDeletion(ids, owner.ID).UserID != "" {
		t.Fatalf("retry did not release the due queue: %v, %v", ids, err)
	}
	if err := db.PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, []string{ownRoom.ID}); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("purge ignored retry deadline: %v", err)
	}
	now = now.Add(2 * time.Minute)

	// An active suspension holds the purge back.
	if err := db.BanAccount(ctx, domain.AccountBan{UserID: owner.ID, ActorID: visitor.ID, Reason: "spam", Note: "integration test note"}); err != nil {
		t.Fatal(err)
	}
	if err := db.PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, []string{ownRoom.ID}); !errors.Is(err, domain.ErrAccountSuspended) {
		t.Fatalf("purge while suspended = %v", err)
	}
	if err := db.LiftAccountBan(ctx, owner.ID, visitor.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, nil); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("purge with an unfenced room = %v", err)
	}
	if _, err := db.GetRoom(ctx, ownRoom.ID); err != nil {
		t.Fatalf("unfenced room did not survive: %v", err)
	}
	if err := db.PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, []string{ownRoom.ID}); err != nil {
		t.Fatalf("purge: %v", err)
	}
	var authUsers, profiles, rooms, bansKept int
	var shownName string
	if err := db.pool.QueryRow(ctx, `SELECT (SELECT COUNT(*) FROM auth.users WHERE id = $1), (SELECT COUNT(*) FROM profiles WHERE id = $1),
		(SELECT COUNT(*) FROM rooms WHERE owner_id = $1), (SELECT COUNT(*) FROM room_bans WHERE room_id = $2 AND banned_by IS NULL),
		(SELECT sender_display_name FROM messages WHERE room_id = $2 LIMIT 1)`, owner.ID, otherRoom.ID).Scan(&authUsers, &profiles, &rooms, &bansKept, &shownName); err != nil {
		t.Fatal(err)
	}
	if authUsers != 0 || profiles != 0 || rooms != 0 || bansKept < 1 || shownName != DeletedMemberName {
		t.Fatalf("after purge: auth=%d profiles=%d rooms=%d bans kept=%d name=%q", authUsers, profiles, rooms, bansKept, shownName)
	}
	if exists, err := db.AuthAccountExists(ctx, owner.ID); err != nil || exists {
		t.Fatalf("deleted auth account exists = %v, %v", exists, err)
	}
	if err := db.EndOwnedRoom(ctx, otherRoom.ID, visitor.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.PatchBoard(ctx, otherRoom.ID, BoardPatch{}); !errors.Is(err, domain.ErrRoomEnded) {
		t.Fatalf("patch after room ended: %v", err)
	}
	if recent, _ := db.ListRecentRooms(ctx, visitor.ID, 10); len(recent) != 0 {
		t.Fatalf("deleted owner's room still listed: %+v", recent)
	}
}

func TestAccountPurgeRollsBackWithoutAuthDeletePermission(t *testing.T) {
	db, ctx := openDisposable(t)
	owner := newMember(t, ctx, db, "Restricted purge owner")
	room, err := db.CreateRoom(ctx, domain.CreateRoomParams{Name: "Keep this room", Owner: owner})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := db.ScheduleAccountDeletion(ctx, owner.ID, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}

	// Use a dedicated role with access to app tables, but no auth DELETE.
	role := "purge_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := db.pool.Exec(ctx, `CREATE ROLE `+role+` BYPASSRLS`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := db.pool.Exec(ctx, `DROP OWNED BY `+role+`; DROP ROLE `+role); err != nil {
			t.Errorf("cleanup restricted role: %v", err)
		}
	})
	if _, err := db.pool.Exec(ctx, `GRANT USAGE ON SCHEMA public, auth TO `+role+`;
		GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO `+role+`;
		GRANT SELECT ON auth.users TO `+role); err != nil {
		t.Fatal(err)
	}
	cfg := db.pool.Config()
	cfg.ConnConfig.RuntimeParams["role"] = role
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	err = (&Postgres{pool: pool}).PurgeAccount(ctx, loadDeletion(t, ctx, db, owner.ID), now, []string{room.ID})
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" || !strings.HasPrefix(err.Error(), "delete auth user:") {
		t.Fatalf("expected auth DELETE to fail with insufficient privilege, got %v", err)
	}
	if _, err := db.GetRoom(ctx, room.ID); err != nil {
		t.Fatalf("room did not survive failed purge: %v", err)
	}
	profile, err := db.AccountProfile(ctx, owner.ID)
	if err != nil || profile.DeletionScheduledFor == nil {
		t.Fatalf("profile or deletion schedule did not survive: %+v, %v", profile, err)
	}
}

func TestReportsQueueAndAdminViews(t *testing.T) {
	db, ctx := openDisposable(t)
	admin := newMember(t, ctx, db, "Admin Person")
	reporter := newMember(t, ctx, db, "Reporter Person")
	target := newMember(t, ctx, db, "Target Person")
	room, err := db.CreateRoom(ctx, domain.CreateRoomParams{Name: "Report room", Owner: target, AllowGuests: true})
	if err != nil {
		t.Fatal(err)
	}
	report := domain.Report{ReporterType: domain.IdentityUser, ReporterID: reporter.ID, ReporterName: reporter.DisplayName, RoomID: room.ID, RoomName: room.Name,
		TargetType: domain.ReportTargetUser, TargetID: target.ID, TargetName: "spoofed name", Reason: "spam", Details: "posting links"}
	created, err := db.CreateReport(ctx, report)
	if err != nil || created.Status != domain.ReportOpen || created.TargetName != "Target Person" || created.TargetReports != 1 {
		t.Fatalf("created = %+v, %v", created, err)
	}
	if _, err := db.CreateReport(ctx, report); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate open report = %v", err)
	}
	guest := report
	guest.ReporterType, guest.ReporterID, guest.ReporterName = domain.IdentityGuest, uuid.NewString(), "Guest"
	if _, err := db.CreateReport(ctx, guest); err != nil {
		t.Fatal(err)
	}
	open, total, err := db.ListReports(ctx, domain.ReportOpen, 50, 0)
	if err != nil || total < 2 || !slices.ContainsFunc(open, func(r domain.Report) bool { return r.ID == created.ID }) {
		t.Fatalf("open queue = %d, %v", total, err)
	}
	users, _, err := db.ListAdminUsers(ctx, target.ID, domain.AdminUsersReported, 10, 0)
	if err != nil || len(users) != 1 || users[0].OpenReports != 2 {
		t.Fatalf("reported users = %+v, %v", users, err)
	}

	resolved, err := db.ResolveReport(ctx, created.ID, admin.ID, domain.ReportActioned, "Warned the member")
	if err != nil || resolved.Status != domain.ReportActioned || resolved.ResolvedAt == nil {
		t.Fatalf("resolved = %+v, %v", resolved, err)
	}
	if _, err := db.ResolveReport(ctx, created.ID, admin.ID, domain.ReportDismissed, ""); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("second resolve = %v", err)
	}
	if _, err := db.ResolveReport(ctx, 1<<60, admin.ID, domain.ReportDismissed, ""); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown resolve = %v", err)
	}
	// A new report is allowed once the previous one is closed.
	if _, err := db.CreateReport(ctx, report); err != nil {
		t.Fatalf("report after close = %v", err)
	}

	entries, total, err := db.ListAdminAudit(ctx, domain.AdminAuditFilter{Action: "report.actioned", ActorID: admin.ID, TargetID: target.ID}, 10, 0)
	if err != nil || total != 1 || entries[0].Note != "Warned the member" {
		t.Fatalf("audit = %+v (%d), %v", entries, total, err)
	}
	future := time.Now().Add(time.Hour)
	if _, total, _ := db.ListAdminAudit(ctx, domain.AdminAuditFilter{ActorID: admin.ID, From: &future}, 10, 0); total != 0 {
		t.Fatalf("date filter kept %d rows", total)
	}

	detail, err := db.AdminUserDetail(ctx, target.ID)
	if err != nil || detail.TotalReports != 3 || detail.OpenReports != 2 || len(detail.History) != 1 || len(detail.RecentReports) != 3 || detail.RoomCount != 1 {
		t.Fatalf("detail = %+v, %v", detail, err)
	}
	if _, err := db.AdminUserDetail(ctx, uuid.NewString()); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown detail = %v", err)
	}
	overview, err := db.AdminOverview(ctx)
	if err != nil || len(overview.Daily) != domain.AdminTrendDays || overview.OpenReports < 2 {
		t.Fatalf("overview = %+v, %v", overview, err)
	}
	last := overview.Daily[len(overview.Daily)-1]
	if last.Date != time.Now().UTC().Format(time.DateOnly) || last.Users < 3 || last.Rooms < 1 {
		t.Fatalf("today bucket = %+v", last)
	}
}

func dueDeletion(values []domain.DueDeletion, want string) domain.DueDeletion {
	for _, value := range values {
		if value.UserID == want {
			return value
		}
	}
	return domain.DueDeletion{}
}

func loadDeletion(t *testing.T, ctx context.Context, db *Postgres, userID string) domain.DueDeletion {
	t.Helper()
	deletion := domain.DueDeletion{UserID: userID}
	if err := db.pool.QueryRow(ctx, `SELECT requested_at FROM account_deletions WHERE user_id = $1`, userID).Scan(&deletion.RequestedAt); err != nil {
		t.Fatal(err)
	}
	return deletion
}
