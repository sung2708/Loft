package spotify

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"time"
)

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
