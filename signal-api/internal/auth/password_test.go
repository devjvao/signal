package auth

import "testing"

func TestHashPassword_CheckPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if hash == "correct-horse-battery" {
		t.Fatal("expected hash to differ from the plaintext password")
	}
	if !CheckPassword("correct-horse-battery", hash) {
		t.Error("expected CheckPassword to succeed with the correct password")
	}
}

func TestCheckPassword_WrongPassword(t *testing.T) {
	hash, err := HashPassword("correct-horse-battery")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if CheckPassword("wrong-password", hash) {
		t.Error("expected CheckPassword to fail with an incorrect password")
	}
}
