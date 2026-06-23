# Signal

Signal is a feature-request and voting platform. Users register, create projects, submit feature
requests, and vote on the ones that matter most. The repository is a polyrepo with two independently
deployable services:

- **`signal-api/`** — Go (Gin) REST API with JWT auth, backed by PostgreSQL (sqlc + golang-migrate).
- **`signal-web/`** — React (Vite + TypeScript) single-page app styled with Tailwind CSS and shadcn/ui.

## Requirements

| Tool | Version | Used by |
|---|---|---|
| Go | 1.23+ (repo builds on 1.26) | `signal-api` |
| Node.js | 20+ | `signal-web` |
| npm | 10+ | `signal-web` |
| Docker | any recent | local PostgreSQL via `docker-compose.yml` |
| sqlc CLI | latest | `signal-api` (codegen) |
| golang-migrate CLI | latest | `signal-api` (DB migrations) |

Install the Go CLIs once:

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```

## How to install dependencies

**Backend (`signal-api`):**

```bash
cd signal-api
go mod download
```

**Frontend (`signal-web`):**

```bash
cd signal-web
npm install
```

## How to build

**Backend** — compile the API binary:

```bash
cd signal-api
go build -o api ./cmd/api
```

**Frontend** — type-check and produce the production bundle in `dist/`:

```bash
cd signal-web
npm run build
```

## How to run

**1. Start PostgreSQL** (from the repo root):

```bash
docker compose up -d
```

**2. Run the backend** (`signal-api`):

```bash
cd signal-api
cp .env.example .env          # then adjust values as needed
migrate -path db/migrations -database "$DB_URL" up   # apply migrations (or: DB_URL=<url> make migrate-up)
go run ./cmd/api              # or: make run
```

The API listens on `http://localhost:8080`. Verify it:

```bash
curl http://localhost:8080/health   # {"status":"ok"}
```

Backend environment variables (see `signal-api/.env.example`): `PORT` (default `8080`), `DB_URL`
(required), `JWT_SECRET` (required), `WEB_ORIGIN` (allowed CORS origin, default `http://localhost:5173`).

**3. Run the frontend** (`signal-web`):

```bash
cd signal-web
cp .env.example .env          # set VITE_API_URL to the API URL (default http://localhost:8080)
npm run dev
```

The app is served at `http://localhost:5173`.

## How to test

**Backend** — runs against a PostgreSQL instance (`DB_URL` must be set):

```bash
cd signal-api
go test ./...
```

**Frontend** — Vitest unit/component tests:

```bash
cd signal-web
npm run test
```
