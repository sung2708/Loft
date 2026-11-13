package domain

import (
	"context"
	"time"
)

// AccountDeletionGrace is how long a scheduled deletion can be cancelled.
const AccountDeletionGrace = 14 * 24 * time.Hour

// ProfileOverrides are member choices that win over identity-provider claims.
type ProfileOverrides struct {
	DisplayName string
	HideAvatar  bool
}

// Apply returns the identity as other participants should see it.
func (o ProfileOverrides) Apply(identity Identity) Identity {
	if o.DisplayName != "" {
		identity.DisplayName = o.DisplayName
	}
	if o.HideAvatar {
		identity.AvatarURL = ""
	}
	return identity
}

type AccountProfile struct {
	ID                   string     `json:"id"`
	DisplayName          string     `json:"display_name"`
	CustomDisplayName    *string    `json:"custom_display_name"`
	AvatarURL            string     `json:"avatar_url,omitempty"`
	HideAvatar           bool       `json:"hide_avatar"`
	CreatedAt            time.Time  `json:"created_at"`
	DeletionScheduledFor *time.Time `json:"deletion_scheduled_for"`
}

type ProfileSettings struct {
	// CustomDisplayName nil restores the provider name.
	CustomDisplayName *string
	HideAvatar        bool
}

type ExportedRoom struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type ExportedMessage struct {
	RoomID    string     `json:"room_id"`
	Content   string     `json:"content"`
	CreatedAt time.Time  `json:"created_at"`
	EditedAt  *time.Time `json:"edited_at,omitempty"`
	Deleted   bool       `json:"deleted"`
}

type ExportedFeedback struct {
	RoomID    string    `json:"room_id"`
	Rating    int       `json:"rating"`
	Tags      []string  `json:"tags"`
	CreatedAt time.Time `json:"created_at"`
}

// MaxExportedMessages bounds one export; the newest messages are kept.
const MaxExportedMessages = 10000

type AccountExport struct {
	ExportedAt   time.Time          `json:"exported_at"`
	Profile      AccountProfile     `json:"profile"`
	Rooms        []ExportedRoom     `json:"rooms"`
	Messages     []ExportedMessage  `json:"messages"`
	CallFeedback []ExportedFeedback `json:"call_feedback"`
	RecentRooms  []RecentRoom       `json:"recent_rooms"`
}

type RecentRoom struct {
	Room
	OwnerName     string    `json:"owner_name"`
	LastVisitedAt time.Time `json:"last_visited_at"`
}

type DueDeletion struct {
	UserID      string
	RequestedAt time.Time
}

type AccountStore interface {
	ProfileOverrides(context.Context, string) (ProfileOverrides, error)
	AccountProfile(context.Context, string) (AccountProfile, error)
	UpdateProfileSettings(context.Context, Identity, ProfileSettings) error
	ScheduleAccountDeletion(context.Context, string, time.Time) (time.Time, error)
	CancelAccountDeletion(context.Context, string) error
	ExportAccount(context.Context, string) (AccountExport, error)
	DueAccountDeletions(context.Context, time.Time, int) ([]DueDeletion, error)
	OwnedRoomIDs(context.Context, string) ([]string, error)
	PostponeAccountDeletion(context.Context, DueDeletion, time.Time) error
	// PurgeAccount deletes a due account and everything it owns. It returns
	// ErrNotFound when not due and ErrConflict if an owned room is not fenced.
	PurgeAccount(context.Context, DueDeletion, time.Time, []string) error
}

type RoomVisitStore interface {
	RecordRoomVisit(context.Context, string, string) error
	ListRecentRooms(context.Context, string, int) ([]RecentRoom, error)
	ForgetRoomVisit(context.Context, string, string) error
}
