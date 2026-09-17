package domain

import "testing"

func TestYouTubeAuthorization(t *testing.T) {
	room := Room{ID: "r", OwnerID: "host", AllowGuests: true}
	host := Identity{ID: "host", Type: IdentityUser, RoomID: "r"}
	guest := Identity{ID: "guest", Type: IdentityGuest, RoomID: "r"}
	if !CanCreateRoomPick(room, guest) || !CanVoteRoomPick(room, guest) {
		t.Fatal("room members should create and vote")
	}
	if !CanPromoteRoomPick(room, host) || !CanChangeAutoplay(room, host) {
		t.Fatal("host should promote and change autoplay")
	}
	if CanChangeAutoplay(room, guest) {
		t.Fatal("guest must not change autoplay")
	}
}
