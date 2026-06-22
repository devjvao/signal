# Project CRUD (Create, Update, Delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create/update/delete for projects across signal-api (owner-restricted update/delete) and signal-web (create/edit form page, delete confirmation modal, redirect to the refreshed projects list).

**Architecture:** signal-api gets three new handler methods (`Create`, `Update`, `Delete`) on the existing `ProjectHandler`, backed by four new sqlc queries, wired into the existing `/projects` route group. signal-web gets a shared `ProjectFormPage` for create/edit, a Radix-based `Dialog` primitive for delete confirmation, and owner-only action buttons on `ProjectCard`. Both sides reuse existing patterns (gin handlers + sqlc, react-query + the `lib/api.ts` client) rather than introducing new ones.

**Tech Stack:** Go + gin + sqlc + pgx (signal-api); React + TypeScript + react-router-dom + @tanstack/react-query + Radix UI (signal-web).

## Global Constraints

- Project `name` is required, max 200 characters. `description` is optional, max 2000 characters.
- Update and delete are restricted to the project's owner: non-owners get `403`, missing/deleted projects get `404`.
- Slugs are server-generated from `name` (lowercase, non-alphanumeric runs collapsed to `-`, trimmed); on a uniqueness collision, retry with a random 6-hex-char suffix, up to 5 attempts total.
- No `GET /projects/:id` endpoint is added. The edit page gets its data from React Router navigation state, not a fetch.
- `corsMiddleware` must allow `PUT` and `DELETE` for the new endpoints to work from the browser.
- Local Postgres for integration tests: `DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable` (start via `docker compose up -d` from the repo root; integration tests `t.Skip()` if `DB_URL` is unset).
- Commit messages follow `CONVENTIONAL_COMMIT_GUIDELINE.md` (e.g. `feat(api): ...`, `feat(web): ...`).

---

## Task 1: sqlc queries for project mutations

**Files:**
- Modify: `signal-api/db/queries/projects.sql`
- Generated (do not hand-edit, produced by `sqlc generate`): `signal-api/internal/db/projects.sql.go`

**Interfaces:**
- Consumes: existing `projects` table schema (`signal-api/db/migrations/000003_create_projects_table.up.sql`), existing `sqlc.yaml` (`uuid` → `string` override).
- Produces (for later tasks):
  - `db.Queries.CreateProject(ctx, db.CreateProjectParams{OwnerID, Name, Slug, Description}) (db.CreateProjectRow, error)` where `CreateProjectRow` has `ID, OwnerID, Name, Slug string; Description pgtype.Text; CreatedAt pgtype.Timestamptz`.
  - `db.Queries.GetProjectByID(ctx, id string) (db.GetProjectByIDRow, error)` where `GetProjectByIDRow` has `ID, OwnerID, Name, Slug, OwnerName string; Description pgtype.Text; CreatedAt pgtype.Timestamptz`. Returns `pgx.ErrNoRows` when the project doesn't exist or is soft-deleted.
  - `db.Queries.UpdateProject(ctx, db.UpdateProjectParams{ID, Name string; Description pgtype.Text}) (db.UpdateProjectRow, error)` where `UpdateProjectRow` has the same shape as `CreateProjectRow`.
  - `db.Queries.SoftDeleteProject(ctx, id string) error`.

This task has no business logic of its own, so there's no failing-test step — it's verified by a successful build.

- [ ] **Step 1: Append the new queries**

Add to the end of `signal-api/db/queries/projects.sql`:

```sql
-- name: CreateProject :one
INSERT INTO projects (owner_id, name, slug, description)
VALUES (sqlc.arg('owner_id'), sqlc.arg('name'), sqlc.arg('slug'), sqlc.arg('description'))
RETURNING id, owner_id, name, slug, description, created_at;

-- name: GetProjectByID :one
SELECT p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.id = sqlc.arg('id')::uuid AND p.deleted_at IS NULL;

-- name: UpdateProject :one
UPDATE projects
SET name = sqlc.arg('name'), description = sqlc.arg('description')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, owner_id, name, slug, description, created_at;

-- name: SoftDeleteProject :exec
UPDATE projects
SET deleted_at = now()
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL;
```

