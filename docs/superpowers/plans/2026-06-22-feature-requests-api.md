# Feature Requests API Implementation Plan (signal-api)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add feature-request and voting routes to `signal-api`, conforming exactly to
`contracts/feature-requests-api.md` and the `GET /projects/:id` addition in `contracts/projects-api.md`.

**Architecture:** Follows the existing project-CRUD pattern: sqlc-generated queries in
`internal/db`, a Gin handler struct in `internal/handlers`, routes wired in `cmd/api/main.go`.
Authorization is fetch-then-check: load the row via `GetFeatureRequestByID`, compare the caller's
id against `CreatedBy` / `ProjectOwnerID`, return `403`/`404`/`409` as appropriate. Vote counts and
the viewer's vote state are computed in SQL.

**Tech Stack:** Go, Gin, sqlc (pgx/v5), PostgreSQL, golang-migrate. Tests are table-driven Go
integration tests that skip when `DB_URL` is unset (existing convention in
`internal/handlers/projects_test.go`).

## Global Constraints

- JSON keys are camelCase via explicit `json:"..."` struct tags.
- Error envelope is always `{ "error": "<message>" }`.
- Soft-delete everywhere: `deleted_at IS NULL` filters on all reads; deletes set `deleted_at = now()`.
- Cursor strings are opaque base64; clients pass them back verbatim.
- The DB schema already exists — migrations `000004_create_feature_requests_table` and
  `000005_create_votes_table`. **Do not add migrations.**
- `uuidPattern`, `zeroUUID`, `descriptionToText`, and `newProjectResponse` already exist in
  `internal/handlers/projects.go` (same `handlers` package) — reuse them, do not redefine.
- The status enum is exactly: `open`, `planned`, `in_progress`, `completed`, `rejected`.

## Environment Setup (do this once before Task 1)

- [ ] Start Postgres and run migrations so integration tests actually execute (not just skip):

```bash
cd /d/Lab/signal
docker compose up -d postgres
cd signal-api
export DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
migrate -path db/migrations -database "$DB_URL" up
```

Expected: migrations `000001`..`000005` apply cleanly (or report "no change" if already applied).

- [ ] Confirm `sqlc` is available (the queries below are compiled by it):

```bash
sqlc version || go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

Expected: a version string. If `sqlc` cannot be installed, see the note at the end of Task 1.

---

### Task 1: sqlc queries for feature requests and votes

**Files:**
- Create: `signal-api/db/queries/feature_requests.sql`
- Create: `signal-api/db/queries/votes.sql`
- Generate: `signal-api/internal/db/feature_requests.sql.go`, `signal-api/internal/db/votes.sql.go`

**Interfaces:**
- Consumes: existing `models.go` types `FeatureRequest`, `Vote`; existing `GetProjectByID`.
- Produces (the symbols later tasks rely on — these are what `sqlc generate` emits):
  - `ListFeatureRequestsParams{ ViewerID string; ProjectID string; HasCursor bool; CursorCount int32; CursorCreatedAt pgtype.Timestamptz; CursorID string; LimitCount int32 }`
  - `ListFeatureRequestsRow{ ID, ProjectID, CreatedBy, Title string; Description pgtype.Text; Status string; CreatedAt pgtype.Timestamptz; CreatedByName string; UpvoteCount int32; ViewerHasVoted bool }`
  - `(q *Queries) ListFeatureRequests(ctx, ListFeatureRequestsParams) ([]ListFeatureRequestsRow, error)`
  - `GetFeatureRequestByIDParams{ ViewerID string; ID string }`
  - `GetFeatureRequestByIDRow{ ID, ProjectID, CreatedBy, Title string; Description pgtype.Text; Status string; CreatedAt pgtype.Timestamptz; CreatedByName, ProjectOwnerID string; UpvoteCount int32; ViewerHasVoted bool }`
  - `(q *Queries) GetFeatureRequestByID(ctx, GetFeatureRequestByIDParams) (GetFeatureRequestByIDRow, error)`
  - `CreateFeatureRequestParams{ ProjectID, CreatedBy, Title string; Description pgtype.Text }` → `CreateFeatureRequestRow{ ID, ProjectID, CreatedBy, Title string; Description pgtype.Text; Status string; CreatedAt pgtype.Timestamptz }`
  - `UpdateFeatureRequestParams{ Title string; Description pgtype.Text; ID string }` → `UpdateFeatureRequestRow` (same fields as `CreateFeatureRequestRow`)
  - `UpdateFeatureRequestStatusParams{ Status string; ID string }` → `UpdateFeatureRequestStatusRow` (same fields as `CreateFeatureRequestRow`)
  - `(q *Queries) SoftDeleteFeatureRequest(ctx, id string) error`
  - `CreateVoteParams{ FeatureRequestID, UserID string }` → `(q *Queries) CreateVote(ctx, CreateVoteParams) error`
  - `RemoveVoteParams{ FeatureRequestID, UserID string }` → `(q *Queries) RemoveVote(ctx, RemoveVoteParams) error`

- [ ] **Step 1: Write `db/queries/feature_requests.sql`**

```sql
-- name: ListFeatureRequests :many
SELECT
    fr.id,
    fr.project_id,
    fr.created_by,
    fr.title,
    fr.description,
    fr.status,
    fr.created_at,
    u.name AS created_by_name,
    COALESCE(v.cnt, 0)::int AS upvote_count,
    EXISTS (
        SELECT 1 FROM votes vv
        WHERE vv.feature_request_id = fr.id
          AND vv.user_id = sqlc.arg('viewer_id')::uuid
          AND vv.deleted_at IS NULL
    ) AS viewer_has_voted
