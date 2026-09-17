package domain

// YouTube authorization stays centralized so transport handlers cannot invent
// room-pick or autoplay permission rules.
func CanCreateRoomPick(room Room, identity Identity) bool  { return CanJoin(room, identity) }
func CanVoteRoomPick(room Room, identity Identity) bool    { return CanJoin(room, identity) }
func CanPromoteRoomPick(room Room, identity Identity) bool { return CanControlMedia(room, identity) }
func CanChangeAutoplay(room Room, identity Identity) bool  { return CanControlMedia(room, identity) }
