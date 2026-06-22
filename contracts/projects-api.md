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

## GET /projects/:id

Protected — requires `Authorization: Bearer <token>`.

Returns a single active project by id.

**Success response — `200 OK`:**

```json
{
  "project": {
    "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
    "name": "Signal",
    "slug": "signal",
    "description": "A feedback aggregator",
    "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "ownerName": "Ada Lovelace",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID:
  ```json
  { "error": "invalid project id" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `404 Not Found` — no active project with that id:
  ```json
  { "error": "project not found" }
  ```

## POST /projects

Protected — requires `Authorization: Bearer <token>`. The authenticated user becomes the project's
owner.

**Request body:**

```json
{
  "name": "Signal",
  "description": "A feedback aggregator"
}
```

- `name` — required, non-empty, max 200 characters.
- `description` — optional, max 2000 characters.

The `slug` is server-generated from `name` (lowercased, non-alphanumeric runs collapsed to a single
`-`, leading/trailing `-` trimmed; falls back to `project` if that yields an empty string). If the
slug collides with an existing active project, a random suffix is appended and creation is retried.

**Success response — `201 Created`:**

```json
{
  "project": {
    "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
    "name": "Signal",
    "slug": "signal",
    "description": "A feedback aggregator",
    "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "ownerName": "Ada Lovelace",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `400 Bad Request` — validation failure (missing/too-long `name`, or `description` over 2000
  characters):
  ```json
  { "error": "<validation error message>" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```

## PUT /projects/:id

Protected — requires `Authorization: Bearer <token>`. Owner-only: the authenticated user must be
the project's `ownerId`. The `slug` is immutable and not affected by this route.

**Request body:** same shape and validation as `POST /projects` (`name` required, `description`
optional).

**Success response — `200 OK`:**

```json
{
  "project": {
    "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
    "name": "Signal",
    "slug": "signal",
    "description": "A feedback aggregator",
    "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "ownerName": "Ada Lovelace",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID, or the request body fails validation:
  ```json
  { "error": "invalid project id" }
  ```
  ```json
  { "error": "<validation error message>" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is not the project's owner:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active project with that id:
  ```json
  { "error": "project not found" }
  ```

## DELETE /projects/:id

Protected — requires `Authorization: Bearer <token>`. Owner-only: the authenticated user must be
the project's `ownerId`. Soft-deletes the project (sets `deleted_at`); it is excluded from all
subsequent lookups and listings.

**Success response — `204 No Content`** (empty body).

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID:
  ```json
  { "error": "invalid project id" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is not the project's owner:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active project with that id:
  ```json
  { "error": "project not found" }
  ```