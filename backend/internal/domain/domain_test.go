package domain

import "testing"

func TestNormalizeRoomIdentifier(t *testing.T) {
	tests := map[string]string{
		"ABCD1234":                         "abcd1234",
		"  late-night  ":                   "late-night",
		"https://loft.app/join/ABCD1234":   "abcd1234",
		"http://localhost:3000/room/abc-1": "abc-1",
	}
	for input, want := range tests {
		got, err := NormalizeRoomIdentifier(input)
		if err != nil || got != want {
			t.Fatalf("NormalizeRoomIdentifier(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range []string{"", "a", "javascript:alert(1)", "https://loft.app/home", "abc/def"} {
		if _, err := NormalizeRoomIdentifier(input); err == nil {
			t.Fatalf("NormalizeRoomIdentifier(%q) accepted malformed input", input)
		}
	}
}

func TestGuestScope(t *testing.T) {
	room := Room{ID: "room-1", AllowGuests: true}
	if !CanJoin(room, Identity{Type: IdentityGuest, RoomID: "room-1"}) {
		t.Fatal("scoped guest should join")
	}
	if CanJoin(room, Identity{Type: IdentityGuest, RoomID: "room-2"}) {
		t.Fatal("guest token must not cross rooms")
	}
	if !CanJoin(room, Identity{Type: IdentityUser}) {
		t.Fatal("authenticated user should join invite room")
	}
}

func TestDeleteRoomPermission(t *testing.T) {
	room := Room{OwnerID: "owner"}
	if !CanDeleteRoom(room, Identity{Type: IdentityUser, ID: "owner"}) {
		t.Fatal("owner cannot delete own room")
	}
	if CanDeleteRoom(room, Identity{Type: IdentityUser, ID: "other"}) || CanDeleteRoom(room, Identity{Type: IdentityGuest, ID: "owner"}) {
		t.Fatal("non-owner can delete room")
	}
}

func TestMediaControlPermission(t *testing.T) {
	room := Room{ID: "room-1", OwnerID: "owner", AllowGuests: true}
	if !CanControlMedia(room, Identity{Type: IdentityUser, ID: "owner"}) {
		t.Fatal("owner cannot control media")
	}
	for _, identity := range []Identity{
		{Type: IdentityUser, ID: "member"},
		{Type: IdentityGuest, ID: "owner", RoomID: room.ID},
	} {
		if CanControlMedia(room, identity) {
			t.Fatalf("non-host controlled media: %+v", identity)
		}
		if !CanManageQueue(room, identity) {
			t.Fatalf("joined participant cannot manage queue: %+v", identity)
		}
	}
}

func TestValidation(t *testing.T) {
	if name, err := ValidateDisplayName("  Minh   Nguyen "); err != nil || name != "Minh Nguyen" {
		t.Fatalf("unexpected normalized name %q, %v", name, err)
	}
	if _, err := ValidateDisplayName("x"); err == nil {
		t.Fatal("short display name accepted")
	}
	if _, err := ValidateMessage(""); err == nil {
		t.Fatal("empty message accepted")
	}
	tooLong := make([]rune, MaxMessageLength+1)
	for i := range tooLong {
		tooLong[i] = 'x'
	}
	if _, err := ValidateMessage(string(tooLong)); err == nil {
		t.Fatal("oversized message accepted")
	}
}
