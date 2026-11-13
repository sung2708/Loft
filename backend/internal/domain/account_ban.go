package domain

import (
	"context"
	"errors"
	"time"
)

// ErrAccountSuspended is returned when an authenticated user has an active ban.
var ErrAccountSuspended = errors.New("account suspended")

// MaxAccountBanDays bounds temporary suspensions; nil ExpiresAt is permanent.
const MaxAccountBanDays = 365

type AccountBan struct {
	UserID    string     `json:"user_id"`
	ActorID   string     `json:"actor_id"`
	Reason    string     `json:"reason"`
	Note      string     `json:"note"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

// Active reports whether the ban is in force at now.
func (b AccountBan) Active(now time.Time) bool {
	return b.UserID != "" && (b.ExpiresAt == nil || b.ExpiresAt.After(now))
}

type AdminAuditEntry struct {
	ID         int64      `json:"id"`
	ActorID    string     `json:"actor_id"`
	ActorName  string     `json:"actor_name,omitempty"`
	Action     string     `json:"action"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	Reason     string     `json:"reason,omitempty"`
	Note       string     `json:"note,omitempty"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
}

// AccountBanStore persists suspensions; every mutation writes an audit row in
// the same transaction.
type AccountBanStore interface {
	ActiveAccountBan(ctx context.Context, userID string) (*AccountBan, error)
	BanAccount(ctx context.Context, ban AccountBan) error
	LiftAccountBan(ctx context.Context, userID, actorID string) error
	ListAdminAudit(ctx context.Context, limit, offset int) ([]AdminAuditEntry, int, error)
}

// CanSuspendAccount: only admins act, never on themselves or other admins
// (admins are managed through deployment configuration, not the dashboard).
func CanSuspendAccount(actorIsAdmin, targetIsAdmin bool, actorID, targetID string) bool {
	return actorIsAdmin && !targetIsAdmin && actorID != "" && targetID != "" && actorID != targetID
}
