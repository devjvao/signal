package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

func setupTestFeatureRequestHandler(t *testing.T) (*FeatureRequestHandler, *pgxpool.Pool) {
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
	if _, err := pool.Exec(context.Background(), "TRUNCATE TABLE votes, feature_requests, projects, users CASCADE"); err != nil {
		t.Fatalf("failed to truncate tables: %v", err)
	}
	return &FeatureRequestHandler{Queries: db.New(pool)}, pool
}

func seedFeatureRequest(t *testing.T, pool *pgxpool.Pool, projectID, createdBy, title string, createdAt time.Time) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(),
		`INSERT INTO feature_requests (project_id, created_by, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $4) RETURNING id`,
		projectID, createdBy, title, createdAt,
	).Scan(&id)
	if err != nil {
		t.Fatalf("failed to seed feature request: %v", err)
	}
	return id
}

func seedVote(t *testing.T, pool *pgxpool.Pool, featureRequestID, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO votes (feature_request_id, user_id) VALUES ($1, $2)`, featureRequestID, userID,
	); err != nil {
		t.Fatalf("failed to seed vote: %v", err)
	}
}

func frRouter(secret []byte, register func(r *gin.RouterGroup)) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/")
	g.Use(auth.Middleware(secret))
	register(g)
	return r
}

func TestFRCreate_Success(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.POST("/projects/:id/feature-requests", h.Create) })

	body := strings.NewReader(`{"title":"Dark mode","description":"please"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects/"+projectID+"/feature-requests", body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		FeatureRequest struct {
			Title          string `json:"title"`
			Status         string `json:"status"`
			CreatedByName  string `json:"createdByName"`
			UpvoteCount    int    `json:"upvoteCount"`
			ViewerHasVoted bool   `json:"viewerHasVoted"`
		} `json:"featureRequest"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	fr := resp.FeatureRequest
	if fr.Title != "Dark mode" || fr.Status != "open" || fr.CreatedByName != "Ada Lovelace" || fr.UpvoteCount != 0 || fr.ViewerHasVoted {
		t.Errorf("unexpected feature request %+v", fr)
	}
}

func TestFRCreate_MissingTitle(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.POST("/projects/:id/feature-requests", h.Create) })

	req := httptest.NewRequest(http.MethodPost, "/projects/"+projectID+"/feature-requests", strings.NewReader(`{"description":"no title"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRCreate_ProjectNotFound(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.POST("/projects/:id/feature-requests", h.Create) })

	req := httptest.NewRequest(http.MethodPost, "/projects/00000000-0000-0000-0000-000000000000/feature-requests", strings.NewReader(`{"title":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRList_OrdersByUpvotesThenNewest(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterA := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	voterB := seedUser(t, pool, "Alan Turing", "alan@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	low := seedFeatureRequest(t, pool, projectID, ownerID, "Low", base)
	high := seedFeatureRequest(t, pool, projectID, ownerID, "High", base.Add(time.Second))
	seedVote(t, pool, high, voterA)
	seedVote(t, pool, high, voterB)
	seedVote(t, pool, low, voterA)

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/feature-requests", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		FeatureRequests []struct {
			ID          string `json:"id"`
			UpvoteCount int    `json:"upvoteCount"`
		} `json:"featureRequests"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(resp.FeatureRequests) != 2 {
		t.Fatalf("expected 2, got %d", len(resp.FeatureRequests))
	}
	if resp.FeatureRequests[0].ID != high || resp.FeatureRequests[0].UpvoteCount != 2 {
		t.Errorf("expected high (2 votes) first, got %+v", resp.FeatureRequests)
	}
	if resp.FeatureRequests[1].ID != low {
		t.Errorf("expected low second, got %+v", resp.FeatureRequests)
	}
}

func TestFRList_FiltersByStatus(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	openID := seedFeatureRequest(t, pool, projectID, ownerID, "Open one", base)
	plannedID := seedFeatureRequest(t, pool, projectID, ownerID, "Planned one", base.Add(time.Second))
	if _, err := pool.Exec(context.Background(), "UPDATE feature_requests SET status = 'planned' WHERE id = $1", plannedID); err != nil {
		t.Fatalf("failed to set status: %v", err)
	}

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/feature-requests?status=planned", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		FeatureRequests []struct {
			ID string `json:"id"`
		} `json:"featureRequests"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(resp.FeatureRequests) != 1 || resp.FeatureRequests[0].ID != plannedID {
		t.Fatalf("expected only %s, got %+v (openID=%s)", plannedID, resp.FeatureRequests, openID)
	}
}

func TestFRList_InvalidStatus(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/feature-requests?status=banana", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRList_PaginatesAndExcludesSoftDeleted(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := map[string]bool{}
	for i := 0; i < 15; i++ {
		id := seedFeatureRequest(t, pool, projectID, ownerID, "FR", base.Add(time.Duration(i)*time.Second))
		want[id] = true
	}
	deleted := seedFeatureRequest(t, pool, projectID, ownerID, "Deleted", base.Add(time.Hour))
	if _, err := pool.Exec(context.Background(), "UPDATE feature_requests SET deleted_at = now() WHERE id = $1", deleted); err != nil {
		t.Fatalf("soft delete: %v", err)
	}

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	seen := map[string]bool{}
	cursor := ""
	for page := 0; ; page++ {
		if page > 10 {
			t.Fatal("too many pages")
		}
		path := "/projects/" + projectID + "/feature-requests?limit=5"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			FeatureRequests []struct {
				ID string `json:"id"`
			} `json:"featureRequests"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("parse: %v", err)
		}
		for _, fr := range resp.FeatureRequests {
			if fr.ID == deleted {
				t.Fatal("soft-deleted feature request appeared")
			}
			if seen[fr.ID] {
				t.Fatalf("duplicate %s", fr.ID)
			}
			seen[fr.ID] = true
		}
		if resp.NextCursor == nil {
			break
		}
		cursor = *resp.NextCursor
	}
	if len(seen) != len(want) {
		t.Fatalf("expected %d, got %d", len(want), len(seen))
	}
}

