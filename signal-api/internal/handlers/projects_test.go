package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

func setupTestProjectHandler(t *testing.T) (*ProjectHandler, *pgxpool.Pool) {
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

	if _, err := pool.Exec(context.Background(), "TRUNCATE TABLE projects, users CASCADE"); err != nil {
		t.Fatalf("failed to truncate tables: %v", err)
	}

	return &ProjectHandler{Queries: db.New(pool)}, pool
}

func seedUser(t *testing.T, pool *pgxpool.Pool, name, email string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		name, email, "hashed-password",
	).Scan(&id)
	if err != nil {
		t.Fatalf("failed to seed user: %v", err)
	}
	return id
}

func seedProject(t *testing.T, pool *pgxpool.Pool, ownerID, name, slug string, createdAt time.Time) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO projects (owner_id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		ownerID, name, slug, createdAt,
	).Scan(&id)
	if err != nil {
		t.Fatalf("failed to seed project: %v", err)
	}
	return id
}

func TestList_Empty(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Projects   []map[string]any `json:"projects"`
		NextCursor *string          `json:"nextCursor"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if len(resp.Projects) != 0 {
		t.Errorf("expected 0 projects, got %d", len(resp.Projects))
	}
	if resp.NextCursor != nil {
		t.Errorf("expected nil nextCursor, got %v", *resp.NextCursor)
	}
}

func TestList_PaginatesAllProjects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := make(map[string]bool)
	for i := 0; i < 25; i++ {
		id := seedProject(t, pool, ownerID, fmt.Sprintf("Project %d", i), fmt.Sprintf("project-%d", i), base.Add(time.Duration(i)*time.Second))
		want[id] = true
	}

	r := gin.New()
	r.GET("/projects", h.List)

	seen := make(map[string]bool)
	cursor := ""
	for pages := 0; ; pages++ {
		if pages > 10 {
			t.Fatal("too many pages, possible infinite loop")
		}
		path := "/projects"
		if cursor != "" {
			path += "?cursor=" + url.QueryEscape(cursor)
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
		}

		var resp struct {
			Projects []struct {
				ID string `json:"id"`
			} `json:"projects"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}

		for _, p := range resp.Projects {
			if seen[p.ID] {
				t.Fatalf("project %s returned twice", p.ID)
			}
			seen[p.ID] = true
		}

		if resp.NextCursor == nil {
			break
		}
		cursor = *resp.NextCursor
	}

	if len(seen) != len(want) {
		t.Fatalf("expected %d unique projects, got %d", len(want), len(seen))
	}
	for id := range want {
		if !seen[id] {
			t.Errorf("missing project %s", id)
		}
	}
}

func TestListMine_OnlyOwnProjects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerA := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	ownerB := seedUser(t, pool, "Grace Hopper", "grace@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	mineID := seedProject(t, pool, ownerA, "Mine", "mine", base)
	seedProject(t, pool, ownerB, "Not mine", "not-mine", base.Add(time.Second))

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerA, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/mine", h.ListMine)

	req := httptest.NewRequest(http.MethodGet, "/projects/mine", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if len(resp.Projects) != 1 || resp.Projects[0].ID != mineID {
		t.Fatalf("expected only project %s, got %+v", mineID, resp.Projects)
	}
}

func TestList_InvalidLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects?limit=0", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestList_InvalidCursor(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects?cursor=not-valid-base64!!", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestList_ExcludesSoftDeleted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	seedProject(t, pool, ownerID, "Active", "active", base)
	deletedID := seedProject(t, pool, ownerID, "Deleted", "deleted", base.Add(time.Second))

	if _, err := pool.Exec(context.Background(), "UPDATE projects SET deleted_at = now() WHERE id = $1", deletedID); err != nil {
		t.Fatalf("failed to soft-delete project: %v", err)
	}

	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var resp struct {
		Projects []struct {
			ID string `json:"id"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	for _, p := range resp.Projects {
		if p.ID == deletedID {
			t.Fatalf("soft-deleted project %s should not appear in listing", deletedID)
		}
	}
}