- [ ] **Step 2: Generate the Go code**

Run (from `signal-api/`):
```bash
sqlc generate
```
Expected: command exits 0; `internal/db/projects.sql.go` now contains `CreateProject`, `GetProjectByID`, `UpdateProject`, `SoftDeleteProject` plus their `Params`/`Row` types, alongside the existing `ListProjects`/`ListProjectsByOwner`.

- [ ] **Step 3: Verify it builds**

Run (from `signal-api/`):
```bash
go build ./...
```
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add signal-api/db/queries/projects.sql signal-api/internal/db/projects.sql.go
git commit -m "feat(api): add sqlc queries for project create, update, and delete"
```

---

## Task 2: `POST /projects` — create

**Files:**
- Modify: `signal-api/internal/handlers/projects.go`
- Modify: `signal-api/cmd/api/main.go`
- Test: `signal-api/internal/handlers/projects_test.go`

**Interfaces:**
- Consumes: `db.CreateProject`/`CreateProjectParams`/`CreateProjectRow` (Task 1), existing `h.Queries.GetUserByID(ctx, id) (db.GetUserByIDRow, error)` (`GetUserByIDRow.Name`), existing `auth.UserID(c) (string, bool)`, existing `newProjectResponse(id, ownerID, name, slug string, description pgtype.Text, createdAt pgtype.Timestamptz, ownerName string) projectResponse`.
- Produces: `ProjectHandler.Create(c *gin.Context)`; route `POST /projects`.

- [ ] **Step 1: Write the failing tests**

Add `"strings"` to the import block of `signal-api/internal/handlers/projects_test.go` (alongside the existing `"fmt"`, `"net/url"`, etc.), then append:

```go
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-api/`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestCreate -v
```
Expected: compile error — `h.Create` (and `protected.POST`) undefined, since `Create` doesn't exist yet.

- [ ] **Step 3: Implement the handler**

In `signal-api/internal/handlers/projects.go`, add to the import block:

```go
import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)
```

Then append to the end of the file:

```go
type createProjectRequest struct {
	Name        string  `json:"name" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

var slugInvalidPattern = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	slug := slugInvalidPattern.ReplaceAllString(strings.ToLower(name), "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return "project"
	}
	return slug
}

func randomSlugSuffix() (string, error) {
	buf := make([]byte, 3)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

const maxSlugAttempts = 5

func descriptionToText(description *string) pgtype.Text {
	if description == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *description, Valid: true}
}

func (h *ProjectHandler) Create(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req createProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	description := descriptionToText(req.Description)
	baseSlug := slugify(req.Name)
	slug := baseSlug

	var row db.CreateProjectRow
	for attempt := 0; ; attempt++ {
		var err error
		row, err = h.Queries.CreateProject(c.Request.Context(), db.CreateProjectParams{
			OwnerID:     userID,
			Name:        req.Name,
			Slug:        slug,
			Description: description,
		})
		if err == nil {
			break
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && attempt < maxSlugAttempts-1 {
			suffix, suffixErr := randomSlugSuffix()
			if suffixErr != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
				return
			}
			slug = baseSlug + "-" + suffix
			continue
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	owner, err := h.Queries.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"project": newProjectResponse(
		row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, owner.Name,
	)})
}
```

- [ ] **Step 4: Wire the route**

In `signal-api/cmd/api/main.go`, after the existing `protectedProjects.GET("/mine", projectHandler.ListMine)` line, add:

```go
	protectedProjects.POST("", projectHandler.Create)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `signal-api/`, with `docker compose up -d` already running at the repo root and migrations applied via `make migrate-up`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestCreate -v
