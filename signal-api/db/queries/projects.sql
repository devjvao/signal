-- name: ListProjects :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: ListProjectsByOwner :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name
FROM projects p
JOIN users u ON u.id = p.owner_id
WHERE p.deleted_at IS NULL
  AND p.owner_id = sqlc.arg('owner_id')::uuid
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY p.created_at DESC, p.id DESC
LIMIT sqlc.arg('limit_count')::int;
