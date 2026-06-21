# Signal Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold `signal-api` (Go/gin) and `signal-web` (React/Vite/shadcn) inside the `signal` monorepo with minimum runnable code that proves all dependency chains work.

**Architecture:** Two subdirectories in the `signal` monorepo. `signal-api` exposes `GET /health` via gin on `:8080`. `signal-web` renders a shadcn Button on `:5173` via Vite. A root `docker-compose.yml` provides PostgreSQL 16 for local development.

**Tech Stack:** Go 1.23+, gin, sqlc (CLI tool), golang-migrate (CLI tool), PostgreSQL 16, React 18, TypeScript, Vite, Tailwind CSS v3, shadcn/ui

---

## File Map

```
signal/
├── docker-compose.yml                          ← new
├── signal-api/
│   ├── cmd/api/
│   │   ├── main.go                             ← new
│   │   └── main_test.go                        ← new
│   ├── internal/db/.gitkeep                    ← new (empty, for sqlc output)
│   ├── db/
│   │   ├── migrations/.gitkeep                 ← new
│   │   └── queries/.gitkeep                    ← new
│   ├── sqlc.yaml                               ← new
│   ├── .env.example                            ← new
│   ├── Makefile                                ← new
│   ├── go.mod                                  ← new
│   ├── go.sum                                  ← auto-generated
│   └── README.md                               ← new
└── signal-web/
    ├── src/
    │   ├── components/ui/button.tsx            ← new (via shadcn add)
    │   ├── lib/utils.ts                        ← new (via shadcn init)
    │   ├── App.tsx                             ← modified
    │   ├── main.tsx                            ← unchanged
    │   └── index.css                           ← modified (Tailwind + shadcn vars)
    ├── components.json                         ← new (via shadcn init)
    ├── tailwind.config.js                      ← new (via tailwind init, modified by shadcn)
    ├── postcss.config.js                       ← new (via tailwind init)
    ├── vite.config.ts                          ← modified (path alias)
    ├── tsconfig.app.json                       ← modified (path alias)
    ├── package.json                            ← modified (new deps)
    └── README.md                               ← new
```

---

## Task 1: Root docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml at repo root**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: signal
      POSTGRES_PASSWORD: signal
      POSTGRES_DB: signal
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 2: Start and verify**

Run from `D:\Lab\signal`:
```bash
docker compose up -d
docker compose ps
```

Expected: one running container with `0.0.0.0:5432->5432/tcp`.

- [ ] **Step 3: Stop and commit**

```bash
docker compose down
git add docker-compose.yml
git commit -m "feat: add docker-compose for local PostgreSQL"
```

---

## Task 2: signal-api — Go module and gin dependency

**Files:**
- Create: `signal-api/go.mod`
- Create: `signal-api/go.sum` (auto-generated)
- Create: `signal-api/internal/db/.gitkeep`
- Create: `signal-api/db/migrations/.gitkeep`
- Create: `signal-api/db/queries/.gitkeep`

- [ ] **Step 1: Create directory tree**

Run from `D:\Lab\signal`:
```bash
mkdir -p signal-api/cmd/api
mkdir -p signal-api/internal/db
mkdir -p signal-api/db/migrations
mkdir -p signal-api/db/queries
```

- [ ] **Step 2: Initialize Go module**

Run from `signal-api/`:
```bash
go mod init signal-api
```

Expected: `go.mod` created with `module signal-api` and the current Go version.

- [ ] **Step 3: Install gin**

Run from `signal-api/`:
```bash
go get github.com/gin-gonic/gin
go mod tidy
```

Expected: `go.mod` has `require github.com/gin-gonic/gin v1.x.x`; `go.sum` generated.

- [ ] **Step 4: Create .gitkeep files for empty directories**

Create three empty files:
- `signal-api/internal/db/.gitkeep`
- `signal-api/db/migrations/.gitkeep`
- `signal-api/db/queries/.gitkeep`

Each file is empty (zero bytes). Git won't track empty directories without these.

---

## Task 3: signal-api — Config files

**Files:**
- Create: `signal-api/sqlc.yaml`
- Create: `signal-api/.env.example`
- Create: `signal-api/Makefile`

- [ ] **Step 1: Create sqlc.yaml**

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "db/queries"
    schema: "db/migrations"
    gen:
      go:
        package: "db"
        out: "internal/db"
        sql_package: "pgx/v5"