func TestFRList_SortNewest_OrdersByCreatedAt(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	older := seedFeatureRequest(t, pool, projectID, ownerID, "Older, more votes", base)
	newer := seedFeatureRequest(t, pool, projectID, ownerID, "Newer, no votes", base.Add(time.Second))
	seedVote(t, pool, older, voterID)

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/feature-requests?sort=newest", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		FeatureRequests []struct {
			ID string `json:"id"`
		} `json:"featureRequests"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(resp.FeatureRequests) != 2 || resp.FeatureRequests[0].ID != newer || resp.FeatureRequests[1].ID != older {
		t.Fatalf("expected [newer, older] regardless of votes, got %+v", resp.FeatureRequests)
	}
}

func TestFRList_SortNewest_PaginatesAcrossPages(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	want := map[string]bool{}
	for i := 0; i < 15; i++ {
		id := seedFeatureRequest(t, pool, projectID, ownerID, "FR", base.Add(time.Duration(i)*time.Second))
		want[id] = true
	}

	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	seen := map[string]bool{}
	cursor := ""
	for page := 0; ; page++ {
		if page > 10 {
			t.Fatal("too many pages")
		}
		path := "/projects/" + projectID + "/feature-requests?sort=newest&limit=5"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			FeatureRequests []struct {
				ID string `json:"id"`
			} `json:"featureRequests"`
			NextCursor *string `json:"nextCursor"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("parse: %v", err)
		}
		for _, fr := range resp.FeatureRequests {
			if seen[fr.ID] {
				t.Fatalf("duplicate %s", fr.ID)
			}
			seen[fr.ID] = true
		}
		if resp.NextCursor == nil {
			break
		}
		cursor = *resp.NextCursor
	}
	if len(seen) != len(want) {
		t.Fatalf("expected %d, got %d", len(want), len(seen))
	}
}

