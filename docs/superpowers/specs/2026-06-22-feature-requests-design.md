# Feature Requests — Full-Stack Design

**Date:** 2026-06-22
**Scope:** `signal-api` (Go/Gin/sqlc/pgx) and `signal-web` (React/react-router/TanStack Query),
worked in parallel against a frozen set of API contracts.

## Goal

Add feature requests to projects. Any user can create feature requests in any project, upvote them
(once, toggleable), and the project owner manages their status. The web app surfaces feature
requests on a per-project page ordered by upvotes with infinite scroll.

## Decisions

- **Voting is a toggle.** A user may add an upvote and later remove it. `POST` adds, `DELETE`
  removes; both are idempotent. When the count returns to `0`, the author may edit again.
- **Status is editable by the project owner in the web app.** Cards render a status `Select`
  (Radix-based, new `components/ui/select.tsx`) for the project owner, defaulting to the current
  status; all other viewers see a read-only badge. Selecting a new value auto-saves via
  `PUT /feature-requests/:id/status`.
- **Editing uses a dedicated page**, mirroring the existing `ProjectFormPage` create/edit pattern.

## Shared Contracts

The `contracts/` folder is the single source of truth and is frozen before parallel work begins.

### Entity: `FeatureRequest` (`contracts/entities.md`)

| field            | type             | notes                                                       |
|------------------|------------------|-------------------------------------------------------------|
| `id`             | string           | UUID, primary key                                           |
| `projectId`      | string           | UUID of the parent project                                  |
| `title`          | string           | required, non-empty, max 200                                |
| `description`    | string \| null   | optional, max 2000                                          |
| `status`         | string           | `open` \| `planned` \| `in_progress` \| `completed` \| `rejected` |
| `createdBy`      | string           | UUID of the author                                          |
| `createdByName`  | string           | denormalized author display name, joined from `users`       |
| `upvoteCount`    | number           | count of active (non-deleted) votes                         |
| `viewerHasVoted` | boolean          | whether the authenticated user has an active vote           |
| `createdAt`      | string           | ISO 8601 timestamp                                          |

Soft-deleted feature requests (`deleted_at IS NOT NULL`) are excluded from all lookups and listings.

### Routes (`contracts/feature-requests-api.md`)

All routes are protected (`Authorization: Bearer <token>`). JSON is camelCase. Error envelope is
`{ "error": "..." }`, consistent with the existing contracts.

#### `GET /projects/:id/feature-requests`

