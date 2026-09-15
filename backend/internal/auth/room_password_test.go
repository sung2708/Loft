package auth

import (
	"strings"
	"testing"
)

func TestRoomPasswordHashAndVerify(t *testing.T) {
	verifier, err := HashRoomPassword("correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(verifier, "correct horse battery") {
		t.Fatal("verifier contains plaintext password")
	}
	if !VerifyRoomPassword("correct horse battery", verifier) {
		t.Fatal("valid password rejected")
	}
	if VerifyRoomPassword("wrong password", verifier) {
		t.Fatal("wrong password accepted")
	}
}

func TestRoomPasswordValidation(t *testing.T) {
	if _, err := HashRoomPassword("abc"); err == nil {
		t.Fatal("short password accepted")
	}
	if _, err := HashRoomPassword("   "); err == nil {
		t.Fatal("blank password accepted")
	}
	if _, err := HashRoomPassword(strings.Repeat("x", roomPasswordMaxBytes+1)); err == nil {
		t.Fatal("oversized password accepted")
	}
}