```

- [ ] **Step 2: Create .env.example**

```
PORT=8080
DB_URL=postgres://signal:signal@localhost:5432/signal?sslmode=disable
```

- [ ] **Step 3: Create Makefile**

```makefile
.PHONY: run migrate-up migrate-down sqlc-gen

run:
	go run ./cmd/api

migrate-up:
	migrate -path db/migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path db/migrations -database "$(DB_URL)" down 1

sqlc-gen:
	sqlc generate
```

> Note: Makefile targets use tab indentation (not spaces). Ensure your editor doesn't convert them.

- [ ] **Step 4: Commit**

Run from `D:\Lab\signal`:
```bash
git add signal-api/
git commit -m "feat: scaffold signal-api module and config files"
```

---

## Task 4: signal-api — /health endpoint (TDD)

**Files:**
- Create: `signal-api/cmd/api/main_test.go`
- Create: `signal-api/cmd/api/main.go`

- [ ] **Step 1: Write the failing test**

Create `signal-api/cmd/api/main_test.go`:
```go
package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestHealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/health", nil)
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to parse response body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf(`expected body {"status":"ok"}, got %v`, body)
	}
}
```

- [ ] **Step 2: Run test — expect compile failure**

Run from `signal-api/`:
```bash
go test ./cmd/api/...
```

Expected:
```
./cmd/api/main_test.go:14:7: undefined: setupRouter
FAIL    signal-api/cmd/api [build failed]
```

- [ ] **Step 3: Write main.go**

Create `signal-api/cmd/api/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

func setupRouter() *gin.Engine {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	return r
}