FROM feature_requests fr
JOIN users u ON u.id = fr.created_by
LEFT JOIN (
    SELECT feature_request_id, count(*) AS cnt
    FROM votes
    WHERE deleted_at IS NULL
    GROUP BY feature_request_id
) v ON v.feature_request_id = fr.id
WHERE fr.project_id = sqlc.arg('project_id')::uuid
  AND fr.deleted_at IS NULL
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR COALESCE(v.cnt, 0)::int < sqlc.arg('cursor_count')::int
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at = sqlc.arg('cursor_created_at')::timestamptz AND fr.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY upvote_count DESC, fr.created_at DESC, fr.id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: GetFeatureRequestByID :one
SELECT
    fr.id,
    fr.project_id,
    fr.created_by,
    fr.title,
    fr.description,
    fr.status,
    fr.created_at,
    u.name AS created_by_name,
    p.owner_id AS project_owner_id,
    COALESCE(v.cnt, 0)::int AS upvote_count,
    EXISTS (
        SELECT 1 FROM votes vv
        WHERE vv.feature_request_id = fr.id
          AND vv.user_id = sqlc.arg('viewer_id')::uuid
          AND vv.deleted_at IS NULL
    ) AS viewer_has_voted
FROM feature_requests fr
JOIN users u ON u.id = fr.created_by
JOIN projects p ON p.id = fr.project_id
LEFT JOIN (
    SELECT feature_request_id, count(*) AS cnt
    FROM votes
    WHERE deleted_at IS NULL
    GROUP BY feature_request_id
) v ON v.feature_request_id = fr.id
WHERE fr.id = sqlc.arg('id')::uuid AND fr.deleted_at IS NULL;

-- name: CreateFeatureRequest :one
INSERT INTO feature_requests (project_id, created_by, title, description)
VALUES (sqlc.arg('project_id')::uuid, sqlc.arg('created_by')::uuid, sqlc.arg('title'), sqlc.arg('description'))
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: UpdateFeatureRequest :one
UPDATE feature_requests
SET title = sqlc.arg('title'), description = sqlc.arg('description')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: UpdateFeatureRequestStatus :one
UPDATE feature_requests
SET status = sqlc.arg('status')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: SoftDeleteFeatureRequest :exec
UPDATE feature_requests
SET deleted_at = now()
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL;
```

- [ ] **Step 2: Write `db/queries/votes.sql`**

```sql
-- name: CreateVote :exec
INSERT INTO votes (feature_request_id, user_id)
VALUES (sqlc.arg('feature_request_id')::uuid, sqlc.arg('user_id')::uuid);

-- name: RemoveVote :exec
UPDATE votes
SET deleted_at = now()
WHERE feature_request_id = sqlc.arg('feature_request_id')::uuid
  AND user_id = sqlc.arg('user_id')::uuid
  AND deleted_at IS NULL;
