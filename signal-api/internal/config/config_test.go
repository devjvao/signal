package config

import "testing"

func TestLoad_MissingDBURL(t *testing.T) {
	t.Setenv("DB_URL", "")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("PORT", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error when DB_URL is missing, got nil")
	}
}

func TestLoad_MissingJWTSecret(t *testing.T) {
	t.Setenv("DB_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "")
	t.Setenv("PORT", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected an error when JWT_SECRET is missing, got nil")
	}
}

func TestLoad_DefaultsPort(t *testing.T) {
	t.Setenv("DB_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("PORT", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.Port != "8080" {
		t.Errorf("expected default port 8080, got %s", cfg.Port)
	}
}

func TestLoad_DefaultsWebOrigin(t *testing.T) {
	t.Setenv("DB_URL", "postgres://example")
	t.Setenv("JWT_SECRET", "secret")
	t.Setenv("WEB_ORIGIN", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.WebOrigin != "http://localhost:5173" {
		t.Errorf("expected default web origin http://localhost:5173, got %s", cfg.WebOrigin)
	}
}
