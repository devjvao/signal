# Signal redesign — backend (signal-api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add project-level `requestCount`/`voteCount` aggregates and server-side `search`/`sort`/`status` query params to the two paginated list endpoints (`GET /projects[/mine]`, `GET /projects/:id/feature-requests`), per `contracts/projects-api.md`, `contracts/feature-requests-api.md`, and `contracts/entities.md` (already updated and committed at `081c0bb`), and per `docs/superpowers/specs/2026-06-22-redesign-design.md`.

**Architecture:** Both endpoints already use hand-rolled keyset (cursor) pagination — a per-endpoint cursor struct, base64 encode/decode functions, and a matching SQL `WHERE`/`ORDER BY`. This plan extends that same pattern: each new sort mode gets its own cursor struct/encode/decode pair and its own sqlc query, because the cursor's shape depends on what it's sorting by (e.g. `(createdAt, id)` vs `(score, createdAt, id)`). No shared/generic cursor abstraction is introduced. The frontend always restarts pagination (omits `cursor`) when `sort`/`search`/`status` changes, so a cursor never needs to "remember" which sort produced it.

**Tech Stack:** Go, Gin, sqlc (`pgx/v5` driver), PostgreSQL. Integration tests hit a real Postgres via `DB_URL` env var (skipped if unset, per existing `setupTestProjectHandler`/`setupTestFeatureRequestHandler` pattern).

## Global Constraints

