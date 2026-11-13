package domain

import (
	"context"
	"errors"
	"net/url"
	"path"
	"strings"
	"time"
)

const MaxMessageLength = 2000

var ErrRoomEnded = errors.New("room has ended")

var (
	ErrNotFound              = errors.New("not found")
	ErrUnauthorized          = errors.New("unauthorized")
	ErrInvalidName           = errors.New("invalid display name")
	ErrInvalidChat           = errors.New("invalid chat message")
	ErrConflict              = errors.New("conflict")
	ErrBanned                = errors.New("banned")
	ErrInvalidRoomAppearance = errors.New("invalid room appearance")
)

type IdentityType string

const (
	IdentityUser  IdentityType = "user"
	IdentityGuest IdentityType = "guest"
)

type Identity struct {
	ID          string       `json:"id"`
	Type        IdentityType `json:"type"`
	DisplayName string       `json:"display_name"`
	AvatarURL   string       `json:"avatar_url,omitempty"`
	RoomID      string       `json:"-"`
	// AAL is the Supabase authenticator assurance level ("aal1" or "aal2").
	AAL            string `json:"-"`
	ProviderName   string `json:"-"`
	ProviderAvatar string `json:"-"`
}

func (i Identity) LiveKitIdentity() string { return string(i.Type) + ":" + i.ID }

type Room struct {
	ID                      string         `json:"id"`
	Slug                    string         `json:"slug"`
	Name                    string         `json:"name"`
	OwnerID                 string         `json:"owner_id"`
	AllowGuests             bool           `json:"allow_guests"`
	MaxParticipants         int            `json:"max_participants"`
	IsLocked                bool           `json:"is_locked"`
	Version                 int64          `json:"version"`
	PasswordRequired        bool           `json:"password_required"`
	PasswordVerifier        string         `json:"-"`
	Atmosphere              RoomAtmosphere `json:"atmosphere"`
	Accent                  RoomAccent     `json:"accent"`
	AdaptiveMediaBackground bool           `json:"adaptive_media_background"`
	CreatedAt               time.Time      `json:"created_at"`
}

type RoomAtmosphere string

const (
	AtmosphereMinimal RoomAtmosphere = "minimal"
	AtmosphereAmbient RoomAtmosphere = "ambient"
	AtmosphereFocus   RoomAtmosphere = "focus"
	AtmosphereParty   RoomAtmosphere = "party"
)

type RoomAccent string

const (
	AccentBlue   RoomAccent = "blue"
	AccentPurple RoomAccent = "purple"
	AccentGreen  RoomAccent = "green"
	AccentOrange RoomAccent = "orange"
	AccentRose   RoomAccent = "rose"
)

type RoomAppearanceUpdate struct {
	Atmosphere              RoomAtmosphere
	Accent                  RoomAccent
	AdaptiveMediaBackground bool
}

func (a RoomAtmosphere) Valid() bool {
	switch a {
	case AtmosphereMinimal, AtmosphereAmbient, AtmosphereFocus, AtmosphereParty:
		return true
	}
	return false
}

func (a RoomAccent) Valid() bool {
	switch a {
	case AccentBlue, AccentPurple, AccentGreen, AccentOrange, AccentRose:
		return true
	}
	return false
}

func NormalizeRoomAppearance(room Room) Room {
	if !room.Atmosphere.Valid() {
		room.Atmosphere = AtmosphereAmbient
		room.AdaptiveMediaBackground = true
	}
	if !room.Accent.Valid() {
		room.Accent = AccentBlue
	}
	return room
}

func CanUpdateRoomAppearance(current HostAuthority, actor Identity) bool {
	return CanModerateHost(current, actor)
}

type RoomAccessUpdate struct {
	Name            string
	AllowGuests     bool
	PasswordEnabled bool
	Password        string
	Locked          bool
}

// GovernanceStore persists room admission rules. Realtime authority keeps a
// local copy, but PostgreSQL remains the durable source after process restart.
type GovernanceStore interface {
	SetRoomLocked(context.Context, string, string, int64, bool) (Room, error)
	BanIdentity(context.Context, string, string, Identity) error
	IsBanned(context.Context, string, Identity) (bool, error)
}

// HostGovernanceStore exposes host-authorized governance mutations. The
// existing owner-scoped methods remain available for backwards compatibility;
// these methods let the active realtime host govern an active room without
// turning the host into the durable owner.
type HostGovernanceStore interface {
	SetRoomLockedByHost(context.Context, string, int64, bool) (Room, error)
	BanIdentityByHost(context.Context, string, Identity) error
	BanIdentityForHost(context.Context, string, Identity, time.Time) error
}

type RoomAppearanceStore interface {
	UpdateRoomAppearanceByHost(context.Context, string, int64, RoomAppearanceUpdate) (Room, error)
}

type RoomAccessStore interface {
	UpdateRoomAccess(context.Context, string, string, int64, RoomAccessUpdate) (Room, error)
}

type JoinRequest struct {
	UserID      string    `json:"user_id"`
	DisplayName string    `json:"display_name"`
	AvatarURL   string    `json:"avatar_url,omitempty"`
	RequestedAt time.Time `json:"requested_at"`
}