```

- [ ] **Step 3: Generate the Go code**

Run: `cd signal-api && sqlc generate`
Expected: creates `internal/db/feature_requests.sql.go` and `internal/db/votes.sql.go`; no errors.
Verify the produced symbols match the **Produces** list above (`grep -n "func (q \*Queries)" internal/db/feature_requests.sql.go internal/db/votes.sql.go`).

> If `sqlc` is genuinely unavailable: hand-write the two `.sql.go` files following
> `internal/db/projects.sql.go` byte-for-byte in style (package `db`, `const <name> = \`<SQL with $N placeholders>\``, a `<Name>Params` struct, a `<Name>Row` struct, and the method body using
> `q.db.QueryRow`/`q.db.Query`/`q.db.Exec` and `row.Scan(...)`). The positional `$N` order must match
> the `sqlc.arg` first-appearance order shown in the queries above. `:exec` queries (`CreateVote`,
> `RemoveVote`, `SoftDeleteFeatureRequest`) return only `error`.

- [ ] **Step 4: Verify it compiles**

Run: `cd signal-api && go build ./...`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add signal-api/db/queries/feature_requests.sql signal-api/db/queries/votes.sql signal-api/internal/db/feature_requests.sql.go signal-api/internal/db/votes.sql.go
git commit -m "feat(api): add feature request and vote queries"
```

---

### Task 2: `GET /projects/:id` single-project handler

**Files:**
- Modify: `signal-api/internal/handlers/projects.go` (add `Get` method)
- Test: `signal-api/internal/handlers/projects_test.go` (add tests)

**Interfaces:**
- Consumes: existing `GetProjectByID`, `newProjectResponse`, `uuidPattern`, `auth.UserID`.
- Produces: `(h *ProjectHandler) Get(c *gin.Context)`.

- [ ] **Step 1: Write the failing tests** — append to `projects_test.go`:

```go
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd signal-api && go test ./internal/handlers/ -run TestGet_ -v`
Expected: compile error `h.Get undefined` (or, with `DB_URL` set, FAIL).

- [ ] **Step 3: Add the `Get` method** to `projects.go` (place after `ListMine`):

```go
func (h *ProjectHandler) Get(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}
	if _, ok := auth.UserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	row, err := h.Queries.GetProjectByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": newProjectResponse(
		row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName,
	)})
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd signal-api && go test ./internal/handlers/ -run TestGet_ -v`
Expected: PASS (with `DB_URL` set) or SKIP (without).

- [ ] **Step 5: Commit**

```bash
git add signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go
git commit -m "feat(api): add get project by id route"
```

---

### Task 3: Feature request handler — scaffolding, list, and create

**Files:**
- Create: `signal-api/internal/handlers/feature_requests.go`
- Test: `signal-api/internal/handlers/feature_requests_test.go`

**Interfaces:**
- Consumes: Task 1 query symbols; `uuidPattern`, `zeroUUID`, `descriptionToText`, `auth.UserID` from the `handlers` package.
- Produces: `FeatureRequestHandler{ Queries *db.Queries }` with methods `List`, `Create` (this task) and `Update`, `UpdateStatus`, `Delete`, `Vote`, `Unvote` (Tasks 4–5). Plus helpers `newFeatureRequestResponse`, cursor encode/decode, and `respondWithFeatureRequest`.

- [ ] **Step 1: Write the handler scaffolding + List + Create** in `feature_requests.go`:

```go
package handlers

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type FeatureRequestHandler struct {
	Queries *db.Queries
}

type featureRequestResponse struct {
	ID             string  `json:"id"`
	ProjectID      string  `json:"projectId"`
	Title          string  `json:"title"`
	Description    *string `json:"description"`
	Status         string  `json:"status"`
	CreatedBy      string  `json:"createdBy"`
	CreatedByName  string  `json:"createdByName"`
	UpvoteCount    int32   `json:"upvoteCount"`
	ViewerHasVoted bool    `json:"viewerHasVoted"`
	CreatedAt      string  `json:"createdAt"`
}

type featureRequestsListResponse struct {
	FeatureRequests []featureRequestResponse `json:"featureRequests"`
	NextCursor      *string                  `json:"nextCursor"`
}

const (
	defaultFeatureRequestsLimit = 10
	maxFeatureRequestsLimit     = 50
)

var validFeatureRequestStatuses = map[string]bool{
	"open": true, "planned": true, "in_progress": true, "completed": true, "rejected": true,
}

type featureRequestCursor struct {
	count     int32
	createdAt time.Time
	id        string
}

