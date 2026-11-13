package domain

import "context"

// MaxReplyPreviewRunes bounds the quoted parent text sent with a reply.
const MaxReplyPreviewRunes = 140

// MessageReply is the quoted parent shown above a reply.
type MessageReply struct {
	Revision          uint64 `json:"revision"`
	ID                string `json:"id"`
	SenderDisplayName string `json:"sender_display_name"`
	Content           string `json:"content"`
	Deleted           bool   `json:"deleted,omitempty"`
}

// MessageStore is implemented by stores that support replies, edits and
// soft deletes. Realtime type-asserts it so older test fakes keep working.
type MessageStore interface {
	InsertMessageReply(ctx context.Context, roomID string, sender Identity, content, replyToID string) (Message, error)
	GetMessage(ctx context.Context, roomID, messageID string) (Message, error)
	EditMessage(ctx context.Context, roomID, messageID string, actor Identity, content string) (Message, error)
	DeleteMessage(ctx context.Context, roomID, messageID string, actor Identity) (Message, error)
}

// IsMessageAuthor compares the durable sender identity, never a display name.
func IsMessageAuthor(message Message, actor Identity) bool {
	return actor.ID != "" && message.SenderID == actor.ID && message.SenderType == actor.Type
}

// CanEditMessage allows only the author to change a live message.
func CanEditMessage(message Message, actor Identity) bool {
	return !message.Deleted && IsMessageAuthor(message, actor)
}

// CanDeleteMessage allows the author or the room owner to remove a message.
func CanDeleteMessage(room Room, message Message, actor Identity) bool {
	return !message.Deleted && (IsMessageAuthor(message, actor) || CanControlMedia(room, actor))
}
