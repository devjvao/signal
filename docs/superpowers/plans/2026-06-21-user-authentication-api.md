# User Authentication (signal-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement registration, login, and a protected "current user" route in `signal-api`, plus the JWT middleware that will guard all future non-auth routes.

**Architecture:** Gin handlers backed by sqlc-generated Postgres queries (pgx/v5). Passwords are hashed with bcrypt. Login issues a signed JWT (HS256, 7-day expiry, no refresh token) carried as `Authorization: Bearer <token>`. A small Gin middleware validates that header on protected routes and puts the user id in the request context.

**Tech Stack:** Go 1.26.1, Gin, pgx/v5, sqlc, golang-jwt/v5, golang.org/x/crypto/bcrypt, Postgres 16 (via the repo's `docker-compose.yml`).

## Global Constraints

- Go module is `signal-api`, Go version `1.26.1` (`signal-api/go.mod`) — do not change.
- The API surface (request/response JSON shapes, routes, status codes) MUST exactly match
  `contracts/auth-api.md` and `contracts/entities.md` at the repo root. Those files are read-only
  ground truth — if anything here seems to contradict them, stop and report it rather than
  resolving it unilaterally.
- All JSON keys are `camelCase` (e.g. `createdAt`, not `created_at`).
- Every non-2xx JSON response body is exactly `{"error": "<message>"}`.
- JWT: HS256, claims `sub` (user id), `email`, `iat`, `exp`; 7-day expiry; no refresh token, no
  revocation list.
- Passwords are hashed with `bcrypt.DefaultCost`. Never log or return a password or its hash.
- `password_hash` and `deleted_at` are never serialized in any API response.
- Soft-deleted users (`deleted_at IS NOT NULL`) are treated as not existing for register/login/me.
- Commit messages follow `CONVENTIONAL_COMMIT_GUIDELINE.md`: `type(api): summary`, imperative,
  lowercase, no trailing period, no `Co-authored-by` trailer.
- Run all commands below from the `signal-api/` directory unless a step says otherwise.
- Integration tests that need Postgres skip themselves (`t.Skip`) when `DB_URL` is unset, so `go
  test ./...` is always safe to run, but you must have a real Postgres reachable at `DB_URL` with
  migrations applied to actually exercise them (see Task 2, Step 1).

---

### Task 1: Config loading

**Files:**
- Create: `signal-api/internal/config/config.go`
- Test: `signal-api/internal/config/config_test.go`
- Modify: `signal-api/.env.example`

**Interfaces:**
- Produces: `config.Config{Port, DBURL, JWTSecret, WebOrigin string}`, `config.Load() (Config, error)`

- [ ] **Step 1: Write the failing tests**

```go
// signal-api/internal/config/config_test.go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/config/... -v`
Expected: FAIL — `package config: no Go files` or `undefined: Load`

- [ ] **Step 3: Write the implementation**

```go
// signal-api/internal/config/config.go
package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port      string
	DBURL     string
	JWTSecret string
	WebOrigin string
}

func Load() (Config, error) {
	cfg := Config{
		Port:      os.Getenv("PORT"),
		DBURL:     os.Getenv("DB_URL"),
		JWTSecret: os.Getenv("JWT_SECRET"),
		WebOrigin: os.Getenv("WEB_ORIGIN"),
	}

	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.WebOrigin == "" {
		cfg.WebOrigin = "http://localhost:5173"
	}
	if cfg.DBURL == "" {
		return Config{}, fmt.Errorf("DB_URL is required")
	}
	if cfg.JWTSecret == "" {
		return Config{}, fmt.Errorf("JWT_SECRET is required")
	}

	return cfg, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/config/... -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Update `.env.example`**

```
PORT=8080
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable
JWT_SECRET=change-me-in-production
WEB_ORIGIN=http://localhost:5173
```

- [ ] **Step 6: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go .env.example
git commit -m "feat(api): add environment config loader"
```

---

### Task 2: User queries (sqlc)

**Files:**
- Create: `signal-api/db/queries/users.sql`
- Modify: `signal-api/sqlc.yaml`
- Generated (do not hand-edit, regenerate with `sqlc generate`): `signal-api/internal/db/db.go`,
  `signal-api/internal/db/models.go`, `signal-api/internal/db/users.sql.go`
- Test: `signal-api/internal/db/users_test.go`

**Interfaces:**
- Produces: `db.New(pool) *db.Queries`; `(*db.Queries) CreateUser(ctx, db.CreateUserParams{Name, Email, PasswordHash string}) (db.CreateUserRow, error)`; `(*db.Queries) GetUserByEmail(ctx, email string) (db.GetUserByEmailRow, error)`; `(*db.Queries) GetUserByID(ctx, id string) (db.GetUserByIDRow, error)`. Each `*Row` type has fields `ID, Name, Email, PasswordHash string` and `CreatedAt, UpdatedAt, DeletedAt pgtype.Timestamptz` (use `.CreatedAt.Time` to get a `time.Time`).

This task has no red/green TDD cycle in the usual sense — the bulk of the code is generated by
`sqlc generate` from the SQL below — but it ends with a real test against a real database, so
treat the steps in order and don't skip the verification step.

- [ ] **Step 1: Start Postgres and apply migrations**

Run (from the repo root, `D:\Lab\signal`): `docker compose up -d`
Then (from `signal-api/`):
```bash
migrate -path db/migrations -database "postgres://signal:signal@localhost:5432/signal?sslmode=disable" up
```
Expected: `1/u create_set_updated_at_function ...` through `5/u create_votes_table ...`, no errors.
If `migrate` isn't installed: `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.18.1`
and ensure `$(go env GOPATH)/bin` is on `PATH`.

- [ ] **Step 2: Add the uuid override to sqlc.yaml**

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "db/queries"
    schema: "db/migrations"
    gen:
      go:
        package: "db"
        out: "internal/db"
        sql_package: "pgx/v5"
        overrides:
          - db_type: "uuid"
            go_type: "string"
```

This override makes generated `uuid` columns plain Go `string` instead of `pgtype.UUID`, which
keeps every later handler free of manual UUID conversion.

- [ ] **Step 3: Write the queries**

```sql
-- signal-api/db/queries/users.sql
-- name: CreateUser :one
INSERT INTO users (name, email, password_hash)
VALUES ($1, $2, $3)
RETURNING id, name, email, password_hash, created_at, updated_at, deleted_at;

-- name: GetUserByEmail :one
SELECT id, name, email, password_hash, created_at, updated_at, deleted_at
FROM users
WHERE email = $1 AND deleted_at IS NULL;

-- name: GetUserByID :one
SELECT id, name, email, password_hash, created_at, updated_at, deleted_at
FROM users
WHERE id = $1 AND deleted_at IS NULL;
```

- [ ] **Step 4: Install sqlc and generate**

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
sqlc generate
```
Expected: no output on success; `internal/db/db.go`, `internal/db/models.go`, and
`internal/db/users.sql.go` are created/updated.

- [ ] **Step 5: Add the pgx dependency and verify it builds**

```bash
go get github.com/jackc/pgx/v5 github.com/jackc/pgx/v5/pgxpool
go build ./...
```
Expected: builds with no errors.

- [ ] **Step 6: Write the integration test**

```go
// signal-api/internal/db/users_test.go
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
```

- [ ] **Step 7: Run the test against the real database**

Run:
```bash
DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/db/... -v
```
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add db/queries/users.sql sqlc.yaml internal/db/db.go internal/db/models.go internal/db/users.sql.go internal/db/users_test.go go.mod go.sum
git commit -m "feat(api): add sqlc user queries"
```

---

### Task 3: Password hashing

**Files:**
- Create: `signal-api/internal/auth/password.go`
- Test: `signal-api/internal/auth/password_test.go`

**Interfaces:**
- Produces: `auth.HashPassword(password string) (string, error)`, `auth.CheckPassword(password, hash string) bool`

- [ ] **Step 1: Write the failing tests**

```go
// signal-api/internal/auth/password_test.go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v`
Expected: FAIL — `undefined: HashPassword`

- [ ] **Step 3: Write the implementation**

```go
// signal-api/internal/auth/password.go
package auth

import "golang.org/x/crypto/bcrypt"

func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(hash), nil
}

func CheckPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go mod tidy && go test ./internal/auth/... -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/auth/password.go internal/auth/password_test.go go.mod go.sum
git commit -m "feat(api): add bcrypt password hashing"
```

---

### Task 4: JWT helpers

**Files:**
- Create: `signal-api/internal/auth/jwt.go`
- Test: `signal-api/internal/auth/jwt_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `auth.GenerateToken(secret []byte, userID, email string) (string, error)`,
  `auth.ParseToken(secret []byte, tokenString string) (*auth.Claims, error)`,
  `auth.Claims{Email string; jwt.RegisteredClaims}` (so `claims.Subject` is the user id)

- [ ] **Step 1: Write the failing tests**

```go
// signal-api/internal/auth/jwt_test.go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v -run TestGenerateAndParseToken`
Expected: FAIL — `undefined: GenerateToken`

- [ ] **Step 3: Write the implementation**

```go
// signal-api/internal/auth/jwt.go
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const tokenTTL = 7 * 24 * time.Hour

type Claims struct {
	Email string `json:"email"`
	jwt.RegisteredClaims
}

func GenerateToken(secret []byte, userID, email string) (string, error) {
	now := time.Now()
	claims := Claims{
		Email: email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(secret)
}

func ParseToken(secret []byte, tokenString string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (interface{}, error) {
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go get github.com/golang-jwt/jwt/v5 && go test ./internal/auth/... -v`
Expected: PASS (5 tests — the 2 from Task 3 plus these 3)

- [ ] **Step 5: Commit**

```bash
git add internal/auth/jwt.go internal/auth/jwt_test.go go.mod go.sum
git commit -m "feat(api): add jwt sign and parse helpers"
```

---

### Task 5: Auth middleware

**Files:**
- Create: `signal-api/internal/auth/middleware.go`
- Test: `signal-api/internal/auth/middleware_test.go`

**Interfaces:**
- Consumes: `auth.GenerateToken`, `auth.ParseToken` (Task 4)
- Produces: `auth.Middleware(secret []byte) gin.HandlerFunc`, `auth.UserID(c *gin.Context) (string, bool)`

- [ ] **Step 1: Write the failing tests**

```go
// signal-api/internal/auth/middleware_test.go
package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupTestRouter(secret []byte) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/protected", Middleware(secret), func(c *gin.Context) {
		userID, _ := UserID(c)
		c.JSON(http.StatusOK, gin.H{"userID": userID})
	})
	return r
}

func TestMiddleware_ValidToken(t *testing.T) {
	secret := []byte("test-secret")
	token, err := GenerateToken(secret, "user-123", "ada@example.com")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	r := setupTestRouter(secret)
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}

func TestMiddleware_MissingHeader(t *testing.T) {
	r := setupTestRouter([]byte("test-secret"))
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}

func TestMiddleware_InvalidToken(t *testing.T) {
	r := setupTestRouter([]byte("test-secret"))
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v -run TestMiddleware`
Expected: FAIL — `undefined: Middleware`

- [ ] **Step 3: Write the implementation**

```go
// signal-api/internal/auth/middleware.go
package auth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

const userIDKey = "userID"

func Middleware(secret []byte) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		tokenString := strings.TrimPrefix(header, prefix)
		claims, err := ParseToken(secret, tokenString)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}

		c.Set(userIDKey, claims.Subject)
		c.Next()
	}
}

func UserID(c *gin.Context) (string, bool) {
	value, ok := c.Get(userIDKey)
	if !ok {
		return "", false
	}
	userID, ok := value.(string)
	return userID, ok
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./internal/auth/... -v`
Expected: PASS (8 tests — Tasks 3+4+5 combined)

- [ ] **Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/middleware_test.go
git commit -m "feat(api): add jwt auth middleware"
```

---

### Task 6: Register handler

**Files:**
- Create: `signal-api/internal/handlers/auth.go`
- Test: `signal-api/internal/handlers/auth_test.go`

**Interfaces:**
- Consumes: `auth.HashPassword` (Task 3); `db.New`, `db.CreateUserParams`, `db.CreateUserRow` (Task 2)
- Produces: `handlers.AuthHandler{Queries *db.Queries; JWTSecret []byte}`,
  `(*AuthHandler) Register(c *gin.Context)`. Internal `userResponse{ID, Name, Email, CreatedAt string}`
  (`json:"id"`, `json:"name"`, `json:"email"`, `json:"createdAt"`) — later tasks in this file reuse it.

- [ ] **Step 1: Write the failing tests**

```go
// signal-api/internal/handlers/auth_test.go
package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"signal-api/internal/db"
)

