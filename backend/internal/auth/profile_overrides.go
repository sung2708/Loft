package auth

import (
	"context"
	"time"

	"loft/backend/internal/domain"
)

// ProfileOverrideSource loads member choices that win over provider claims.
type ProfileOverrideSource interface {
	ProfileOverrides(context.Context, string) (domain.ProfileOverrides, error)
}

// SetProfileOverrides must be called before the verifier serves requests.
func (v *SupabaseVerifier) SetProfileOverrides(source ProfileOverrideSource) {
	v.overrides = source
}

func (v *SupabaseVerifier) applyProfileOverrides(parent context.Context, identity domain.Identity) domain.Identity {
	if v.overrides == nil {
		return identity
	}
	ctx, cancel := context.WithTimeout(parent, 750*time.Millisecond)
	defer cancel()
	value, err := v.overrides.ProfileOverrides(ctx, identity.ID)
	if err != nil {
		identity.AvatarURL = ""
		return identity
	}
	return value.Apply(identity)
}
