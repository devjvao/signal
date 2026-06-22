# Project CRUD (Create, Update, Delete) — Design

## Context

`signal-api` and `signal-web` already support listing projects (`GET /projects`, `GET /projects/mine`)
with cursor pagination. This spec adds the missing write operations: creating a project, updating a
project, and deleting (soft-deleting) a project — restricted to the project's owner for update/delete —
plus the corresponding `signal-web` UI.

## Backend (signal-api)

### Routes

All under the existing `protectedProjects` route group (already behind `auth.Middleware`):

| Method | Path            | Handler                  | Auth                  |
|--------|-----------------|---------------------------|------------------------|
| POST   | `/projects`     | `ProjectHandler.Create`   | any authenticated user |
| PUT    | `/projects/:id` | `ProjectHandler.Update`   | owner only             |
| DELETE | `/projects/:id` | `ProjectHandler.Delete`   | owner only             |

`corsMiddleware`'s `Access-Control-Allow-Methods` header gains `PUT, DELETE`.

### sqlc queries (`db/queries/projects.sql`)

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

### Handler behavior (`internal/handlers/projects.go`)

Request bodies:

```go
type createProjectRequest struct {
    Name        string  `json:"name" binding:"required,max=200"`
    Description *string `json:"description" binding:"omitempty,max=2000"`
}

type updateProjectRequest struct {
    Name        string  `json:"name" binding:"required,max=200"`
    Description *string `json:"description" binding:"omitempty,max=2000"`
}
```

**Create:**
1. Bind `createProjectRequest`; `400` on validation failure.
2. Get `userID` from `auth.UserID(c)`.
3. `slugify(req.Name)` → lowercase, collapse runs of non-`[a-z0-9]` to a single hyphen, trim
   leading/trailing hyphens; fall back to `"project"` if the result is empty.
4. Insert via `CreateProject`. On a unique-violation (`pgconn.PgError.Code == "23505"`) targeting the
   slug, append a random 6-hex-char suffix and retry, up to 5 attempts; otherwise `500`.
5. Fetch the owner's name via the existing `GetUserByID` query to populate `ownerName`.
6. `201` with `{"project": projectResponse{...}}`.

**Update:**
1. Validate `:id` against the existing `uuidPattern` regex; `400` if invalid.
2. Bind `updateProjectRequest`; `400` on validation failure.
3. Get `userID`; `401` if missing.
4. `GetProjectByID`; `404` if `pgx.ErrNoRows`, `500` on other errors.
5. If `row.OwnerID != userID` → `403`.
6. `UpdateProject` with the new name/description; `500` on error.
7. `200` with `{"project": projectResponse{...}}`, built from the `UpdateProject` result plus
   `ownerName` from step 4 (slug and owner never change on update).

**Delete:**
1. Validate `:id`; `400` if invalid.
2. Get `userID`; `401` if missing.
3. `GetProjectByID`; `404` if missing.
4. If `row.OwnerID != userID` → `403`.
5. `SoftDeleteProject`; `500` on error.
6. `204` with no body.

### Tests

Extend `projects_test.go` (integration tests gated on `DB_URL`, matching existing style) with cases for:
create success + slug collision retry + validation failure; update success, 403 for non-owner, 404 for
missing/deleted project; delete success, 403 for non-owner, 204 + subsequent list exclusion.

## Frontend (signal-web)

### API client (`src/lib/api.ts`)

```ts
export interface ProjectInput {
  name: string
  description?: string
}

export function createProject(input: ProjectInput): Promise<{ project: Project }>
export function updateProject(id: string, input: ProjectInput): Promise<{ project: Project }>
export function deleteProject(id: string): Promise<void>
```

`request<T>` already tolerates an empty/non-JSON body (used for the `204` delete response).

### New UI primitives

- `src/components/ui/textarea.tsx` — mirrors `input.tsx` styling, for the description field.
- `src/components/ui/dialog.tsx` — thin wrapper around `@radix-ui/react-dialog` (new dependency,
  consistent with the existing `@radix-ui/react-tabs` usage), used for the delete confirmation modal.

### Pages and routing

- `src/pages/ProjectFormPage.tsx` — one component backing both:
  - `/projects/new` — create mode, empty form.
  - `/projects/:id/edit` — edit mode, prefilled from `location.state.project` (passed by the "Edit"
    button on `ProjectCard`, which already has the full `Project` object in memory). If `:id` is
    present but `location.state.project` is missing (e.g. direct navigation or a page refresh), redirect
    to `/` — there is no `GET /projects/:id` endpoint in this scope, so the edit page cannot otherwise
    recover the data.
  - On submit success, invalidate the `["projects"]` react-query cache key (covers both the `"all"` and
    `"mine"` scopes) and `navigate("/")`, landing back on the projects list with fresh data.
  - Errors surface inline via `ApiError`, matching `LoginPage`'s pattern.
- `src/App.tsx` — register both routes, wrapped in `ProtectedRoute`.

### Components

- `src/components/projects/ProjectCard.tsx` — accept the current user via `useAuth()`; when
  `project.ownerId === user?.id`, render "Edit" and "Delete" buttons (in addition to the existing
  read-only content), regardless of which tab (`all`/`mine`) the card is rendered in.
  - "Edit" → `navigate(`/projects/${project.id}/edit`, { state: { project } })`.
  - "Delete" → opens `DeleteProjectDialog`.
- `src/components/projects/DeleteProjectDialog.tsx` — `Dialog` confirming deletion by project name;
  on confirm calls `deleteProject(id)`, invalidates the `["projects"]` cache, and closes; on cancel,
  closes without action.
- `src/pages/MainPage.tsx` — add a "New project" `Button` near the tabs that navigates to
  `/projects/new`.

## Out of scope

- A `GET /projects/:id` endpoint (edit relies on in-memory state instead — see above).
- Hard delete / un-delete / project archiving UI.
- Changing a project's slug after creation.