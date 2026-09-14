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
	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000001_mvp.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("migration failed (%T)", err)
	}
	for _, table := range []string{"profiles", "rooms", "room_members", "messages"} {
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
	if err := tx.QueryRow(ctx, "SELECT (SELECT count(*) FROM messages)+(SELECT count(*) FROM room_members)").Scan(&remaining); err != nil || remaining != 0 {
		t.Fatal("room cascade left orphan rows")
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal("migration transaction rollback failed")
	}
}
