package auth

import "testing"

func TestGenerateAndParseToken(t *testing.T) {
	secret := []byte("test-secret")

	token, err := GenerateToken(secret, "user-123", "ada@example.com")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	claims, err := ParseToken(secret, token)
	if err != nil {
		t.Fatalf("ParseToken failed: %v", err)
	}
	if claims.Subject != "user-123" {
		t.Errorf("expected subject user-123, got %s", claims.Subject)
	}
	if claims.Email != "ada@example.com" {
		t.Errorf("expected email ada@example.com, got %s", claims.Email)
	}
}

func TestParseToken_WrongSecret(t *testing.T) {
	token, err := GenerateToken([]byte("secret-a"), "user-123", "ada@example.com")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	if _, err := ParseToken([]byte("secret-b"), token); err == nil {
		t.Fatal("expected an error when parsing with the wrong secret")
	}
}

func TestParseToken_Malformed(t *testing.T) {
	if _, err := ParseToken([]byte("test-secret"), "not-a-jwt"); err == nil {
		t.Fatal("expected an error when parsing a malformed token")
	}
}
