package httpapi

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"loft/backend/internal/domain"
)

func (s *Server) adminReports(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminStore(w, r); !ok {
		return
	}
	reports, ok := s.store.(domain.ReportStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	_, limit, offset, ok := adminListParams(w, r)
	if !ok {
		return
	}
	status := domain.ReportStatus(r.URL.Query().Get("status"))
	if status == "" {
		status = domain.ReportOpen
	}
	if status != domain.ReportOpen && !domain.ValidReportResolution(status) {
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "Invalid report status")
		return
	}
	items, total, err := reports.ListReports(r.Context(), status, limit, offset)
	if err != nil {
		s.internal(w, r, "list reports", err)
		return
	}
	writeJSON(w, http.StatusOK, adminListResponse[domain.Report]{Items: items, Total: total, Limit: limit, Offset: offset})
}

func (s *Server) adminResolveReport(w http.ResponseWriter, r *http.Request) {
	actor, err := s.authenticatedUser(r)
	if err != nil || !s.isAdmin(actor.ID) {
		writeError(w, http.StatusForbidden, "ADMIN_REQUIRED", "Admin access is required")
		return
	}
	reports, ok := s.store.(domain.ReportStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	id, err := strconv.ParseInt(chi.URLParam(r, "reportID"), 10, 64)
	if err != nil || id < 1 {
		writeError(w, http.StatusNotFound, "REPORT_NOT_FOUND", "Report not found")
		return
	}
	var body struct {
		Status domain.ReportStatus `json:"status"`
		Note   string              `json:"note"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if !domain.ValidReportResolution(body.Status) || len([]rune(body.Note)) > domain.MaxReportDetails ||
		(body.Status == domain.ReportActioned && len([]rune(body.Note)) < 10) {
		writeError(w, http.StatusBadRequest, "INVALID_RESOLUTION", "Choose an outcome. Actioned reports need a note of 10–1000 characters.")
		return
	}
	report, err := reports.ResolveReport(r.Context(), id, actor.ID, body.Status, body.Note)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		writeError(w, http.StatusNotFound, "REPORT_NOT_FOUND", "Report not found")
	case errors.Is(err, domain.ErrConflict):
		writeError(w, http.StatusConflict, "REPORT_ALREADY_RESOLVED", "Another admin already closed this report")
	case err != nil:
		s.internal(w, r, "resolve report", err)
	default:
		s.logger.Info("report resolved", "request_id", middleware.GetReqID(r.Context()), "report_id", id, "status", body.Status)
		writeJSON(w, http.StatusOK, report)
	}
}

func (s *Server) adminUserDetail(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminStore(w, r); !ok {
		return
	}
	details, ok := s.store.(domain.AdminUserDetailStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	id, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		return
	}
	detail, err := details.AdminUserDetail(r.Context(), id.String())
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		return
	}
	if err != nil {
		s.internal(w, r, "load admin user detail", err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// adminAuditFilterParams parses action, actor, target, from and to. Dates are
// YYYY-MM-DD in UTC; "to" is inclusive of that whole day.
func adminAuditFilterParams(w http.ResponseWriter, r *http.Request) (domain.AdminAuditFilter, bool) {
	query := r.URL.Query()
	filter := domain.AdminAuditFilter{Action: query.Get("action"), ActorID: query.Get("actor"), TargetID: strings.TrimSpace(query.Get("target"))}
	if !domain.ValidAuditAction(filter.Action) {
		writeError(w, http.StatusBadRequest, "INVALID_ACTION", "Invalid audit action")
		return filter, false
	}
	if filter.ActorID != "" {
		id, err := uuid.Parse(filter.ActorID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_ACTOR", "Invalid administrator ID")
			return filter, false
		}
		filter.ActorID = id.String()
	}
	if len(filter.TargetID) > 64 {
		writeError(w, http.StatusBadRequest, "INVALID_TARGET", "Target ID is too long")
		return filter, false
	}
	if id, err := uuid.Parse(filter.TargetID); err == nil {
		filter.TargetID = id.String()
	}
	for _, field := range []struct {
		name string
		dest **time.Time
		end  bool
	}{{"from", &filter.From, false}, {"to", &filter.To, true}} {
		value := query.Get(field.name)
		if value == "" {
			continue
		}
		day, err := time.Parse(time.DateOnly, value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DATE", "Dates must be YYYY-MM-DD")
			return filter, false
		}
		if field.end {
			day = day.Add(24 * time.Hour)
		}
		*field.dest = &day
	}
	if filter.From != nil && filter.To != nil && !filter.From.Before(*filter.To) {
		writeError(w, http.StatusBadRequest, "INVALID_DATE", "The start date must be before the end date")
		return filter, false
	}
	return filter, true
}

func (s *Server) adminAuditExport(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminStore(w, r); !ok {
		return
	}
	bans, ok := s.store.(domain.AccountBanStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	filter, ok := adminAuditFilterParams(w, r)
	if !ok {
		return
	}
	entries, total, err := bans.ListAdminAudit(r.Context(), filter, domain.MaxAuditExportRows, 0)
	if err != nil {
		s.internal(w, r, "export admin audit", err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="mingly-audit-`+time.Now().UTC().Format("20060102-150405")+`.csv"`)
	w.Header().Set("X-Total-Count", strconv.Itoa(total))
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	// UTF-8 BOM so spreadsheet apps read Vietnamese names correctly.
	_, _ = w.Write([]byte("\xef\xbb\xbf"))
	out := csv.NewWriter(w)
	_ = out.Write([]string{"id", "created_at", "actor_id", "actor_name", "action", "target_type", "target_id", "reason", "note", "expires_at"})
	for _, e := range entries {
		expires := ""
		if e.ExpiresAt != nil {
			expires = e.ExpiresAt.UTC().Format(time.RFC3339)
		}
		_ = out.Write([]string{strconv.FormatInt(e.ID, 10), e.CreatedAt.UTC().Format(time.RFC3339), e.ActorID, csvCell(e.ActorName), e.Action,
			e.TargetType, csvCell(e.TargetID), e.Reason, csvCell(e.Note), expires})
	}
	out.Flush()
}

// csvCell neutralizes spreadsheet formula injection in free text.
func csvCell(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		return "'" + value
	}
	return value
}
