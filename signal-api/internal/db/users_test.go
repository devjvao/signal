package db

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func setupTestQueries(t *testing.T) *Queries {
	t.Helper()
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		t.Skip("DB_URL not set; skipping integration test")
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	t.Cleanup(pool.Close)

	if _, err := pool.Exec(context.Background(), "TRUNCATE TABLE users CASCADE"); err != nil {
		t.Fatalf("failed to truncate users table: %v", err)
	}

	return New(pool)
}

func TestCreateAndGetUser(t *testing.T) {
	q := setupTestQueries(t)
	ctx := context.Background()

	created, err := q.CreateUser(ctx, CreateUserParams{
		Name:         "Ada Lovelace",
		Email:        "ada@example.com",
		PasswordHash: "hashed-password",
	})
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}
	if created.Email != "ada@example.com" {
		t.Errorf("expected email ada@example.com, got %s", created.Email)
	}

	byEmail, err := q.GetUserByEmail(ctx, "ada@example.com")
	if err != nil {
		t.Fatalf("GetUserByEmail failed: %v", err)
	}
	if byEmail.ID != created.ID {
		t.Errorf("expected ID %s, got %s", created.ID, byEmail.ID)
	}

	byID, err := q.GetUserByID(ctx, created.ID)
	if err != nil {
		t.Fatalf("GetUserByID failed: %v", err)
	}
	if byID.Email != "ada@example.com" {
		t.Errorf("expected email ada@example.com, got %s", byID.Email)
	}
}

func TestGetUserByEmail_NotFound(t *testing.T) {
	q := setupTestQueries(t)

	if _, err := q.GetUserByEmail(context.Background(), "missing@example.com"); err == nil {
		t.Fatal("expected an error for a missing user, got nil")
	}
}