// RoomMembershipStore is the durable authorization source for private rooms.
// A room link identifies a room but never grants a signed-in user membership.
type RoomMembershipStore interface {
	IsRoomMember(context.Context, string, string) (bool, error)
	RequestRoomAccess(context.Context, string, Identity) error
	ListJoinRequests(context.Context, string, string) ([]JoinRequest, error)
	ResolveJoinRequest(context.Context, string, string, string, bool) error
}

type Participant struct {
	ConnectionID    string       `json:"connection_id"`
	IdentityID      string       `json:"identity_id"`
	IdentityType    IdentityType `json:"identity_type"`
	DisplayName     string       `json:"display_name"`
	AvatarURL       string       `json:"avatar_url,omitempty"`
	Role            string       `json:"role"`
	LiveKitIdentity string       `json:"livekit_identity"`
	JoinedAt        time.Time    `json:"joined_at"`
	RaisedHand      bool         `json:"raised_hand"`
	SocialVersion   uint64       `json:"social_version"`
}

func ValidReaction(value string) bool {
	switch value {
	case "❤️", "😂", "🔥", "👏", "😭":
		return true
	}
	return false
}

func CanSetOwnHand(identity Identity, participant Participant) bool {
	return identity.ID != "" && participant.IdentityID == identity.ID &&
		participant.IdentityType == identity.Type && participant.ConnectionID != ""
}

// HostAuthority is the public, non-sensitive description of the active
// realtime host. It contains no token, secret, or database credential.
type HostAuthority struct {
	ConnectionID string       `json:"connection_id"`
	IdentityID   string       `json:"identity_id"`
	IdentityType IdentityType `json:"identity_type"`
	Generation   uint64       `json:"generation"`
	Version      uint64       `json:"version"`
	State        string       `json:"state"`
}

type Message struct {
	Revision          uint64        `json:"revision"`
	ID                string        `json:"id"`
	RoomID            string        `json:"room_id"`
	SenderID          string        `json:"sender_id"`
	SenderType        IdentityType  `json:"sender_type"`
	SenderDisplayName string        `json:"sender_display_name"`
	SenderAvatarURL   string        `json:"sender_avatar_url,omitempty"`
	Content           string        `json:"content"`
	CreatedAt         time.Time     `json:"created_at"`
	ReplyTo           *MessageReply `json:"reply_to,omitempty"`
	EditedAt          *time.Time    `json:"edited_at,omitempty"`
	// Deleted messages keep their row (and history) but never expose content.
	Deleted bool `json:"deleted,omitempty"`
}

type CreateRoomParams struct {
	Name        string
	Owner       Identity
	AllowGuests bool
	Password    string
}

type Store interface {
	Ping(context.Context) error
	UpsertProfile(context.Context, Identity) error
	CreateRoom(context.Context, CreateRoomParams) (Room, error)
	GetRoom(context.Context, string) (Room, error)
	ListOwnedRooms(context.Context, string) ([]Room, error)
	DeleteOwnedRoom(context.Context, string, string) error
	InsertMessage(context.Context, string, Identity, string) (Message, error)
	RecentMessages(context.Context, string, int) ([]Message, error)
	Close()
}

type AdminDailyCount struct {
	Date  string `json:"date"`
	Users int    `json:"users"`
	Rooms int    `json:"rooms"`
}

// AdminTrendDays is the length of the daily signup and room series.
const AdminTrendDays = 14

type AdminOverview struct {
	Users            int               `json:"users"`
	Rooms            int               `json:"rooms"`
	OpenRooms        int               `json:"open_rooms"`
	EndedRooms       int               `json:"ended_rooms"`
	NewUsers         int               `json:"new_users"`
	NewRooms         int               `json:"new_rooms"`
	OpenReports      int               `json:"open_reports"`
	SuspendedUsers   int               `json:"suspended_users"`
	PendingDeletions int               `json:"pending_deletions"`
	Daily            []AdminDailyCount `json:"daily"`
}

type AdminUser struct {
	ID                   string      `json:"id"`
	DisplayName          string      `json:"display_name"`
	CreatedAt            time.Time   `json:"created_at"`
	RoomCount            int         `json:"room_count"`
	Suspension           *AccountBan `json:"suspension,omitempty"`
	DeletionScheduledFor *time.Time  `json:"deletion_scheduled_for,omitempty"`
	OpenReports          int         `json:"open_reports"`
}

// AdminUserDetail adds history to one account. It never carries email,
// message content or room passwords.
type AdminUserDetail struct {
	AdminUser
	LastSeenAt    time.Time         `json:"last_seen_at"`
	MemberRooms   int               `json:"member_rooms"`
	MessagesSent  int               `json:"messages_sent"`
	TotalReports  int               `json:"total_reports"`
	ReportsFiled  int               `json:"reports_filed"`
	History       []AdminAuditEntry `json:"history"`
	RecentReports []Report          `json:"recent_reports"`
}

type AdminUserStatus string

