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