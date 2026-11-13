package domain

import "testing"

func TestChatMessagePermissions(t *testing.T) {
	owner := Identity{ID: "owner", Type: IdentityUser}
	author := Identity{ID: "guest-1", Type: IdentityGuest}
	other := Identity{ID: "guest-2", Type: IdentityGuest}
	// Same id but different identity type must never match.
	spoof := Identity{ID: "guest-1", Type: IdentityUser}
	room := Room{ID: "room", OwnerID: owner.ID}
	message := Message{SenderID: author.ID, SenderType: author.Type}

	if !CanEditMessage(message, author) || CanEditMessage(message, other) || CanEditMessage(message, owner) || CanEditMessage(message, spoof) {
		t.Fatal("only the author may edit")
	}
	if !CanDeleteMessage(room, message, author) || !CanDeleteMessage(room, message, owner) {
		t.Fatal("author and room owner may delete")
	}
	if CanDeleteMessage(room, message, other) || CanDeleteMessage(room, message, spoof) {
		t.Fatal("other participants may not delete")
	}
	deleted := message
	deleted.Deleted = true
	if CanEditMessage(deleted, author) || CanDeleteMessage(room, deleted, owner) {
		t.Fatal("deleted messages are final")
	}
	if IsMessageAuthor(Message{}, Identity{}) {
		t.Fatal("empty identity must not match")
	}
}

func TestCanSuspendAccount(t *testing.T) {
	if !CanSuspendAccount(true, false, "admin", "user") {
		t.Fatal("admin should suspend a regular user")
	}
	if CanSuspendAccount(false, false, "a", "b") || CanSuspendAccount(true, true, "a", "b") || CanSuspendAccount(true, false, "a", "a") || CanSuspendAccount(true, false, "", "b") {
		t.Fatal("suspension guard too permissive")
	}
}
