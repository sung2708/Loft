package domain

import "testing"

func TestCanReport(t *testing.T) {
	member := Identity{ID: "u1", Type: IdentityUser}
	guest := Identity{ID: "g1", Type: IdentityGuest}
	for _, tc := range []struct {
		reporter Identity
		target   ReportTarget
		id       string
		want     bool
	}{
		{member, ReportTargetUser, "u2", true},
		{member, ReportTargetUser, "u1", false},
		{member, ReportTargetGuest, "u1", true}, // same UUID, different identity type
		{guest, ReportTargetGuest, "g1", false},
		{guest, ReportTargetRoom, "room", true},
		{member, "message", "x", false},
		{Identity{}, ReportTargetRoom, "room", false},
		{member, ReportTargetUser, "", false},
	} {
		if got := CanReport(tc.reporter, tc.target, tc.id); got != tc.want {
			t.Errorf("CanReport(%v, %s, %s) = %v", tc.reporter, tc.target, tc.id, got)
		}
	}
}

func TestProfileOverridesApply(t *testing.T) {
	identity := Identity{DisplayName: "Provider", AvatarURL: "https://a"}
	if got := (ProfileOverrides{}).Apply(identity); got != identity {
		t.Fatalf("empty overrides changed identity: %+v", got)
	}
	if got := (ProfileOverrides{DisplayName: "Mine", HideAvatar: true}).Apply(identity); got.DisplayName != "Mine" || got.AvatarURL != "" {
		t.Fatalf("overrides = %+v", got)
	}
}
