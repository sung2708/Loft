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

var (
	ErrNotFound     = errors.New("not found")
	ErrUnauthorized = errors.New("unauthorized")
	ErrInvalidName  = errors.New("invalid display name")
	ErrInvalidChat  = errors.New("invalid chat message")
	ErrConflict     = errors.New("conflict")
	ErrBanned       = errors.New("banned")
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
}

func (i Identity) LiveKitIdentity() string { return string(i.Type) + ":" + i.ID }

type Room struct {
	ID               string    `json:"id"`
	Slug             string    `json:"slug"`
	Name             string    `json:"name"`
	OwnerID          string    `json:"owner_id"`
	AllowGuests      bool      `json:"allow_guests"`
	MaxParticipants  int       `json:"max_participants"`
	IsLocked         bool      `json:"is_locked"`
	Version          int64     `json:"version"`
	PasswordRequired bool      `json:"password_required"`
	PasswordVerifier string    `json:"-"`
	CreatedAt        time.Time `json:"created_at"`
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

type RoomAccessStore interface {
	UpdateRoomAccess(context.Context, string, string, int64, RoomAccessUpdate) (Room, error)
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
}

type Message struct {
	ID                string       `json:"id"`
	RoomID            string       `json:"room_id"`
	SenderID          string       `json:"sender_id"`
	SenderType        IdentityType `json:"sender_type"`
	SenderDisplayName string       `json:"sender_display_name"`
	SenderAvatarURL   string       `json:"sender_avatar_url,omitempty"`
	Content           string       `json:"content"`
	CreatedAt         time.Time    `json:"created_at"`
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

func CanDeleteRoom(room Room, identity Identity) bool {
	return identity.Type == IdentityUser && identity.ID == room.OwnerID
}

func CanManageQueue(room Room, identity Identity) bool {
	return CanJoin(room, identity)
}

func CanChangeSettings(room Room, identity Identity) bool { return CanControlMedia(room, identity) }

func CanKick(room Room, identity Identity) bool { return CanControlMedia(room, identity) }
