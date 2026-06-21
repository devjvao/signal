# Signal Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the PostgreSQL schema (users, projects, feature_requests, votes) as golang-migrate migrations in `signal-api`, verified against a real Postgres instance.

**Architecture:** One golang-migrate up/down pair per table, plus one pair for a shared `set_updated_at()` trigger function, applied in order against the existing `docker-compose.yml` Postgres service. Each migration is verified by applying it, inspecting the resulting schema via `psql` against `pg_catalog`/`information_schema`, exercising constraints with real INSERT/UPDATE/DELETE statements, then reverting and re-applying.

**Tech Stack:** PostgreSQL 16 (`postgres:16-alpine` via root `docker-compose.yml`), golang-migrate CLI, `psql` (via `docker compose exec`).

## Global Constraints

- DB connection string (from `signal-api/.env.example`): `postgres://signal:signal@localhost:5432/signal?sslmode=disable`
- Postgres service name in `docker-compose.yml`: `postgres`
- Migrations live in `signal-api/db/migrations/`, sequential 6-digit numbering (`000001_...`), one `.up.sql`/`.down.sql` pair per migration — matches `signal-api/sqlc.yaml`'s `schema: "db/migrations"`.
- Every table: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` (built into Postgres core since v13 — no extension needed), `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `deleted_at TIMESTAMPTZ` (NULL = active row, soft delete only — no hard deletes from the application).
- `updated_at` is auto-maintained by a shared `BEFORE UPDATE` trigger calling `set_updated_at()` (created in migration `000001`).
- Any uniqueness constraint that must tolerate "delete and recreate" (email, slug, a user's vote) is a **partial unique index** `WHERE deleted_at IS NULL`, not a table-level `UNIQUE` constraint.
- All foreign keys use `ON DELETE CASCADE`.
- Spec: `docs/superpowers/specs/2026-06-21-signal-schema-design.md`.

---

### Task 1: Shared `set_updated_at()` trigger function

**Files:**
- Create: `signal-api/db/migrations/000001_create_set_updated_at_function.up.sql`
- Create: `signal-api/db/migrations/000001_create_set_updated_at_function.down.sql`

**Interfaces:**
- Consumes: nothing (first migration).
- Produces: a Postgres function `set_updated_at()` that later tasks attach as a `BEFORE UPDATE` trigger via `EXECUTE FUNCTION set_updated_at()`.

- [ ] **Step 1: Start Postgres and confirm the `migrate` CLI is available**

Run from the repo root (`D:\Lab\signal`):

```bash
docker compose up -d
docker compose ps
```

Expected: the `postgres` service shows `State: running` (or `Up`).

Then check the CLI:

```bash
migrate -version
```

If that fails with "command not found", install it (requires network access to the Go module proxy):

```bash
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
migrate -version
```

Expected: prints a version like `v4.18.x`.

- [ ] **Step 2: Verify the function does not exist yet**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';"
```

Expected: `(0 rows)`.

- [ ] **Step 3: Write the up migration**

Create `signal-api/db/migrations/000001_create_set_updated_at_function.up.sql`:

```sql
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 4: Write the down migration**

Create `signal-api/db/migrations/000001_create_set_updated_at_function.down.sql`:

```sql
DROP FUNCTION IF EXISTS set_updated_at();
```

- [ ] **Step 5: Apply the migration**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected output ends with: `000001/u create_set_updated_at_function (xx.xxxxxxxxx)`.

- [ ] **Step 6: Verify the function now exists**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT proname, prorettype::regtype FROM pg_proc WHERE proname = 'set_updated_at';"
```

Expected:
```
    proname     | prorettype
-----------------+------------
 set_updated_at  | trigger
(1 row)
```

- [ ] **Step 7: Verify the down migration reverts cleanly**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';"
```

Expected: migrate-down output ends with `000001/d create_set_updated_at_function (xx.xxxxxxxxx)`; the psql query returns `(0 rows)`.

- [ ] **Step 8: Re-apply so the DB is ready for Task 2**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected: same success output as Step 5.

- [ ] **Step 9: Commit**

```bash
git add signal-api/db/migrations/000001_create_set_updated_at_function.up.sql signal-api/db/migrations/000001_create_set_updated_at_function.down.sql
git commit -m "feat: add set_updated_at trigger function migration"
```

---

### Task 2: `users` table

**Files:**
- Create: `signal-api/db/migrations/000002_create_users_table.up.sql`
- Create: `signal-api/db/migrations/000002_create_users_table.down.sql`

**Interfaces:**
- Consumes: `set_updated_at()` from Task 1.
- Produces: `users` table (`id`, `email`, `password_hash`, `name`, `created_at`, `updated_at`, `deleted_at`) that Task 3's `projects.owner_id` references.

- [ ] **Step 1: Verify the table does not exist yet**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "\d users"
```

Expected: `Did not find any relation named "users".`

- [ ] **Step 2: Write the up migration**

Create `signal-api/db/migrations/000002_create_users_table.up.sql`:

```sql
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ
);

