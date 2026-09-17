package spotify

import "testing"

func TestCredentialEncryptionRoundTrip(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	ciphertext, err := EncryptCredential(key, "refresh-secret")
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecryptCredential(key, ciphertext)
	if err != nil || got != "refresh-secret" {
		t.Fatalf("got %q, %v", got, err)
	}
	if ciphertext == "refresh-secret" {
		t.Fatal("credential was not encrypted")
	}
}
