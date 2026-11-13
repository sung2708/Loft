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

type suspensionNotifier interface {
	DisconnectUser(context.Context, string)
	InvalidateSuspension(string)
}

// adminBanTarget authenticates the admin and resolves the target user id.
func (s *Server) adminBanTarget(w http.ResponseWriter, r *http.Request) (domain.Identity, string, domain.AccountBanStore, bool) {
	actor, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Sign in to continue")
		return actor, "", nil, false
	}
	target := chi.URLParam(r, "userID")
	parsed, err := uuid.Parse(target)
	if err != nil {
		writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
		return actor, "", nil, false
	}
	target = parsed.String()
	if !domain.CanSuspendAccount(s.isAdmin(actor.ID), s.isAdmin(target), actor.ID, target) {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "This account cannot be suspended")
		return actor, "", nil, false
	}
	bans, ok := s.store.(domain.AccountBanStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return actor, "", nil, false
	}
	return actor, target, bans, true
}

func (s *Server) adminSuspendUser(w http.ResponseWriter, r *http.Request) {
	actor, target, bans, ok := s.adminBanTarget(w, r)
	if !ok {
		return
	}
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
		// Days == 0 means permanent.
		Days int `json:"days"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Note = strings.TrimSpace(body.Note)
	if !domain.ValidModerationReason(body.Reason) || len([]rune(body.Note)) < 10 || len([]rune(body.Note)) > 1000 || body.Days < 0 || body.Days > domain.MaxAccountBanDays {
		writeError(w, http.StatusBadRequest, "INVALID_MODERATION", "Select a reason, a duration, and a note between 10 and 1000 characters")
		return
	}
	ban := domain.AccountBan{UserID: target, ActorID: actor.ID, Reason: body.Reason, Note: body.Note}
	if body.Days > 0 {
		expires := time.Now().UTC().Add(time.Duration(body.Days) * 24 * time.Hour)
		ban.ExpiresAt = &expires
	}
	if err := bans.BanAccount(r.Context(), ban); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "USER_NOT_FOUND", "User not found")
			return
		}
		s.internal(w, r, "suspend account", err)
		return
	}
	s.bans.Invalidate(target)
	if notifier, ok := s.deletion.(suspensionNotifier); ok {
		notifier.DisconnectUser(r.Context(), target)
	}
	s.logger.Info("account suspended", "request_id", middleware.GetReqID(r.Context()), "reason", body.Reason, "permanent", body.Days == 0)
	writeJSON(w, http.StatusOK, ban)
}

func (s *Server) adminLiftSuspension(w http.ResponseWriter, r *http.Request) {
	actor, target, bans, ok := s.adminBanTarget(w, r)
	if !ok {
		return
	}
	if err := bans.LiftAccountBan(r.Context(), target, actor.ID); err != nil {
		if errors.Is(err, domain.ErrNotFound) {
			writeError(w, http.StatusNotFound, "SUSPENSION_NOT_FOUND", "This account is not suspended")
			return
		}
		s.internal(w, r, "lift suspension", err)
		return
	}
	s.bans.Invalidate(target)
	if notifier, ok := s.deletion.(suspensionNotifier); ok {
		notifier.InvalidateSuspension(target)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminAudit(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.adminStore(w, r); !ok {
		return
	}
	bans, ok := s.store.(domain.AccountBanStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return
	}
	_, limit, offset, ok := adminListParams(w, r)
	if !ok {
		return
	}
	filter, ok := adminAuditFilterParams(w, r)
	if !ok {
		return
	}
	entries, total, err := bans.ListAdminAudit(r.Context(), filter, limit, offset)
	if err != nil {
		s.internal(w, r, "list admin audit", err)
		return
	}
	writeJSON(w, http.StatusOK, adminListResponse[domain.AdminAuditEntry]{Items: entries, Total: total, Limit: limit, Offset: offset})
}