CREATE UNIQUE INDEX users_email_active_idx ON users (email) WHERE deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 3: Write the down migration**

Create `signal-api/db/migrations/000002_create_users_table.down.sql`:

```sql
DROP TABLE IF EXISTS users;
```

- [ ] **Step 4: Apply the migration**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected output ends with: `000002/u create_users_table (xx.xxxxxxxxx)`.

- [ ] **Step 5: Verify columns**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position;"
```

Expected:
```
  column_name  |          data_type          | is_nullable
----------------+------------------------------+-------------
 id             | uuid                         | NO
 email          | text                         | NO
 password_hash  | text                         | NO
 name           | text                         | NO
 created_at     | timestamp with time zone     | NO
 updated_at     | timestamp with time zone     | NO
 deleted_at     | timestamp with time zone     | YES
(7 rows)
```

- [ ] **Step 6: Verify the index and trigger**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT indexname FROM pg_indexes WHERE tablename = 'users' ORDER BY indexname;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT tgname FROM pg_trigger WHERE tgrelid = 'users'::regclass AND NOT tgisinternal;"
```

Expected first query: `users_email_active_idx` and `users_pkey` (2 rows).
Expected second query: `users_set_updated_at` (1 row).

- [ ] **Step 7: Behavioral test — `updated_at` auto-updates**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "INSERT INTO users (email, password_hash, name) VALUES ('alice@example.com', 'hash', 'Alice') RETURNING id, created_at, updated_at;"
```

Note the returned `id` and `updated_at`, then (substituting the real id):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "UPDATE users SET name = 'Alice Smith' WHERE email = 'alice@example.com'; SELECT created_at, updated_at, created_at <> updated_at AS trigger_fired FROM users WHERE email = 'alice@example.com';"
```

Expected: `trigger_fired` column is `t`.

- [ ] **Step 8: Behavioral test — active-email uniqueness**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "INSERT INTO users (email, password_hash, name) VALUES ('alice@example.com', 'hash2', 'Alice Two');"
```

Expected: `ERROR: duplicate key value violates unique constraint "users_email_active_idx"`.

- [ ] **Step 9: Behavioral test — soft-deleted email can be reused**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "UPDATE users SET deleted_at = now() WHERE email = 'alice@example.com'; INSERT INTO users (email, password_hash, name) VALUES ('alice@example.com', 'hash3', 'New Alice') RETURNING id;"
```