```
Expected: `PASS` for `TestCreate_Success`, `TestCreate_SlugCollision`, `TestCreate_MissingName`, `TestCreate_Unauthorized`.

- [ ] **Step 6: Commit**

```bash
git add signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go signal-api/cmd/api/main.go
git commit -m "feat(api): add POST /projects to create a project"
```

---

## Task 3: `PUT /projects/:id` — update (owner-only)

**Files:**
- Modify: `signal-api/internal/handlers/projects.go`
- Modify: `signal-api/cmd/api/main.go`
- Test: `signal-api/internal/handlers/projects_test.go`

**Interfaces:**
- Consumes: `db.GetProjectByID`/`GetProjectByIDRow` and `db.UpdateProject`/`UpdateProjectParams`/`UpdateProjectRow` (Task 1), existing `uuidPattern *regexp.Regexp`, `descriptionToText` (Task 2), `newProjectResponse` (existing).
- Produces: `ProjectHandler.Update(c *gin.Context)`; route `PUT /projects/:id`.

- [ ] **Step 1: Write the failing tests**

Append to `signal-api/internal/handlers/projects_test.go`:

```go
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-api/`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestUpdate -v
```
Expected: compile error — `h.Update` (and `protected.PUT`) undefined.

- [ ] **Step 3: Implement the handler**

Add `"github.com/jackc/pgx/v5"` to the import block of `signal-api/internal/handlers/projects.go` (for `pgx.ErrNoRows`), then append to the end of the file:

```go
type updateProjectRequest struct {
	Name        string  `json:"name" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

func (h *ProjectHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}

	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var req updateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := h.Queries.GetProjectByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if existing.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	row, err := h.Queries.UpdateProject(c.Request.Context(), db.UpdateProjectParams{
		ID:          id,
		Name:        req.Name,
		Description: descriptionToText(req.Description),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"project": newProjectResponse(
		row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, existing.OwnerName,
	)})
}
```

- [ ] **Step 4: Wire the route**

In `signal-api/cmd/api/main.go`, after the `protectedProjects.POST("", projectHandler.Create)` line, add:

```go
	protectedProjects.PUT("/:id", projectHandler.Update)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `signal-api/`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestUpdate -v
```
Expected: `PASS` for `TestUpdate_Success`, `TestUpdate_ForbiddenForNonOwner`, `TestUpdate_NotFound`, `TestUpdate_InvalidID`.

- [ ] **Step 6: Commit**

```bash
git add signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go signal-api/cmd/api/main.go
git commit -m "feat(api): add PUT /projects/:id to update a project, owner-only"
```

---

## Task 4: `DELETE /projects/:id` — delete (owner-only) + CORS

**Files:**
- Modify: `signal-api/internal/handlers/projects.go`
- Modify: `signal-api/cmd/api/main.go`
- Test: `signal-api/internal/handlers/projects_test.go`

**Interfaces:**
- Consumes: `db.SoftDeleteProject` (Task 1), `db.GetProjectByID` (Task 1, reused), existing `uuidPattern`.
- Produces: `ProjectHandler.Delete(c *gin.Context)`; route `DELETE /projects/:id`.

- [ ] **Step 1: Write the failing tests**

Append to `signal-api/internal/handlers/projects_test.go`:

```go
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-api/`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./internal/handlers/... -run TestDelete -v
```
Expected: compile error — `h.Delete` (and `protected.DELETE`) undefined.

- [ ] **Step 3: Implement the handler**

Append to the end of `signal-api/internal/handlers/projects.go`:

```go
func (h *ProjectHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}

	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	existing, err := h.Queries.GetProjectByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if existing.OwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if err := h.Queries.SoftDeleteProject(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.Status(http.StatusNoContent)
}
```

- [ ] **Step 4: Wire the route and update CORS**

In `signal-api/cmd/api/main.go`:

