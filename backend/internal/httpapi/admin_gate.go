package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
)

// ConfigureAdminMFA makes every admin request require a session verified with
// a second factor (Supabase aal2). Clients receive ADMIN_MFA_REQUIRED and are
// expected to run the MFA step rather than sign out.
func (s *Server) ConfigureAdminMFA(required bool) {
	s.adminRequireMFA = required
}

// adminGate is the single entry check for /api/v1/admin. Handlers still call
// their own authorization helpers; this layer adds what must apply to every
// admin request: denial logging, per-admin budgets and the MFA requirement.
func (s *Server) adminGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		identity, err := s.authenticatedUser(r)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Sign in to continue")
			return
		}
		requestID := middleware.GetReqID(r.Context())
		if !s.isAdmin(identity.ID) {
			s.logger.Warn("admin access denied", "request_id", requestID, "user_id", identity.ID, "method", r.Method, "path", r.URL.Path)
			writeError(w, http.StatusForbidden, "ADMIN_REQUIRED", "Admin access is required")
			return
		}
		if !s.adminLimit.AllowContext(r.Context(), identity.ID) ||
			(r.Method != http.MethodGet && !s.adminWriteLimit.AllowContext(r.Context(), identity.ID)) {
			s.logger.Warn("admin rate limited", "request_id", requestID, "user_id", identity.ID, "method", r.Method, "path", r.URL.Path)
			writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "Too many admin requests. Wait a moment.")
			return
		}
		if s.adminRequireMFA && identity.AAL != "aal2" {
			writeError(w, http.StatusForbidden, "ADMIN_MFA_REQUIRED", "Verify with your authenticator app to continue")
			return
		}
		next.ServeHTTP(w, r)
	})
}
