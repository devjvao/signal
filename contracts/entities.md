# Entities

## User

The publicly-serialized shape of a user. Never includes the password hash or soft-delete marker.

| Field       | Type   | Notes                                              |
|-------------|--------|-----------------------------------------------------|
| `id`        | string | UUID, primary key                                  |
| `name`      | string | display name, required, non-empty                 |
| `email`     | string | unique among active (non-deleted) users, required |
| `createdAt` | string | ISO 8601 timestamp, e.g. `2026-06-21T12:00:00Z`    |

Example:

```json
{
  "id": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "createdAt": "2026-06-21T12:00:00Z"
}
```

### Server-internal fields (never serialized)

These exist in the database but must never appear in any API response:

- `password_hash` — bcrypt hash of the user's password
- `deleted_at` — soft-delete timestamp; soft-deleted users are excluded from all lookups
  (treated as if they don't exist for registration/login/me purposes)

## Project

The publicly-serialized shape of a project, including a denormalized owner name so listing
clients don't need a separate lookup.

| Field         | Type             | Notes                                              |
|---------------|------------------|-----------------------------------------------------|
| `id`          | string           | UUID, primary key                                  |
| `name`        | string           | required, non-empty                                |
| `slug`        | string           | unique among active (non-deleted) projects         |
| `description` | string \| null   | optional                                           |
| `ownerId`     | string           | UUID of the owning user                            |
| `ownerName`   | string           | display name of the owner, joined from `users`     |
| `createdAt`   | string           | ISO 8601 timestamp, e.g. `2026-06-21T12:00:00Z`    |

Example:

```json
{
  "id": "c4f2d3e1-2b3c-5d4e-0f9a-8b7c6d5e4f3a",
  "name": "Signal",
  "slug": "signal",
  "description": "A feedback aggregator",
  "ownerId": "b3f1c2e0-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
  "ownerName": "Ada Lovelace",
  "createdAt": "2026-06-21T12:00:00Z"
}
```

Soft-deleted projects (`deleted_at IS NOT NULL`) are excluded from all lookups and listings.
