package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"loft/backend/internal/domain"
)

// participantCounter is implemented by the realtime hub.
type participantCounter interface {
	ParticipantCounts(context.Context, []string) map[string]int
}

func (s *Server) accountStore(w http.ResponseWriter, r *http.Request) (domain.Identity, domain.AccountStore, bool) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return identity, nil, false
	}
	accounts, ok := s.store.(domain.AccountStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ACCOUNT_UNAVAILABLE", "Account settings are temporarily unavailable")
		return identity, nil, false
	}
	return identity, accounts, true
}

func (s *Server) account(w http.ResponseWriter, r *http.Request) {
	identity, accounts, ok := s.accountStore(w, r)
	if !ok {
		return
	}
	if err := s.store.UpsertProfile(r.Context(), identity); err != nil {
		s.internal(w, r, "upsert profile", err)
		return
	}
	profile, err := accounts.AccountProfile(r.Context(), identity.ID)
	if err != nil {
		s.internal(w, r, "load account", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) updateAccount(w http.ResponseWriter, r *http.Request) {
	identity, accounts, ok := s.accountStore(w, r)
	if !ok {
		return
	}
	if !s.accountLimit.AllowContext(r.Context(), identity.ID) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many changes. Try again later.")
		return
	}
	var body struct {
		DisplayName *string `json:"display_name"`
		HideAvatar  bool    `json:"hide_avatar"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	settings := domain.ProfileSettings{HideAvatar: body.HideAvatar}
	if body.DisplayName != nil && strings.TrimSpace(*body.DisplayName) != "" {
		name, err := domain.ValidateDisplayName(*body.DisplayName)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DISPLAY_NAME", "Display name must be 2–48 characters")
			return
		}
		settings.CustomDisplayName = &name
	}
	if err := s.store.UpsertProfile(r.Context(), identity); err != nil {
		s.internal(w, r, "upsert profile", err)
		return
	}
	if err := accounts.UpdateProfileSettings(r.Context(), identity, settings); err != nil {
		s.internal(w, r, "update profile settings", err)
		return
	}
	if notifier, ok := s.deletion.(interface{ NotifyProfileChanged(context.Context, string) }); ok {
		notifier.NotifyProfileChanged(r.Context(), identity.ID)
	}
	profile, err := accounts.AccountProfile(r.Context(), identity.ID)
	if err != nil {
		s.internal(w, r, "load account", err)
		return
	}
	writeJSON(w, http.StatusOK, profile)
}

func (s *Server) scheduleAccountDeletion(w http.ResponseWriter, r *http.Request) {
	identity, accounts, ok := s.accountStore(w, r)
	if !ok {
		return
	}
	var body struct {
		Confirm string `json:"confirm"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.Confirm != "DELETE" {
		writeError(w, http.StatusBadRequest, "CONFIRMATION_REQUIRED", "Type DELETE to confirm")
		return
	}
	scheduled, err := accounts.ScheduleAccountDeletion(r.Context(), identity.ID, time.Now().UTC().Add(domain.AccountDeletionGrace))
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ACCOUNT_NOT_FOUND", "Account not found")
		return
	}
	if err != nil {
		s.internal(w, r, "schedule account deletion", err)
		return
	}
	s.logger.Info("account deletion scheduled", "request_id", middleware.GetReqID(r.Context()), "scheduled_for", scheduled)
	writeJSON(w, http.StatusOK, map[string]time.Time{"deletion_scheduled_for": scheduled})
}

func (s *Server) cancelAccountDeletion(w http.ResponseWriter, r *http.Request) {
	identity, accounts, ok := s.accountStore(w, r)
	if !ok {
		return
	}
	if err := accounts.CancelAccountDeletion(r.Context(), identity.ID); err != nil && !errors.Is(err, domain.ErrNotFound) {
		s.internal(w, r, "cancel account deletion", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) exportAccount(w http.ResponseWriter, r *http.Request) {
	identity, accounts, ok := s.accountStore(w, r)
	if !ok {
		return
	}
	if !s.exportLimit.AllowContext(r.Context(), identity.ID) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "You can download your data a few times an hour. Try again later.")
		return
	}
	export, err := accounts.ExportAccount(r.Context(), identity.ID)
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ACCOUNT_NOT_FOUND", "Account not found")
		return
	}
	if err != nil {
		s.internal(w, r, "export account", err)
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="mingly-data-`+time.Now().UTC().Format("20060102")+`.json"`)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, export)
}

func (s *Server) recentRooms(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	visits, ok := s.store.(domain.RoomVisitStore)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"rooms": []domain.RecentRoom{}, "live": map[string]int{}})
		return
	}
	rooms, err := visits.ListRecentRooms(r.Context(), identity.ID, 30)
	if err != nil {
		s.internal(w, r, "list recent rooms", err)
		return
	}
	ids := make([]string, len(rooms))
	for i, room := range rooms {
		ids[i] = room.ID
	}
	writeJSON(w, http.StatusOK, map[string]any{"rooms": rooms, "live": s.liveCounts(r.Context(), ids)})
}

func (s *Server) forgetRoomVisit(w http.ResponseWriter, r *http.Request) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required")
		return
	}
	roomID, err := uuid.Parse(chi.URLParam(r, "roomID"))
	if err != nil {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if visits, ok := s.store.(domain.RoomVisitStore); ok {
		if err := visits.ForgetRoomVisit(r.Context(), identity.ID, roomID.String()); err != nil {
			s.internal(w, r, "forget room visit", err)
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// liveCounts asks the realtime layer how many people are in each room. It is
// bounded in time and returns what it has when presence is slow.
func (s *Server) liveCounts(parent context.Context, roomIDs []string) map[string]int {
	counter, ok := s.deletion.(participantCounter)
	if !ok || len(roomIDs) == 0 {
		return map[string]int{}
	}
	ctx, cancel := context.WithTimeout(parent, 1500*time.Millisecond)
	defer cancel()
	return counter.ParticipantCounts(ctx, roomIDs)
}

// recordVisit is best effort: a failure never blocks joining a room.
func (s *Server) recordVisit(r *http.Request, identity domain.Identity, roomID string) {
	if identity.Type != domain.IdentityUser {
		return
	}
	visits, ok := s.store.(domain.RoomVisitStore)
	if !ok {
		return
	}
	if err := visits.RecordRoomVisit(r.Context(), identity.ID, roomID); err != nil {
		s.logger.Warn("record room visit failed", "request_id", middleware.GetReqID(r.Context()), "room_id", roomID, "error", err)
	}
}

func (s *Server) createReport(w http.ResponseWriter, r *http.Request) {
	reports, ok := s.store.(domain.ReportStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "REPORTS_UNAVAILABLE", "Reporting is temporarily unavailable")
		return
	}
	room, err := s.store.GetRoom(r.Context(), chi.URLParam(r, "roomID"))
	if errors.Is(err, domain.ErrRoomEnded) {
		err = nil
	}
	if errors.Is(err, domain.ErrNotFound) {
		writeError(w, http.StatusNotFound, "ROOM_NOT_FOUND", "Room not found")
		return
	}
	if err != nil {
		s.internal(w, r, "get room for report", err)
		return
	}
	reporter, err := s.requestIdentity(r, room)
	if err != nil {
		s.writeRoomIdentityError(w, r, err)
		return
	}
	var body struct {
		TargetType domain.ReportTarget `json:"target_type"`
		TargetID   string              `json:"target_id"`
		TargetName string              `json:"target_name"`
		Reason     string              `json:"reason"`
		Details    string              `json:"details"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if body.TargetType == domain.ReportTargetRoom {
		body.TargetID, body.TargetName = room.ID, room.Name
	}
	target, err := uuid.Parse(body.TargetID)
	body.Details = strings.TrimSpace(body.Details)
	body.TargetName = strings.Join(strings.Fields(body.TargetName), " ")
	if err != nil || !domain.ValidModerationReason(body.Reason) || len([]rune(body.Details)) > domain.MaxReportDetails ||
		body.TargetName == "" || len([]rune(body.TargetName)) > 80 || !domain.CanReport(reporter, body.TargetType, target.String()) {
		writeError(w, http.StatusBadRequest, "INVALID_REPORT", "Choose who or what to report and a reason")
		return
	}
	if body.TargetType != domain.ReportTargetRoom {
		guard, ok := s.deletion.(mediaAdmissionGuard)
		if !ok {
			writeError(w, http.StatusServiceUnavailable, "REPORTS_UNAVAILABLE", "Reporting is temporarily unavailable")
			return
		}
		admitted, err := guard.CanIssueMediaToken(r.Context(), room.ID, domain.Identity{
			ID: target.String(), Type: domain.IdentityType(body.TargetType),
		})
		if err != nil {
			s.internal(w, r, "check report target admission", err)
			return
		}
		if !admitted {
			writeError(w, http.StatusBadRequest, "INVALID_REPORT", "That participant is no longer in this room")
			return
		}
	}
	// The budget counts reports that would be stored, per reporter identity.
	if !s.reportLimit.AllowContext(r.Context(), reporter.LiveKitIdentity()) {
		writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many reports. Try again later.")
		return
	}
	report, err := reports.CreateReport(r.Context(), domain.Report{
		ReporterType: reporter.Type, ReporterID: reporter.ID, ReporterName: reporter.DisplayName,
		RoomID: room.ID, RoomName: room.Name, TargetType: body.TargetType, TargetID: target.String(), TargetName: body.TargetName,
		Reason: body.Reason, Details: body.Details,
	})
	if errors.Is(err, domain.ErrConflict) {
		writeError(w, http.StatusConflict, "REPORT_ALREADY_OPEN", "You already reported this. An admin will review it.")
		return
	}
	if err != nil {
		s.internal(w, r, "create report", err)
		return
	}
	s.logger.Info("report created", "request_id", middleware.GetReqID(r.Context()), "report_id", report.ID, "target_type", report.TargetType, "reason", report.Reason)
	writeJSON(w, http.StatusCreated, map[string]any{"id": report.ID, "status": report.Status})
}