1. After the `protectedProjects.PUT("/:id", projectHandler.Update)` line, add:
   ```go
   	protectedProjects.DELETE("/:id", projectHandler.Delete)
   ```
2. In `corsMiddleware`, change:
   ```go
   		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
   ```
   to:
   ```go
   		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
   ```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `signal-api/`):
```bash
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable go test ./... -v
```
Expected: all tests `PASS`, including the full `TestDelete_*` set and every pre-existing test (no regressions).

- [ ] **Step 6: Commit**

```bash
git add signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go signal-api/cmd/api/main.go
git commit -m "feat(api): add DELETE /projects/:id to delete a project, owner-only"
```

---

## Task 5: signal-web API client for create/update/delete

**Files:**
- Modify: `signal-web/src/lib/api.ts`
- Test: `signal-web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: existing `request<T>`, `Project` interface, `ApiError` (all in `lib/api.ts`).
- Produces: `ProjectInput { name: string; description?: string }`, `createProject(input: ProjectInput): Promise<{ project: Project }>`, `updateProject(id: string, input: ProjectInput): Promise<{ project: Project }>`, `deleteProject(id: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `signal-web/src/lib/api.test.ts` (extend the existing import line at the top to also bring in `createProject`, `updateProject`, `deleteProject`):

```ts
describe("createProject", () => {
  it("posts to /projects and returns the created project", async () => {
    const project = { id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(201, { project }))

    const result = await createProject({ name: "Signal", description: "A product" })

    expect(result.project).toEqual(project)
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects")
    expect(options?.method).toBe("POST")
    expect(JSON.parse(options?.body as string)).toEqual({ name: "Signal", description: "A product" })
  })
})

describe("updateProject", () => {
  it("puts to /projects/:id and returns the updated project", async () => {
    const project = { id: "1", name: "Signal v2", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(200, { project }))

    const result = await updateProject("1", { name: "Signal v2" })

    expect(result.project).toEqual(project)
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/1")
    expect(options?.method).toBe("PUT")
    expect(JSON.parse(options?.body as string)).toEqual({ name: "Signal v2" })
  })
})

describe("deleteProject", () => {
  it("sends a DELETE request to /projects/:id", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse(204, undefined))

    await deleteProject("1")

    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toContain("/projects/1")
    expect(options?.method).toBe("DELETE")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-web/`):
```bash
npx vitest run src/lib/api.test.ts
```
Expected: FAIL — `createProject`/`updateProject`/`deleteProject` are not exported from `./api`.

- [ ] **Step 3: Implement the client functions**

Append to the end of `signal-web/src/lib/api.ts`:

```ts
export interface ProjectInput {
  name: string
  description?: string
}

export function createProject(input: ProjectInput): Promise<{ project: Project }> {
  return request<{ project: Project }>("/projects", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export function updateProject(id: string, input: ProjectInput): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${id}`, { method: "DELETE" })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `signal-web/`):
```bash
npx vitest run src/lib/api.test.ts
```
Expected: all tests in the file `PASS`.

- [ ] **Step 5: Commit**

```bash
git add signal-web/src/lib/api.ts signal-web/src/lib/api.test.ts
git commit -m "feat(web): add create, update, and delete project API client functions"
```

---

## Task 6: `Textarea` and `Dialog` UI primitives

**Files:**
- Modify: `signal-web/package.json` (new dependency)
- Create: `signal-web/src/components/ui/textarea.tsx`
- Create: `signal-web/src/components/ui/textarea.test.tsx`
- Create: `signal-web/src/components/ui/dialog.tsx`
- Create: `signal-web/src/components/ui/dialog.test.tsx`

**Interfaces:**
- Consumes: existing `cn` (`@/lib/utils`).
- Produces: `Textarea` (forwardRef textarea, same prop surface as `Input`); `Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay, DialogContent, DialogTitle, DialogDescription` (thin wrappers around `@radix-ui/react-dialog`).