Expected: the `INSERT` succeeds and returns a new `id` (no unique violation, because the old row's `deleted_at` is no longer `NULL`).

- [ ] **Step 10: Clean up test rows**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "DELETE FROM users WHERE email = 'alice@example.com';"
```

Expected: `DELETE 2`.

- [ ] **Step 11: Verify the down migration reverts cleanly**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "\d users"
```

Expected: migrate-down output ends with `000002/d create_users_table (xx.xxxxxxxxx)`; psql reports `Did not find any relation named "users".`

- [ ] **Step 12: Re-apply so the DB is ready for Task 3**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected: re-applies both `000001` and `000002` (or just `000002` if `000001` was already at that version) and ends without error.

- [ ] **Step 13: Commit**

```bash
git add signal-api/db/migrations/000002_create_users_table.up.sql signal-api/db/migrations/000002_create_users_table.down.sql
git commit -m "feat: add users table migration"
```

---

### Task 3: `projects` table

**Files:**
- Create: `signal-api/db/migrations/000003_create_projects_table.up.sql`
- Create: `signal-api/db/migrations/000003_create_projects_table.down.sql`

**Interfaces:**
- Consumes: `users.id` (Task 2) for `owner_id`; `set_updated_at()` (Task 1).
- Produces: `projects` table (`id`, `owner_id`, `name`, `slug`, `description`, `created_at`, `updated_at`, `deleted_at`) that Task 4's `feature_requests.project_id` references.

- [ ] **Step 1: Verify the table does not exist yet**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "\d projects"
```

Expected: `Did not find any relation named "projects".`

- [ ] **Step 2: Write the up migration**

Create `signal-api/db/migrations/000003_create_projects_table.up.sql`:

```sql
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX projects_owner_id_idx ON projects (owner_id);
CREATE UNIQUE INDEX projects_slug_active_idx ON projects (slug) WHERE deleted_at IS NULL;

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 3: Write the down migration**

Create `signal-api/db/migrations/000003_create_projects_table.down.sql`:

```sql
DROP TABLE IF EXISTS projects;
```

- [ ] **Step 4: Apply the migration**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected output ends with: `000003/u create_projects_table (xx.xxxxxxxxx)`.

- [ ] **Step 5: Verify columns, constraints, and indexes**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'projects' ORDER BY ordinal_position;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT conname, contype, confdeltype FROM pg_constraint WHERE conrelid = 'projects'::regclass ORDER BY conname;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT indexname FROM pg_indexes WHERE tablename = 'projects' ORDER BY indexname;"
```

Expected columns: `id, owner_id, name, slug, description, created_at, updated_at, deleted_at` (8 rows), with `owner_id` non-nullable and `description`/`deleted_at` nullable.

Expected constraints:
```
        conname         | contype | confdeltype
-------------------------+---------+-------------
 projects_owner_id_fkey  | f       | c
 projects_pkey           | p       |
(2 rows)
```

Expected indexes: `projects_owner_id_idx`, `projects_pkey`, `projects_slug_active_idx` (3 rows).

- [ ] **Step 6: Behavioral test — cascade delete from `users` to `projects`**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO users (email, password_hash, name) VALUES ('bob@example.com', 'hash', 'Bob') RETURNING id;"
```

Substitute the returned id (`<owner_id>`) below:

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO projects (owner_id, name, slug) VALUES ('<owner_id>', 'Bob Project', 'bob-project');
DELETE FROM users WHERE id = '<owner_id>';
SELECT count(*) FROM projects WHERE slug = 'bob-project';"
```

Expected: the final `count` is `0` — deleting the user cascaded into deleting the project.

- [ ] **Step 7: Behavioral test — active-slug uniqueness and soft-delete reuse**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO users (email, password_hash, name) VALUES ('carol@example.com', 'hash', 'Carol') RETURNING id;"
```

Substitute the returned id (`<owner_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO projects (owner_id, name, slug) VALUES ('<owner_id>', 'Carol Project', 'carol-project');
INSERT INTO projects (owner_id, name, slug) VALUES ('<owner_id>', 'Carol Project 2', 'carol-project');"
```

Expected: the second `INSERT` fails with `ERROR: duplicate key value violates unique constraint "projects_slug_active_idx"`.

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
UPDATE projects SET deleted_at = now() WHERE slug = 'carol-project';
INSERT INTO projects (owner_id, name, slug) VALUES ('<owner_id>', 'Carol Project 3', 'carol-project') RETURNING id;"
```

Expected: this `INSERT` succeeds.

- [ ] **Step 8: Clean up test rows**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "DELETE FROM users WHERE email = 'carol@example.com';"
```

Expected: `DELETE 1` (cascades to delete the two remaining Carol projects too).

- [ ] **Step 9: Verify the down migration reverts cleanly**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "\d projects"
```

Expected: migrate-down output ends with `000003/d create_projects_table (xx.xxxxxxxxx)`; psql reports `Did not find any relation named "projects".`

- [ ] **Step 10: Re-apply so the DB is ready for Task 4**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected: ends without error, `projects` exists again.

- [ ] **Step 11: Commit**

```bash
git add signal-api/db/migrations/000003_create_projects_table.up.sql signal-api/db/migrations/000003_create_projects_table.down.sql
git commit -m "feat: add projects table migration"
```

---

### Task 4: `feature_requests` table

**Files:**
- Create: `signal-api/db/migrations/000004_create_feature_requests_table.up.sql`
- Create: `signal-api/db/migrations/000004_create_feature_requests_table.down.sql`

**Interfaces:**
- Consumes: `projects.id` (Task 3) for `project_id`; `users.id` (Task 2) for `created_by`; `set_updated_at()` (Task 1).
- Produces: `feature_requests` table (`id`, `project_id`, `created_by`, `title`, `description`, `status`, `created_at`, `updated_at`, `deleted_at`) that Task 5's `votes.feature_request_id` references.

- [ ] **Step 1: Verify the table does not exist yet**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "\d feature_requests"
```

Expected: `Did not find any relation named "feature_requests".`

- [ ] **Step 2: Write the up migration**

Create `signal-api/db/migrations/000004_create_feature_requests_table.up.sql`:

```sql
CREATE TABLE feature_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'planned', 'in_progress', 'completed', 'rejected')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at  TIMESTAMPTZ
);

CREATE INDEX feature_requests_project_status_idx
    ON feature_requests (project_id, status) WHERE deleted_at IS NULL;
CREATE INDEX feature_requests_created_by_idx ON feature_requests (created_by);

CREATE TRIGGER feature_requests_set_updated_at BEFORE UPDATE ON feature_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 3: Write the down migration**

Create `signal-api/db/migrations/000004_create_feature_requests_table.down.sql`:

```sql
DROP TABLE IF EXISTS feature_requests;
```

- [ ] **Step 4: Apply the migration**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected output ends with: `000004/u create_feature_requests_table (xx.xxxxxxxxx)`.

- [ ] **Step 5: Verify columns, constraints, and indexes**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'feature_requests' ORDER BY ordinal_position;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT conname, contype FROM pg_constraint WHERE conrelid = 'feature_requests'::regclass ORDER BY conname;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT indexname FROM pg_indexes WHERE tablename = 'feature_requests' ORDER BY indexname;"
```

Expected columns (9 rows) include `status` with `column_default = 'open'::text` and `is_nullable = NO`.

Expected constraints:
```
              conname               | contype
-------------------------------------+---------
 feature_requests_created_by_fkey    | f
 feature_requests_pkey               | p
 feature_requests_project_id_fkey    | f
 feature_requests_status_check       | c
(4 rows)
```

Expected indexes: `feature_requests_created_by_idx`, `feature_requests_pkey`, `feature_requests_project_status_idx` (3 rows).

- [ ] **Step 6: Behavioral test — `status` CHECK constraint**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO users (email, password_hash, name) VALUES ('dave@example.com', 'hash', 'Dave') RETURNING id;"
```

Substitute the returned id (`<user_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO projects (owner_id, name, slug) VALUES ('<user_id>', 'Dave Project', 'dave-project') RETURNING id;"
```

Substitute the returned id (`<project_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO feature_requests (project_id, created_by, title, status) VALUES ('<project_id>', '<user_id>', 'Bad status', 'bogus');"
```

Expected: `ERROR: new row for relation "feature_requests" violates check constraint "feature_requests_status_check"`.

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO feature_requests (project_id, created_by, title) VALUES ('<project_id>', '<user_id>', 'Default status test') RETURNING status;"
```

Expected: `status` is `open` (the default applied with no explicit value).

- [ ] **Step 7: Behavioral test — cascade delete from `projects` to `feature_requests`**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
DELETE FROM projects WHERE id = '<project_id>';
SELECT count(*) FROM feature_requests WHERE project_id = '<project_id>';"
```

Expected: `count` is `0`.

- [ ] **Step 8: Clean up test rows**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "DELETE FROM users WHERE email = 'dave@example.com';"
```

Expected: `DELETE 1`.

- [ ] **Step 9: Verify the down migration reverts cleanly**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "\d feature_requests"
```

Expected: migrate-down output ends with `000004/d create_feature_requests_table (xx.xxxxxxxxx)`; psql reports `Did not find any relation named "feature_requests".`

- [ ] **Step 10: Re-apply so the DB is ready for Task 5**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected: ends without error, `feature_requests` exists again.

- [ ] **Step 11: Commit**

```bash
git add signal-api/db/migrations/000004_create_feature_requests_table.up.sql signal-api/db/migrations/000004_create_feature_requests_table.down.sql
git commit -m "feat: add feature_requests table migration"
```

---

### Task 5: `votes` table

**Files:**
- Create: `signal-api/db/migrations/000005_create_votes_table.up.sql`
- Create: `signal-api/db/migrations/000005_create_votes_table.down.sql`

**Interfaces:**
- Consumes: `feature_requests.id` (Task 4) for `feature_request_id`; `users.id` (Task 2) for `user_id`; `set_updated_at()` (Task 1).
- Produces: `votes` table (`id`, `feature_request_id`, `user_id`, `created_at`, `updated_at`, `deleted_at`) — the final table in this plan; no later task depends on it.

- [ ] **Step 1: Verify the table does not exist yet**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "\d votes"
```

Expected: `Did not find any relation named "votes".`

- [ ] **Step 2: Write the up migration**

Create `signal-api/db/migrations/000005_create_votes_table.up.sql`:

```sql
CREATE TABLE votes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX votes_feature_request_user_active_idx
    ON votes (feature_request_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX votes_user_id_idx ON votes (user_id);

CREATE TRIGGER votes_set_updated_at BEFORE UPDATE ON votes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

- [ ] **Step 3: Write the down migration**

Create `signal-api/db/migrations/000005_create_votes_table.down.sql`:

```sql
DROP TABLE IF EXISTS votes;
```

- [ ] **Step 4: Apply the migration**

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
```

Expected output ends with: `000005/u create_votes_table (xx.xxxxxxxxx)`.

- [ ] **Step 5: Verify columns, constraints, and indexes**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'votes' ORDER BY ordinal_position;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT conname, contype, confdeltype FROM pg_constraint WHERE conrelid = 'votes'::regclass ORDER BY conname;"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT indexname FROM pg_indexes WHERE tablename = 'votes' ORDER BY indexname;"
```

Expected columns (6 rows): `id, feature_request_id, user_id, created_at, updated_at, deleted_at`.

Expected constraints:
```
             conname              | contype | confdeltype
-----------------------------------+---------+-------------
 votes_feature_request_id_fkey     | f       | c
 votes_pkey                        | p       |
 votes_user_id_fkey                | f       | c
(3 rows)
```

Expected indexes: `votes_feature_request_user_active_idx`, `votes_pkey`, `votes_user_id_idx` (3 rows).

- [ ] **Step 6: Behavioral test — one active vote per user per feature request**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO users (email, password_hash, name) VALUES ('erin@example.com', 'hash', 'Erin') RETURNING id;"
```

Substitute the returned id (`<user_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO projects (owner_id, name, slug) VALUES ('<user_id>', 'Erin Project', 'erin-project') RETURNING id;"
```

Substitute the returned id (`<project_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO feature_requests (project_id, created_by, title) VALUES ('<project_id>', '<user_id>', 'Dark mode') RETURNING id;"
```

Substitute the returned id (`<fr_id>`):

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
INSERT INTO votes (feature_request_id, user_id) VALUES ('<fr_id>', '<user_id>');
INSERT INTO votes (feature_request_id, user_id) VALUES ('<fr_id>', '<user_id>');"
```

Expected: the second `INSERT` fails with `ERROR: duplicate key value violates unique constraint "votes_feature_request_user_active_idx"`.

- [ ] **Step 7: Behavioral test — un-vote then re-vote**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
UPDATE votes SET deleted_at = now() WHERE feature_request_id = '<fr_id>' AND user_id = '<user_id>';
INSERT INTO votes (feature_request_id, user_id) VALUES ('<fr_id>', '<user_id>') RETURNING id;
SELECT count(*) FROM votes WHERE feature_request_id = '<fr_id>' AND deleted_at IS NULL;"
```

Expected: the `INSERT` succeeds; the final `count` is `1` (only the new active vote counts).

- [ ] **Step 8: Behavioral test — cascade delete from `feature_requests` to `votes`**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "
DELETE FROM feature_requests WHERE id = '<fr_id>';
SELECT count(*) FROM votes WHERE feature_request_id = '<fr_id>';"
```

Expected: `count` is `0`.

- [ ] **Step 9: Clean up test rows**

```bash
docker compose exec -T postgres psql -U signal -d signal -c "DELETE FROM users WHERE email = 'erin@example.com';"
```

Expected: `DELETE 1`.

- [ ] **Step 10: Verify the down migration reverts cleanly**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "\d votes"
```

Expected: migrate-down output ends with `000005/d create_votes_table (xx.xxxxxxxxx)`; psql reports `Did not find any relation named "votes".`

- [ ] **Step 11: Full chain re-apply — verify all 5 migrations apply cleanly from scratch**

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

Note: `make migrate-down` only reverts one step at a time per the Makefile target (`migrate ... down 1`), so run it repeatedly (4 more times) until no migrations remain:

```bash
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
make -C signal-api migrate-down DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name; SELECT proname FROM pg_proc WHERE proname = 'set_updated_at';"
```

Expected: both queries return `(0 rows)` — every table and the function are gone.

```bash
make -C signal-api migrate-up DB_URL="postgres://signal:signal@localhost:5432/signal?sslmode=disable"
docker compose exec -T postgres psql -U signal -d signal -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

Expected: `migrate-up` applies all 5 migrations in order without error; the query returns `feature_requests`, `projects`, `users`, `votes` (4 rows).

- [ ] **Step 12: Commit**

```bash
git add signal-api/db/migrations/000005_create_votes_table.up.sql signal-api/db/migrations/000005_create_votes_table.down.sql
git commit -m "feat: add votes table migration"
```