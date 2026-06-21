# signal-api

Go backend for Signal — authentication and feature voting. Powered by gin, sqlc, and golang-migrate.

## Prerequisites

- Go 1.23+
- Docker (for local PostgreSQL via docker-compose at repo root)
- sqlc CLI: `go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest`
- golang-migrate CLI: `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest`
- Make (Linux/macOS) or run commands manually on Windows

## Setup

1. Copy env file:
   ```bash
   cp .env.example .env
   ```

2. Start PostgreSQL (from repo root):
   ```bash
   docker compose up -d
   ```

## Run

```bash
go run ./cmd/api
# or: make run
```

Server starts on `http://localhost:8080`.

Verify:
```bash
curl http://localhost:8080/health
# {"status":"ok"}
```

## Development

| Task | Command |
|---|---|
| Run server | `make run` |
| Run tests | `go test ./...` |
| Apply DB migrations | `DB_URL=<url> make migrate-up` |
| Generate sqlc code | `make sqlc-gen` |
