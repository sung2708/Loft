package store

import (
	"context"
	"errors"
	"loft/backend/internal/domain"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresModerationAtomicAndImmutable(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_DB_TEST") != "1" {
		t.Skip("requires isolated test PostgreSQL via DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	config, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal("invalid test configuration")
	}
	schema := "moderation_" + uuid.NewString()[:8]
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	config.ConnConfig.RuntimeParams["search_path"] = schema
	config.ConnConfig.RuntimeParams["application_name"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err = pool.Exec(ctx, `CREATE TYPE identity_type AS ENUM ('user','guest'); CREATE TABLE messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), room_id uuid, sender_user_id uuid, sender_guest_id uuid, sender_type identity_type, sender_display_name text, sender_avatar_url text, content text, created_at timestamptz DEFAULT now()); CREATE TABLE profiles(id uuid PRIMARY KEY, display_name text); CREATE TABLE rooms(id uuid PRIMARY KEY, short_code text, invite_code text, name text, owner_id uuid, allow_guests boolean, is_locked boolean, password_required boolean, created_at timestamptz DEFAULT now()); CREATE TABLE room_endings(room_id uuid PRIMARY KEY REFERENCES rooms(id));`); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000015_room_moderation", "000017_chat_replies_edits", "000018_account_bans", "000020_message_revision"} {
		migration, err := os.ReadFile("../../migrations/" + name + ".up.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(migration)); err != nil {
			t.Fatal(err)
		}
	}
	repo := &Postgres{pool: pool}
	room, actor := uuid.NewString(), uuid.NewString()
	if _, err = pool.Exec(ctx, "INSERT INTO rooms(id,name,owner_id,allow_guests,is_locked,password_required) VALUES($1,'Test room',NULL,true,false,false)", room); err != nil {
		t.Fatal(err)
	}
	if err = repo.ModerateRoom(ctx, room, actor, "invalid", "Documented policy violation"); err == nil {
		t.Fatal("invalid reason accepted")
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM room_endings").Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid decision ended room", err)
	}
	guest := domain.Identity{ID: uuid.NewString(), Type: domain.IdentityGuest, DisplayName: "Guest"}
	message, err := repo.InsertMessage(ctx, room, guest, "before closure")
	if err != nil {
		t.Fatal(err)
	}
	if message.Revision != 0 {
		t.Fatalf("initial revision: %d", message.Revision)
	}
	edited, err := repo.EditMessage(ctx, room, message.ID, guest, "edited")
	if err != nil || edited.Revision != 1 {
		t.Fatalf("edit revision: %+v, %v", edited, err)
	}
	deleted, err := repo.DeleteMessage(ctx, room, message.ID, guest)
	if err != nil || deleted.Revision != 2 || !deleted.Deleted || deleted.Content != "" {
		t.Fatalf("delete revision: %+v, %v", deleted, err)
	}
	history, err := repo.RecentMessages(ctx, room, 10)
	if err != nil || len(history) != 1 || history[0].Revision != 2 {
		t.Fatalf("snapshot revision: %+v, %v", history, err)
	}
	if err = repo.ModerateRoom(ctx, room, actor, "policy", "Documented policy violation"); err != nil {
		t.Fatal(err)
	}
	if err = repo.ModerateRoom(ctx, room, uuid.NewString(), "other", "Changed during cleanup retry"); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.InsertMessage(ctx, room, guest, "after closure"); !errors.Is(err, domain.ErrRoomEnded) {
		t.Fatal("closed room accepted message", err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM messages").Scan(&count); err != nil || count != 1 {
		t.Fatal("closed room persisted chat", err)
	}
	var savedActor, reason, note string
	if err = pool.QueryRow(ctx, "SELECT actor_id::text,reason,note FROM room_moderation WHERE room_id=$1", room).Scan(&savedActor, &reason, &note); err != nil {
		t.Fatal(err)
	}
	if savedActor != actor || reason != "policy" || note != "Documented policy violation" {
		t.Fatal("retry replaced first decision")
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM room_endings").Scan(&count); err != nil || count != 1 {
		t.Fatal("missing ending", err)
	}
	items, total, err := repo.ListAdminRooms(ctx, room, "moderated", "", 25, 0)
	if err != nil || total != 1 || len(items) != 1 || items[0].Deleted {
		t.Fatal("moderated room missing", err)
	}
	// Chat waiting behind a closing transaction must re-read the committed ending.
	racingRoom := uuid.NewString()
	if _, err = pool.Exec(ctx, "INSERT INTO rooms(id) VALUES($1)", racingRoom); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT id FROM rooms WHERE id=$1 FOR UPDATE", racingRoom); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := repo.InsertMessage(ctx, racingRoom, guest, "racing closure"); result <- err }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err = admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock')", schema).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("chat did not serialize with closure")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if _, err = tx.Exec(ctx, "INSERT INTO room_endings(room_id) VALUES($1)", racingRoom); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-result; !errors.Is(err, domain.ErrRoomEnded) {
		t.Fatal("racing message bypassed closure", err)
	}
	if _, err = pool.Exec(ctx, "DELETE FROM room_endings; DELETE FROM rooms"); err != nil {
		t.Fatal(err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM room_moderation").Scan(&count); err != nil || count != 1 {
		t.Fatal("deleting room removed audit", err)
	}
	items, total, err = repo.ListAdminRooms(ctx, room, "moderated", "", 25, 0)
	if err != nil || total != 1 || len(items) != 1 || !items[0].Deleted || items[0].Moderation.Note != note {
		t.Fatal("deleted decision inaccessible", err)
	}
	items, total, err = repo.ListAdminRooms(ctx, room, "open", "", 25, 0)
	if err != nil || total != 0 || len(items) != 0 {
		t.Fatal("deleted decision reported open", err)
	}
}
