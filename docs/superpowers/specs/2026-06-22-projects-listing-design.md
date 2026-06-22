# Projects Listing — Design

## Goal

Add a full-stack "projects listing" feature:
- API: cursor-paginated `GET /projects` (all projects) and `GET /projects/mine` (current user's projects).
- Web: main page shows the listing behind two tabs, "All projects" (default) and "My projects", each with infinite scroll.

## Contracts

### `contracts/entities.md` — new `Project` entity

| Field | Type | Notes |
|---|---|---|
| `id` | string | UUID, primary key |
| `name` | string | |
| `slug` | string | |
| `description` | string \| null | |
| `ownerId` | string | UUID of the owning user |
| `ownerName` | string | denormalized display name of the owner, joined from `users` |
| `createdAt` | string | ISO 8601 timestamp |

Soft-deleted projects (`deleted_at IS NOT NULL`) are excluded from all listings.

### `contracts/projects-api.md` — new file

#### `GET /projects`

Protected — requires `Authorization: Bearer <token>`.

Returns all non-deleted projects across all users, newest first.

**Query params:**
- `cursor` (optional) — opaque string from a previous response's `nextCursor`. Omit for the first page.
- `limit` (optional) — page size, default `10`, max `50`. Values outside `[1, 50]` are a `400`.

**Success response — `200 OK`:**

```json
{
  "projects": [
    {
      "id": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
      "name": "Signal",
      "slug": "signal",
      "description": "A feedback aggregator",
      "ownerId": "a1b2c3d4-...",
      "ownerName": "Ada Lovelace",
      "createdAt": "2026-06-21T12:00:00Z"
    }
  ],
  "nextCursor": "<opaque string>"
}
```

`nextCursor` is `null` when there are no more pages.

**Error responses:**
- `400 Bad Request` — invalid `cursor` or `limit`: `{ "error": "invalid cursor" }` / `{ "error": "invalid limit" }`
- `401 Unauthorized` — missing/invalid/expired token: `{ "error": "unauthorized" }`

#### `GET /projects/mine`

Protected — requires `Authorization: Bearer <token>`. Same params, response shape, and errors as
`GET /projects`, but scoped to projects owned by the authenticated user (`ownerId == sub` claim).

#### Cursor encoding (implementation note, not part of the wire contract)

Opaque to clients. Server encodes as base64 of `"<createdAt RFC3339Nano>|<id>"` and decodes it back
to resume pagination after `(createdAt, id)` ordered `DESC`. Clients must treat it as an opaque
string and only pass back what they were given.

### `contracts/README.md`

Add `projects-api.md` to the Files list. Add `400 Bad Request` is already listed; no new status
codes needed (200, 400, 401 all already documented).

## signal-api

### Queries — `db/queries/projects.sql`

Two queries, `ListProjects` and `ListProjectsByOwner`:
- Join `projects p` to `users u ON u.id = p.owner_id` for `owner_name`.
- Filter `p.deleted_at IS NULL` (`ListProjectsByOwner` additionally filters `p.owner_id = $owner_id`).
- Cursor filter (nullable params, skip when null):
  ```sql
  AND (
    sqlc.narg('cursor_created_at') IS NULL
    OR p.created_at < sqlc.narg('cursor_created_at')
    OR (p.created_at = sqlc.narg('cursor_created_at') AND p.id < sqlc.narg('cursor_id'))
  )
  ```
- `ORDER BY p.created_at DESC, p.id DESC LIMIT $limit`.

### Handler — `internal/handlers/projects.go`

`ProjectHandler{ Queries *db.Queries }` with `List` and `ListMine`.

Shared logic:
- Parse `limit` query param: default `10`; if present must parse as int in `[1, 50]`, else `400`.
- Parse `cursor` query param if present: base64-decode, split on `|`, parse the timestamp with
  `time.RFC3339Nano` and keep the id string; any failure is a `400 { "error": "invalid cursor" }`.
- Call the sqlc query requesting `limit + 1` rows.
- If more than `limit` rows came back, trim to `limit` and set `nextCursor` from the last row in the
  trimmed slice (encode `createdAt|id` as base64); otherwise `nextCursor` is `null`.
- Map rows to a `projectResponse` slice (camelCase JSON tags, `description` as `*string`).
- `ListMine` additionally reads the user id via `auth.UserID(c)` (same pattern as `AuthHandler.Me`)
  and calls `ListProjectsByOwner`.

### Routing — `cmd/api/main.go`

```go
projects := r.Group("/projects")
projects.Use(auth.Middleware(authHandler.JWTSecret))
projects.GET("", projectHandler.List)
projects.GET("/mine", projectHandler.ListMine)
```

### Tests — `internal/handlers/projects_test.go`

Integration-style, following `auth_test.go`'s pattern (skip if `DB_URL` unset, truncate tables,
real Postgres via `pgxpool`):
- Empty list returns `{ "projects": [], "nextCursor": null }`.
- Seeding N projects across two users: `GET /projects` paginates through all of them across multiple
  requests using returned cursors, with no duplicates/gaps, and final page has `nextCursor: null`.