- [ ] **Step 1: Add the Radix Dialog dependency**

Run (from `signal-web/`):
```bash
npm install @radix-ui/react-dialog
```
Expected: `package.json` and `package-lock.json` gain `@radix-ui/react-dialog`.

- [ ] **Step 2: Write the failing tests**

Create `signal-web/src/components/ui/textarea.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Textarea } from "./textarea"

describe("Textarea", () => {
  it("renders a textarea and forwards props", () => {
    render(<Textarea aria-label="description" placeholder="Description" />)
    const textarea = screen.getByLabelText("description")
    expect(textarea.tagName).toBe("TEXTAREA")
    expect(textarea).toHaveAttribute("placeholder", "Description")
  })
})
```

Create `signal-web/src/components/ui/dialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./dialog"

describe("Dialog", () => {
  it("opens content when the trigger is clicked", async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm</DialogTitle>
        </DialogContent>
      </Dialog>
    )

    expect(screen.queryByText("Confirm")).not.toBeInTheDocument()

    await userEvent.click(screen.getByText("Open"))

    expect(screen.getByText("Confirm")).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `signal-web/`):
```bash
npx vitest run src/components/ui/textarea.test.tsx src/components/ui/dialog.test.tsx
```
Expected: FAIL — `./textarea` and `./dialog` don't exist yet.

- [ ] **Step 4: Implement `Textarea`**

Create `signal-web/src/components/ui/textarea.tsx`:

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
```

- [ ] **Step 5: Implement `Dialog`**

Create `signal-web/src/components/ui/dialog.tsx`:

```tsx
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("fixed inset-0 z-50 bg-background/80", className)}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-background p-6 shadow-lg",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("font-display text-lg font-semibold", className)}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `signal-web/`):
```bash
npx vitest run src/components/ui/textarea.test.tsx src/components/ui/dialog.test.tsx
```
Expected: both files' tests `PASS`.

- [ ] **Step 7: Commit**

```bash
git add signal-web/package.json signal-web/package-lock.json signal-web/src/components/ui/textarea.tsx signal-web/src/components/ui/textarea.test.tsx signal-web/src/components/ui/dialog.tsx signal-web/src/components/ui/dialog.test.tsx
git commit -m "feat(web): add Textarea and Dialog UI primitives"
```

---

## Task 7: `ProjectFormPage` (create + edit) and routing

**Files:**
- Create: `signal-web/src/pages/ProjectFormPage.tsx`
- Create: `signal-web/src/pages/ProjectFormPage.test.tsx`
- Modify: `signal-web/src/App.tsx`

**Interfaces:**
- Consumes: `createProject`, `updateProject`, `ApiError`, `ProjectInput`, `Project` (Task 5, `lib/api.ts`); `Input`, `Label`, `Textarea` (Task 6), `Button` (existing); `ProtectedRoute` (existing).
- Produces: default-exported `ProjectFormPage` component; routes `/projects/new` and `/projects/:id/edit` registered in `App.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `signal-web/src/pages/ProjectFormPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { describe, expect, it, vi } from "vitest"

import * as api from "@/lib/api"
import ProjectFormPage from "./ProjectFormPage"

function renderAt(initialEntries: Array<string | { pathname: string; state?: unknown }>) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/" element={<div>projects list</div>} />
          <Route path="/projects/new" element={<ProjectFormPage />} />
          <Route path="/projects/:id/edit" element={<ProjectFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe("ProjectFormPage", () => {
  it("creates a project and redirects to the projects list", async () => {
    vi.spyOn(api, "createProject").mockResolvedValue({
      project: { id: "1", name: "Signal", slug: "signal", description: null, ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" },
    })

    renderAt(["/projects/new"])

    expect(screen.getByText("New project")).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText("Name"), "Signal")
    await userEvent.click(screen.getByText("Save"))

    expect(api.createProject).toHaveBeenCalledWith({ name: "Signal", description: undefined })
    expect(await screen.findByText("projects list")).toBeInTheDocument()
  })

  it("prefills from navigation state and updates an existing project", async () => {
    vi.spyOn(api, "updateProject").mockResolvedValue({
      project: { id: "1", name: "Signal v2", slug: "signal", description: "old", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" },
    })
    const project = { id: "1", name: "Signal", slug: "signal", description: "old", ownerId: "o1", ownerName: "Ada", createdAt: "2026-06-21T00:00:00Z" }

    renderAt([{ pathname: "/projects/1/edit", state: { project } }])

    expect(screen.getByText("Edit project")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Signal")).toBeInTheDocument()
    expect(screen.getByDisplayValue("old")).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText("Name"))
    await userEvent.type(screen.getByLabelText("Name"), "Signal v2")
    await userEvent.click(screen.getByText("Save"))

    expect(api.updateProject).toHaveBeenCalledWith("1", { name: "Signal v2", description: "old" })
    expect(await screen.findByText("projects list")).toBeInTheDocument()
  })

  it("redirects to / when edit state is missing", () => {
    renderAt(["/projects/1/edit"])
    expect(screen.getByText("projects list")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-web/`):