func parseFeatureRequestsLimit(c *gin.Context) (int, bool) {
	raw := c.Query("limit")
	if raw == "" {
		return defaultFeatureRequestsLimit, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxFeatureRequestsLimit {
		return 0, false
	}
	return limit, true
}

func parseFeatureRequestsCursor(c *gin.Context) (*featureRequestCursor, bool) {
	raw := c.Query("cursor")
	if raw == "" {
		return nil, true
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, false
	}
	parts := strings.SplitN(string(decoded), "|", 3)
	if len(parts) != 3 || !uuidPattern.MatchString(parts[2]) {
		return nil, false
	}
	count, err := strconv.Atoi(parts[0])
	if err != nil {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return nil, false
	}
	return &featureRequestCursor{count: int32(count), createdAt: createdAt, id: parts[2]}, true
}

func encodeFeatureRequestsCursor(count int32, createdAt time.Time, id string) string {
	raw := strconv.Itoa(int(count)) + "|" + createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func featureRequestCursorParams(cursor *featureRequestCursor) (hasCursor bool, count int32, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, 0, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, zeroUUID
	}
	return true, cursor.count, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}

func newFeatureRequestResponse(id, projectID, createdBy, title string, description pgtype.Text, status string, createdAt pgtype.Timestamptz, createdByName string, upvoteCount int32, viewerHasVoted bool) featureRequestResponse {
	var desc *string
	if description.Valid {
		d := description.String
		desc = &d
	}
	return featureRequestResponse{
		ID:             id,
		ProjectID:      projectID,
		Title:          title,
		Description:    desc,
		Status:         status,
		CreatedBy:      createdBy,
		CreatedByName:  createdByName,
		UpvoteCount:    upvoteCount,
		ViewerHasVoted: viewerHasVoted,
		CreatedAt:      createdAt.Time.UTC().Format(time.RFC3339),
	}
}

// respondWithFeatureRequest re-reads the row (refreshing upvoteCount / viewerHasVoted) and writes it.
func (h *FeatureRequestHandler) respondWithFeatureRequest(c *gin.Context, viewerID, id string, status int) {
	fr, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: viewerID, ID: id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	c.JSON(status, gin.H{"featureRequest": newFeatureRequestResponse(
		fr.ID, fr.ProjectID, fr.CreatedBy, fr.Title, fr.Description, fr.Status, fr.CreatedAt, fr.CreatedByName, fr.UpvoteCount, fr.ViewerHasVoted,
	)})
}

func (h *FeatureRequestHandler) List(c *gin.Context) {
	projectID := c.Param("id")
	if !uuidPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}
	viewerID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	limit, ok := parseFeatureRequestsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseFeatureRequestsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	if _, err := h.Queries.GetProjectByID(c.Request.Context(), projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	hasCursor, cursorCount, cursorCreatedAt, cursorID := featureRequestCursorParams(cursor)
	rows, err := h.Queries.ListFeatureRequests(c.Request.Context(), db.ListFeatureRequestsParams{
		ViewerID:        viewerID,
		ProjectID:       projectID,
		HasCursor:       hasCursor,
		CursorCount:     cursorCount,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
		LimitCount:      int32(limit + 1),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	items := make([]featureRequestResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, newFeatureRequestResponse(row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, row.CreatedByName, row.UpvoteCount, row.ViewerHasVoted))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeFeatureRequestsCursor(last.UpvoteCount, last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, featureRequestsListResponse{FeatureRequests: items, NextCursor: nextCursor})
}

type createFeatureRequestRequest struct {
	Title       string  `json:"title" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

func (h *FeatureRequestHandler) Create(c *gin.Context) {
	projectID := c.Param("id")
	if !uuidPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req createFeatureRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := h.Queries.GetProjectByID(c.Request.Context(), projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	row, err := h.Queries.CreateFeatureRequest(c.Request.Context(), db.CreateFeatureRequestParams{
		ProjectID:   projectID,
		CreatedBy:   userID,
		Title:       req.Title,
		Description: descriptionToText(req.Description),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	h.respondWithFeatureRequest(c, userID, row.ID, http.StatusCreated)
}
```

- [ ] **Step 2: Write the test helpers + List/Create tests** in `feature_requests_test.go`:

```go
package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
```

> Note: `feature_requests_test.go` reuses `seedUser`/`seedProject` from `projects_test.go` (same
> package) and needs its own `os` import. Add `"os"` to the import block.

- [ ] **Step 3: Run tests to verify they fail (before wiring) / pass (with DB)**

Run: `cd signal-api && go vet ./... && go test ./internal/handlers/ -run TestFR -v`
Expected: compiles; PASS with `DB_URL` set, SKIP without.

- [ ] **Step 4: Commit**

```bash
git add signal-api/internal/handlers/feature_requests.go signal-api/internal/handlers/feature_requests_test.go
git commit -m "feat(api): add feature request list and create handlers"
```

---

### Task 4: Update, status, and delete handlers

**Files:**
- Modify: `signal-api/internal/handlers/feature_requests.go`
- Test: `signal-api/internal/handlers/feature_requests_test.go`

**Interfaces:**
- Consumes: Task 3 helpers; `GetFeatureRequestByID`, `UpdateFeatureRequest`, `UpdateFeatureRequestStatus`, `SoftDeleteFeatureRequest`.
- Produces: `Update`, `UpdateStatus`, `Delete` methods.

- [ ] **Step 1: Add the three handlers** to `feature_requests.go`:

```go
type updateFeatureRequestRequest struct {
	Title       string  `json:"title" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

func (h *FeatureRequestHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req updateFeatureRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if existing.UpvoteCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "feature request has upvotes"})
		return
	}

	row, err := h.Queries.UpdateFeatureRequest(c.Request.Context(), db.UpdateFeatureRequestParams{
		ID:          id,
		Title:       req.Title,
		Description: descriptionToText(req.Description),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"featureRequest": newFeatureRequestResponse(
		row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, existing.CreatedByName, existing.UpvoteCount, existing.ViewerHasVoted,
	)})
}

type updateFeatureRequestStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (h *FeatureRequestHandler) UpdateStatus(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req updateFeatureRequestStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || !validFeatureRequestStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}

	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.ProjectOwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	row, err := h.Queries.UpdateFeatureRequestStatus(c.Request.Context(), db.UpdateFeatureRequestStatusParams{
		ID:     id,
		Status: req.Status,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"featureRequest": newFeatureRequestResponse(
		row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, existing.CreatedByName, existing.UpvoteCount, existing.ViewerHasVoted,
	)})
}

