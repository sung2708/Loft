package spotify

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"strings"
	"time"
)

// DecodeCredentialKey decodes an encryption key from various representations
// (standard padded Base64, unpadded raw Base64, URL-safe Base64, or 32-byte raw string).
// It verifies that the resulting key is exactly 32 bytes for AES-256.
func DecodeCredentialKey(rawKey string) ([]byte, error) {
	trimmed := strings.TrimSpace(rawKey)
	if trimmed == "" {
		return nil, fmt.Errorf("credential key is empty")
	}

	// Try standard base64 if padded with '='
	if strings.HasSuffix(trimmed, "=") {
		if key, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(key) == 32 {
			return key, nil
		}
		if key, err := base64.URLEncoding.DecodeString(trimmed); err == nil && len(key) == 32 {
			return key, nil
		}
	}

	// Try raw standard base64 (unpadded)
	if key, err := base64.RawStdEncoding.DecodeString(trimmed); err == nil && len(key) == 32 {
		return key, nil
	}

	// Try standard base64 (without suffix check)
	if key, err := base64.StdEncoding.DecodeString(trimmed); err == nil && len(key) == 32 {
		return key, nil
	}

	// Try URL-safe base64 unpadded
	if key, err := base64.RawURLEncoding.DecodeString(trimmed); err == nil && len(key) == 32 {
		return key, nil
	}

	// Try raw 32-byte ASCII string
	if len([]byte(trimmed)) == 32 {
		return []byte(trimmed), nil
	}

	return nil, fmt.Errorf("invalid credential key: must decode to exactly 32 bytes")
}


type Credentials struct {
	UserID       string
	AccessToken  string
	RefreshToken string
	Scopes       []string
	ExpiresAt    time.Time
	RevokedAt    *time.Time
}

type CredentialStore interface {
	Save(Credentials) error
	Load(userID string) (Credentials, error)
	ReplaceAccessToken(userID, accessToken string, expiresAt time.Time) error
	ReplaceRefreshToken(userID, refreshToken string) error
	Revoke(userID string, at time.Time) error
	Disconnect(userID string) error
}

func (c Credentials) Expired(now time.Time) bool { return !now.Before(c.ExpiresAt) }

// EncryptCredential seals provider tokens with an AES-GCM key held only by the backend.
func EncryptCredential(key []byte, value string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func DecryptCredential(key []byte, encoded string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	data, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	if len(data) < gcm.NonceSize() {
		return "", fmt.Errorf("ciphertext too short")
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