```bash
npx vitest run src/pages/ProjectFormPage.test.tsx
```
Expected: FAIL — `./ProjectFormPage` doesn't exist.

- [ ] **Step 3: Implement `ProjectFormPage`**

Create `signal-web/src/pages/ProjectFormPage.tsx`:

```tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError, createProject, updateProject } from "@/lib/api"
import type { Project } from "@/lib/api"

export default function ProjectFormPage() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const isEditMode = Boolean(id)
  const editingProject = (location.state as { project?: Project } | null)?.project ?? null

  const [name, setName] = useState(editingProject?.name ?? "")
  const [description, setDescription] = useState(editingProject?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isEditMode && !editingProject) {
    return <Navigate to="/" replace />
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const input = { name, description: description || undefined }
      if (isEditMode && id) {
        await updateProject(id, input)
      } else {
        await createProject(input)
      }
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      navigate("/")
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4">
      <h1 className="font-display text-3xl font-extrabold tracking-tight">
        {isEditMode ? "Edit project" : "New project"}
      </h1>
      <form className="flex w-full max-w-sm flex-col gap-4" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save"}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 4: Register the routes**

In `signal-web/src/App.tsx`, add the import:

```tsx
import ProjectFormPage from "@/pages/ProjectFormPage"
```

And add these two routes inside `<Routes>` (after the `"/"` route):

```tsx
      <Route
        path="/projects/new"
        element={
          <ProtectedRoute>
            <ProjectFormPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/projects/:id/edit"
        element={
          <ProtectedRoute>
            <ProjectFormPage />
          </ProtectedRoute>
        }
      />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `signal-web/`):
```bash
npx vitest run src/pages/ProjectFormPage.test.tsx
```
Expected: all 3 tests `PASS`.

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/pages/ProjectFormPage.tsx signal-web/src/pages/ProjectFormPage.test.tsx signal-web/src/App.tsx
git commit -m "feat(web): add create/edit project form page and routes"
```

---

## Task 8: Owner-only actions on `ProjectCard` + delete confirmation modal

**Files:**
- Create: `signal-web/src/components/projects/DeleteProjectDialog.tsx`
- Create: `signal-web/src/components/projects/ProjectCard.test.tsx`
- Modify: `signal-web/src/components/projects/ProjectCard.tsx`
- Modify: `signal-web/src/components/projects/ProjectList.test.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogTrigger`/`DialogContent`/`DialogTitle`/`DialogDescription` (Task 6), `deleteProject` (Task 5), `Button` (existing), `useAuth` (existing `AuthContext`), `Project` (existing).
- Produces: `DeleteProjectDialog({ project, trigger }: { project: Project; trigger: ReactNode })`; `ProjectCard` now renders "Edit"/"Delete" when `project.ownerId === user?.id`.

- [ ] **Step 1: Write the failing tests**

Create `signal-web/src/components/projects/ProjectCard.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import type { Project } from "@/lib/api"
import { ProjectCard } from "./ProjectCard"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

