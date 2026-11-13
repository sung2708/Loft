package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"loft/backend/internal/domain"
)

const reportColumns = `c.id, c.reporter_type, c.reporter_id::text, c.reporter_name, c.room_id::text, COALESCE(r.name, c.room_name),
	c.target_type, c.target_id::text, COALESCE(CASE WHEN c.target_type = 'user' THEN tp.display_name END, CASE WHEN c.target_type = 'room' THEN r.name END, c.target_name),
	c.reason, c.details, c.status, COALESCE(c.resolved_by::text, ''), COALESCE(c.resolution_note, ''), c.resolved_at, c.created_at,
	(SELECT COUNT(*)::int FROM content_reports o WHERE o.target_type = c.target_type AND o.target_id = c.target_id)`

const reportJoins = ` FROM content_reports c
	LEFT JOIN rooms r ON r.id = c.room_id
	LEFT JOIN profiles tp ON c.target_type = 'user' AND tp.id = c.target_id `

func scanReport(row rowScanner) (domain.Report, error) {
	var report domain.Report
	err := row.Scan(&report.ID, &report.ReporterType, &report.ReporterID, &report.ReporterName, &report.RoomID, &report.RoomName,
		&report.TargetType, &report.TargetID, &report.TargetName, &report.Reason, &report.Details, &report.Status,
		&report.ResolvedBy, &report.ResolutionNote, &report.ResolvedAt, &report.CreatedAt, &report.TargetReports)
	return report, err
}

func (p *Postgres) CreateReport(ctx context.Context, report domain.Report) (domain.Report, error) {
	var id int64
	err := p.pool.QueryRow(ctx, `INSERT INTO content_reports (reporter_type, reporter_id, reporter_name, room_id, room_name, target_type, target_id, target_name, reason, details)
		VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::uuid, $8, $9, $10) RETURNING id`,
		report.ReporterType, report.ReporterID, report.ReporterName, report.RoomID, report.RoomName,
		report.TargetType, report.TargetID, report.TargetName, report.Reason, report.Details).Scan(&id)
	if isUniqueViolation(err) {
		return domain.Report{}, domain.ErrConflict
	}
	if err != nil {
		return domain.Report{}, err
	}
	return scanReport(p.pool.QueryRow(ctx, `SELECT `+reportColumns+reportJoins+` WHERE c.id = $1`, id))
}

// ListReports pages a queue. Open reports are worked oldest first; closed
// ones are reviewed newest first.
func (p *Postgres) ListReports(ctx context.Context, status domain.ReportStatus, limit, offset int) ([]domain.Report, int, error) {
	var total int
	if err := p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM content_reports WHERE status = $1`, status).Scan(&total); err != nil {
		return nil, 0, err
	}
	order := ` ORDER BY c.created_at DESC, c.id DESC`
	if status == domain.ReportOpen {
		order = ` ORDER BY c.created_at, c.id`
	}
	rows, err := p.pool.Query(ctx, `SELECT `+reportColumns+reportJoins+` WHERE c.status = $1`+order+` LIMIT $2 OFFSET $3`, status, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	reports := make([]domain.Report, 0, limit)
	for rows.Next() {
		report, err := scanReport(rows)
		if err != nil {
			return nil, 0, err
		}
		reports = append(reports, report)
	}
	return reports, total, rows.Err()
}

// ResolveReport is a single conditional update: when two admins close the
// same report at once exactly one succeeds and the other gets ErrConflict.
func (p *Postgres) ResolveReport(ctx context.Context, id int64, actorID string, status domain.ReportStatus, note string) (domain.Report, error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.Report{}, err
	}
	defer tx.Rollback(ctx)
	var targetType, targetID, reason string
	err = tx.QueryRow(ctx, `UPDATE content_reports SET status = $2, resolved_by = $3::uuid, resolution_note = NULLIF($4, ''), resolved_at = NOW()
		WHERE id = $1 AND status = 'open' RETURNING target_type, target_id::text, reason`, id, status, actorID, note).Scan(&targetType, &targetID, &reason)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM content_reports WHERE id = $1)`, id).Scan(&exists); err != nil {
			return domain.Report{}, err
		}
		if exists {
			return domain.Report{}, domain.ErrConflict
		}
		return domain.Report{}, domain.ErrNotFound
	}
	if err != nil {
		return domain.Report{}, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO admin_audit_log (actor_id, action, target_type, target_id, reason, note)
		VALUES ($1::uuid, $2, $3, $4, $5, NULLIF($6, ''))`, actorID, "report."+string(status), targetType, targetID, reason, note); err != nil {
		return domain.Report{}, err
	}
	report, err := scanReport(tx.QueryRow(ctx, `SELECT `+reportColumns+reportJoins+` WHERE c.id = $1`, id))
	if err != nil {
		return domain.Report{}, err
	}
	return report, tx.Commit(ctx)
}
