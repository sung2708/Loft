package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"hash"
	"strconv"
	"strings"
)

const roomPasswordIterations = 120000
const roomPasswordSaltBytes = 16
const roomPasswordMaxBytes = 256

var ErrInvalidRoomPassword = errors.New("invalid room password")

func HashRoomPassword(password string) (string, error) {
	if !validRoomPassword(password) {
		return "", ErrInvalidRoomPassword
	}
	salt := make([]byte, roomPasswordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}
	derived := pbkdf2SHA256([]byte(password), salt, roomPasswordIterations, sha256.Size)
	return fmt.Sprintf("v1$sha256$%d$%s$%s", roomPasswordIterations,
		base64.RawURLEncoding.EncodeToString(salt), base64.RawURLEncoding.EncodeToString(derived)), nil
}

func VerifyRoomPassword(password, verifier string) bool {
	if !validRoomPassword(password) || verifier == "" {
		return false
	}
	parts := strings.Split(verifier, "$")
	if len(parts) != 5 || parts[0] != "v1" || parts[1] != "sha256" {
		return false
	}
	iterations, err := strconv.Atoi(parts[2])
	if err != nil || iterations < 100000 || iterations > 1000000 {
		return false
	}
	salt, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil || len(salt) != roomPasswordSaltBytes {
		return false
	}
	want, err := base64.RawURLEncoding.DecodeString(parts[4])
	if err != nil || len(want) != sha256.Size {
		return false
	}
	return hmac.Equal(pbkdf2SHA256([]byte(password), salt, iterations, len(want)), want)
}

func validRoomPassword(password string) bool {
	return len(strings.TrimSpace(password)) >= 4 && len([]byte(password)) <= roomPasswordMaxBytes
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLen int) []byte {
	var h func() hash.Hash = sha256.New
	blocks := (keyLen + sha256.Size - 1) / sha256.Size
	out := make([]byte, 0, blocks*sha256.Size)
	for block := 1; block <= blocks; block++ {
		mac := hmac.New(h, password)
		mac.Write(salt)
		mac.Write([]byte{byte(block >> 24), byte(block >> 16), byte(block >> 8), byte(block)})
		u := mac.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iterations; i++ {
			mac = hmac.New(h, password)
			mac.Write(u)
			u = mac.Sum(nil)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}
