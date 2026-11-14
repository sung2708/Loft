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
	"loft/backend/internal/domain"
)

func TestPostgresConcurrentJoinDecisions(t *testing.T) {
	if os.Getenv("LOFT_RELEASE_DB_TEST") != "1" {
		t.Skip("requires disposable PostgreSQL via DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	cfg, err := pgxpool.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "join_decisions_" + uuid.NewString()[:8]
	schema := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
	cfg.ConnConfig.RuntimeParams["search_path"] = name + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if _, err := pool.Exec(ctx, `CREATE TABLE profiles(id uuid PRIMARY KEY);
		CREATE TABLE rooms(id uuid PRIMARY KEY, owner_id uuid NOT NULL);
		CREATE TABLE room_members(room_id uuid, user_id uuid, role text, PRIMARY KEY(room_id, user_id));`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{"000007_room_join_requests.up.sql", "000024_join_request_decisions.up.sql"} {
		sql, err := os.ReadFile(filepath.Join("..", "..", "migrations", file))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	room, owner, user := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO profiles VALUES($1)", []any{user}},
		{"INSERT INTO rooms VALUES($1,$2)", []any{room, owner}},
		{"INSERT INTO room_join_requests(room_id,user_id) VALUES($1,$2)", []any{room, user}},
	} {
		if _, err := pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	repo := &Postgres{pool: pool}
	start := make(chan struct{}, 1)
	approved, rejected := make(chan error, 1), make(chan error, 1)
	go func() { <-start; approved <- repo.ResolveJoinRequest(ctx, room, owner, user, true) }()
	go func() { <-start; rejected <- repo.ResolveJoinRequest(ctx, room, owner, user, false) }()
	close(start)
	a, r := <-approved, <-rejected
	want := "approved"
	switch {
	case a == nil && errors.Is(r, domain.ErrNotFound):
	case r == nil && errors.Is(a, domain.ErrNotFound):
		want = "rejected"
	default:
		t.Fatalf("expected one decision: approve=%v reject=%v", a, r)
	}
	if got, err := repo.JoinRequestStatus(ctx, room, user); err != nil || got != want {
		t.Fatalf("status=%q, want %q: %v", got, want, err)
	}
	if member, err := repo.IsRoomMember(ctx, room, user); err != nil || member != (want == "approved") {
		t.Fatalf("membership=%t for %s: %v", member, want, err)
	}
}
