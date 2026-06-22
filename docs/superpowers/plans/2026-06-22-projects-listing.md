# Projects Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add cursor-paginated `GET /projects` and `GET /projects/mine` to signal-api, and a tabbed, infinite-scrolling projects listing on the signal-web main page.

**Architecture:** signal-api gains a `ProjectHandler` (sqlc queries + gin routes, mirroring the existing `AuthHandler` pattern) behind the existing JWT `auth.Middleware`. signal-web gains a `ProjectList` component built on `@tanstack/react-query`'s `useInfiniteQuery` plus an `IntersectionObserver` sentinel, switched between "all" and "mine" scope via a new `Tabs` UI primitive on `MainPage`. Cursor pagination uses an opaque base64 `"<createdAt RFC3339Nano>|<id>"` token, ordered `created_at DESC, id DESC`.

**Tech Stack:** Go 1.26, gin, sqlc (pgx/v5), pgx/v5, PostgreSQL — React 19, TypeScript, Vite, Tailwind, `@tanstack/react-query`, `@radix-ui/react-tabs`, vitest + @testing-library/react.

## Global Constraints

- Commit messages follow `CONVENTIONAL_COMMIT_GUIDELINE.md` (`type(scope): summary`, lowercase, imperative, no trailing period).
- All API JSON uses `camelCase` keys via explicit Go `json:"..."` tags (per `contracts/README.md`).
- Error envelope for non-2xx responses is always `{ "error": "..." }`.
- `contracts/` is shared ground truth — write it before either implementation track starts.
- signal-api integration tests skip (`t.Skip`) when `DB_URL` is unset, matching `auth_test.go` / `users_test.go`.
- signal-web has no existing data-fetching library; `@tanstack/react-query` is being introduced specifically for this feature per the approved design.
- Do not modify `prompts.txt` from inside any dispatched subagent — only the controller session appends to it (existing project rule).

---

### Task 1: Contracts — Project entity and projects API

**Files:**
- Modify: `contracts/entities.md`
- Create: `contracts/projects-api.md`
- Modify: `contracts/README.md`

**Interfaces:**
- Produces: the `Project` JSON shape and the `GET /projects` / `GET /projects/mine` wire contract that both Task 3 (API) and Task 5 (web `api.ts`) implement against.

- [x] **Step 1: Add the `Project` entity to `contracts/entities.md`**

Append to the end of the file:

```markdown

## Project

The publicly-serialized shape of a project, including a denormalized owner name so listing
clients don't need a separate lookup.

| Field         | Type             | Notes                                              |
|---------------|------------------|-----------------------------------------------------|
| `id`          | string           | UUID, primary key                                  |
| `name`        | string           | required, non-empty                                |
| `slug`        | string           | unique among active (non-deleted) projects         |
| `description` | string \| null   | optional                                           |
| `ownerId`     | string           | UUID of the owning user                            |
| `ownerName`   | string           | display name of the owner, joined from `users`     |
| `createdAt`   | string           | ISO 8601 timestamp, e.g. `2026-06-21T12:00:00Z`    |

Example:

```json
{
  "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
  "name": "Signal",
  "slug": "signal",
  "description": "A feedback aggregator",
  "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
  "ownerName": "Ada Lovelace",
  "createdAt": "2026-06-21T12:00:00Z"
}
```

Soft-deleted projects (`deleted_at IS NOT NULL`) are excluded from all lookups and listings.
```

- [x] **Step 2: Create `contracts/projects-api.md`**

