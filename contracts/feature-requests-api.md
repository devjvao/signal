# Feature Requests API

See `README.md` for base URL, auth header, error envelope, and status code conventions used
throughout this document. See `entities.md` for the `FeatureRequest` shape referenced below.

All routes are protected — they require `Authorization: Bearer <token>`.

`upvoteCount` and `viewerHasVoted` on any `FeatureRequest` in a response are always computed
relative to the authenticated user making the request.

## GET /projects/:id/feature-requests

Returns a project's non-deleted feature requests, ordered by `upvoteCount` descending, then
`createdAt` descending, then `id` descending (most-upvoted first; ties broken by newest first).

**Query params:**

- `cursor` (optional) — opaque string from a previous response's `nextCursor`. Omit for the first
  page. Clients must treat this as opaque and pass back exactly what they were given.
- `limit` (optional) — page size. Default `10`, max `50`. Values outside `1..50`, or non-integer
  values, are a `400`.

**Success response — `200 OK`:**

```json
{
  "featureRequests": [
    {
      "id": "d5e3f4a2-3c4d-6e5f-1a0b-9c8d7e6f5a4b",
      "projectId": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
      "title": "Dark mode",
      "description": "Add a dark color scheme",
      "status": "open",
      "createdBy": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
      "createdByName": "Ada Lovelace",
      "upvoteCount": 3,
      "viewerHasVoted": false,
      "createdAt": "2026-06-21T12:00:00Z"
    }
  ],
  "nextCursor": "<opaque string>"
}
```

`nextCursor` is `null` when there are no more pages.

Because `upvoteCount` is mutable, results can shift across pages if votes change while a client is
paginating. This is a known, accepted tradeoff.

**Error responses:**

- `400 Bad Request`:
  ```json
  { "error": "invalid project id" }
  ```
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
- `404 Not Found` — no active project with that id:
  ```json
  { "error": "project not found" }
  ```

## POST /projects/:id/feature-requests

Any authenticated user may create a feature request on any active project. The authenticated user
becomes the `createdBy` author. `status` is always created as `open`.

**Request body:**

```json
{
  "title": "Dark mode",
  "description": "Add a dark color scheme"
}
```

- `title` — required, non-empty, max 200 characters.
- `description` — optional, max 2000 characters.

**Success response — `201 Created`:**

```json
{
  "featureRequest": {
    "id": "d5e3f4a2-3c4d-6e5f-1a0b-9c8d7e6f5a4b",
    "projectId": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
    "title": "Dark mode",
    "description": "Add a dark color scheme",
    "status": "open",
    "createdBy": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "createdByName": "Ada Lovelace",
    "upvoteCount": 0,
    "viewerHasVoted": false,
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
- `404 Not Found` — no active project with that id:
  ```json
  { "error": "project not found" }
  ```

## PUT /feature-requests/:id

Update `title` and `description`. Author-only: the authenticated user must be the feature
request's `createdBy`. Only allowed while `upvoteCount` is currently `0`. If upvotes are later
removed back to `0`, editing becomes available again.

**Request body:** same shape and validation as create (`title` required, `description` optional).

**Success response — `200 OK`:**

```json
{
  "featureRequest": {
    "id": "d5e3f4a2-3c4d-6e5f-1a0b-9c8d7e6f5a4b",
    "projectId": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
    "title": "Dark mode toggle",
    "description": "Add a dark color scheme with a toggle in settings",
    "status": "open",
    "createdBy": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "createdByName": "Ada Lovelace",
    "upvoteCount": 0,
    "viewerHasVoted": false,
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID, or the request body fails validation:
  ```json
  { "error": "invalid feature request id" }
  ```
  ```json
  { "error": "<validation error message>" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is not the feature request's author:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active feature request with that id:
  ```json
  { "error": "feature request not found" }
  ```
- `409 Conflict` — the feature request has at least one upvote:
  ```json
  { "error": "feature request has upvotes" }
  ```

## PUT /feature-requests/:id/status

Update `status`. Project-owner-only: the authenticated user must be the owner of the feature
request's parent project (not the feature request's author, unless they're the same person).

**Request body:**

```json
{
  "status": "planned"
}
```

- `status` — required, must be one of `open`, `planned`, `in_progress`, `completed`, `rejected`.
  Any other value is a `400`.

**Success response — `200 OK`:** same shape as `PUT /feature-requests/:id`, with the updated
`status`.

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID, or `status` is missing/invalid:
  ```json
  { "error": "invalid feature request id" }
  ```
  ```json
  { "error": "invalid status" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is not the parent project's owner:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active feature request with that id:
  ```json
  { "error": "feature request not found" }
  ```

## DELETE /feature-requests/:id

Soft-deletes the feature request (sets `deleted_at`); it is excluded from all subsequent lookups
and listings. Allowed for the feature request's author **or** the parent project's owner.

**Success response — `204 No Content`** (empty body).

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID:
  ```json
  { "error": "invalid feature request id" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is neither the author nor the project owner:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active feature request with that id:
  ```json
  { "error": "feature request not found" }
  ```

## POST /feature-requests/:id/vote

Adds the authenticated user's upvote. The feature request's author cannot upvote their own
request. Idempotent — if the authenticated user already has an active vote, this returns the
current state without creating a duplicate.

**Success response — `200 OK`:** same shape as `PUT /feature-requests/:id`, with
`viewerHasVoted: true` and `upvoteCount` reflecting the new total.

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID:
  ```json
  { "error": "invalid feature request id" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `403 Forbidden` — authenticated user is the feature request's author:
  ```json
  { "error": "forbidden" }
  ```
- `404 Not Found` — no active feature request with that id:
  ```json
  { "error": "feature request not found" }
  ```

## DELETE /feature-requests/:id/vote

Removes the authenticated user's upvote. Idempotent — if the authenticated user has no active
vote, this returns the current state without error.

**Success response — `200 OK`:** same shape as `PUT /feature-requests/:id`, with
`viewerHasVoted: false` and `upvoteCount` reflecting the new total.

**Error responses:**

- `400 Bad Request` — `:id` is not a valid UUID:
  ```json
  { "error": "invalid feature request id" }
  ```
- `401 Unauthorized` — missing/invalid/expired token:
  ```json
  { "error": "unauthorized" }
  ```
- `404 Not Found` — no active feature request with that id:
  ```json
  { "error": "feature request not found" }
  ```