func setupTestHandler(t *testing.T) *AuthHandler {
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

	return &AuthHandler{
		Queries:   db.New(pool),
		JWTSecret: []byte("test-secret"),
	}
}

func TestRegister_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)

	body, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		User struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.User.Email != "ada@example.com" {
		t.Errorf("expected email ada@example.com, got %s", resp.User.Email)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)

	body, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})

	req1 := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(httptest.NewRecorder(), req1)

	req2 := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	r.ServeHTTP(w2, req2)

	if w2.Code != http.StatusConflict {
		t.Fatalf("expected status 409, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestRegister_InvalidEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)

	body, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "not-an-email",
		"password": "correct-horse-battery",
	})
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v`
Expected: FAIL — `package handlers: no Go files` (or `undefined: AuthHandler`)

- [ ] **Step 3: Write the implementation**

```go
// signal-api/internal/handlers/auth.go
package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type AuthHandler struct {
	Queries   *db.Queries
	JWTSecret []byte
}

type userResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
}

type registerRequest struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	row, err := h.Queries.CreateUser(c.Request.Context(), db.CreateUserParams{
		Name:         req.Name,
		Email:        req.Email,
		PasswordHash: hash,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "email is already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user": userResponse{
		ID:        row.ID,
		Name:      row.Name,
		Email:     row.Email,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
	}})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/handlers/auth.go internal/handlers/auth_test.go
