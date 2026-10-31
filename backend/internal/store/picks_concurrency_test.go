package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"loft/backend/internal/domain"
)

func TestPostgresRoomPickCapacityConcurrentWriters(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_DB_TEST") != "1" {
		t.Skip("set LOFT_RELEASE_DB_TEST=1 for real PostgreSQL concurrency validation")
	}
	_ = godotenv.Load(filepath.Join("..", "..", ".env"))
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("test database unavailable")
	}
	defer conn.Close(context.Background())
	name := "pick_capacity_" + uuid.NewString()[:8]
	schema := pgx.Identifier{name}.Sanitize()
	if _, err = conn.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := conn.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error("test schema cleanup failed", err)
		}
	}()
	if _, err = conn.Exec(ctx, "CREATE TABLE "+schema+".rooms(id uuid PRIMARY KEY); CREATE TABLE "+schema+".youtube_room_picks(id uuid PRIMARY KEY,room_id uuid,video_id text,title text,channel text,suggested_by uuid,active boolean)"); err != nil {
		t.Fatal(err)
	}
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("invalid test database configuration")
	}
	config.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repo := &Postgres{pool: pool}
	roomID := uuid.NewString()
	if _, err = pool.Exec(ctx, `INSERT INTO rooms(id) VALUES($1)`, roomID); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 49; i++ {
		if err = repo.CreateRoomPick(ctx, YouTubeRoomPick{ID: uuid.NewString(), RoomID: roomID, VideoID: uuid.NewString(), SuggestedBy: uuid.NewString(), Active: true}); err != nil {
			t.Fatal(err)
		}
	}
	start := make(chan struct{})
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		go func() {
			<-start
			results <- repo.CreateRoomPick(ctx, YouTubeRoomPick{ID: uuid.NewString(), RoomID: roomID, VideoID: uuid.NewString(), SuggestedBy: uuid.NewString(), Active: true})
		}()
	}
	close(start)
	successes := 0
	for i := 0; i < 12; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if !errors.Is(err, ErrPickCapacityReached) {
			t.Fatal(err)
		}
	}
	var count int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM youtube_room_picks WHERE room_id=$1 AND active`, roomID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if successes != 1 || count != 50 {
		t.Fatalf("capacity exceeded: successful writers=%d count=%d", successes, count)
	}
	// An invalid selection must roll back the setting written in the same transaction.
	if _, err = pool.Exec(ctx, `CREATE TABLE youtube_room_media_settings(room_id uuid PRIMARY KEY,autoplay_enabled boolean,updated_by uuid,updated_at timestamptz DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	settings := &YouTubeMediaSettings{RoomID: roomID, AutoplayEnabled: true, UpdatedBy: uuid.NewString()}
	if err = repo.CommitYouTubeSelection(ctx, roomID, settings, uuid.NewString()); err == nil {
		t.Fatal("missing pick committed")
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM youtube_room_media_settings`).Scan(&count); err != nil || count != 0 {
		t.Fatal("failed selection persisted autoplay setting")
	}
	var pickID string
	if err = pool.QueryRow(ctx, `SELECT id FROM youtube_room_picks WHERE room_id=$1 AND active LIMIT 1`, roomID).Scan(&pickID); err != nil {
		t.Fatal(err)
	}
	if err = repo.CommitYouTubeSelection(ctx, roomID, settings, pickID); err != nil {
		t.Fatal(err)
	}
	var enabled, active bool
	if err = pool.QueryRow(ctx, `SELECT s.autoplay_enabled,p.active FROM youtube_room_media_settings s JOIN youtube_room_picks p ON p.room_id=s.room_id WHERE p.id=$1`, pickID).Scan(&enabled, &active); err != nil || !enabled || active {
		t.Fatal("selection and setting did not commit together")
	}

	// Resolve the database transaction identity, not the connection's error.
	for _, commit := range []bool{true, false} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var transactionID string
		if err = tx.QueryRow(ctx, `SELECT pg_current_xact_id()::text`).Scan(&transactionID); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		status, err := repo.YouTubeSelectionStatus(ctx, transactionID)
		if err != nil || status != SelectionInProgress {
			_ = tx.Rollback(ctx)
			t.Fatalf("active transaction status: %s %v", status, err)
		}
		expected := SelectionAborted
		if commit {
			err = tx.Commit(ctx)
			expected = SelectionCommitted
		} else {
			err = tx.Rollback(ctx)
		}
		if err != nil {
			t.Fatal(err)
		}
		status, err = repo.YouTubeSelectionStatus(ctx, transactionID)
		if err != nil || status != expected {
			t.Fatalf("durable transaction status: got %s want %s err=%v", status, expected, err)
		}
	}

	// Ending closes admission without deleting room, messages or whiteboard rows.
	if _, err = pool.Exec(ctx, `ALTER TABLE rooms ADD owner_id uuid,ADD short_code text,ADD invite_code text,ADD name text DEFAULT 'Room',ADD allow_guests boolean DEFAULT true,ADD max_participants smallint DEFAULT 12,ADD is_locked boolean DEFAULT false,ADD version bigint DEFAULT 0,ADD password_required boolean DEFAULT false,ADD password_verifier text,ADD atmosphere text DEFAULT 'ambient',ADD accent text DEFAULT 'blue',ADD adaptive_media_background boolean DEFAULT true,ADD created_at timestamptz DEFAULT now(),ADD updated_at timestamptz DEFAULT now(); CREATE TABLE messages(room_id uuid,content text)`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"000013_room_whiteboards.up.sql", "000014_room_endings.up.sql"} {
		raw, err := os.ReadFile(filepath.Join("..", "..", "migrations", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(raw)); err != nil {
			t.Fatal(err)
		}
	}
	ownerID := uuid.NewString()
	if _, err = pool.Exec(ctx, `UPDATE rooms SET owner_id=$2,short_code='123456',invite_code='private-test' WHERE id=$1`, roomID, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO messages(room_id,content) VALUES($1,'Keep me')`, roomID); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `INSERT INTO room_whiteboards(room_id) VALUES($1)`, roomID); err != nil {
		t.Fatal(err)
	}
	if err = repo.EndOwnedRoom(ctx, roomID, uuid.NewString()); !errors.Is(err, domain.ErrNotFound) {
		t.Fatal("non-owner ended room", err)
	}
	if _, err = repo.GetRoom(ctx, roomID); err != nil {
		t.Fatal("active room unavailable", err)
	}
	for i := 0; i < 2; i++ {
		if err = repo.EndOwnedRoom(ctx, roomID, ownerID); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{roomID, "123456", "private-test"} {
		if _, err = repo.GetRoom(ctx, id); !errors.Is(err, domain.ErrRoomEnded) {
			t.Fatal("ended room admitted", id, err)
		}
	}
	rooms, err := repo.ListOwnedRooms(ctx, ownerID)
	if err != nil || len(rooms) != 0 {
		t.Fatal("ended room listed as active", err)
	}
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM rooms)+(SELECT count(*) FROM messages)+(SELECT count(*) FROM room_whiteboards)`).Scan(&count); err != nil || count != 3 {
		t.Fatal("ending deleted history", count, err)
	}

}
