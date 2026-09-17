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

func TestDecodeCredentialKey(t *testing.T) {
	// 1. Padded base64 (as in backend/.env)
	padded := "/iJc1EhvJLCdGt2wGJm6r1SIDjFcyScuh1aft0FHUxo="
	key1, err := DecodeCredentialKey(padded)
	if err != nil {
		t.Fatalf("failed to decode padded key: %v", err)
	}
	if len(key1) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(key1))
	}

	// 2. Unpadded raw base64
	unpadded := "/iJc1EhvJLCdGt2wGJm6r1SIDjFcyScuh1aft0FHUxo"
	key2, err := DecodeCredentialKey(unpadded)
	if err != nil {
		t.Fatalf("failed to decode unpadded key: %v", err)
	}
	if len(key2) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(key2))
	}
	if string(key1) != string(key2) {
		t.Fatalf("expected key1 and key2 to match")
	}

	// 3. Raw 32-byte key
	raw32 := "01234567890123456789012345678901"
	key3, err := DecodeCredentialKey(raw32)
	if err != nil {
		t.Fatalf("failed to decode raw 32-byte key: %v", err)
	}
	if len(key3) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(key3))
	}

	// 4. Invalid cases
	invalidCases := []string{
		"",
		"   ",
		"too-short",
		"not-valid-base64!!!@@@###$$$",
	}
	for _, tc := range invalidCases {
		if _, err := DecodeCredentialKey(tc); err == nil {
			t.Fatalf("expected error for invalid key %q, got nil", tc)
		}
	}
}



