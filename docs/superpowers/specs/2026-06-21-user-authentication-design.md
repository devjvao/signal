# User Authentication — Design Spec

Date: 2026-06-21

## Summary

Add a full-stack registration/login feature to the Signal monorepo. `signal-api` (Go/Gin/Postgres)
gains two unauthenticated routes (register, login) and one protected example route (`/auth/me`),
plus an authentication middleware that will guard all future non-auth routes. `signal-web`
(React/Vite) gains a login page, a registration page, an auth context, and a route guard on the
main page that redirects unauthenticated visitors to `/login`.

Both projects are implemented independently and in parallel (via the dispatching-parallel-agents
skill), coordinated only through a new root-level `contracts/` folder that is the single source of
truth for the User entity shape and the three auth routes.

## Architecture

- **Auth mechanism:** JWT Bearer token. The API signs a JWT on login. Claims: `sub` (user id),
  `email`, `iat`, `exp`. The frontend stores the token in `localStorage` and sends
  `Authorization: Bearer <token>` on every authenticated request. No cookies, no CORS-credentials
  configuration needed.
- **Token lifetime:** a single access token, 7-day expiry. No refresh token, no refresh endpoint,
  no server-side revocation in this version. Expiry just means the user logs in again.
- **Password hashing:** bcrypt (`golang.org/x/crypto/bcrypt`, default cost factor).
- **Server-side validation:** Gin's built-in binding tags (`binding:"required,email"`,
  `binding:"required,min=8"`), backed by `go-playground/validator`, already a transitive
  dependency of Gin — no new package required.
- **Client-side validation:** mirrors the server rules in the form components (required fields,
  email format, password minimum length) purely for UX; the server remains authoritative.
- **Routes:**
  - `POST /auth/register` — public
  - `POST /auth/login` — public
  - `GET /auth/me` — protected; the one concrete example of the auth-guard middleware today, and
    used by the frontend to validate a stored token on load
- **Registration does not log the user in.** It returns the created user (no token). The frontend
  redirects to `/login` afterward.
- **Logout** is client-only: clear the stored token and redirect to `/login`. There is nothing to
  revoke server-side since tokens are stateless.
- **Error envelope:** every non-2xx response body is `{"error": "<message>"}`.
- **Status codes:** 201 register success · 200 login/me success · 400 validation failure · 401 bad
  credentials or missing/invalid/expired token · 409 email already registered · 500 unexpected
  server error.

## Contracts folder

A new root-level `contracts/` folder is the shared, read-only source of truth for both subagents:

```
contracts/
├── README.md     — conventions: base URL placeholder, Authorization header format, error envelope
│                    shape, status-code meanings, JSON field casing (camelCase)
├── entities.md    — User entity: field name, type, notes
│                    (id: uuid, name: string, email: string unique, createdAt: ISO 8601 string;
│                    password_hash and deleted_at are server-internal and never serialized)
└── auth-api.md    — one section per route, each with: method + path, auth requirement, request
                      JSON example, success response JSON example, and the specific error
                      statuses/bodies it can return
```

Both the signal-api and signal-web subagents treat `contracts/` as ground truth. If either finds
the contract ambiguous or insufficient, they stop and report back rather than silently resolving it
on their own.

### Route contracts (content to be written into `contracts/auth-api.md`)

**POST /auth/register** — public
- Request: `{"name": "Ada Lovelace", "email": "ada@example.com", "password": "correct-horse"}`
- 201 response: `{"user": {"id": "...", "name": "Ada Lovelace", "email": "ada@example.com", "createdAt": "2026-06-21T12:00:00Z"}}`
- Errors: 400 (validation), 409 (email already registered)

**POST /auth/login** — public
- Request: `{"email": "ada@example.com", "password": "correct-horse"}`
- 200 response: `{"token": "<jwt>", "user": {"id": "...", "name": "Ada Lovelace", "email": "ada@example.com", "createdAt": "..."}}`
- Errors: 400 (validation), 401 (invalid email/password — same message for both cases, to avoid
  leaking which part was wrong)

**GET /auth/me** — protected (`Authorization: Bearer <token>`)
- 200 response: `{"user": {"id": "...", "name": "...", "email": "...", "createdAt": "..."}}`
- Errors: 401 (missing, malformed, invalid, or expired token)

## signal-api implementation

