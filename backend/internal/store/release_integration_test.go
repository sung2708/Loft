package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
)

// Explicit opt-in: run the migration in an isolated schema and roll the entire
// transaction back. Existing application tables and auth users are not changed.
func TestReleaseMigrationInIsolatedSchema(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_DB_TEST") != "1" {
		t.Skip("set LOFT_RELEASE_DB_TEST=1 for real database migration validation")
	}
	_ = godotenv.Load(filepath.Join("..", "..", ".env"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("database connection unavailable")
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal("cannot start migration transaction")
	}
	defer tx.Rollback(context.Background())
	schema := pgx.Identifier{"release_gate_" + uuid.NewString()}.Sanitize()
	if _, err := tx.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal("cannot create isolated schema")
	}
	if _, err := tx.Exec(ctx, "SET LOCAL search_path TO "+schema+", public, extensions"); err != nil {
		t.Fatal("cannot set isolated search path")
	}
	for _, name := range []string{"000001_mvp.up.sql", "000002_governance.up.sql", "000003_short_room_codes.up.sql", "000004_room_access.up.sql"} {
		migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, string(migration)); err != nil {
			t.Fatalf("migration %s failed (%T)", name, err)
		}
	}
	for _, table := range []string{"profiles", "rooms", "room_members", "messages", "room_bans"} {
		var exists bool
		if err := tx.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil || !exists {
			t.Fatalf("missing migration table %s", table)
		}
	}
	// Use an existing auth identity only as an FK target; all inserted business
	// rows live in the isolated transaction and never survive this test.
	var userID string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM auth.users LIMIT 1").Scan(&userID); err != nil {
		t.Fatal("no auth fixture available")
	}
	if _, err := tx.Exec(ctx, "INSERT INTO profiles(id,display_name) VALUES($1,'Release QA')", userID); err != nil {
		t.Fatal("profile FK validation failed")
	}
	var roomID string
	if err := tx.QueryRow(ctx, "INSERT INTO rooms(name,owner_id) VALUES('Release migration QA',$1) RETURNING id::text", userID).Scan(&roomID); err != nil {
		t.Fatal("room insert failed")
	}
	var locked bool
	var version int64
	var shortCodeValid bool
	if err := tx.QueryRow(ctx, "SELECT is_locked, version, short_code ~ '^[0-9]{6}$' FROM rooms WHERE id=$1", roomID).Scan(&locked, &version, &shortCodeValid); err != nil || locked || version != 0 || !shortCodeValid {
		t.Fatalf("governance defaults invalid: locked=%v version=%d err=%v", locked, version, err)
	}
	if err := tx.QueryRow(ctx, "UPDATE rooms SET is_locked=true, version=version+1 WHERE id=$1 AND owner_id=$2 AND version=0 RETURNING is_locked, version", roomID, userID).Scan(&locked, &version); err != nil || !locked || version != 1 {
		t.Fatalf("governance lock update failed: locked=%v version=%d err=%v", locked, version, err)
	}
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM rooms WHERE id=$1 AND owner_id=$2 AND version=0", roomID, userID).Scan(&version); err != nil || version != 0 {
		t.Fatalf("stale governance version unexpectedly matched: count=%d err=%v", version, err)
	}
	guestID := uuid.NewString()
	if _, err := tx.Exec(ctx, "INSERT INTO room_bans(room_id,identity_type,identity_id,banned_by) VALUES($1,'guest',$2,$3)", roomID, guestID, userID); err != nil {
		t.Fatal("ban insert failed")
	}
	var banned bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM room_bans WHERE room_id=$1 AND identity_type='guest' AND identity_id=$2)", roomID, guestID).Scan(&banned); err != nil || !banned {
		t.Fatalf("ban row missing: banned=%v err=%v", banned, err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO room_members(room_id,user_id,role) VALUES($1,$2,'host')", roomID, userID); err != nil {
		t.Fatal("membership insert failed")
	}
	if _, err := tx.Exec(ctx, "INSERT INTO messages(room_id,sender_user_id,sender_type,sender_display_name,content) VALUES($1,$2,'user','Release QA','hello 👋')", roomID, userID); err != nil {
		t.Fatal("message insert failed")
	}
	if _, err := tx.Exec(ctx, "DELETE FROM rooms WHERE id=$1", roomID); err != nil {
		t.Fatal("room delete failed")
	}
	var remaining int
	if err := tx.QueryRow(ctx, "SELECT (SELECT count(*) FROM messages)+(SELECT count(*) FROM room_members)+(SELECT count(*) FROM room_bans)").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("room cascade left orphan rows")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal("migration transaction rollback failed")
	}
}
