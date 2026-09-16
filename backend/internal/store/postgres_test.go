package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/joho/godotenv"
	"loft/backend/internal/domain"
)

func TestMigrationSQL000006Definitions(t *testing.T) {
	upBytes, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000006_room_appearance.up.sql"))
	if err != nil {
		t.Fatalf("failed to read 000006 up migration: %v", err)
	}
	upSQL := string(upBytes)

	if !strings.Contains(upSQL, "atmosphere TEXT NOT NULL DEFAULT 'ambient'") {
		t.Fatal("up migration missing atmosphere non-null default 'ambient'")
	}
	if !strings.Contains(upSQL, "accent TEXT NOT NULL DEFAULT 'blue'") {
		t.Fatal("up migration missing accent non-null default 'blue'")
	}
	if !strings.Contains(upSQL, "adaptive_media_background BOOLEAN NOT NULL DEFAULT TRUE") &&
		!strings.Contains(upSQL, "adaptive_media_background BOOLEAN NOT NULL DEFAULT true") {
		t.Fatal("up migration missing adaptive_media_background non-null default true")
	}
	if !strings.Contains(upSQL, "'minimal', 'ambient', 'focus', 'party'") {
		t.Fatal("up migration missing closed atmosphere constraint check")
	}
	if !strings.Contains(upSQL, "'blue', 'purple', 'green', 'orange', 'rose'") {
		t.Fatal("up migration missing closed accent constraint check")
	}

	downBytes, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000006_room_appearance.down.sql"))
	if err != nil {
		t.Fatalf("failed to read 000006 down migration: %v", err)
	}
	downSQL := string(downBytes)

	if !strings.Contains(downSQL, "DROP CONSTRAINT IF EXISTS rooms_accent_valid") ||
		!strings.Contains(downSQL, "DROP CONSTRAINT IF EXISTS rooms_atmosphere_valid") {
		t.Fatal("down migration missing constraint drop")
	}
	if !strings.Contains(downSQL, "DROP COLUMN IF EXISTS adaptive_media_background") ||
		!strings.Contains(downSQL, "DROP COLUMN IF EXISTS accent") ||
		!strings.Contains(downSQL, "DROP COLUMN IF EXISTS atmosphere") {
		t.Fatal("down migration missing column drop")
	}
	if strings.Contains(downSQL, "DROP TABLE") {
		t.Fatal("down migration must not drop tables")
	}
}

func TestPostgresRoomAppearancePersistenceAndConcurrency(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_DB_TEST") != "1" {
		t.Skip("set LOFT_RELEASE_DB_TEST=1 for real database migration and persistence validation")
	}
	_ = godotenv.Load(filepath.Join("..", "..", ".env"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("database connection unavailable: %v", err)
	}
	defer conn.Close(context.Background())

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("cannot start test transaction: %v", err)
	}
	defer tx.Rollback(context.Background())

	schema := pgx.Identifier{"spec005_test_" + uuid.NewString()}.Sanitize()
	if _, err := tx.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("cannot create isolated schema: %v", err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL search_path TO "+schema+", public, extensions"); err != nil {
		t.Fatalf("cannot set search path: %v", err)
	}

	migrationFiles := []string{
		"000001_mvp.up.sql",
		"000002_governance.up.sql",
		"000003_short_room_codes.up.sql",
		"000004_room_access.up.sql",
		"000006_room_appearance.up.sql",
	}
	for _, name := range migrationFiles {
		content, err := os.ReadFile(filepath.Join("..", "..", "migrations", name))
		if err != nil {
			t.Fatalf("reading %s: %v", name, err)
		}
		if _, err := tx.Exec(ctx, string(content)); err != nil {
			t.Fatalf("applying migration %s: %v", name, err)
		}
	}

	var ownerID string
	if err := tx.QueryRow(ctx, "SELECT id::text FROM auth.users LIMIT 1").Scan(&ownerID); err != nil {
		t.Fatalf("no auth fixture user: %v", err)
	}
	if _, err := tx.Exec(ctx, "INSERT INTO profiles(id, display_name) VALUES($1, 'Atmosphere Tester')", ownerID); err != nil {
		t.Fatalf("inserting profile: %v", err)
	}

	var roomID string
	var atmo domain.RoomAtmosphere
	var accent domain.RoomAccent
	var adaptive bool
	var version int64

	err = tx.QueryRow(ctx, `INSERT INTO rooms(name, owner_id) VALUES('Atmosphere Room', $1)
		RETURNING id::text, atmosphere, accent, adaptive_media_background, version`, ownerID).
		Scan(&roomID, &atmo, &accent, &adaptive, &version)
	if err != nil {
		t.Fatalf("failed to insert room: %v", err)
	}

	if atmo != domain.AtmosphereAmbient || accent != domain.AccentBlue || !adaptive || version != 0 {
		t.Fatalf("unexpected defaults: atmo=%q accent=%q adaptive=%v version=%d", atmo, accent, adaptive, version)
	}

	// Successful update
	err = tx.QueryRow(ctx, `UPDATE rooms SET atmosphere=$3, accent=$4, adaptive_media_background=$5, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND version=$2
		RETURNING atmosphere, accent, adaptive_media_background, version`,
		roomID, 0, domain.AtmosphereParty, domain.AccentRose, false).
		Scan(&atmo, &accent, &adaptive, &version)
	if err != nil {
		t.Fatalf("failed to update room appearance: %v", err)
	}
	if atmo != domain.AtmosphereParty || accent != domain.AccentRose || adaptive || version != 1 {
		t.Fatalf("unexpected updated values: atmo=%q accent=%q adaptive=%v version=%d", atmo, accent, adaptive, version)
	}

	// Stale expected version conflict
	var rowsUpdated int64
	cmdTag, err := tx.Exec(ctx, `UPDATE rooms SET atmosphere=$3, accent=$4, adaptive_media_background=$5, version=version+1, updated_at=NOW()
		WHERE id=$1::uuid AND version=$2`,
		roomID, 0, domain.AtmosphereFocus, domain.AccentGreen, true)
	if err != nil {
		t.Fatalf("exec error: %v", err)
	}
	rowsUpdated = cmdTag.RowsAffected()
	if rowsUpdated != 0 {
		t.Fatalf("stale version update should have affected 0 rows, got %d", rowsUpdated)
	}

	// Verify room state is untouched after failed conflict update
	err = tx.QueryRow(ctx, `SELECT atmosphere, accent, adaptive_media_background, version FROM rooms WHERE id=$1::uuid`, roomID).
		Scan(&atmo, &accent, &adaptive, &version)
	if err != nil {
		t.Fatalf("re-reading room: %v", err)
	}
	if atmo != domain.AtmosphereParty || accent != domain.AccentRose || version != 1 {
		t.Fatalf("state was corrupted by failed update: atmo=%q accent=%q version=%d", atmo, accent, version)
	}

	// Reversible rollback verification
	downContent, err := os.ReadFile(filepath.Join("..", "..", "migrations", "000006_room_appearance.down.sql"))
	if err != nil {
		t.Fatalf("reading down migration: %v", err)
	}
	if _, err := tx.Exec(ctx, string(downContent)); err != nil {
		t.Fatalf("rolling back 000006: %v", err)
	}

	// Verify room record still exists after 000006 rollback
	var roomCount int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM rooms WHERE id=$1::uuid`, roomID).Scan(&roomCount); err != nil || roomCount != 1 {
		t.Fatalf("room was unexpectedly deleted by rollback: count=%d, err=%v", roomCount, err)
	}
}