**New dependencies:** `github.com/golang-jwt/jwt/v5`; `golang.org/x/crypto/bcrypt` (promotes the
already-indirect `x/crypto` to a direct dependency); `github.com/jackc/pgx/v5/pgxpool` (nothing
currently opens a DB connection — `sqlc.yaml` is already configured for `pgx/v5` output).

**New/changed files:**
- `db/queries/users.sql` — sqlc queries: `CreateUser`, `GetUserByEmail`, `GetUserByID` (all
  excluding soft-deleted rows via `WHERE deleted_at IS NULL`)
- `internal/config/config.go` — loads `PORT`, `DB_URL`, `JWT_SECRET` from env
- `.env.example` — add `JWT_SECRET`
- `internal/auth/password.go` — `HashPassword`, `CheckPassword`
- `internal/auth/jwt.go` — `GenerateToken(userID, email string) (string, error)`,
  `ParseToken(token string) (*Claims, error)`
- `internal/auth/middleware.go` — Gin middleware reading `Authorization: Bearer <token>`; on
  success stores the user id in the Gin context; on failure aborts with 401 and the standard error
  envelope
- `internal/handlers/auth.go` — `Register`, `Login`, `Me` handlers
- `cmd/api/main.go` — opens the pgx pool, wires `setupRouter` with a public route group
  (`/auth/register`, `/auth/login`) and a protected group using the middleware (`/auth/me`)

`sqlc generate` is run to produce `internal/db` from the new queries before the handlers are wired
up.

**Testing:**
- Unit tests for `password.go` and `jwt.go` — pure functions, no DB.
- Handler tests for register/login/me run against a real Postgres instance (same
  `postgres:16-alpine` pattern already used in `.github/workflows/ci.yml`), migrations applied,
  exercised via `httptest`. Covers: successful register, duplicate-email conflict, successful
  login, wrong-password login, `/me` with a valid token, `/me` with a missing/invalid token.

## signal-web implementation

**New dependencies:** `react-router-dom` (runtime); `vitest`, `@testing-library/react`,
`@testing-library/jest-dom`, `jsdom` (dev, test tooling — none of this exists yet in
`signal-web/package.json`).

**New/changed files:**
- `src/lib/api.ts` — fetch wrapper; base URL from `import.meta.env.VITE_API_URL` (new
  `signal-web/.env.example` entry, default `http://localhost:8080`); attaches the `Authorization`
  header when a token is present; throws a typed error parsed from the `{"error": "..."}` envelope
  on non-2xx responses
- `src/context/AuthContext.tsx` — `AuthProvider` holding `user`, `token`, and `status`
  (`"loading" | "authenticated" | "unauthenticated"`); on mount, if a token exists in
  `localStorage`, calls `GET /auth/me` to validate/hydrate, clearing the token on a 401. Exposes
  `login()`, `register()`, `logout()`
- `src/components/auth/ProtectedRoute.tsx` — renders nothing while `status === "loading"`;
  redirects to `/login` via `<Navigate>` when `unauthenticated`; otherwise renders its children
- `src/pages/LoginPage.tsx` — email/password form; calls `login()`; navigates to `/` on success;
  includes a "Register" button linking to `/register`
- `src/pages/RegisterPage.tsx` — name/email/password form; calls `register()`; navigates to
  `/login` on success
- `src/pages/MainPage.tsx` — current landing content (Logo + heading), extended to show the
  logged-in user's name/email and a logout button that calls `logout()` and navigates to `/login`
- `src/components/ui/input.tsx`, `src/components/ui/label.tsx` — minimal shadcn-style primitives
  (only `button.tsx` exists today), needed by the two forms
- `src/main.tsx` — wraps `App` in `BrowserRouter` and `AuthProvider`
- `src/App.tsx` — becomes the route table: `/` → `ProtectedRoute` wrapping `MainPage`, `/login` →
  `LoginPage`, `/register` → `RegisterPage`

**Testing:** vitest unit tests for `AuthContext` (login/register/logout state transitions,
localStorage persistence, `/auth/me` hydration and clear-on-401 behavior) and for
`ProtectedRoute`'s redirect behavior. No full-page UI tests in this version.

## Out of scope (explicitly deferred)

- Refresh tokens / token rotation / server-side session revocation
- Password reset / forgot-password flow
- Email verification
- Rate limiting on auth routes
- Full-page UI tests for signal-web (component-level only)