func main() {
	r := setupRouter()
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if err := r.Run(":" + port); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 4: Run test — expect PASS**

Run from `signal-api/`:
```bash
go test ./cmd/api/...
```

Expected:
```
ok      signal-api/cmd/api    0.XXXs
```

- [ ] **Step 5: Smoke test the running server**

In terminal 1, run from `signal-api/`:
```bash
go run ./cmd/api
```

In terminal 2:
```bash
curl http://localhost:8080/health
```

Expected: `{"status":"ok"}`

Stop server with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add signal-api/cmd/api/
git commit -m "feat: add signal-api /health endpoint"
```

---

## Task 5: signal-api — README

**Files:**
- Create: `signal-api/README.md`

- [ ] **Step 1: Write README**

Create `signal-api/README.md`:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add signal-api/README.md
git commit -m "docs: add signal-api README"
```

---

## Task 6: signal-web — Vite scaffold with React + TypeScript

**Files:**
- Create: `signal-web/` (all Vite-generated files)

- [ ] **Step 1: Scaffold the Vite project**

Run from `D:\Lab\signal`:
```bash
npm create vite@latest signal-web -- --template react-ts
```

Expected: `signal-web/` directory with `src/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`.

- [ ] **Step 2: Install dependencies**

Run from `signal-web/`:
```bash
cd signal-web
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Verify dev server starts**

Run from `signal-web/`:
```bash
npm run dev
```

Expected output includes: `VITE v5.x ready in XXXms` and `Local: http://localhost:5173/`

Open browser at `http://localhost:5173` — default Vite + React page loads. Stop with Ctrl+C.

- [ ] **Step 4: Commit**

Run from `D:\Lab\signal`:
```bash
git add signal-web/
git commit -m "feat: scaffold signal-web with Vite + React + TypeScript"
```

---

## Task 7: signal-web — Tailwind CSS

**Files:**
- Create: `signal-web/tailwind.config.js`
- Create: `signal-web/postcss.config.js`
- Modify: `signal-web/src/index.css`

- [ ] **Step 1: Install Tailwind and peer dependencies**

Run from `signal-web/`:
```bash
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

Expected: `tailwind.config.js` and `postcss.config.js` created.

- [ ] **Step 2: Configure content paths in tailwind.config.js**

Replace `signal-web/tailwind.config.js` with:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

- [ ] **Step 3: Add Tailwind directives to index.css**

Replace the full contents of `signal-web/src/index.css` with:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run from `signal-web/`:
```bash
npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add signal-web/tailwind.config.js signal-web/postcss.config.js signal-web/src/index.css
git commit -m "feat: add Tailwind CSS to signal-web"
```

---

## Task 8: signal-web — Path aliases and shadcn/ui

**Files:**
- Modify: `signal-web/tsconfig.app.json`
- Modify: `signal-web/vite.config.ts`
- Create: `signal-web/components.json` (via shadcn init)
- Create: `signal-web/src/lib/utils.ts` (via shadcn init)
- Create: `signal-web/src/components/ui/button.tsx` (via shadcn add)

shadcn/ui requires `@/*` path aliases in both TypeScript and Vite configs.

- [ ] **Step 1: Install @types/node**

Run from `signal-web/`:
```bash
npm install -D @types/node
```

- [ ] **Step 2: Add path alias to tsconfig.app.json**

Open `signal-web/tsconfig.app.json`. Add the two keys `"baseUrl"` and `"paths"` inside `compilerOptions` (keep all existing keys):

```json
{
  "compilerOptions": {
    ...existing keys unchanged...,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Update vite.config.ts with path alias**

Replace `signal-web/vite.config.ts`:
```ts
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
```

- [ ] **Step 4: Verify TypeScript still compiles**

Run from `signal-web/`:
```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 5: Initialize shadcn/ui**

Run from `signal-web/`:
```bash
npx shadcn@latest init
```

When prompted, answer as follows (accept defaults where they match):

| Prompt | Answer |
|---|---|
| Which style? | **Default** |
| Which base color? | **Slate** |
| Where is your global CSS file? | **src/index.css** |
| Use CSS variables for colors? | **Yes** |
| Custom tailwind prefix? | *(leave blank, press Enter)* |
| Import alias for components | **@/components** |
| Import alias for utils | **@/lib/utils** |
| Using React Server Components? | **No** |
| Write config to components.json? | **Yes** |

Expected: `components.json` created; `src/lib/utils.ts` created; `src/index.css` updated with shadcn CSS variable block; `tailwind.config.js` updated with `darkMode: ["class"]` and extended theme colors.

- [ ] **Step 6: Add the Button component**

Run from `signal-web/`:
```bash
npx shadcn@latest add button
```

Expected: `src/components/ui/button.tsx` created; `class-variance-authority` and `lucide-react` installed.

- [ ] **Step 7: Verify TypeScript compiles**

Run from `signal-web/`:
```bash
npx tsc --noEmit
```

Expected: no output.

- [ ] **Step 8: Commit**

Run from `D:\Lab\signal`:
```bash
git add signal-web/
git commit -m "feat: add shadcn/ui with Button component to signal-web"
```

---

## Task 9: signal-web — App.tsx, README, and final verification

**Files:**
- Modify: `signal-web/src/App.tsx`
- Delete: `signal-web/src/App.css`
- Create: `signal-web/README.md`

- [ ] **Step 1: Replace App.tsx**

Replace `signal-web/src/App.tsx` entirely:
```tsx
import { Button } from "@/components/ui/button"

export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold tracking-tight">Signal</h1>
      <Button>Get Started</Button>
    </main>
  )
}
```

- [ ] **Step 2: Delete App.css**

Delete `signal-web/src/App.css`. The default Vite scaffold imports it from `App.tsx`; our new `App.tsx` uses Tailwind and does not import it.

- [ ] **Step 3: Write README**

Create `signal-web/README.md`:

````markdown
# signal-web

React frontend for Signal — authentication and feature voting. Powered by Vite, Tailwind CSS, and shadcn/ui.

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

App starts on `http://localhost:5173`.

## Build

```bash
npm run build
```

## Add shadcn components

```bash
npx shadcn@latest add <component-name>
```

Browse available components at https://ui.shadcn.com/docs/components
````

- [ ] **Step 4: Production build verification**

Run from `signal-web/`:
```bash
npm run build
```

Expected: no TypeScript errors; `dist/` created with `index.html` and hashed JS/CSS bundles.

- [ ] **Step 5: Final smoke test**

Run from `signal-web/`:
```bash
npm run dev
```

Open `http://localhost:5173`. Verify:
- "Signal" heading is visible
- "Get Started" shadcn Button is rendered and styled

Stop server with Ctrl+C.

- [ ] **Step 6: Final commit**

Run from `D:\Lab\signal`:
```bash
git add signal-web/
git commit -m "feat: complete signal-web scaffold with App, shadcn Button, and README"
```
