# API Contracts

This folder is the shared source of truth for the Signal API surface. Both `signal-api`
(implementation) and `signal-web` (consumer) must conform to what's documented here.

If a contract here is ambiguous or insufficient for an implementation task, stop and report it
back rather than silently resolving it on your own — these files are read-only ground truth, not
a starting draft.

## Conventions

- **Base URL:** the API is served from a single base URL (e.g. `http://localhost:8080` in
  development). All paths below are relative to it.
- **Authentication:** protected routes require an `Authorization: Bearer <token>` header. The
  token is the JWT returned by `POST /auth/login`.
- **JSON field casing:** all request and response JSON uses `camelCase` keys. Go structs map to
  this via explicit `json:"..."` tags (e.g. a `created_at` database column serializes as
  `createdAt`).
- **Error envelope:** every non-2xx response body has the shape:

  ```json
  { "error": "human readable message" }
  ```

- **Status codes used in this feature:**
  - `200 OK` — successful login or read
  - `201 Created` — successful registration or project creation
  - `204 No Content` — successful project deletion
  - `400 Bad Request` — request body failed validation (missing/malformed fields), or a malformed
    path parameter (e.g. an invalid project id)
  - `401 Unauthorized` — bad login credentials, or a missing/malformed/invalid/expired token
  - `403 Forbidden` — authenticated user is not the resource's owner
  - `404 Not Found` — no active resource with that id
  - `409 Conflict` — registration with an email that's already registered, or attempting to edit
    a feature request that already has upvotes
  - `500 Internal Server Error` — unexpected server error

## Files

- `entities.md` — shared data shapes (e.g. the User, Project, and FeatureRequest entities)
- `auth-api.md` — authentication routes: register, login, current-user
- `projects-api.md` — project routes: listing, get-by-id, create, update, delete
- `feature-requests-api.md` — feature request routes: listing, create, update, status, delete,
  voting