func (h *FeatureRequestHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy != userID && existing.ProjectOwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if err := h.Queries.SoftDeleteFeatureRequest(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	c.Status(http.StatusNoContent)
}
```

- [ ] **Step 2: Add tests** to `feature_requests_test.go` (covers `403` author/owner matrix and the `409` upvote lock):

```go
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
```

- [ ] **Step 3: Run tests**

Run: `cd signal-api && go test ./internal/handlers/ -run TestFR -v`
Expected: PASS with `DB_URL` set; SKIP without.

- [ ] **Step 4: Commit**

```bash
git add signal-api/internal/handlers/feature_requests.go signal-api/internal/handlers/feature_requests_test.go
git commit -m "feat(api): add feature request update, status, and delete handlers"
```

---

### Task 5: Vote and unvote handlers

**Files:**
- Modify: `signal-api/internal/handlers/feature_requests.go`
- Test: `signal-api/internal/handlers/feature_requests_test.go`

**Interfaces:**
- Consumes: Task 3 `respondWithFeatureRequest`; `CreateVote`, `RemoveVote`, `GetFeatureRequestByID`.
- Produces: `Vote`, `Unvote` methods.

- [ ] **Step 1: Add the handlers** to `feature_requests.go`:

```go
func (h *FeatureRequestHandler) Vote(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy == userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if err := h.Queries.CreateVote(c.Request.Context(), db.CreateVoteParams{FeatureRequestID: id, UserID: userID}); err != nil {
		var pgErr *pgconn.PgError
		if !(errors.As(err, &pgErr) && pgErr.Code == "23505") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
		// 23505 = unique violation: an active vote already exists. Idempotent — fall through.
	}

	h.respondWithFeatureRequest(c, userID, id, http.StatusOK)
}

func (h *FeatureRequestHandler) Unvote(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if _, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if err := h.Queries.RemoveVote(c.Request.Context(), db.RemoveVoteParams{FeatureRequestID: id, UserID: userID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	h.respondWithFeatureRequest(c, userID, id, http.StatusOK)
}
```

- [ ] **Step 2: Add tests** to `feature_requests_test.go`:

```go
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
```

- [ ] **Step 3: Run tests**

Run: `cd signal-api && go test ./internal/handlers/ -run TestFR -v`
Expected: PASS with `DB_URL` set; SKIP without.

- [ ] **Step 4: Commit**

```bash
git add signal-api/internal/handlers/feature_requests.go signal-api/internal/handlers/feature_requests_test.go
git commit -m "feat(api): add feature request vote and unvote handlers"
```

---

### Task 6: Wire routes in main.go

**Files:**
- Modify: `signal-api/cmd/api/main.go`
- Modify: `signal-api/cmd/api/main_test.go`

**Interfaces:**
- Consumes: `handlers.FeatureRequestHandler`, `ProjectHandler.Get`.
- Produces: registered routes; updated `setupRouter` signature.

- [ ] **Step 1: Update `setupRouter`** — change the signature and add routes:

```go
func setupRouter(authHandler *handlers.AuthHandler, projectHandler *handlers.ProjectHandler, featureRequestHandler *handlers.FeatureRequestHandler, webOrigin string) *gin.Engine {
```

Inside, replace the `protectedProjects` block with:

```go
	protectedProjects := r.Group("/projects")
	protectedProjects.Use(auth.Middleware(authHandler.JWTSecret))
	protectedProjects.GET("", projectHandler.List)
	protectedProjects.GET("/mine", projectHandler.ListMine)
	protectedProjects.GET("/:id", projectHandler.Get)
	protectedProjects.POST("", projectHandler.Create)
	protectedProjects.PUT("/:id", projectHandler.Update)
	protectedProjects.DELETE("/:id", projectHandler.Delete)
	protectedProjects.GET("/:id/feature-requests", featureRequestHandler.List)
	protectedProjects.POST("/:id/feature-requests", featureRequestHandler.Create)

	protectedFeatureRequests := r.Group("/feature-requests")
	protectedFeatureRequests.Use(auth.Middleware(authHandler.JWTSecret))
	protectedFeatureRequests.PUT("/:id", featureRequestHandler.Update)
	protectedFeatureRequests.PUT("/:id/status", featureRequestHandler.UpdateStatus)
	protectedFeatureRequests.DELETE("/:id", featureRequestHandler.Delete)
	protectedFeatureRequests.POST("/:id/vote", featureRequestHandler.Vote)
	protectedFeatureRequests.DELETE("/:id/vote", featureRequestHandler.Unvote)
```

In `main()`, after the `projectHandler` construction, add and pass the new handler:

```go
	featureRequestHandler := &handlers.FeatureRequestHandler{
		Queries: db.New(pool),
	}

	r := setupRouter(authHandler, projectHandler, featureRequestHandler, cfg.WebOrigin)
```

- [ ] **Step 2: Update `main_test.go`** — `TestHealthEndpoint` must construct the new handler and pass it:

```go
	projectHandler := &handlers.ProjectHandler{Queries: db.New(nil)}
	featureRequestHandler := &handlers.FeatureRequestHandler{Queries: db.New(nil)}
	r := setupRouter(authHandler, projectHandler, featureRequestHandler, "http://localhost:5173")
```

- [ ] **Step 3: Verify routes register without panic and the suite is green**

Run: `cd signal-api && go build ./... && go test ./... -v`
Expected: `TestHealthEndpoint` PASSES (route registration in `setupRouter` runs here — a gin
routing conflict between `GET /projects/:id` and `GET /projects/mine` would panic this test). All
handler tests PASS (with `DB_URL`) or SKIP (without).

> If gin panics on the `GET /projects/mine` vs `GET /projects/:id` sibling routes, the installed
> gin version predates static/param sibling support. The fix is to register `GET /projects/:id` and
> its `:id/feature-requests` children on a separate handling path; but current gin (the version in
> `go.mod`) supports this, so expect no panic. Surface it in review if it occurs.

- [ ] **Step 4: Commit**

```bash
git add signal-api/cmd/api/main.go signal-api/cmd/api/main_test.go
git commit -m "feat(api): wire feature request and get-project routes"
```

---

## Self-Review

- **Spec coverage:** list/create/update/status/delete/vote/unvote + `GET /projects/:id` → Tasks 2–6.
  Ordering by upvotes, cursor pagination, soft-delete exclusion → Task 3. Author/owner permission
  matrix and the `409` upvote lock → Task 4. Author-cannot-vote + idempotency → Task 5.
- **No placeholders:** every step has full code or an exact command + expected output.
- **Type consistency:** handler calls use the exact `*Params`/`*Row` field names declared in Task 1's
  Produces block (`ViewerID`, `CursorCount`, `ProjectOwnerID`, `UpvoteCount`, `ViewerHasVoted`, etc.).