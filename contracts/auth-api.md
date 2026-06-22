# Auth API

See `README.md` for base URL, auth header, error envelope, and status code conventions used
throughout this document. See `entities.md` for the `User` shape referenced below.

## POST /auth/register

Public — no `Authorization` header required.

Creates a new user account. Does **not** log the user in (no token is returned) — the client is
expected to redirect to the login page afterward.

**Request body:**

```json
{
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "password": "correct-horse-battery"
}
```

Validation: `name` required non-empty; `email` required, must be a valid email format; `password`
required, minimum 8 characters.

**Success response — `201 Created`:**

```json
{
  "user": {
    "id": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `400 Bad Request` — a field failed validation, e.g.:
  ```json
  { "error": "email is required" }
  ```
- `409 Conflict` — the email is already registered to an active user:
  ```json
  { "error": "email is already registered" }
  ```

## POST /auth/login

Public — no `Authorization` header required.

**Request body:**

```json
{
  "email": "ada@example.com",
  "password": "correct-horse-battery"
}
```

Validation: both fields required non-empty.

**Success response — `200 OK`:**

```json
{
  "token": "<jwt>",
  "user": {
    "id": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

The `token` is a JWT with claims `sub` (user id), `email`, `iat`, and `exp` (7 days from issue).
Send it back as `Authorization: Bearer <token>` on subsequent requests.

**Error responses:**

- `400 Bad Request` — a field failed validation:
  ```json
  { "error": "password is required" }
  ```
- `401 Unauthorized` — email not found, or password doesn't match. Use the same message for both
  cases so the client can't tell which one was wrong:
  ```json
  { "error": "invalid email or password" }
  ```

## GET /auth/me

Protected — requires `Authorization: Bearer <token>`.

Returns the current user for the given token. Used by the frontend to validate a stored token on
load, and serves as the reference example of a route guarded by the auth middleware.

**Success response — `200 OK`:**

```json
{
  "user": {
    "id": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "createdAt": "2026-06-21T12:00:00Z"
  }
}
```

**Error responses:**

- `401 Unauthorized` — header missing, malformed, token invalid/expired, or the user it refers to
  no longer exists (soft-deleted):
  ```json
  { "error": "unauthorized" }
  ```