git commit -m "feat(api): add register handler"
```

---

### Task 7: Login handler

**Files:**
- Modify: `signal-api/internal/handlers/auth.go`
- Modify: `signal-api/internal/handlers/auth_test.go`

**Interfaces:**
- Consumes: `auth.CheckPassword`, `auth.GenerateToken` (Tasks 3–4); `db.GetUserByEmail` (Task 2);
  `userResponse` (Task 6)
- Produces: `(*AuthHandler) Login(c *gin.Context)`

- [ ] **Step 1: Add the failing tests** (append to `auth_test.go`)

```go
func TestLogin_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)
	r.POST("/auth/login", h.Login)

	registerBody, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	registerReq := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(registerBody))
	registerReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(httptest.NewRecorder(), registerReq)

	loginBody, _ := json.Marshal(map[string]string{
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, loginReq)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Token string `json:"token"`
		User  struct {
			Email string `json:"email"`
		} `json:"user"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Token == "" {
		t.Error("expected a non-empty token")
	}
	if resp.User.Email != "ada@example.com" {
		t.Errorf("expected email ada@example.com, got %s", resp.User.Email)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)
	r.POST("/auth/login", h.Login)

	registerBody, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	registerReq := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(registerBody))
	registerReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(httptest.NewRecorder(), registerReq)

	loginBody, _ := json.Marshal(map[string]string{
		"email":    "ada@example.com",
		"password": "wrong-password",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, loginReq)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_UnknownEmail(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/login", h.Login)

	loginBody, _ := json.Marshal(map[string]string{
		"email":    "missing@example.com",
		"password": "correct-horse-battery",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, loginReq)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v -run TestLogin`
Expected: FAIL — `h.Login undefined`

- [ ] **Step 3: Add the implementation** (append to `auth.go`; add `"github.com/jackc/pgx/v5"` to the import block)

```go
type loginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type loginResponse struct {
	Token string       `json:"token"`
	User  userResponse `json:"user"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	row, err := h.Queries.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if !auth.CheckPassword(req.Password, row.PasswordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	token, err := auth.GenerateToken(h.JWTSecret, row.ID, row.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, loginResponse{
		Token: token,
		User: userResponse{
			ID:        row.ID,
			Name:      row.Name,
			Email:     row.Email,
			CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
		},
	})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v`
Expected: PASS (6 tests — Task 6's 3 plus these 3)

- [ ] **Step 5: Commit**

```bash
git add internal/handlers/auth.go internal/handlers/auth_test.go
git commit -m "feat(api): add login handler"
```

---

### Task 8: Me handler

**Files:**
- Modify: `signal-api/internal/handlers/auth.go`
- Modify: `signal-api/internal/handlers/auth_test.go`

**Interfaces:**
- Consumes: `auth.UserID` (Task 5); `db.GetUserByID` (Task 2); `auth.Middleware` (Task 5);
  `userResponse` (Task 6)
- Produces: `(*AuthHandler) Me(c *gin.Context)`

- [ ] **Step 1: Add the failing tests** (append to `auth_test.go`; add
  `"signal-api/internal/auth"` to the import block)

```go
func TestMe_ValidToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	r.POST("/auth/register", h.Register)
	r.POST("/auth/login", h.Login)
	protected := r.Group("/auth")
	protected.Use(auth.Middleware(h.JWTSecret))
	protected.GET("/me", h.Me)

	registerBody, _ := json.Marshal(map[string]string{
		"name":     "Ada Lovelace",
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	registerReq := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(registerBody))
	registerReq.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(httptest.NewRecorder(), registerReq)

	loginBody, _ := json.Marshal(map[string]string{
		"email":    "ada@example.com",
		"password": "correct-horse-battery",
	})
	loginReq := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginW := httptest.NewRecorder()
	r.ServeHTTP(loginW, loginReq)

	var loginResp struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(loginW.Body.Bytes(), &loginResp); err != nil {
		t.Fatalf("failed to parse login response: %v", err)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	meReq.Header.Set("Authorization", "Bearer "+loginResp.Token)
	meW := httptest.NewRecorder()
	r.ServeHTTP(meW, meReq)

	if meW.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", meW.Code, meW.Body.String())
	}
}

func TestMe_MissingToken(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := setupTestHandler(t)
	r := gin.New()
	protected := r.Group("/auth")
	protected.Use(auth.Middleware(h.JWTSecret))
	protected.GET("/me", h.Me)

	meReq := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	meW := httptest.NewRecorder()
	r.ServeHTTP(meW, meReq)

	if meW.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d: %s", meW.Code, meW.Body.String())
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v -run TestMe`
Expected: FAIL — `h.Me undefined`

- [ ] **Step 3: Add the implementation** (append to `auth.go`)

```go
func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	row, err := h.Queries.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": userResponse{
		ID:        row.ID,
		Name:      row.Name,
		Email:     row.Email,
		CreatedAt: row.CreatedAt.Time.Format(time.RFC3339),
	}})
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" go test ./internal/handlers/... -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add internal/handlers/auth.go internal/handlers/auth_test.go
git commit -m "feat(api): add me handler"
```

---

### Task 9: Wire routes and CORS into main.go

**Files:**
- Modify: `signal-api/cmd/api/main.go`
- Modify: `signal-api/cmd/api/main_test.go`

**Interfaces:**
- Consumes: `config.Load` (Task 1); `db.New` (Task 2); `auth.Middleware` (Task 5);
  `handlers.AuthHandler`, `.Register`, `.Login`, `.Me` (Tasks 6–8)
- Produces: `setupRouter(authHandler *handlers.AuthHandler, webOrigin string) *gin.Engine` (signature
  change from the current zero-arg `setupRouter()`)

- [ ] **Step 1: Update the test for the new `setupRouter` signature**

```go
// signal-api/cmd/api/main_test.go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"signal-api/internal/db"
	"signal-api/internal/handlers"
)

func TestHealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authHandler := &handlers.AuthHandler{
		Queries:   db.New(nil),
		JWTSecret: []byte("test-secret"),
	}
	r := setupRouter(authHandler, "http://localhost:5173")

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf(`expected body {"status":"ok"}, got %v`, body)
	}
}
```

- [ ] **Step 2: Run the test to verify it fails to compile**

Run: `go test ./cmd/api/... -v`
Expected: FAIL — `not enough arguments in call to setupRouter`

- [ ] **Step 3: Rewrite main.go**

```go
// signal-api/cmd/api/main.go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"signal-api/internal/auth"
	"signal-api/internal/config"
	"signal-api/internal/db"
	"signal-api/internal/handlers"
)

func corsMiddleware(allowedOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", allowedOrigin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func setupRouter(authHandler *handlers.AuthHandler, webOrigin string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(webOrigin))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/auth/register", authHandler.Register)
	r.POST("/auth/login", authHandler.Login)

	protected := r.Group("/auth")
	protected.Use(auth.Middleware(authHandler.JWTSecret))
	protected.GET("/me", authHandler.Me)

	return r
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	pool, err := pgxpool.New(context.Background(), cfg.DBURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	authHandler := &handlers.AuthHandler{
		Queries:   db.New(pool),
		JWTSecret: []byte(cfg.JWTSecret),
	}

	r := setupRouter(authHandler, cfg.WebOrigin)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
```

`/auth/register` and `/auth/login` are registered directly on `r` (no group), so the
`auth.Middleware` on the `/auth` group only applies to routes added through that group object
(`/auth/me`) — Gin does not retroactively apply group middleware to routes already registered on
the parent engine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./... -v`
Expected: PASS — every package's tests pass (config, auth, db, handlers, cmd/api). The db/handlers
integration tests will skip if `DB_URL` isn't set in this shell; run with `DB_URL` exported (as in
earlier tasks) to exercise them for real.

- [ ] **Step 5: Manual smoke test**

```bash
DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable" JWT_SECRET=dev-secret go run ./cmd/api
```
In another shell:
```bash
curl -s -X POST http://localhost:8080/auth/register -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"correct-horse-battery"}'
curl -s -X POST http://localhost:8080/auth/login -H "Content-Type: application/json" \
  -d '{"email":"ada@example.com","password":"correct-horse-battery"}'
```
Expected: register returns `201` with a `user` object; login returns `200` with a `token` and
`user`. Copy the token and confirm:
```bash
curl -s http://localhost:8080/auth/me -H "Authorization: Bearer <token>"
```
returns `200` with the same user. Stop the server (Ctrl+C) when done.

- [ ] **Step 6: Commit**

```bash
git add cmd/api/main.go cmd/api/main_test.go
git commit -m "feat(api): wire auth routes and cors into the router"
```