const project: Project = {
  id: "p1",
  name: "Signal",
  slug: "signal",
  description: "A product",
  ownerId: "owner-1",
  ownerName: "Ada Lovelace",
  createdAt: "2026-06-21T00:00:00Z",
}

function mockUser(id: string) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id, name: "User", email: "user@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
}

function renderCard() {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProjectCard project={project} />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ProjectCard", () => {
  it("hides Edit/Delete for a non-owner", () => {
    mockUser("someone-else")
    renderCard()
    expect(screen.queryByText("Edit")).not.toBeInTheDocument()
    expect(screen.queryByText("Delete")).not.toBeInTheDocument()
  })

  it("shows Edit/Delete for the owner", () => {
    mockUser("owner-1")
    renderCard()
    expect(screen.getByText("Edit")).toBeInTheDocument()
    expect(screen.getByText("Delete")).toBeInTheDocument()
  })

  it("opens a confirmation dialog and deletes on confirm", async () => {
    mockUser("owner-1")
    vi.spyOn(api, "deleteProject").mockResolvedValue(undefined)
    renderCard()

    await userEvent.click(screen.getByRole("button", { name: "Delete" }))
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument()

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" })
    await userEvent.click(deleteButtons[deleteButtons.length - 1])

    expect(api.deleteProject).toHaveBeenCalledWith("p1")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `signal-web/`):
```bash
npx vitest run src/components/projects/ProjectCard.test.tsx
```
Expected: FAIL — no "Edit"/"Delete" buttons rendered yet (`ProjectCard` doesn't have owner actions).

- [ ] **Step 3: Implement `DeleteProjectDialog`**

Create `signal-web/src/components/projects/DeleteProjectDialog.tsx`:

```tsx
import { useState } from "react"
import type { ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ApiError, deleteProject } from "@/lib/api"
import type { Project } from "@/lib/api"

interface DeleteProjectDialogProps {
  project: Project
  trigger: ReactNode
}

export function DeleteProjectDialog({ project, trigger }: DeleteProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const queryClient = useQueryClient()

  async function handleConfirm() {
    setError(null)
    setIsDeleting(true)
    try {
      await deleteProject(project.id)
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      setOpen(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "something went wrong")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>Delete project</DialogTitle>
        <DialogDescription>
          Are you sure you want to delete &quot;{project.name}&quot;? This action cannot be undone.
        </DialogDescription>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Update `ProjectCard`**

Replace the full contents of `signal-web/src/components/projects/ProjectCard.tsx` with:

```tsx
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { DeleteProjectDialog } from "@/components/projects/DeleteProjectDialog"
import { useAuth } from "@/context/AuthContext"
import type { Project } from "@/lib/api"

interface ProjectCardProps {
  project: Project
}

export function ProjectCard({ project }: ProjectCardProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const createdAt = new Date(project.createdAt).toLocaleDateString()
  const isOwner = user?.id === project.ownerId

  return (
    <div className="rounded-md border border-border bg-background p-4">
      <h3 className="font-display text-lg font-semibold">{project.name}</h3>
      {project.description && (
        <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {project.ownerName} &middot; {createdAt}
      </p>
      {isOwner && (
        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${project.id}/edit`, { state: { project } })}
          >
            Edit
          </Button>
          <DeleteProjectDialog
            project={project}
            trigger={
              <Button variant="destructive" size="sm">
                Delete
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Fix `ProjectList.test.tsx` for the new `ProjectCard` dependencies**

`ProjectCard` now calls `useNavigate()` and `useAuth()`, so `ProjectList`'s existing tests (which render `ProjectCard` indirectly) need a `MemoryRouter` and a mocked `AuthContext`. Replace the full contents of `signal-web/src/components/projects/ProjectList.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as authContext from "@/context/AuthContext"
import * as api from "@/lib/api"
import { ProjectList } from "./ProjectList"

vi.mock("@/context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("@/context/AuthContext")>("@/context/AuthContext")
  return { ...actual, useAuth: vi.fn() }
})

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
  vi.mocked(authContext.useAuth).mockReturnValue({
    status: "authenticated",
    user: { id: "viewer-1", name: "Viewer", email: "viewer@example.com", createdAt: "2026-06-21T00:00:00Z" },
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderWithClient(ui: ReactNode) {
  const queryClient = new QueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
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

(This is a wrapper-only change — the mocked viewer id `"viewer-1"` never matches `project()`'s `ownerId: "owner-1"`, so no Edit/Delete buttons appear and all original assertions still hold.)

- [ ] **Step 6: Run the tests to verify they pass**

Run (from `signal-web/`):
```bash
npx vitest run src/components/projects/ProjectCard.test.tsx src/components/projects/ProjectList.test.tsx
```
Expected: all tests in both files `PASS`.

- [ ] **Step 7: Commit**

```bash
git add signal-web/src/components/projects/DeleteProjectDialog.tsx signal-web/src/components/projects/ProjectCard.tsx signal-web/src/components/projects/ProjectCard.test.tsx signal-web/src/components/projects/ProjectList.test.tsx
git commit -m "feat(web): add owner-only edit/delete actions with delete confirmation modal"
```

---

## Task 9: "New project" entry point on `MainPage`

**Files:**
- Modify: `signal-web/src/pages/MainPage.tsx`
- Modify: `signal-web/src/pages/MainPage.test.tsx`

**Interfaces:**
- Consumes: `Button` (existing), `useNavigate` (existing pattern, already used in `MainPage` for logout).
- Produces: a visible "New project" button on `MainPage` that navigates to `/projects/new`.

- [ ] **Step 1: Write the failing test**

In `signal-web/src/pages/MainPage.test.tsx`, add `Route, Routes` to the existing `react-router-dom` import (so it reads `import { MemoryRouter, Route, Routes } from "react-router-dom"`), then append:

```tsx
describe("MainPage New project button", () => {
  it("navigates to /projects/new when clicked", async () => {
    mockAuthenticated()

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<MainPage />} />
          <Route path="/projects/new" element={<div>new project page</div>} />
        </Routes>
      </MemoryRouter>
    )

    await userEvent.click(screen.getByText("New project"))
    expect(await screen.findByText("new project page")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `signal-web/`):
```bash
npx vitest run src/pages/MainPage.test.tsx
```
Expected: FAIL — no element with text "New project" exists yet.

- [ ] **Step 3: Add the button**

In `signal-web/src/pages/MainPage.tsx`, change the `<main>` block from:

```tsx
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <Tabs defaultValue="all">
```

to:

```tsx
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="flex justify-end">
          <Button onClick={() => navigate("/projects/new")}>New project</Button>
        </div>
        <Tabs defaultValue="all">
```

(`navigate` and `Button` are already imported and in scope in this file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run (from `signal-web/`):
```bash
npx vitest run src/pages/MainPage.test.tsx
```
Expected: all tests in the file `PASS`, including the pre-existing tab-switching tests (no regressions).

- [ ] **Step 5: Run the full frontend test suite, lint, and build**

Run (from `signal-web/`):
```bash
npx vitest run
npm run lint
npm run build
```
Expected: all green — no failing tests, no lint errors, successful `tsc -b && vite build`.

- [ ] **Step 6: Commit**

```bash
git add signal-web/src/pages/MainPage.tsx signal-web/src/pages/MainPage.test.tsx
git commit -m "feat(web): add New project button to the projects list page"
```