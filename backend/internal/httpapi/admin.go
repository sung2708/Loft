package httpapi

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"loft/backend/internal/domain"
)

type adminListResponse[T any] struct {
	Items  []T `json:"items"`
	Total  int `json:"total"`
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

func (s *Server) isAdmin(userID string) bool {
	_, ok := s.adminUserIDs[userID]
	return ok
}

func (s *Server) adminStore(w http.ResponseWriter, r *http.Request) (domain.AdminStore, bool) {
	identity, err := s.authenticatedUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Sign in to continue")
		return nil, false
	}
	if !s.isAdmin(identity.ID) {
		writeError(w, http.StatusForbidden, "ADMIN_REQUIRED", "Admin access is required")
		return nil, false
	}
	admin, ok := s.store.(domain.AdminStore)
	if !ok {
		writeError(w, http.StatusServiceUnavailable, "ADMIN_UNAVAILABLE", "Admin data is temporarily unavailable")
		return nil, false
	}
	return admin, true
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.adminStore(w, r)
	if !ok {
		return
	}
	overview, err := admin.AdminOverview(r.Context())
	if err != nil {
		s.internal(w, r, "load admin overview", err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (s *Server) adminUsers(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.adminStore(w, r)
	if !ok {
		return
	}
	query, limit, offset, ok := adminListParams(w, r)
	if !ok {
		return
	}
	status := domain.AdminUserStatus(r.URL.Query().Get("status"))
	switch status {
	case domain.AdminUsersAll, domain.AdminUsersSuspended, domain.AdminUsersDeleting, domain.AdminUsersReported:
	default:
		writeError(w, http.StatusBadRequest, "INVALID_STATUS", "Invalid user status")
		return
	}
	users, total, err := admin.ListAdminUsers(r.Context(), query, status, limit, offset)
	if err != nil {
		s.internal(w, r, "list admin users", err)
		return
	}
	writeJSON(w, http.StatusOK, adminListResponse[domain.AdminUser]{Items: users, Total: total, Limit: limit, Offset: offset})
}

func (s *Server) adminRooms(w http.ResponseWriter, r *http.Request) {
	admin, ok := s.adminStore(w, r)
	if !ok {
		return
	}
	query, limit, offset, ok := adminListParams(w, r)
	if !ok {
		return
	}
	status, owner := r.URL.Query().Get("status"), r.URL.Query().Get("owner")
	if status != "" && status != "open" && status != "ended" && status != "moderated" {
		writeError(w, 400, "INVALID_STATUS", "Invalid room status")
		return
	}
	if owner != "" {
		parsed, err := uuid.Parse(owner)
		if err != nil {
			writeError(w, 400, "INVALID_OWNER", "Invalid owner ID")
			return
		}
		owner = parsed.String()
	}
	rooms, total, err := admin.ListAdminRooms(r.Context(), query, status, owner, limit, offset)
	if err != nil {
		s.internal(w, r, "list admin rooms", err)
		return
	}
	writeJSON(w, http.StatusOK, adminListResponse[domain.AdminRoom]{Items: rooms, Total: total, Limit: limit, Offset: offset})
}

func adminListParams(w http.ResponseWriter, r *http.Request) (string, int, int, bool) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) > 80 {
		writeError(w, http.StatusBadRequest, "INVALID_QUERY", "Search text is too long")
		return "", 0, 0, false
	}
	limit := 25
	if value := r.URL.Query().Get("limit"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 50 {
			writeError(w, http.StatusBadRequest, "INVALID_LIMIT", "Limit must be between 1 and 50")
			return "", 0, 0, false
		}
		limit = parsed
	}
	offset := 0
	if value := r.URL.Query().Get("offset"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 || parsed > 1_000_000 {
			writeError(w, http.StatusBadRequest, "INVALID_OFFSET", "Offset is invalid")
			return "", 0, 0, false
		}
		offset = parsed
	}
	return query, limit, offset, true
}
