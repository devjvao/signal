package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
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

func TestCreate_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.POST("", h.Create)

	body := strings.NewReader(`{"name":"My Project","description":"A test project"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Project struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			Slug        string `json:"slug"`
			Description string `json:"description"`
			OwnerID     string `json:"ownerId"`
			OwnerName   string `json:"ownerName"`
		} `json:"project"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Project.Slug != "my-project" {
		t.Errorf("expected slug 'my-project', got %q", resp.Project.Slug)
	}
	if resp.Project.Description != "A test project" {
		t.Errorf("expected description 'A test project', got %q", resp.Project.Description)
	}
	if resp.Project.OwnerID != ownerID || resp.Project.OwnerName != "Ada Lovelace" {
		t.Errorf("expected owner %s (Ada Lovelace), got %s (%s)", ownerID, resp.Project.OwnerID, resp.Project.OwnerName)
	}
}

func TestCreate_SlugCollision(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	seedProject(t, pool, ownerID, "My Project", "my-project", time.Now())

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.POST("", h.Create)

	body := strings.NewReader(`{"name":"My Project"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected status 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Project struct {
			Slug string `json:"slug"`
		} `json:"project"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Project.Slug == "my-project" {
		t.Fatal("expected a different slug on collision, got the same one")
	}
	if !strings.HasPrefix(resp.Project.Slug, "my-project-") {
		t.Errorf("expected slug to start with 'my-project-', got %q", resp.Project.Slug)
	}
}

func TestCreate_MissingName(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.POST("", h.Create)

	body := strings.NewReader(`{"description":"missing a name"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreate_Unauthorized(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	secret := []byte("test-secret")

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.POST("", h.Create)

	body := strings.NewReader(`{"name":"My Project"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdate_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Old Name", "old-name", time.Now())

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.PUT("/:id", h.Update)

	body := strings.NewReader(`{"name":"New Name","description":"Updated"}`)
	req := httptest.NewRequest(http.MethodPut, "/projects/"+projectID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Project struct {
			Name        string `json:"name"`
			Slug        string `json:"slug"`
			Description string `json:"description"`
		} `json:"project"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Project.Name != "New Name" || resp.Project.Description != "Updated" {
		t.Errorf("expected updated name/description, got %+v", resp.Project)
	}
	if resp.Project.Slug != "old-name" {
		t.Errorf("expected slug to stay 'old-name', got %q", resp.Project.Slug)
	}
}

func TestUpdate_ForbiddenForNonOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	otherID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Old Name", "old-name", time.Now())

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, otherID, "grace@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.PUT("/:id", h.Update)

	body := strings.NewReader(`{"name":"Hijacked"}`)
	req := httptest.NewRequest(http.MethodPut, "/projects/"+projectID, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdate_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.PUT("/:id", h.Update)

	body := strings.NewReader(`{"name":"Anything"}`)
	req := httptest.NewRequest(http.MethodPut, "/projects/00000000-0000-0000-0000-000000000000", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdate_InvalidID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.PUT("/:id", h.Update)

	body := strings.NewReader(`{"name":"Anything"}`)
	req := httptest.NewRequest(http.MethodPut, "/projects/not-a-uuid", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDelete_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Doomed", "doomed", time.Now())

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.DELETE("/:id", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/projects/"+projectID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected status 204, got %d: %s", w.Code, w.Body.String())
	}

	var deletedAt *time.Time
	if err := pool.QueryRow(context.Background(), "SELECT deleted_at FROM projects WHERE id = $1", projectID).Scan(&deletedAt); err != nil {
		t.Fatalf("failed to query project: %v", err)
	}
	if deletedAt == nil {
		t.Error("expected deleted_at to be set")
	}
}

func TestDelete_ForbiddenForNonOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	otherID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Protected", "protected", time.Now())

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, otherID, "grace@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.DELETE("/:id", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/projects/"+projectID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDelete_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.DELETE("/:id", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/projects/00000000-0000-0000-0000-000000000000", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGet_Success(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/:id", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Project struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"project"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Project.ID != projectID || resp.Project.Name != "Signal" {
		t.Errorf("unexpected project %+v", resp.Project)
	}
}

func TestGet_NotFound(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/:id", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/projects/00000000-0000-0000-0000-000000000000", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected status 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGet_InvalidID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	r := gin.New()
	r.GET("/projects/:id", h.Get)

	req := httptest.NewRequest(http.MethodGet, "/projects/not-a-uuid", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestList_IncludesAggregateCounts(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	frID := ""
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO feature_requests (project_id, created_by, title) VALUES ($1, $2, $3) RETURNING id`,
		projectID, ownerID, "Dark mode",
	).Scan(&frID); err != nil {
		t.Fatalf("failed to seed feature request: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO votes (feature_request_id, user_id) VALUES ($1, $2)`, frID, voterID,
	); err != nil {
		t.Fatalf("failed to seed vote: %v", err)
	}

	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Projects []struct {
			ID           string `json:"id"`
			RequestCount int    `json:"requestCount"`
			VoteCount    int    `json:"voteCount"`
		} `json:"projects"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if len(resp.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(resp.Projects))
	}
	if resp.Projects[0].RequestCount != 1 || resp.Projects[0].VoteCount != 1 {
		t.Errorf("expected requestCount=1 voteCount=1, got %+v", resp.Projects[0])
	}
}

func seedFeatureRequestAndVotes(t *testing.T, pool *pgxpool.Pool, projectID, ownerID string, voteCount int) {
	t.Helper()
	var frID string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO feature_requests (project_id, created_by, title) VALUES ($1, $2, 'FR') RETURNING id`,
		projectID, ownerID,
	).Scan(&frID); err != nil {
		t.Fatalf("failed to seed feature request: %v", err)
	}
	for i := 0; i < voteCount; i++ {
		voterID := seedUser(t, pool, fmt.Sprintf("Voter %s %d", projectID, i), fmt.Sprintf("voter-%s-%d@example.com", projectID, i))
		if _, err := pool.Exec(context.Background(),
			`INSERT INTO votes (feature_request_id, user_id) VALUES ($1, $2)`, frID, voterID,
		); err != nil {
			t.Fatalf("failed to seed vote: %v", err)
		}
	}
}

func TestList_SortActive_OrdersByEngagement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	quiet := seedProject(t, pool, ownerID, "Quiet", "quiet", base)
	loud := seedProject(t, pool, ownerID, "Loud", "loud", base.Add(time.Second))
	seedFeatureRequestAndVotes(t, pool, loud, ownerID, 3)

	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects?sort=active", nil)
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
	if len(resp.Projects) != 2 || resp.Projects[0].ID != loud || resp.Projects[1].ID != quiet {
		t.Fatalf("expected [loud, quiet], got %+v", resp.Projects)
	}
}

func TestList_SortActive_PaginatesAcrossPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := map[string]bool{}
	for i := 0; i < 15; i++ {
		id := seedProject(t, pool, ownerID, fmt.Sprintf("Project %d", i), fmt.Sprintf("project-%d", i), base.Add(time.Duration(i)*time.Second))
		seedFeatureRequestAndVotes(t, pool, id, ownerID, i%4)
		want[id] = true
	}

	r := gin.New()
	r.GET("/projects", h.List)

	seen := map[string]bool{}
	cursor := ""
	for page := 0; ; page++ {
		if page > 10 {
			t.Fatal("too many pages, possible infinite loop")
		}
		path := "/projects?sort=active&limit=5"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
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
}

func TestList_InvalidSort(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _ := setupTestProjectHandler(t)
	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects?sort=banana", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListMine_SortActive_OrdersByEngagement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	quiet := seedProject(t, pool, ownerID, "Quiet", "quiet", base)
	loud := seedProject(t, pool, ownerID, "Loud", "loud", base.Add(time.Second))
	seedFeatureRequestAndVotes(t, pool, loud, ownerID, 3)

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/mine", h.ListMine)

	req := httptest.NewRequest(http.MethodGet, "/projects/mine?sort=active", nil)
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
	if len(resp.Projects) != 2 || resp.Projects[0].ID != loud || resp.Projects[1].ID != quiet {
		t.Fatalf("expected [loud, quiet], got %+v", resp.Projects)
	}
}

func TestListMine_SortActive_PaginatesAcrossPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := map[string]bool{}
	for i := 0; i < 15; i++ {
		id := seedProject(t, pool, ownerID, fmt.Sprintf("Project %d", i), fmt.Sprintf("project-%d", i), base.Add(time.Duration(i)*time.Second))
		seedFeatureRequestAndVotes(t, pool, id, ownerID, i%4)
		want[id] = true
	}

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/mine", h.ListMine)

	seen := map[string]bool{}
	cursor := ""
	for page := 0; ; page++ {
		if page > 10 {
			t.Fatal("too many pages, possible infinite loop")
		}
		path := "/projects/mine?sort=active&limit=5"
		if cursor != "" {
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
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
}

func TestListMine_InvalidSort(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	secret := []byte("test-secret")
	token, err := auth.GenerateToken(secret, ownerID, "ada@example.com")
	if err != nil {
		t.Fatalf("failed to generate token: %v", err)
	}

	r := gin.New()
	protected := r.Group("/projects")
	protected.Use(auth.Middleware(secret))
	protected.GET("/mine", h.ListMine)

	req := httptest.NewRequest(http.MethodGet, "/projects/mine?sort=banana", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected status 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestList_FiltersBySearch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, pool := setupTestProjectHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	matchID := seedProject(t, pool, ownerID, "Signal Platform", "signal-platform", base)
	seedProject(t, pool, ownerID, "Unrelated", "unrelated", base.Add(time.Second))

	r := gin.New()
	r.GET("/projects", h.List)

	req := httptest.NewRequest(http.MethodGet, "/projects?search=signal", nil)
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
	if len(resp.Projects) != 1 || resp.Projects[0].ID != matchID {
		t.Fatalf("expected only %s, got %+v", matchID, resp.Projects)
	}
}
