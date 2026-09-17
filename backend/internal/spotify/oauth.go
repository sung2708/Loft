package spotify

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strings"
)

var ErrInvalidOAuthState = errors.New("invalid spotify oauth state")

// PKCEChallenge returns the S256 challenge for a cryptographically random verifier.
func PKCEChallenge(verifier string) (string, error) {
	if len(verifier) < 43 || len(verifier) > 128 {
		return "", fmt.Errorf("pkce verifier length must be between 43 and 128 characters")
	}
	hash := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(hash[:]), nil
}

func NewVerifier() (string, error) {
	buf := make([]byte, 64)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate pkce verifier: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func ValidateRedirect(expected, received string) error {
	if expected == "" || received == "" || expected != received {
		return fmt.Errorf("%w: redirect uri mismatch", ErrInvalidOAuthState)
	}
	expectedURL, err := url.Parse(expected)
	if err != nil || expectedURL.Scheme != "https" {
		return fmt.Errorf("%w: redirect uri must use https", ErrInvalidOAuthState)
	}
	return nil
}

func ValidateState(expected, received string) error {
	if expected == "" || received == "" || !strings.EqualFold(expected, received) {
		return ErrInvalidOAuthState
	}
	return nil
}
