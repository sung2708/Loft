package realtime

import (
	"context"
	"encoding/json"
	"testing"

	"loft/backend/internal/domain"
)

type profileStore struct{ realtimeStore }

func (*profileStore) AccountProfile(context.Context, string) (domain.AccountProfile, error) {
	return domain.AccountProfile{HideAvatar: true}, nil
}

func TestProfileHideReachesOtherNode(t *testing.T) {
	store := &profileStore{}
	a, b := New(store, nil, nil, nil, nil), New(store, nil, nil, nil, nil)
	c := &client{id: "c", roomID: "room", send: make(chan []byte, 1),
		identity:    domain.Identity{Type: domain.IdentityUser, ID: "user", AvatarURL: "https://example.invalid/avatar"},
		participant: domain.Participant{AvatarURL: "https://example.invalid/avatar"},
	}
	b.rooms["room"] = &roomState{clients: map[string]*client{c.id: c}}
	a.SetBus(&memoryBus{instanceID: "a", peers: []*memoryBus{{instanceID: "b", deliver: b.DeliverRemote}}})
	a.NotifyProfileChanged(context.Background(), "user")
	if c.participant.AvatarURL != "" {
		t.Fatal("remote participant retained hidden avatar")
	}
	select {
	case data := <-c.send:
		var msg Envelope
		var avatar participantAvatar
		if json.Unmarshal(data, &msg) != nil || msg.Type != "participant.avatar" ||
			json.Unmarshal(msg.Payload, &avatar) != nil || avatar.ConnectionID != c.id || avatar.AvatarURL != "" {
			t.Fatalf("unexpected profile event: %s", data)
		}
	default:
		t.Fatal("room received no avatar update")
	}
}