- `GET /projects/mine` only returns projects owned by the authenticated user.
- Invalid cursor and invalid limit both return `400`.
- Soft-deleted projects never appear in either listing.

## signal-web

### New dependencies

- `@tanstack/react-query` — infinite query state/caching.
- `@radix-ui/react-tabs` — tabs primitive, consistent with the existing Radix-based `ui/button.tsx`.

### `src/lib/api.ts`

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

export interface ProjectPage {
  projects: Project[]
  nextCursor: string | null
}

export function listProjects(params: { cursor?: string; limit?: number }): Promise<ProjectPage>
export function listMyProjects(params: { cursor?: string; limit?: number }): Promise<ProjectPage>
```

Both build a query string from the given params and call the shared `request<T>` helper against
`/projects` / `/projects/mine`.

### `src/main.tsx`

Wrap `<App />` in a `QueryClientProvider` (new `QueryClient` instance module-level).

### `src/components/ui/tabs.tsx`

Shadcn-style wrapper around `@radix-ui/react-tabs`: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`,
styled with Tailwind classes consistent with `button.tsx`/`input.tsx` (border/background/muted
tokens already in use).

### `src/components/projects/ProjectCard.tsx`

Presentational: renders `name`, `description` (or nothing if null), `ownerName`, formatted
`createdAt`.

### `src/components/projects/ProjectList.tsx`

```ts
interface ProjectListProps {
  scope: "all" | "mine"
}
```

- `useInfiniteQuery` with `queryKey: ["projects", scope]`, `queryFn` calling `listProjects` or
  `listMyProjects` based on `scope`, `getNextPageParam: (lastPage) => lastPage.nextCursor`,
  `initialPageParam: undefined`.
- Flattens `data.pages[].projects` and renders a `ProjectCard` per item.
- A sentinel `<div ref={sentinelRef} />` after the list, observed via `IntersectionObserver` (set up
  in a `useEffect`, cleaned up on unmount) that calls `fetchNextPage()` when intersecting and
  `hasNextPage && !isFetchingNextPage`.
- Renders a loading indicator while `isFetchingNextPage`, and an empty state when the first page
  loads with zero projects.

### `src/pages/MainPage.tsx`

Replace the placeholder `<main>` content with:

```tsx
<Tabs defaultValue="all">
  <TabsList>
    <TabsTrigger value="all">All projects</TabsTrigger>
    <TabsTrigger value="mine">My projects</TabsTrigger>
  </TabsList>
  <TabsContent value="all"><ProjectList scope="all" /></TabsContent>
  <TabsContent value="mine"><ProjectList scope="mine" /></TabsContent>
</Tabs>
```

### Tests

- `src/components/projects/ProjectList.test.tsx` — mock `@/lib/api`, verify: first page renders,
  scrolling the sentinel into view (mock `IntersectionObserver`) triggers a second fetch with the
  right cursor, `scope="mine"` calls `listMyProjects` not `listProjects`, empty state renders.
- `src/components/ui/tabs.test.tsx` — basic render/switch test, following existing `ui/` test style.

## Implementation split (parallel agents)

Contracts are written first (by the controller), since both workstreams depend on them but not on
each other's implementation:
1. **Agent A — signal-api**: `db/queries/projects.sql`, sqlc-generated code, `projects.go` handler,
   route wiring in `main.go`, `projects_test.go`.
2. **Agent B — signal-web**: add deps, `api.ts` additions, `ui/tabs.tsx`, `ProjectCard.tsx`,
   `ProjectList.tsx`, `MainPage.tsx` update, `main.tsx` provider wiring, tests.

## Out of scope

- Project creation/editing/deletion UI or routes (only listing).
- Search/filter/sort beyond the fixed newest-first order.
- Real-time updates to the list while open.