List a project's feature requests, cursor-paginated, ordered by `upvoteCount DESC, createdAt DESC,
id DESC`.

- **Query params:** `cursor` (opaque, optional), `limit` (default `10`, max `50`; out-of-range or
  non-integer → `400 invalid limit`).
- **Success `200`:** `{ "featureRequests": [FeatureRequest...], "nextCursor": string | null }`.
  `viewerHasVoted` and `upvoteCount` are computed relative to the authenticated user.
- **Errors:** `400` invalid project id / invalid cursor / invalid limit; `401` unauthorized;
  `404 project not found`.

The cursor is an opaque base64 of `upvoteCount|createdAt|id`. Because `upvoteCount` is mutable,
pages can shift if votes change mid-scroll; this is accepted for this iteration.

#### `POST /projects/:id/feature-requests`

Create a feature request. Any authenticated user.

- **Body:** `title` (required, non-empty, max 200), `description` (optional, max 2000).
- `status` defaults to `open`. `createdBy` is the authenticated user.
- **Success `201`:** `{ "featureRequest": FeatureRequest }` (`upvoteCount` 0, `viewerHasVoted` false).
- **Errors:** `400` invalid project id / validation; `401`; `404 project not found`.

#### `PUT /feature-requests/:id`

Update `title` and `description`. **Author-only**, and **only while `upvoteCount == 0`**.

- **Body:** same shape/validation as create.
- **Success `200`:** `{ "featureRequest": FeatureRequest }`.
- **Errors:** `400` invalid id / validation; `401`; `403 forbidden` (not the author);
  `404 feature request not found`; `409 conflict` (`feature request has upvotes`) — has ≥1 upvote.

#### `PUT /feature-requests/:id/status`

Update `status`. **Project-owner only.** (PUT, not PATCH: CORS allows only GET/POST/PUT/DELETE.)

- **Body:** `status` — one of the allowed enum values; anything else → `400`.
- **Success `200`:** `{ "featureRequest": FeatureRequest }`.
- **Errors:** `400` invalid id / invalid status; `401`; `403 forbidden` (not the project owner);
  `404 feature request not found`.

#### `DELETE /feature-requests/:id`

Soft-delete. Allowed for the **project owner or the feature request author**.

- **Success `204`** (empty body).
- **Errors:** `400` invalid id; `401`; `403 forbidden`; `404 feature request not found`.

#### `POST /feature-requests/:id/vote`

Add the authenticated user's upvote. The **author cannot upvote** their own request. Idempotent: if
an active vote already exists, returns the current state.

- **Success `200`:** `{ "featureRequest": FeatureRequest }` (`viewerHasVoted` true).
- **Errors:** `400` invalid id; `401`; `403 forbidden` (the author); `404 feature request not found`.

#### `DELETE /feature-requests/:id/vote`

Remove the authenticated user's upvote. Idempotent: returns current state if no active vote exists.

- **Success `200`:** `{ "featureRequest": FeatureRequest }` (`viewerHasVoted` false).
- **Errors:** `400` invalid id; `401`; `404 feature request not found`.

### Addition to `projects-api.md`: `GET /projects/:id`

The project page needs project details on direct load/refresh. The `GetProjectByID` query already
exists.

- **Success `200`:** `{ "project": Project }`.
- **Errors:** `400 invalid project id`; `401`; `404 project not found`.

### Addition to `contracts/README.md`

Add `409 Conflict` to the status-codes list ("the feature request already has upvotes and can no
longer be edited") and reference the new `feature-requests-api.md` file.

## signal-api Implementation

Schema already exists: migrations `000004_create_feature_requests_table` and
`000005_create_votes_table`. No new migrations required.

### Queries — `db/queries/feature_requests.sql`, `db/queries/votes.sql`

- **`ListFeatureRequests`** — `JOIN users` for `created_by_name`; `LEFT JOIN` an aggregated active
  vote-count subquery; `EXISTS` subquery against `votes` for `viewer_has_voted`. Keyset predicate on
  `(upvote_count, created_at, id)`; order `upvote_count DESC, created_at DESC, id DESC`;
  `LIMIT limit_count`. (The `WHERE` repeats `COALESCE(v.cnt,0)` rather than the alias.)
- **`GetFeatureRequestByID`** — returns the FR fields, `created_by_name`, `upvote_count`,
  `project_owner_id` (joined from `projects`), and `viewer_has_voted`. Drives both authorization and
  the post-mutation response shape.
- **`CreateFeatureRequest`**, **`UpdateFeatureRequest`** (title/description),
  **`UpdateFeatureRequestStatus`**, **`SoftDeleteFeatureRequest`**.
- **`CreateVote`** — plain `INSERT`; the partial unique index
  (`votes_feature_request_user_active_idx`) raises `23505` when an active vote already exists, which
  the handler treats as idempotent success. A prior soft-deleted vote does not block re-voting.
- **`RemoveVote`** — `UPDATE votes SET deleted_at = now() WHERE feature_request_id = $1 AND
  user_id = $2 AND deleted_at IS NULL`.

### Handlers — `internal/handlers/feature_requests.go`

`FeatureRequestHandler{ Queries *db.Queries }` mirroring `ProjectHandler`:

- Cursor encode/decode extended to include the integer `upvoteCount` (base64 of
  `count|createdAt|id`).
- `newFeatureRequestResponse(...)` builder mapping pgtype values to the camelCase response struct.
- `List`, `Create`, `Update`, `UpdateStatus`, `Delete`, `Vote`, `Unvote`. Shared helpers: UUID
  validation (`uuidPattern`), `auth.UserID`, fetch-then-authorize (`GetFeatureRequestByID` →
  compare `createdBy` / `projectOwnerId`), `pgx.ErrNoRows` → `404`.
- `Update` returns `409` when `upvoteCount > 0`. `Vote` returns `403` when caller is the author.

### Routing — `cmd/api/main.go`

- Under the existing `protectedProjects` group: `GET /:id/feature-requests`,
  `POST /:id/feature-requests`, plus the new `GET /:id` (single project) on `ProjectHandler`.
- New `protectedFeatureRequests` group (`/feature-requests`, auth middleware):
  `PUT /:id`, `PUT /:id/status`, `DELETE /:id`, `POST /:id/vote`, `DELETE /:id/vote`.
- `main()` constructs a `FeatureRequestHandler` and passes it to `setupRouter`.

### Tests

Table-driven handler tests mirroring `projects_test.go`: success and each error path
(`400/401/403/404/409`), author-vs-project-owner permission matrix for delete/status/edit, the
author-cannot-vote rule, vote toggle idempotency, and listing order/pagination.

## signal-web Implementation

### `lib/api.ts`

- `FeatureRequest` interface and `FeatureRequestsPage` (`{ featureRequests, nextCursor }`).
- `getProject(id)`, `listFeatureRequests(projectId, { cursor?, limit? })`,
  `createFeatureRequest(projectId, input)`, `updateFeatureRequest(id, input)`,
  `updateFeatureRequestStatus(id, status)`, `deleteFeatureRequest(id)`, `voteFeatureRequest(id)`,
  `unvoteFeatureRequest(id)` (the vote/status functions return `{ featureRequest }`).

### Pages & components

- **`pages/ProjectPage.tsx`** (`/projects/:id`): fetches the project (`getProject`), renders a
  header (name, description, owner) and `FeatureRequestList`; shows a "New feature request" button
  linking to `/projects/:id/feature-requests/new`; back link to the project listing.
- **`components/feature-requests/FeatureRequestList.tsx`**: `useInfiniteQuery` keyed
  `["featureRequests", projectId]`, `IntersectionObserver` sentinel — mirrors `ProjectList`.
- **`components/feature-requests/FeatureRequestCard.tsx`**: title, description, status, author,
  upvote count + toggle button. Upvote button hidden for the author; reflects `viewerHasVoted`.
  Edit (→ edit page) shown to the author only when `upvoteCount === 0`. Delete (dialog) shown to
  the author or the project owner. Receives `projectOwnerId` from the page.
  - **Status display:** the project owner sees a `Select` (current status preselected, options =
    the 5 enum values via the existing `statusLabels` map); everyone else sees the existing
    read-only badge.
  - **Status update:** a `useMutation` calling `updateFeatureRequestStatus`, fired `onValueChange`
    (auto-save, no confirm step — consistent with the vote toggle). The `Select` is disabled while
    the mutation is pending. `onSuccess` invalidates `["featureRequests", projectId]`, so the
    displayed value comes from refetched query data (a failed update simply leaves the prior value
    in place since nothing was invalidated). On failure, an inline `text-destructive` message
    appears below the `Select` with the `ApiError` message (or "something went wrong"), mirroring
    `DeleteFeatureRequestDialog`'s error display; it clears on the next change attempt.
- **`components/ui/select.tsx`**: new shadcn-style wrapper around `@radix-ui/react-select` (new
  dependency — Radix primitives already back `Dialog`/`Tabs`), exporting `Select`,
  `SelectTrigger`, `SelectContent`, `SelectItem`, etc.
- **`components/feature-requests/DeleteFeatureRequestDialog.tsx`**: mirrors `DeleteProjectDialog`.
- **`pages/FeatureRequestFormPage.tsx`**: create
  (`/projects/:id/feature-requests/new`) and edit (`/feature-requests/:id/edit`); title +
  description fields with validation; submit and cancel buttons; cancel navigates back to the
  project page.

### Wiring

- `App.tsx` routes (all `ProtectedRoute`): `/projects/:id`,
  `/projects/:id/feature-requests/new`, `/feature-requests/:id/edit`.
- `ProjectCard`: clicking the card body navigates to `/projects/:id`; the Edit/Delete buttons call
  `stopPropagation`.
- Vote toggle: a `useMutation` calling vote/unvote that invalidates the project's
  `featureRequests` query, so the list reorders by upvotes on refetch and edit-availability updates.

### Tests

Component tests mirroring `ProjectCard.test.tsx` / `ProjectList.test.tsx`: card action visibility
matrix (author / project owner / other user; `upvoteCount` 0 vs >0), upvote toggle behavior, form
validation, and navigation from the project card. For status editing: project owner sees the
`Select` defaulting to the current status; non-owners see the read-only badge; changing the value
calls `updateFeatureRequestStatus` and invalidates the query; a failed update shows the inline
error and leaves the original status displayed.

## Parallel Execution

1. Write all contract changes on `main` and commit (the frozen interface).
2. Commit this spec.
3. `writing-plans` → implementation plan.
4. Dispatch two parallel agents in git worktrees: **Agent A = signal-api**, **Agent B =
   signal-web**, each implementing against the frozen contracts. Their only shared artifact is
   `contracts/`; no shared runtime state.

## Known Caveat

Ordering by a mutable `upvoteCount` means infinite-scroll pages can shift if votes change while a
user scrolls. Accepted for this iteration; documented in the contract.