const (
	AdminUsersAll       AdminUserStatus = ""
	AdminUsersSuspended AdminUserStatus = "suspended"
	AdminUsersDeleting  AdminUserStatus = "deleting"
	AdminUsersReported  AdminUserStatus = "reported"
)

type RoomModeration struct {
	ActorID   string    `json:"actor_id"`
	Reason    string    `json:"reason"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
}

func ValidModerationReason(reason string) bool {
	switch reason {
	case "illegal", "policy", "safety", "spam", "other":
		return true
	}
	return false
}

type AdminRoom struct {
	Deleted          bool            `json:"deleted"`
	Moderation       *RoomModeration `json:"moderation,omitempty"`
	ID               string          `json:"id"`
	Code             string          `json:"code"`
	Name             string          `json:"name"`
	OwnerID          string          `json:"owner_id"`
	OwnerName        string          `json:"owner_name"`
	AllowGuests      bool            `json:"allow_guests"`
	IsLocked         bool            `json:"is_locked"`
	PasswordRequired bool            `json:"password_required"`
	Ended            bool            `json:"ended"`
	CreatedAt        time.Time       `json:"created_at"`
}

type AdminStore interface {
	AdminOverview(context.Context) (AdminOverview, error)
	ListAdminUsers(context.Context, string, AdminUserStatus, int, int) ([]AdminUser, int, error)
	ListAdminRooms(context.Context, string, string, string, int, int) ([]AdminRoom, int, error)
}

// AdminUserDetailStore returns ErrNotFound for an unknown account.
type AdminUserDetailStore interface {
	AdminUserDetail(context.Context, string) (AdminUserDetail, error)
}

func ValidateDisplayName(value string) (string, error) {
	value = strings.Join(strings.Fields(value), " ")
	if len([]rune(value)) < 2 || len([]rune(value)) > 48 {
		return "", ErrInvalidName
	}
	return value, nil
}

func ValidateRoomName(value string) (string, error) {
	value = strings.Join(strings.Fields(value), " ")
	if len([]rune(value)) < 2 || len([]rune(value)) > 80 {
		return "", ErrInvalidName
	}
	return value, nil
}

func NormalizeRoomIdentifier(value string) (string, error) {
	value = strings.TrimSpace(value)
	if parsed, err := url.Parse(value); err == nil && parsed.IsAbs() {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return "", ErrNotFound
		}
		parts := strings.Split(strings.Trim(path.Clean(parsed.Path), "/"), "/")
		if len(parts) != 2 || (parts[0] != "join" && parts[0] != "room") {
			return "", ErrNotFound
		}
		value = parts[1]
	}
	if len(value) < 3 || len(value) > 64 || strings.ContainsAny(value, "/\\?#") {
		return "", ErrNotFound
	}
	for _, char := range value {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') && char != '-' {
			return "", ErrNotFound
		}
	}
	return strings.ToLower(value), nil
}

func ValidateMessage(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > MaxMessageLength {
		return "", ErrInvalidChat
	}
	return value, nil
}

func CanJoin(room Room, identity Identity) bool {
	return identity.Type == IdentityUser || (identity.Type == IdentityGuest && room.AllowGuests && identity.RoomID == room.ID)
}

func CanManageRoomAccess(room Room, identity Identity) bool {
	return identity.Type == IdentityUser && identity.ID != "" && identity.ID == room.OwnerID
}

func CanControlMedia(room Room, identity Identity) bool {
	return identity.Type == IdentityUser && room.OwnerID != "" && identity.ID == room.OwnerID
}

func CanEndRoom(room Room, identity Identity) bool { return CanManageRoomAccess(room, identity) }

func CanDeleteRoom(room Room, identity Identity) bool {
	return identity.Type == IdentityUser && identity.ID == room.OwnerID
}

func CanAddToQueue(room Room, identity Identity) bool { return CanJoin(room, identity) }

func CanManageQueue(room Room, identity Identity) bool { return CanControlMedia(room, identity) }

func CanChangeSettings(room Room, identity Identity) bool { return CanControlMedia(room, identity) }

func CanKick(room Room, identity Identity) bool { return CanControlMedia(room, identity) }

func CanBeRealtimeHost(identity Identity) bool {
	return identity.Type == IdentityUser && identity.ID != ""
}

func CanTransferHost(current HostAuthority, actor Identity, target Participant) bool {
	return current.ConnectionID != "" && current.IdentityID == actor.ID &&
		current.IdentityType == actor.Type && CanBeRealtimeHost(actor) &&
		target.ConnectionID != "" && target.ConnectionID != current.ConnectionID &&
		CanBeRealtimeHost(Identity{ID: target.IdentityID, Type: target.IdentityType})
}

func CanModerateHost(current HostAuthority, actor Identity) bool {
	return current.ConnectionID != "" && current.IdentityID == actor.ID &&
		current.IdentityType == actor.Type && CanBeRealtimeHost(actor) &&
		current.State != "failed-over"
}

func CanKickParticipant(current HostAuthority, actor Identity, target Participant) bool {
	return CanModerateHost(current, actor) && target.ConnectionID != "" &&
		target.ConnectionID != current.ConnectionID && target.Role != "host"
}
