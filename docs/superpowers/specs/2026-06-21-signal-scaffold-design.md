# Signal — Project Scaffold Design

**Date:** 2026-06-21
**Scope:** Initial scaffold for `signal-api` and `signal-web` with minimum runnable code.

---

## Overview

Signal is a product with authentication and a feature voting system. This spec covers only the scaffold phase: both projects must compile, run, and prove their respective dependency chains work. No auth or voting logic is implemented yet.

---

## Repository Layout

```
signal/                          ← git root (D:\Lab\signal)
├── docker-compose.yml
├── signal-api/
└── signal-web/
```

Both projects are subdirectories of the same monorepo.

---

## docker-compose.yml

- Single service: `postgres:16-alpine`
- Port: `5432:5432`
- Credentials: `POSTGRES_USER=signal`, `POSTGRES_PASSWORD=signal`, `POSTGRES_DB=signal`
- Named volume for data persistence across restarts

---

## signal-api

**Stack:** Go 1.23+ · gin · sqlc · golang-migrate

### Directory structure

```
signal-api/
├── cmd/
│   └── api/
│       └── main.go            ← server entrypoint
├── internal/
│   └── db/                    ← sqlc-generated code (empty now)
├── db/
│   ├── migrations/            ← golang-migrate SQL files (empty now)
│   └── queries/               ← sqlc .sql query files (empty now)
├── sqlc.yaml                  ← sqlc config pointing at db/
├── .env.example               ← DB_URL, PORT
├── Makefile                   ← run, migrate-up, sqlc-gen targets
├── go.mod                     ← module: signal-api
└── README.md
```

### Minimum running code

`main.go` starts a gin server on the port from the `PORT` env var (default `8080`) and registers one route:

```
GET /health  →  {"status": "ok"}
```

No database connection is wired at scaffold stage. The DB placeholder is in `.env.example` only.

### Makefile targets

| Target | Command |
|---|---|
| `run` | `go run ./cmd/api` |
| `migrate-up` | `migrate -path db/migrations -database $DB_URL up` |
| `sqlc-gen` | `sqlc generate` |

---

## signal-web

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS v3 · shadcn/ui

### Directory structure

```
signal-web/
├── src/
│   ├── components/
│   │   └── ui/                ← shadcn components (Button added at init)
│   ├── App.tsx                ← renders shadcn Button to verify full chain
│   ├── index.css              ← Tailwind directives + shadcn CSS vars
│   └── main.tsx
├── components.json            ← shadcn config (style: default, baseColor: slate)
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
├── tsconfig.node.json
├── package.json
└── README.md
```

### Minimum running code

`App.tsx` renders a centered page with the Signal logo/name and a shadcn `Button` labeled "Get Started". This verifies Vite, Tailwind, and shadcn all work together.

Dev server runs on `http://localhost:5173`.

---

## Success Criteria

- `docker compose up -d` starts PostgreSQL without errors.
- `go run ./cmd/api` (inside `signal-api/`) starts gin on `:8080`; `GET /health` returns `200 {"status":"ok"}`.
- `npm run dev` (inside `signal-web/`) starts Vite on `:5173` with no TypeScript or build errors; page renders a shadcn Button.

---

## Out of Scope (next phases)

- Authentication (JWT / sessions)
- Feature voting data model and API
- DB connection in the API
- Deployment / CI configuration