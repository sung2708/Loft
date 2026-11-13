package domain

import (
	"context"
	"time"
)

type ReportTarget string

const (
	ReportTargetUser  ReportTarget = "user"
	ReportTargetGuest ReportTarget = "guest"
	ReportTargetRoom  ReportTarget = "room"
)

type ReportStatus string

const (
	ReportOpen      ReportStatus = "open"
	ReportActioned  ReportStatus = "actioned"
	ReportDismissed ReportStatus = "dismissed"
)

const MaxReportDetails = 1000

type Report struct {
	ID             int64        `json:"id"`
	ReporterType   IdentityType `json:"reporter_type"`
	ReporterID     string       `json:"reporter_id"`
	ReporterName   string       `json:"reporter_name"`
	RoomID         string       `json:"room_id"`
	RoomName       string       `json:"room_name"`
	TargetType     ReportTarget `json:"target_type"`
	TargetID       string       `json:"target_id"`
	TargetName     string       `json:"target_name"`
	Reason         string       `json:"reason"`
	Details        string       `json:"details"`
	Status         ReportStatus `json:"status"`
	ResolvedBy     string       `json:"resolved_by,omitempty"`
	ResolutionNote string       `json:"resolution_note,omitempty"`
	ResolvedAt     *time.Time   `json:"resolved_at,omitempty"`
	CreatedAt      time.Time    `json:"created_at"`
	// TargetReports counts every report against the same target, this one included.
	TargetReports int `json:"target_reports"`
}

type ReportStore interface {
	// CreateReport returns ErrConflict while the reporter already has an open
	// report against the same target.
	CreateReport(context.Context, Report) (Report, error)
	ListReports(context.Context, ReportStatus, int, int) ([]Report, int, error)
	// ResolveReport closes an open report and writes the audit row atomically.
	// It returns ErrNotFound for an unknown id and ErrConflict when already closed.
	ResolveReport(context.Context, int64, string, ReportStatus, string) (Report, error)
}

func ValidReportTarget(target ReportTarget) bool {
	return target == ReportTargetUser || target == ReportTargetGuest || target == ReportTargetRoom
}

func ValidReportResolution(status ReportStatus) bool {
	return status == ReportActioned || status == ReportDismissed
}

// CanReport: any admitted participant may report a room or another
// participant, never themselves.
func CanReport(reporter Identity, target ReportTarget, targetID string) bool {
	if reporter.ID == "" || !ValidReportTarget(target) || targetID == "" {
		return false
	}
	if target == ReportTargetRoom {
		return true
	}
	return !(string(reporter.Type) == string(target) && reporter.ID == targetID)
}