- JSON keys are `camelCase` (existing convention — no change).
- Invalid `search`/`sort`/`status` values: `sort`/`status` get `400 { "error": "invalid sort" }` / `{ "error": "invalid status" }`; `search` has no validation (any string is valid, empty means "no filter").
- A cursor is only valid for the sort mode that issued it. Mixing them is undefined — not guarded against in code, matching the contract's documented constraint that clients must restart pagination on sort change.
- No new migrations — this plan only changes query-level SQL (joins/aggregates/filters), not schema.
- Run `sqlc generate` from `signal-api/` after every `db/queries/*.sql` edit, before running Go tests, so `internal/db/*.go` matches the queries.
- All new Go tests are integration tests following the existing `setupTestProjectHandler`/`setupTestFeatureRequestHandler` + `seedUser`/`seedProject`/`seedFeatureRequest`/`seedVote` helper pattern already in `projects_test.go`/`feature_requests_test.go`. Run them with `DB_URL` set, e.g.: `DB_URL=postgres://signal:signal@localhost:5432/signal_test go test ./internal/handlers/... -run <TestName> -v` (adjust the URL to match the project's local test database).

---

## Task 1: Project aggregates (`requestCount`, `voteCount`) on every project response

**Files:**
- Modify: `signal-api/db/queries/projects.sql` (`ListProjects`, `ListProjectsByOwner`, `GetProjectByID`)
- Modify: `signal-api/internal/handlers/projects.go` (`projectResponse`, `newProjectResponse`, all 5 call sites: `List`, `ListMine`, `Get`, `Create`, `Update`)
- Modify: `signal-api/internal/handlers/projects_test.go` (new test)
- Regenerate: `signal-api/internal/db/*.go` (via `sqlc generate`)

**Interfaces:**
- Produces: `projectResponse.RequestCount int32` (json `requestCount`), `projectResponse.VoteCount int32` (json `voteCount`) — every later task that touches `projectResponse` or `newProjectResponse` must keep these two trailing params.
- Produces: `newProjectResponse(id, ownerID, name, slug string, description pgtype.Text, createdAt pgtype.Timestamptz, ownerName string, requestCount, voteCount int32) projectResponse` — new signature, two new trailing params.

- [ ] **Step 1: Write the failing test**

Add to `signal-api/internal/handlers/projects_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestList_IncludesAggregateCounts -v`
Expected: FAIL — compile error, `json:"requestCount"` field doesn't exist on the response yet (the test unmarshal will just silently zero it, so the assertion `RequestCount != 1` fails) — or a build failure if you write the test against a struct that doesn't compile. Confirm it fails for the right reason (missing field on the wire, not a typo in the test).

- [ ] **Step 3: Update the SQL queries**

In `signal-api/db/queries/projects.sql`, replace `ListProjects`:

```sql
-- name: ListProjects :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
JOIN users u ON u.id = p.owner_id
LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;
```

Replace `ListProjectsByOwner`:

```sql
-- name: ListProjectsByOwner :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
JOIN users u ON u.id = p.owner_id
LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND p.owner_id = sqlc.arg('owner_id')::uuid
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;
```

Replace `GetProjectByID`:

```sql
-- name: GetProjectByID :one
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
JOIN users u ON u.id = p.owner_id
LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.id = sqlc.arg('id')::uuid AND p.deleted_at IS NULL
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name;
```

Leave `CreateProject` and `UpdateProject` unchanged — a newly created project always has 0 requests/votes (hardcoded in Go below), and an update doesn't change those counts (the handler already fetches them via `GetProjectByID` before applying the update).

- [ ] **Step 4: Regenerate sqlc code**

Run: `cd signal-api && sqlc generate`
Expected: `internal/db/projects.sql.go` (or equivalent generated file) now has `RequestCount int32` and `VoteCount int32` fields on `ListProjectsRow`, `ListProjectsByOwnerRow`, and `GetProjectByIDRow`.

- [ ] **Step 5: Update the handler**

In `signal-api/internal/handlers/projects.go`:

Add two fields to `projectResponse`:

```go
type projectResponse struct {
	ID           string  `json:"id"`
	Name         string  `json:"name"`
	Slug         string  `json:"slug"`
	Description  *string `json:"description"`
	OwnerID      string  `json:"ownerId"`
	OwnerName    string  `json:"ownerName"`
	RequestCount int32   `json:"requestCount"`
	VoteCount    int32   `json:"voteCount"`
	CreatedAt    string  `json:"createdAt"`
}
```

Update `newProjectResponse`:

```go
func newProjectResponse(id, ownerID, name, slug string, description pgtype.Text, createdAt pgtype.Timestamptz, ownerName string, requestCount, voteCount int32) projectResponse {
	var desc *string
	if description.Valid {
		d := description.String
		desc = &d
	}
	return projectResponse{
		ID:           id,
		Name:         name,
		Slug:         slug,
		Description:  desc,
		OwnerID:      ownerID,
		OwnerName:    ownerName,
		RequestCount: requestCount,
		VoteCount:    voteCount,
		CreatedAt:    createdAt.Time.UTC().Format(time.RFC3339),
	}
}
```

Update the 5 call sites. In `List`:

```go
projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName, row.RequestCount, row.VoteCount))
```

In `ListMine`: same change (identical row field names, since `ListProjectsByOwnerRow` has the same shape).

In `Get`:

```go
c.JSON(http.StatusOK, gin.H{"project": newProjectResponse(
	row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName, row.RequestCount, row.VoteCount,
)})
```

In `Create` (a brand-new project has no feature requests or votes yet):

```go
c.JSON(http.StatusCreated, gin.H{"project": newProjectResponse(
	row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, owner.Name, 0, 0,
)})
```

In `Update` (`existing` was fetched via `GetProjectByID` earlier in this handler, before the update — it now carries the aggregate fields too, and an update to name/description doesn't change them):

```go
c.JSON(http.StatusOK, gin.H{"project": newProjectResponse(
	row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, existing.OwnerName, existing.RequestCount, existing.VoteCount,
)})
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestList_IncludesAggregateCounts -v`
Expected: PASS

- [ ] **Step 7: Run the full existing test suite to confirm no regressions**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -v`
Expected: all PASS (existing tests don't assert on `requestCount`/`voteCount`, so they're unaffected by the new fields being present).

- [ ] **Step 8: Commit**

```bash
git add signal-api/db/queries/projects.sql signal-api/internal/db signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go
git commit -m "feat(api): add requestCount and voteCount aggregates to project responses"
```

---

## Task 2: `search` query param on `GET /projects` and `GET /projects/mine`

**Files:**
- Modify: `signal-api/db/queries/projects.sql` (`ListProjects`, `ListProjectsByOwner`)
- Modify: `signal-api/internal/handlers/projects.go` (`List`, `ListMine`)
- Modify: `signal-api/internal/handlers/projects_test.go` (new test)
- Regenerate: `signal-api/internal/db/*.go`

**Interfaces:**
- Consumes: `newProjectResponse(..., requestCount, voteCount int32)` from Task 1 — unchanged signature, no new params needed here.
- Produces: `db.ListProjectsParams.Search string` / `db.ListProjectsByOwnerParams.Search string` — Task 3 reuses this same `search` value when building the `active`-sort query params.

- [ ] **Step 1: Write the failing test**

Add to `signal-api/internal/handlers/projects_test.go`:

```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestList_FiltersBySearch -v`
Expected: FAIL — both projects are returned, since `search` isn't read/applied yet.

- [ ] **Step 3: Update the SQL queries**

In `signal-api/db/queries/projects.sql`, add a search predicate to `ListProjects` (insert after the `WHERE p.deleted_at IS NULL` line, before the cursor predicate):

```sql
  AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
```

So the full `WHERE` clause of `ListProjects` becomes:

```sql
WHERE p.deleted_at IS NULL
  AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
```

Apply the identical addition to `ListProjectsByOwner`'s `WHERE` clause (after the `p.owner_id = ...` line).

- [ ] **Step 4: Regenerate sqlc code**

Run: `cd signal-api && sqlc generate`
Expected: `ListProjectsParams` and `ListProjectsByOwnerParams` now have a `Search string` field.

- [ ] **Step 5: Update the handler**

In `signal-api/internal/handlers/projects.go`, in `List`:

```go
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
	search := c.Query("search")

	hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
	rows, err := h.Queries.ListProjects(c.Request.Context(), db.ListProjectsParams{
		Search:          search,
		HasCursor:       hasCursor,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
		LimitCount:      int32(limit + 1),
	})
	// ... rest unchanged
```

Apply the identical `search := c.Query("search")` + `Search: search` addition to `ListMine`'s call to `h.Queries.ListProjectsByOwner`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestList_FiltersBySearch -v`
Expected: PASS

- [ ] **Step 7: Run the full existing test suite to confirm no regressions**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -v`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add signal-api/db/queries/projects.sql signal-api/internal/db signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go
git commit -m "feat(api): add search query param to project listing endpoints"
```

---

## Task 3: `sort=active` mode on `GET /projects` and `GET /projects/mine`

**Files:**
- Modify: `signal-api/db/queries/projects.sql` (new `ListProjectsActive`, `ListProjectsByOwnerActive`)
- Modify: `signal-api/internal/handlers/projects.go` (`List`, `ListMine`, new sort/cursor helpers)
- Modify: `signal-api/internal/handlers/projects_test.go` (new tests)
- Regenerate: `signal-api/internal/db/*.go`

**Interfaces:**
- Consumes: `search := c.Query("search")` pattern from Task 2.
- Produces: `parseProjectsSort(c *gin.Context) (string, bool)` returning `"newest"` or `"active"` — used by both `List` and `ListMine`.
- Produces: `projectActiveCursor{score int32; createdAt time.Time; id string}`, `parseProjectActiveCursor`, `encodeProjectActiveCursor`, `projectActiveCursorParams` — a fully separate cursor pair from the existing `projectCursor` ones, scoped to `sort=active` only.

- [ ] **Step 1: Write the failing tests**

Add to `signal-api/internal/handlers/projects_test.go`:

```go
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
```

Add `"fmt"` to the import block if not already present (it already is, per the existing `TestList_PaginatesAllProjects`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestList_SortActive -v`
Expected: FAIL — `sort=active` isn't recognized yet, so `List` falls through to default (`newest`) ordering, and `TestList_InvalidSort` fails because `sort=banana` is currently silently ignored (200, not 400).

- [ ] **Step 3: Add the new sqlc queries**

In `signal-api/db/queries/projects.sql`, append:

```sql
-- name: ListProjectsActive :many
WITH project_scores AS (
    SELECT
        p.id,
        p.owner_id,
        p.name,
        p.slug,
        p.description,
        p.created_at,
        u.name AS owner_name,
        COUNT(DISTINCT fr.id)::int AS request_count,
        COUNT(v.id)::int AS vote_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
    LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
    GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
)
SELECT *
FROM project_scores
WHERE (
    sqlc.arg('has_cursor')::bool = false
    OR (request_count + vote_count) < sqlc.arg('cursor_score')::int
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at = sqlc.arg('cursor_created_at')::timestamptz AND id < sqlc.arg('cursor_id')::uuid)
)
ORDER BY (request_count + vote_count) DESC, created_at DESC, id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: ListProjectsByOwnerActive :many
WITH project_scores AS (
    SELECT
        p.id,
        p.owner_id,
        p.name,
        p.slug,
        p.description,
        p.created_at,
        u.name AS owner_name,
        COUNT(DISTINCT fr.id)::int AS request_count,
        COUNT(v.id)::int AS vote_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
    LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND p.owner_id = sqlc.arg('owner_id')::uuid
      AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
    GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
)
SELECT *
FROM project_scores
WHERE (
    sqlc.arg('has_cursor')::bool = false
    OR (request_count + vote_count) < sqlc.arg('cursor_score')::int
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at = sqlc.arg('cursor_created_at')::timestamptz AND id < sqlc.arg('cursor_id')::uuid)
)
ORDER BY (request_count + vote_count) DESC, created_at DESC, id DESC
LIMIT sqlc.arg('limit_count')::int;
```

- [ ] **Step 4: Regenerate sqlc code**

Run: `cd signal-api && sqlc generate`
Expected: `ListProjectsActiveRow`/`ListProjectsByOwnerActiveRow` (with `RequestCount`, `VoteCount` fields) and `ListProjectsActiveParams`/`ListProjectsByOwnerActiveParams` (with `Search`, `HasCursor`, `CursorScore int32`, `CursorCreatedAt pgtype.Timestamptz`, `CursorID string`, `LimitCount int32`) are generated.

- [ ] **Step 5: Add sort parsing and the active-cursor helpers**

In `signal-api/internal/handlers/projects.go`, add near the existing `projectCursor` type:

```go
func parseProjectsSort(c *gin.Context) (string, bool) {
	raw := c.Query("sort")
	if raw == "" {
		return "newest", true
	}
	if raw == "newest" || raw == "active" {
		return raw, true
	}
	return "", false
}

type projectActiveCursor struct {
	score     int32
	createdAt time.Time
	id        string
}

func parseProjectActiveCursor(c *gin.Context) (*projectActiveCursor, bool) {
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
	score, err := strconv.Atoi(parts[0])
	if err != nil {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return nil, false
	}
	return &projectActiveCursor{score: int32(score), createdAt: createdAt, id: parts[2]}, true
}

func encodeProjectActiveCursor(score int32, createdAt time.Time, id string) string {
	raw := strconv.Itoa(int(score)) + "|" + createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func projectActiveCursorParams(cursor *projectActiveCursor) (hasCursor bool, score int32, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, 0, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, zeroUUID
	}
	return true, cursor.score, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}
```

- [ ] **Step 6: Branch `List` and `ListMine` on sort**

Replace the body of `List`:

```go
func (h *ProjectHandler) List(c *gin.Context) {
	limit, ok := parseProjectsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	sort, ok := parseProjectsSort(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sort"})
		return
	}
	search := c.Query("search")

	var projects []projectResponse
	var nextCursor *string

	if sort == "active" {
		cursor, ok := parseProjectActiveCursor(c)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		hasCursor, cursorScore, cursorCreatedAt, cursorID := projectActiveCursorParams(cursor)
		rows, err := h.Queries.ListProjectsActive(c.Request.Context(), db.ListProjectsActiveParams{
			Search:          search,
			HasCursor:       hasCursor,
			CursorScore:     cursorScore,
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
		projects = make([]projectResponse, 0, len(rows))
		for _, row := range rows {
			projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName, row.RequestCount, row.VoteCount))
		}
		if hasMore {
			last := rows[len(rows)-1]
			cur := encodeProjectActiveCursor(last.RequestCount+last.VoteCount, last.CreatedAt.Time, last.ID)
			nextCursor = &cur
		}
	} else {
		cursor, ok := parseProjectsCursor(c)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
		rows, err := h.Queries.ListProjects(c.Request.Context(), db.ListProjectsParams{
			Search:          search,
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
		projects = make([]projectResponse, 0, len(rows))
		for _, row := range rows {
			projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName, row.RequestCount, row.VoteCount))
		}
		if hasMore {
			last := rows[len(rows)-1]
			cur := encodeProjectsCursor(last.CreatedAt.Time, last.ID)
			nextCursor = &cur
		}
	}

	c.JSON(http.StatusOK, projectsListResponse{Projects: projects, NextCursor: nextCursor})
}
```

Apply the identical branching structure to `ListMine`, with two changes: (1) keep its existing `userID, ok := auth.UserID(c)` unauthorized check at the top, and (2) use `h.Queries.ListProjectsByOwnerActive`/`h.Queries.ListProjectsByOwner` with an added `OwnerID: userID` field in both params structs.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run "TestList_SortActive|TestList_InvalidSort" -v`
Expected: PASS

- [ ] **Step 8: Run the full existing test suite to confirm no regressions**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -v`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add signal-api/db/queries/projects.sql signal-api/internal/db signal-api/internal/handlers/projects.go signal-api/internal/handlers/projects_test.go
git commit -m "feat(api): add sort=active mode to project listing endpoints"
```

---

## Task 4: `status` filter on `GET /projects/:id/feature-requests`

**Files:**
- Modify: `signal-api/db/queries/feature_requests.sql` (`ListFeatureRequests`)
- Modify: `signal-api/internal/handlers/feature_requests.go` (`List`)
- Modify: `signal-api/internal/handlers/feature_requests_test.go` (new tests)
- Regenerate: `signal-api/internal/db/*.go`

**Interfaces:**
- Produces: `db.ListFeatureRequestsParams.Status string` (empty string = no filter) — reused as-is by Task 5's new `newest`-sort query, which gets its own params struct but follows the same "empty string means no filter" convention.

- [ ] **Step 1: Write the failing tests**

Add to `signal-api/internal/handlers/feature_requests_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestFRList_FiltersByStatus -v`
Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run TestFRList_InvalidStatus -v`
Expected: both FAIL — `status` isn't read/validated yet.

- [ ] **Step 3: Update the SQL query**

In `signal-api/db/queries/feature_requests.sql`, add a status predicate to `ListFeatureRequests`'s `WHERE` clause (after `fr.deleted_at IS NULL`):

```sql
  AND (sqlc.arg('status')::text = '' OR fr.status = sqlc.arg('status')::text)
```

So the full clause becomes:

```sql
WHERE fr.project_id = sqlc.arg('project_id')::uuid
  AND fr.deleted_at IS NULL
  AND (sqlc.arg('status')::text = '' OR fr.status = sqlc.arg('status')::text)
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR COALESCE(v.cnt, 0)::int < sqlc.arg('cursor_count')::int
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at = sqlc.arg('cursor_created_at')::timestamptz AND fr.id < sqlc.arg('cursor_id')::uuid)
  )
```

- [ ] **Step 4: Regenerate sqlc code**

Run: `cd signal-api && sqlc generate`
Expected: `ListFeatureRequestsParams` now has a `Status string` field.

- [ ] **Step 5: Update the handler**

In `signal-api/internal/handlers/feature_requests.go`, add status validation near `validFeatureRequestStatuses` (already defined) and use it in `List`:

```go
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
	status := c.Query("status")
	if status != "" && !validFeatureRequestStatuses[status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
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
		Status:          status,
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
```

Note `GetProjectByID` is called before the `status`/`sort` work in this handler — leave that call as-is (it's just an existence check; Task 1 added aggregate columns to its row type, but `List` here never reads those columns, so nothing else changes).

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run "TestFRList_FiltersByStatus|TestFRList_InvalidStatus" -v`
Expected: PASS

- [ ] **Step 7: Run the full existing test suite to confirm no regressions**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -v`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add signal-api/db/queries/feature_requests.sql signal-api/internal/db signal-api/internal/handlers/feature_requests.go signal-api/internal/handlers/feature_requests_test.go
git commit -m "feat(api): add status filter to feature request listing"
```

---

## Task 5: `sort=newest` mode on `GET /projects/:id/feature-requests`

**Files:**
- Modify: `signal-api/db/queries/feature_requests.sql` (new `ListFeatureRequestsNewest`)
- Modify: `signal-api/internal/handlers/feature_requests.go` (`List`, new sort/cursor helpers)
- Modify: `signal-api/internal/handlers/feature_requests_test.go` (new tests)
- Regenerate: `signal-api/internal/db/*.go`

**Interfaces:**
- Consumes: `status := c.Query("status")` + validation from Task 4.
- Produces: `parseFeatureRequestsSort(c *gin.Context) (string, bool)` returning `"votes"` or `"newest"`.
- Produces: `featureRequestNewestCursor{createdAt time.Time; id string}`, `parseFeatureRequestNewestCursor`, `encodeFeatureRequestNewestCursor`, `featureRequestNewestCursorParams` — separate from the existing votes-sort cursor pair.

- [ ] **Step 1: Write the failing tests**

Add to `signal-api/internal/handlers/feature_requests_test.go`:

```go
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run "TestFRList_SortNewest|TestFRList_InvalidSort" -v`
Expected: FAIL — `sort` isn't read/validated yet, so results stay ordered by votes and `sort=banana` returns 200.

- [ ] **Step 3: Add the new sqlc query**

In `signal-api/db/queries/feature_requests.sql`, append:

```sql
-- name: ListFeatureRequestsNewest :many
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
  AND (sqlc.arg('status')::text = '' OR fr.status = sqlc.arg('status')::text)
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR fr.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (fr.created_at = sqlc.arg('cursor_created_at')::timestamptz AND fr.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY fr.created_at DESC, fr.id DESC
LIMIT sqlc.arg('limit_count')::int;
```

- [ ] **Step 4: Regenerate sqlc code**

Run: `cd signal-api && sqlc generate`
Expected: `ListFeatureRequestsNewestParams`/`ListFeatureRequestsNewestRow` generated.

- [ ] **Step 5: Add sort parsing and the newest-cursor helpers**

In `signal-api/internal/handlers/feature_requests.go`, add near the existing `featureRequestCursor` type:

```go
func parseFeatureRequestsSort(c *gin.Context) (string, bool) {
	raw := c.Query("sort")
	if raw == "" {
		return "votes", true
	}
	if raw == "votes" || raw == "newest" {
		return raw, true
	}
	return "", false
}

type featureRequestNewestCursor struct {
	createdAt time.Time
	id        string
}

func parseFeatureRequestNewestCursor(c *gin.Context) (*featureRequestNewestCursor, bool) {
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
	return &featureRequestNewestCursor{createdAt: createdAt, id: parts[1]}, true
}

func encodeFeatureRequestNewestCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func featureRequestNewestCursorParams(cursor *featureRequestNewestCursor) (hasCursor bool, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, zeroUUID
	}
	return true, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}
```

- [ ] **Step 6: Branch `List` on sort**

Replace the body of `List` (from the `status` check from Task 4 onward) with:

```go
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
	status := c.Query("status")
	if status != "" && !validFeatureRequestStatuses[status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	sort, ok := parseFeatureRequestsSort(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid sort"})
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

	var items []featureRequestResponse
	var nextCursor *string

	if sort == "newest" {
		cursor, ok := parseFeatureRequestNewestCursor(c)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		hasCursor, cursorCreatedAt, cursorID := featureRequestNewestCursorParams(cursor)
		rows, err := h.Queries.ListFeatureRequestsNewest(c.Request.Context(), db.ListFeatureRequestsNewestParams{
			ViewerID:        viewerID,
			ProjectID:       projectID,
			Status:          status,
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
		items = make([]featureRequestResponse, 0, len(rows))
		for _, row := range rows {
			items = append(items, newFeatureRequestResponse(row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, row.CreatedByName, row.UpvoteCount, row.ViewerHasVoted))
		}
		if hasMore {
			last := rows[len(rows)-1]
			cur := encodeFeatureRequestNewestCursor(last.CreatedAt.Time, last.ID)
			nextCursor = &cur
		}
	} else {
		cursor, ok := parseFeatureRequestsCursor(c)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
			return
		}
		hasCursor, cursorCount, cursorCreatedAt, cursorID := featureRequestCursorParams(cursor)
		rows, err := h.Queries.ListFeatureRequests(c.Request.Context(), db.ListFeatureRequestsParams{
			ViewerID:        viewerID,
			ProjectID:       projectID,
			Status:          status,
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
		items = make([]featureRequestResponse, 0, len(rows))
		for _, row := range rows {
			items = append(items, newFeatureRequestResponse(row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, row.CreatedByName, row.UpvoteCount, row.ViewerHasVoted))
		}
		if hasMore {
			last := rows[len(rows)-1]
			cur := encodeFeatureRequestsCursor(last.UpvoteCount, last.CreatedAt.Time, last.ID)
			nextCursor = &cur
		}
	}

	c.JSON(http.StatusOK, featureRequestsListResponse{FeatureRequests: items, NextCursor: nextCursor})
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -run "TestFRList_SortNewest|TestFRList_InvalidSort" -v`
Expected: PASS

- [ ] **Step 8: Run the full existing test suite to confirm no regressions**

Run: `cd signal-api && DB_URL=<your-test-db-url> go test ./internal/handlers/... -v`
Expected: all PASS

- [ ] **Step 9: Commit**

```bash
git add signal-api/db/queries/feature_requests.sql signal-api/internal/db signal-api/internal/handlers/feature_requests.go signal-api/internal/handlers/feature_requests_test.go
git commit -m "feat(api): add sort=newest mode to feature request listing"
```