```markdown
# Projects API

See `README.md` for base URL, auth header, error envelope, and status code conventions used
throughout this document. See `entities.md` for the `Project` shape referenced below.

## GET /projects

Protected — requires `Authorization: Bearer <token>`.

Returns all non-deleted projects across all users, newest first (`createdAt` descending).

**Query params:**

- `cursor` (optional) — opaque string from a previous response's `nextCursor`. Omit for the first
  page. Clients must treat this as opaque and pass back exactly what they were given.
- `limit` (optional) — page size. Default `10`, max `50`. Values outside `1..50`, or non-integer
  values, are a `400`.

**Success response — `200 OK`:**

```json
{
  "projects": [
    {
      "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
      "name": "Signal",
      "slug": "signal",
      "description": "A feedback aggregator",
      "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
      "ownerName": "Ada Lovelace",
      "createdAt": "2026-06-21T12:00:00Z"
    }
  ],
  "nextCursor": "<opaque string>"
}
```

`nextCursor` is `null` when there are no more pages.

**Error responses:**

- `400 Bad Request`:
  ```json
  { "error": "invalid cursor" }
  ```
  ```json
  { "error": "invalid limit" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```

## GET /projects/mine

Protected — requires `Authorization: Bearer <token>`.

Same query params, response shape, and error responses as `GET /projects`, but scoped to projects
owned by the authenticated user (the token's `sub` claim).
```

- [x] **Step 3: Add `projects-api.md` to the Files list in `contracts/README.md`**

In `contracts/README.md`, change:

```markdown
## Files

- `entities.md` — shared data shapes (e.g. the User entity)
- `auth-api.md` — authentication routes: register, login, current-user
```

to:

```markdown
## Files

- `entities.md` — shared data shapes (e.g. the User and Project entities)
- `auth-api.md` — authentication routes: register, login, current-user
- `projects-api.md` — project listing routes: all projects, current user's projects
```

- [x] **Step 4: Commit**

```bash
git add contracts/entities.md contracts/projects-api.md contracts/README.md
git commit -m "docs(contracts): add project entity and projects listing api"
```

---

### Task 2: signal-api — cursor-paginated SQL queries

**Files:**
- Create: `signal-api/db/queries/projects.sql`
- Create (generated): `signal-api/internal/db/projects.sql.go`

**Interfaces:**
- Consumes: `projects` table (`id, owner_id, name, slug, description, created_at, updated_at,
  deleted_at`) and `users` table (`id, name`) from existing migrations.
- Produces: `db.Queries.ListProjects(ctx, db.ListProjectsParams) ([]db.ListProjectsRow, error)` and
  `db.Queries.ListProjectsByOwner(ctx, db.ListProjectsByOwnerParams) ([]db.ListProjectsByOwnerRow, error)`.
  Both `Row` types have fields `ID, OwnerID, Name, Slug string`, `Description pgtype.Text`,
  `CreatedAt pgtype.Timestamptz`, `OwnerName string`. Both `Params` types have
  `HasCursor bool`, `CursorCreatedAt pgtype.Timestamptz`, `CursorID string`, `LimitCount int32`;
  `ListProjectsByOwnerParams` additionally has `OwnerID string`.

The cursor filter uses a `has_cursor` boolean flag instead of nullable params, so that on the first
page (no cursor) the caller passes `HasCursor: false` with any well-typed dummy values for the
other cursor fields — the `has_cursor = false` clause short-circuits to `true` and the dummy values
are never semantically used, avoiding sqlc's nullable-narg type ambiguity.

- [x] **Step 1: Write `signal-api/db/queries/projects.sql`**

```sql
-- name: ListProjects :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: ListProjectsByOwner :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND p.owner_id = sqlc.arg('owner_id')::uuid
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;
```

- [x] **Step 2: Generate sqlc code**

Run from `signal-api/`:

```bash
make sqlc-gen
```

Expected: creates `internal/db/projects.sql.go`. If the `sqlc` CLI is unavailable in this
environment, create the file by hand with the following exact content (sqlc's output for this
schema is deterministic):

```go
// Code generated by sqlc. DO NOT EDIT.
// versions:
//   sqlc v1.31.1
// source: projects.sql

package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"
)

const listProjects = `-- name: ListProjects :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND (
    $1::bool = false
    OR p.created_at < $2::timestamptz
    OR (p.created_at = $2::timestamptz AND p.id < $3::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT $4::int
`

type ListProjectsParams struct {
	HasCursor       bool
	CursorCreatedAt pgtype.Timestamptz
	CursorID        string
	LimitCount      int32
}

type ListProjectsRow struct {
	ID          string
	OwnerID     string
	Name        string
	Slug        string
	Description pgtype.Text
	CreatedAt   pgtype.Timestamptz
	OwnerName   string
}

func (q *Queries) ListProjects(ctx context.Context, arg ListProjectsParams) ([]ListProjectsRow, error) {
	rows, err := q.db.Query(ctx, listProjects,
		arg.HasCursor,
		arg.CursorCreatedAt,
		arg.CursorID,
		arg.LimitCount,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListProjectsRow
	for rows.Next() {
		var i ListProjectsRow
		if err := rows.Scan(
			&i.ID,
			&i.OwnerID,
			&i.Name,
			&i.Slug,
			&i.Description,
			&i.CreatedAt,
			&i.OwnerName,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

const listProjectsByOwner = `-- name: ListProjectsByOwner :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND p.owner_id = $1::uuid
  AND (
    $2::bool = false
    OR p.created_at < $3::timestamptz
    OR (p.created_at = $3::timestamptz AND p.id < $4::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT $5::int
`

type ListProjectsByOwnerParams struct {
	OwnerID         string
	HasCursor       bool
	CursorCreatedAt pgtype.Timestamptz
	CursorID        string
	LimitCount      int32
}

type ListProjectsByOwnerRow struct {
	ID          string
	OwnerID     string
	Name        string
	Slug        string
	Description pgtype.Text
	CreatedAt   pgtype.Timestamptz
	OwnerName   string
}

func (q *Queries) ListProjectsByOwner(ctx context.Context, arg ListProjectsByOwnerParams) ([]ListProjectsByOwnerRow, error) {
	rows, err := q.db.Query(ctx, listProjectsByOwner,
		arg.OwnerID,
		arg.HasCursor,
		arg.CursorCreatedAt,
		arg.CursorID,
		arg.LimitCount,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []ListProjectsByOwnerRow
	for rows.Next() {
		var i ListProjectsByOwnerRow
		if err := rows.Scan(
			&i.ID,
			&i.OwnerID,
			&i.Name,
			&i.Slug,
			&i.Description,
			&i.CreatedAt,
			&i.OwnerName,
		); err != nil {
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
```

- [x] **Step 3: Verify it compiles**

Run from `signal-api/`:

```bash
go build ./...
```

Expected: no errors.

- [x] **Step 4: Commit**

```bash
git add db/queries/projects.sql internal/db/projects.sql.go
git commit -m "feat(api): add cursor-paginated project listing queries"
```

---

### Task 3: signal-api — ProjectHandler (List + ListMine)

**Files:**
- Create: `signal-api/internal/handlers/projects.go`
- Create: `signal-api/internal/handlers/projects_test.go`

**Interfaces:**
- Consumes: `db.Queries.ListProjects` / `ListProjectsByOwner` and their `Params`/`Row` types from
  Task 2; `auth.UserID(c) (string, bool)` and `auth.Middleware(secret []byte) gin.HandlerFunc` and
  `auth.GenerateToken(secret []byte, userID, email string) (string, error)` from
  `signal-api/internal/auth` (existing).
- Produces: `ProjectHandler{ Queries *db.Queries }` with methods `List(c *gin.Context)` and
  `ListMine(c *gin.Context)`, consumed by Task 4's route wiring.

- [x] **Step 1: Write the failing tests in `signal-api/internal/handlers/projects_test.go`**

```go
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
```

- [x] **Step 2: Run tests to verify they fail to compile (ProjectHandler doesn't exist yet)**

Run from `signal-api/`:

```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestList -v
```

Expected: build failure referencing undefined `ProjectHandler`.

- [x] **Step 3: Write `signal-api/internal/handlers/projects.go`**

```go
package handlers

import (
	"encoding/base64"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type ProjectHandler struct {
	Queries *db.Queries
}

type projectResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description"`
	OwnerID     string  `json:"ownerId"`
	OwnerName   string  `json:"ownerName"`
	CreatedAt   string  `json:"createdAt"`
}

type projectsListResponse struct {
	Projects   []projectResponse `json:"projects"`
	NextCursor *string           `json:"nextCursor"`
}

const (
	defaultProjectsLimit = 10
	maxProjectsLimit     = 50
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type projectCursor struct {
	createdAt time.Time
	id        string
}

func parseProjectsLimit(c *gin.Context) (int, bool) {
	raw := c.Query("limit")
	if raw == "" {
		return defaultProjectsLimit, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxProjectsLimit {
		return 0, false
	}
	return limit, true
}

func parseProjectsCursor(c *gin.Context) (*projectCursor, bool) {
	raw := c.Query("cursor")
	if raw == "" {
		return nil, true
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, false
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 || !uuidPattern.MatchString(parts[1]) {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, false
	}
	return &projectCursor{createdAt: createdAt, id: parts[1]}, true
}

func encodeProjectsCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func newProjectResponse(id, ownerID, name, slug string, description pgtype.Text, createdAt pgtype.Timestamptz, ownerName string) projectResponse {
	var desc *string
	if description.Valid {
		d := description.String
		desc = &d
	}
	return projectResponse{
		ID:          id,
		Name:        name,
		Slug:        slug,
		Description: desc,
		OwnerID:     ownerID,
		OwnerName:   ownerName,
		CreatedAt:   createdAt.Time.UTC().Format(time.RFC3339),
	}
}

func cursorParams(cursor *projectCursor) (hasCursor bool, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, ""
	}
	return true, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}

func (h *ProjectHandler) List(c *gin.Context) {
	limit, ok := parseProjectsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseProjectsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
	rows, err := h.Queries.ListProjects(c.Request.Context(), db.ListProjectsParams{
		HasCursor:       hasCursor,
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

	projects := make([]projectResponse, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeProjectsCursor(last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, projectsListResponse{Projects: projects, NextCursor: nextCursor})
}

func (h *ProjectHandler) ListMine(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit, ok := parseProjectsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseProjectsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
	rows, err := h.Queries.ListProjectsByOwner(c.Request.Context(), db.ListProjectsByOwnerParams{
		OwnerID:         userID,
		HasCursor:       hasCursor,
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

	projects := make([]projectResponse, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeProjectsCursor(last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, projectsListResponse{Projects: projects, NextCursor: nextCursor})
}
```

- [x] **Step 4: Run tests to verify they pass**

Run from `signal-api/`:

```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run 'TestList|TestListMine' -v
```

Expected: `PASS` for all of `TestList_Empty`, `TestList_PaginatesAllProjects`,
`TestListMine_OnlyOwnProjects`, `TestList_InvalidLimit`, `TestList_InvalidCursor`,
`TestList_ExcludesSoftDeleted`.

- [x] **Step 5: Commit**

```bash
git add internal/handlers/projects.go internal/handlers/projects_test.go
git commit -m "feat(api): add project listing handlers with cursor pagination"
```

---

### Task 4: signal-api — wire `/projects` routes

**Files:**
- Modify: `signal-api/cmd/api/main.go`
- Modify: `signal-api/cmd/api/main_test.go`

**Interfaces:**
- Consumes: `handlers.ProjectHandler{ Queries *db.Queries }` from Task 3.
- Produces: `setupRouter(authHandler *handlers.AuthHandler, projectHandler *handlers.ProjectHandler, webOrigin string) *gin.Engine` — the new third parameter that `main_test.go` and `main()` must pass.

- [x] **Step 1: Update `setupRouter` and `main()` in `signal-api/cmd/api/main.go`**

Change the `setupRouter` signature and body:

```go
func setupRouter(authHandler *handlers.AuthHandler, projectHandler *handlers.ProjectHandler, webOrigin string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(webOrigin))

	if err := r.SetTrustedProxies(nil); err != nil {
		panic("failed to set trusted proxies: " + err.Error())
	}

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/auth/register", authHandler.Register)
	r.POST("/auth/login", authHandler.Login)

	protectedAuth := r.Group("/auth")
	protectedAuth.Use(auth.Middleware(authHandler.JWTSecret))
	protectedAuth.GET("/me", authHandler.Me)

	protectedProjects := r.Group("/projects")
	protectedProjects.Use(auth.Middleware(authHandler.JWTSecret))
	protectedProjects.GET("", projectHandler.List)
	protectedProjects.GET("/mine", projectHandler.ListMine)

	return r
}
```

(`protected` was renamed to `protectedAuth` to disambiguate it from `protectedProjects` — update
this in `main.go`.)

In `main()`, after `authHandler := &handlers.AuthHandler{...}`, add:

```go
	projectHandler := &handlers.ProjectHandler{
		Queries: db.New(pool),
	}
```

and change the `setupRouter` call to:

```go
	r := setupRouter(authHandler, projectHandler, cfg.WebOrigin)
```

- [x] **Step 2: Update the call site in `signal-api/cmd/api/main_test.go`**

Change:

```go
	r := setupRouter(authHandler, "http://localhost:5173")
```

to:

```go
	projectHandler := &handlers.ProjectHandler{Queries: db.New(nil)}
	r := setupRouter(authHandler, projectHandler, "http://localhost:5173")
```

- [x] **Step 3: Run tests to verify everything still builds and passes**

Run from `signal-api/`:

```bash
go build ./... && go test ./... -v
```

Expected: build succeeds; `TestHealthEndpoint` passes; DB-dependent tests skip if `DB_URL` is unset
or pass if it's set.

- [x] **Step 4: Commit**

```bash
git add cmd/api/main.go cmd/api/main_test.go
git commit -m "feat(api): wire projects listing routes behind auth middleware"
```

---

### Task 5: signal-web — dependencies, api.ts, and query client wiring

**Files:**
- Modify: `signal-web/package.json` (via `npm install`)
- Modify: `signal-web/src/lib/api.ts`
- Modify: `signal-web/src/lib/api.test.ts`
- Modify: `signal-web/src/main.tsx`

**Interfaces:**
- Produces: `Project` and `ProjectsPage` types, and `listProjects(params?) => Promise<ProjectsPage>`,
  `listMyProjects(params?) => Promise<ProjectsPage>` in `@/lib/api`, where
  `params: { cursor?: string; limit?: number }`. Consumed by Task 7's `ProjectList`.
- Produces: a module-level `QueryClient` wired via `QueryClientProvider` in `main.tsx`, required by
  any component using `useInfiniteQuery` (Task 7).

- [x] **Step 1: Install dependencies**

Run from `signal-web/`:

```bash
npm install @tanstack/react-query @radix-ui/react-tabs
```

Expected: both packages added to `dependencies` in `package.json`.

- [x] **Step 2: Write the failing tests — add to `signal-web/src/lib/api.test.ts`**

Add `listProjects, listMyProjects` to the existing import line at the top of the file:

```ts
import { ApiError, clearToken, getMe, getToken, listMyProjects, listProjects, login, register, setToken } from "./api"
```

Append these `describe` blocks at the end of the file:

```ts
describe("listProjects", () => {
  it("requests /projects with no query string by default", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects()

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects")
    expect(url).not.toContain("?")
  })

  it("includes cursor and limit when provided", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listProjects({ cursor: "abc", limit: 5 })

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("cursor=abc")
    expect(url).toContain("limit=5")
  })

  it("returns the parsed projects page", async () => {
    const page = { projects: [{ id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }], nextCursor: "next" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, page))

    const result = await listProjects()

    expect(result).toEqual(page)
  })
})

describe("listMyProjects", () => {
  it("requests /projects/mine", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { projects: [], nextCursor: null }))

    await listMyProjects()

    const [url] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/mine")
  })
})
```

- [x] **Step 3: Run tests to verify they fail**

Run from `signal-web/`:

```bash
npx vitest run src/lib/api.test.ts
```

Expected: `FAIL` — `listProjects`/`listMyProjects` are not exported from `./api`.

- [x] **Step 4: Add the implementation to `signal-web/src/lib/api.ts`**

Append to the end of the file:

```ts
export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  ownerId: string
  ownerName: string
  createdAt: string
}

export interface ProjectsPage {
  projects: Project[]
  nextCursor: string | null
}

interface ProjectsPageParams {
  cursor?: string
  limit?: number
}

function projectsQueryString(params: ProjectsPageParams): string {
  const search = new URLSearchParams()
  if (params.cursor) search.set("cursor", params.cursor)
  if (params.limit !== undefined) search.set("limit", String(params.limit))
  const query = search.toString()
  return query ? `?${query}` : ""
}

export function listProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects${projectsQueryString(params)}`)
}

export function listMyProjects(params: ProjectsPageParams = {}): Promise<ProjectsPage> {
  return request<ProjectsPage>(`/projects/mine${projectsQueryString(params)}`)
}
```

- [x] **Step 5: Run tests to verify they pass**

Run from `signal-web/`:

```bash
npx vitest run src/lib/api.test.ts
```

Expected: `PASS` for all tests in the file.

- [x] **Step 6: Wire `QueryClientProvider` in `signal-web/src/main.tsx`**

Replace the file with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'

import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/context/AuthContext'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

- [x] **Step 7: Run the full web test suite and the build to verify nothing broke**

Run from `signal-web/`:

```bash
npx vitest run && npm run build
```

Expected: all tests pass; build succeeds.

- [x] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/api.ts src/lib/api.test.ts src/main.tsx
git commit -m "feat(web): add projects api client and wire react-query provider"
```

---

### Task 6: signal-web — Tabs UI primitive

**Files:**
- Create: `signal-web/src/components/ui/tabs.tsx`
- Create: `signal-web/src/components/ui/tabs.test.tsx`

**Interfaces:**
- Produces: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` React components (thin styled wrappers
  over `@radix-ui/react-tabs`), consumed by Task 8's `MainPage`.

- [x] **Step 1: Write the failing test in `signal-web/src/components/ui/tabs.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

function renderTabs() {
  return render(
    <Tabs defaultValue="a">
      <TabsList>
        <TabsTrigger value="a">Tab A</TabsTrigger>
        <TabsTrigger value="b">Tab B</TabsTrigger>
      </TabsList>
      <TabsContent value="a">Content A</TabsContent>
      <TabsContent value="b">Content B</TabsContent>
    </Tabs>
  )
}

describe("Tabs", () => {
  it("shows the default tab's content", () => {
    renderTabs()
    expect(screen.getByText("Content A")).toBeInTheDocument()
    expect(screen.queryByText("Content B")).not.toBeInTheDocument()
  })

  it("switches content when a different tab is clicked", async () => {
    renderTabs()
    await userEvent.click(screen.getByText("Tab B"))
    expect(screen.getByText("Content B")).toBeInTheDocument()
    expect(screen.queryByText("Content A")).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run from `signal-web/`:

```bash
npx vitest run src/components/ui/tabs.test.tsx
```

Expected: `FAIL` — cannot resolve `./tabs`.

- [x] **Step 3: Write `signal-web/src/components/ui/tabs.tsx`**

```tsx
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

- [x] **Step 4: Run the test to verify it passes**

Run from `signal-web/`:

```bash
npx vitest run src/components/ui/tabs.test.tsx
```

Expected: `PASS` for both tests.

- [x] **Step 5: Type-check**

Run from `signal-web/` (vitest transpiles but does not type-check, so this catches type errors the
test run wouldn't):

```bash
npx tsc -b --noEmit
```

Expected: no errors.

- [x] **Step 6: Commit**

```bash
git add src/components/ui/tabs.tsx src/components/ui/tabs.test.tsx
git commit -m "feat(web): add tabs ui primitive"
```

---

### Task 7: signal-web — ProjectCard and infinite-scroll ProjectList

**Files:**
- Create: `signal-web/src/components/projects/ProjectCard.tsx`
- Create: `signal-web/src/components/projects/ProjectList.tsx`
- Create: `signal-web/src/components/projects/ProjectList.test.tsx`

**Interfaces:**
- Consumes: `Project`, `ProjectsPage`, `listProjects`, `listMyProjects` from `@/lib/api` (Task 5).
- Produces: `ProjectList({ scope: "all" | "mine" })`, consumed by Task 8's `MainPage`.

- [x] **Step 1: Write `signal-web/src/components/projects/ProjectCard.tsx`**

(Presentational only — no test required beyond what `ProjectList.test.tsx` exercises through
rendering, consistent with how `Logo` and other presentational components in this codebase have no
dedicated test file.)

```tsx
import type { Project } from "@/lib/api"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const createdAt = new Date(project.createdAt).toLocaleDateString()

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
    </div>
  )
}
```

- [x] **Step 2: Write the failing tests in `signal-web/src/components/projects/ProjectList.test.tsx`**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import { ProjectList } from "./ProjectList"

let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | null = null

class MockIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    intersectionCallback = callback
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  intersectionCallback = null
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

function project(id: string) {
  return {
    id,
    name: `Project ${id}`,
    slug: `project-${id}`,
    description: null,
    ownerId: "owner-1",
    ownerName: "Ada Lovelace",
    createdAt: "2026-06-21T00:00:00Z",
  }
}

describe("ProjectList", () => {
  it("renders the first page for scope=all using listProjects", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [project("1")], nextCursor: null })
    const listMyProjectsSpy = vi.spyOn(api, "listMyProjects")

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("Project 1")).toBeInTheDocument()
    expect(listMyProjectsSpy).not.toHaveBeenCalled()
  })

  it("renders using listMyProjects for scope=mine", async () => {
    vi.spyOn(api, "listMyProjects").mockResolvedValue({ projects: [project("2")], nextCursor: null })

    renderWithClient(<ProjectList scope="mine" />)

    expect(await screen.findByText("Project 2")).toBeInTheDocument()
  })

  it("shows an empty state when there are no projects", async () => {
    vi.spyOn(api, "listProjects").mockResolvedValue({ projects: [], nextCursor: null })

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("No projects yet.")).toBeInTheDocument()
  })

  it("fetches the next page when the sentinel intersects", async () => {
    const spy = vi.spyOn(api, "listProjects")
    spy.mockResolvedValueOnce({ projects: [project("1")], nextCursor: "cursor-1" })
    spy.mockResolvedValueOnce({ projects: [project("2")], nextCursor: null })

    renderWithClient(<ProjectList scope="all" />)

    expect(await screen.findByText("Project 1")).toBeInTheDocument()

    intersectionCallback?.([{ isIntersecting: true }])

    expect(await screen.findByText("Project 2")).toBeInTheDocument()
    expect(spy).toHaveBeenLastCalledWith({ cursor: "cursor-1" })
  })
})
```

- [x] **Step 3: Run tests to verify they fail**

Run from `signal-web/`:

```bash
npx vitest run src/components/projects/ProjectList.test.tsx
```

Expected: `FAIL` — cannot resolve `./ProjectList`.

- [x] **Step 4: Write `signal-web/src/components/projects/ProjectList.tsx`**

```tsx
import { useInfiniteQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { listMyProjects, listProjects } from "@/lib/api"
import { ProjectCard } from "@/components/projects/ProjectCard"

interface ProjectListProps {
  scope: "all" | "mine"
}

export function ProjectList({ scope }: ProjectListProps) {
  const fetchPage = scope === "mine" ? listMyProjects : listProjects

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ["projects", scope],
    queryFn: ({ pageParam }) => fetchPage({ cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading projects...</p>
  }

  const projects = data?.pages.flatMap((page) => page.projects) ?? []

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No projects yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {projects.map((proj) => (
        <ProjectCard key={proj.id} project={proj} />
      ))}
      <div ref={sentinelRef} />
      {isFetchingNextPage && <p className="text-sm text-muted-foreground">Loading more...</p>}
    </div>
  )
}
```

- [x] **Step 5: Run tests to verify they pass**

Run from `signal-web/`:

```bash
npx vitest run src/components/projects/ProjectList.test.tsx
```

Expected: `PASS` for all four tests.

- [x] **Step 6: Type-check**

Run from `signal-web/` (vitest transpiles but does not type-check, so this catches type errors the
test run wouldn't, e.g. in the `useInfiniteQuery` generics):

```bash
npx tsc -b --noEmit
```

Expected: no errors.

- [x] **Step 7: Commit**

```bash
git add src/components/projects/ProjectCard.tsx src/components/projects/ProjectList.tsx src/components/projects/ProjectList.test.tsx
git commit -m "feat(web): add infinite-scroll project list"
```

---

### Task 8: signal-web — wire tabs + ProjectList into MainPage

**Files:**
- Modify: `signal-web/src/pages/MainPage.tsx`
- Create: `signal-web/src/pages/MainPage.test.tsx`

**Interfaces:**
- Consumes: `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs` (Task 6);
  `ProjectList` from `@/components/projects/ProjectList` (Task 7).

- [x] **Step 1: Write the failing tests in `signal-web/src/pages/MainPage.test.tsx`**

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import MainPage from "./MainPage"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

vi.mock("@/components/projects/ProjectList", () => ({
  ProjectList: ({ scope }: { scope: string }) => <div>ProjectList:{scope}</div>,
}))

function mockAuthenticated() {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id: "1", name: "Ada Lovelace", email: "ada@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

describe("MainPage", () => {
  it("defaults to the All projects tab", () => {
    mockAuthenticated()

    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    expect(screen.getByText("ProjectList:all")).toBeInTheDocument()
    expect(screen.queryByText("ProjectList:mine")).not.toBeInTheDocument()
  })

  it("switches to My projects when that tab is clicked", async () => {
    mockAuthenticated()

    render(
      <MemoryRouter>
        <MainPage />
      </MemoryRouter>
    )

    await userEvent.click(screen.getByText("My projects"))
    expect(screen.getByText("ProjectList:mine")).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run tests to verify they fail**

Run from `signal-web/`:

```bash
npx vitest run src/pages/MainPage.test.tsx
```

Expected: `FAIL` — no "All projects"/"My projects" tabs exist yet on the current placeholder page.

- [x] **Step 3: Update `signal-web/src/pages/MainPage.tsx`**

```tsx
import { useNavigate } from "react-router-dom"

import { Logo } from "@/components/brand/logo"
import { ProjectList } from "@/components/projects/ProjectList"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/context/AuthContext"

export default function MainPage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate("/login")
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-background px-6 py-4">
        <Logo />
        {user && (
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {user.name} ({user.email})
            </span>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        )}
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">All projects</TabsTrigger>
            <TabsTrigger value="mine">My projects</TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <ProjectList scope="all" />
          </TabsContent>
          <TabsContent value="mine">
            <ProjectList scope="mine" />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
```

- [x] **Step 4: Run tests to verify they pass**

Run from `signal-web/`:

```bash
npx vitest run src/pages/MainPage.test.tsx
```

Expected: `PASS` for both tests.

- [x] **Step 5: Run the full web test suite and build**

Run from `signal-web/`:

```bash
npx vitest run && npm run build
```

Expected: all tests pass; build succeeds.

- [x] **Step 6: Commit**

```bash
git add src/pages/MainPage.tsx src/pages/MainPage.test.tsx
git commit -m "feat(web): show tabbed projects listing on main page"
```

---

## Execution Notes

- Task 1 (contracts) blocks every other task and should run first.
- After Task 1, **Tasks 2 → 3 → 4** (signal-api) and **Tasks 5 → 6/7 → 8** (signal-web) are two
  independent tracks suitable for parallel dispatch — neither track's implementation depends on the
  other's, only on the Task 1 contract files. Within the web track, Task 6 (tabs) and Task 7
  (ProjectList) are independent of each other and can run in parallel too; Task 8 depends on both.