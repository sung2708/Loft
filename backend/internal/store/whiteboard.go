package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"strings"

	"loft/backend/internal/domain"
)

const MaxBoardRecords = 1500
const MaxBoardBytes = 2 << 20

var ErrBoardConflict = errors.New("board version changed")
var ErrBoardLimit = errors.New("board size limit reached")
var ErrBoardInvalid = errors.New("invalid board record")

// SDK document records are opaque JSON only at this boundary, never permissions.
type BoardRecord struct {
	ID       string `json:"id"`
	TypeName string `json:"typeName"`
	Type     string `json:"type"`
}
type BoardSnapshot struct {
	Version int64                      `json:"version"`
	Records map[string]json.RawMessage `json:"records"`
}
type BoardPatch struct {
	Version int64             `json:"version"`
	Put     []json.RawMessage `json:"put"`
	Remove  []string          `json:"remove"`
}
type BoardRepository interface {
	LoadBoard(context.Context, string) (BoardSnapshot, error)
	BoardVersion(context.Context, string) (int64, error)
	PatchBoard(context.Context, string, BoardPatch) (BoardSnapshot, error)
}

func ApplyBoardPatch(snapshot BoardSnapshot, patch BoardPatch) (BoardSnapshot, error) {
	if snapshot.Version != patch.Version {
		return snapshot, ErrBoardConflict
	}
	if len(patch.Put)+len(patch.Remove) > 200 {
		return snapshot, ErrBoardLimit
	}
	records := make(map[string]json.RawMessage, len(snapshot.Records))
	for id, raw := range snapshot.Records {
		records[id] = raw
	}
	for _, id := range patch.Remove {
		if !strings.HasPrefix(id, "shape:") && !strings.HasPrefix(id, "binding:") {
			return snapshot, ErrBoardInvalid
		}
		delete(records, id)
	}
	changed := make([]string, 0, len(patch.Put))
	for _, raw := range patch.Put {
		var record BoardRecord
		if len(raw) > 64<<10 || !validBoardRecord(raw) || json.Unmarshal(raw, &record) != nil {
			return snapshot, ErrBoardInvalid
		}

		records[record.ID] = raw
		changed = append(changed, record.ID)
	}
	if !validBoardParents(records, changed) {
		return snapshot, ErrBoardInvalid
	}
	if len(records) > MaxBoardRecords {
		return snapshot, ErrBoardLimit
	}
	raw, err := json.Marshal(records)
	if err != nil || len(raw) > MaxBoardBytes {
		return snapshot, ErrBoardLimit
	}
	return BoardSnapshot{Version: snapshot.Version + 1, Records: records}, nil
}

func (p *Postgres) BoardVersion(ctx context.Context, roomID string) (int64, error) {
	var version int64
	err := p.pool.QueryRow(ctx, `SELECT version FROM room_whiteboards WHERE room_id=$1`, roomID).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return version, err
}
func (p *Postgres) LoadBoard(ctx context.Context, roomID string) (BoardSnapshot, error) {
	snapshot := BoardSnapshot{Records: map[string]json.RawMessage{}}
	var raw []byte
	err := p.pool.QueryRow(ctx, `SELECT version, records FROM room_whiteboards WHERE room_id=$1`, roomID).Scan(&snapshot.Version, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return snapshot, nil
	}
	if err != nil {
		return snapshot, err
	}
	err = json.Unmarshal(raw, &snapshot.Records)
	return snapshot, err
}
func (p *Postgres) PatchBoard(ctx context.Context, roomID string, patch BoardPatch) (BoardSnapshot, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return BoardSnapshot{}, err
	}
	defer tx.Rollback(ctx)
	if err := lockOpenRoom(ctx, tx, roomID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = domain.ErrNotFound
		}
		return BoardSnapshot{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO room_whiteboards(room_id) VALUES($1) ON CONFLICT DO NOTHING`, roomID)
	if err != nil {
		return BoardSnapshot{}, err
	}
	var snapshot BoardSnapshot
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT version,records FROM room_whiteboards WHERE room_id=$1 FOR UPDATE`, roomID).Scan(&snapshot.Version, &raw)
	if err != nil {
		return snapshot, err
	}
	if err = json.Unmarshal(raw, &snapshot.Records); err != nil {
		return snapshot, err
	}
	snapshot, err = ApplyBoardPatch(snapshot, patch)
	if err != nil {
		return snapshot, err
	}
	raw, err = json.Marshal(snapshot.Records)
	if err != nil {
		return snapshot, err
	}
	_, err = tx.Exec(ctx, `UPDATE room_whiteboards SET version=$2,records=$3,updated_at=now() WHERE room_id=$1`, roomID, snapshot.Version, raw)
	if err != nil {
		return snapshot, err
	}
	return snapshot, tx.Commit(ctx)
}

// Validate the merged graph: individually valid records can still form cycles.
func validBoardParents(records map[string]json.RawMessage, changed []string) bool {
	done := make(map[string]bool)
	// Unchanged legacy cycles stay quarantined without blocking unrelated edits.
	for _, id := range changed {
		path := make(map[string]bool)
		for current := id; current != "" && !done[current]; {
			if path[current] {
				return false
			}
			var record struct {
				TypeName string `json:"typeName"`
				ParentID string `json:"parentId"`
			}
			raw, exists := records[current]
			if !exists || json.Unmarshal(raw, &record) != nil || record.TypeName != "shape" {
				break
			}
			path[current] = true
			current = record.ParentID
		}
		for current := range path {
			done[current] = true
		}
	}
	return true
}