func TestFRList_InvalidSort(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.GET("/projects/:id/feature-requests", h.List) })

	req := httptest.NewRequest(http.MethodGet, "/projects/"+projectID+"/feature-requests?sort=banana", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRUpdate_Success(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	authorID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, authorID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "Old", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, authorID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.PUT("/feature-requests/:id", h.Update) })

	req := httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID, strings.NewReader(`{"title":"New title"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRUpdate_ForbiddenForNonAuthor(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	authorID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	otherID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, authorID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "Old", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, otherID, "grace@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.PUT("/feature-requests/:id", h.Update) })

	req := httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID, strings.NewReader(`{"title":"Hijack"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRUpdate_ConflictWhenUpvoted(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	authorID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, authorID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "Old", time.Now())
	seedVote(t, pool, frID, voterID)
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, authorID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.PUT("/feature-requests/:id", h.Update) })

	req := httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID, strings.NewReader(`{"title":"Nope"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRStatus_ProjectOwnerOnly(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	authorID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "FR", time.Now())
	secret := []byte("test-secret")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.PUT("/feature-requests/:id/status", h.UpdateStatus) })

	// author (not project owner) -> 403
	authorToken, _ := auth.GenerateToken(secret, authorID, "grace@example.com")
	req := httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID+"/status", strings.NewReader(`{"status":"planned"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+authorToken)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("author: expected 403, got %d: %s", w.Code, w.Body.String())
	}

	// project owner -> 200
	ownerToken, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	req = httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID+"/status", strings.NewReader(`{"status":"planned"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ownerToken)
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("owner: expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRStatus_InvalidValue(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, ownerID, "FR", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, ownerID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.PUT("/feature-requests/:id/status", h.UpdateStatus) })

	req := httptest.NewRequest(http.MethodPut, "/feature-requests/"+frID+"/status", strings.NewReader(`{"status":"banana"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRDelete_AuthorOrProjectOwner(t *testing.T) {
	secret := []byte("test-secret")
	run := func(t *testing.T, actorIsOwner bool) int {
		h, pool := setupTestFeatureRequestHandler(t)
		ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
		authorID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
		projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
		frID := seedFeatureRequest(t, pool, projectID, authorID, "FR", time.Now())
		actor := authorID
		email := "grace@example.com"
		if actorIsOwner {
			actor, email = ownerID, "ada@example.com"
		}
		token, _ := auth.GenerateToken(secret, actor, email)
		r := frRouter(secret, func(g *gin.RouterGroup) { g.DELETE("/feature-requests/:id", h.Delete) })
		req := httptest.NewRequest(http.MethodDelete, "/feature-requests/"+frID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	if code := run(t, false); code != http.StatusNoContent {
		t.Fatalf("author delete: expected 204, got %d", code)
	}
	if code := run(t, true); code != http.StatusNoContent {
		t.Fatalf("owner delete: expected 204, got %d", code)
	}
}

func TestFRDelete_ForbiddenForOther(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	authorID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	otherID := seedUser(t, pool, "Alan Turing", "alan@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "FR", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, otherID, "alan@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.DELETE("/feature-requests/:id", h.Delete) })

	req := httptest.NewRequest(http.MethodDelete, "/feature-requests/"+frID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRVote_AddsAndIsIdempotent(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, ownerID, "FR", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, voterID, "grace@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.POST("/feature-requests/:id/vote", h.Vote) })

	doVote := func() (int, int, bool) {
		req := httptest.NewRequest(http.MethodPost, "/feature-requests/"+frID+"/vote", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var resp struct {
			FeatureRequest struct {
				UpvoteCount    int  `json:"upvoteCount"`
				ViewerHasVoted bool `json:"viewerHasVoted"`
			} `json:"featureRequest"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		return w.Code, resp.FeatureRequest.UpvoteCount, resp.FeatureRequest.ViewerHasVoted
	}

	code, count, voted := doVote()
	if code != http.StatusOK || count != 1 || !voted {
		t.Fatalf("first vote: code=%d count=%d voted=%v", code, count, voted)
	}
	code, count, voted = doVote()
	if code != http.StatusOK || count != 1 || !voted {
		t.Fatalf("idempotent vote: code=%d count=%d voted=%v", code, count, voted)
	}
}

func TestFRVote_AuthorForbidden(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	authorID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	projectID := seedProject(t, pool, authorID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, authorID, "FR", time.Now())
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, authorID, "ada@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.POST("/feature-requests/:id/vote", h.Vote) })

	req := httptest.NewRequest(http.MethodPost, "/feature-requests/"+frID+"/vote", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFRUnvote_RemovesAndIsIdempotent(t *testing.T) {
	h, pool := setupTestFeatureRequestHandler(t)
	ownerID := seedUser(t, pool, "Ada Lovelace", "ada@example.com")
	voterID := seedUser(t, pool, "Grace Hopper", "grace@example.com")
	projectID := seedProject(t, pool, ownerID, "Signal", "signal", time.Now())
	frID := seedFeatureRequest(t, pool, projectID, ownerID, "FR", time.Now())
	seedVote(t, pool, frID, voterID)
	secret := []byte("test-secret")
	token, _ := auth.GenerateToken(secret, voterID, "grace@example.com")
	r := frRouter(secret, func(g *gin.RouterGroup) { g.DELETE("/feature-requests/:id/vote", h.Unvote) })

	doUnvote := func() (int, int, bool) {
		req := httptest.NewRequest(http.MethodDelete, "/feature-requests/"+frID+"/vote", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var resp struct {
			FeatureRequest struct {
				UpvoteCount    int  `json:"upvoteCount"`
				ViewerHasVoted bool `json:"viewerHasVoted"`
			} `json:"featureRequest"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
		return w.Code, resp.FeatureRequest.UpvoteCount, resp.FeatureRequest.ViewerHasVoted
	}

	code, count, voted := doUnvote()
	if code != http.StatusOK || count != 0 || voted {
		t.Fatalf("first unvote: code=%d count=%d voted=%v", code, count, voted)
	}
	code, count, voted = doUnvote()
	if code != http.StatusOK || count != 0 || voted {
		t.Fatalf("idempotent unvote: code=%d count=%d voted=%v", code, count, voted)
	}
}
