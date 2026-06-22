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

	"signal-api/internal/auth"
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
