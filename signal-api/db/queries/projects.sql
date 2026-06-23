-- name: ListProjects :many
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
         JOIN users u ON u.id = p.owner_id
         LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
         LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
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
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
         JOIN users u ON u.id = p.owner_id
         LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
         LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
  AND p.owner_id = sqlc.arg('owner_id')::uuid
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR p.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (p.created_at = sqlc.arg('cursor_created_at')::timestamptz AND p.id < sqlc.arg('cursor_id')::uuid)
  )
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
ORDER BY p.created_at DESC, p.id DESC
    LIMIT sqlc.arg('limit_count')::int;

-- name: CreateProject :one
INSERT INTO projects (owner_id, name, slug, description)
VALUES (sqlc.arg('owner_id'), sqlc.arg('name'), sqlc.arg('slug'), sqlc.arg('description'))
RETURNING id, owner_id, name, slug, description, created_at;

-- name: GetProjectByID :one
SELECT
    p.id,
    p.owner_id,
    p.name,
    p.slug,
    p.description,
    p.created_at,
    u.name AS owner_name,
    COUNT(DISTINCT fr.id)::int AS request_count,
    COUNT(v.id)::int AS vote_count
FROM projects p
         JOIN users u ON u.id = p.owner_id
         LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
         LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
WHERE p.id = sqlc.arg('id')::uuid AND p.deleted_at IS NULL
GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name;

-- name: UpdateProject :one
UPDATE projects
SET name = sqlc.arg('name'), description = sqlc.arg('description')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, owner_id, name, slug, description, created_at;

-- name: SoftDeleteProject :exec
UPDATE projects
SET deleted_at = now()
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL;

-- name: ListProjectsActive :many
WITH project_scores AS (
    SELECT
        p.id,
        p.owner_id,
        p.name,
        p.slug,
        p.description,
        p.created_at,
        u.name AS owner_name,
        COUNT(DISTINCT fr.id)::int AS request_count,
        COUNT(v.id)::int AS vote_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
    LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
    GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
)
SELECT *
FROM project_scores
WHERE (
    sqlc.arg('has_cursor')::bool = false
    OR (request_count + vote_count) < sqlc.arg('cursor_score')::int
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at = sqlc.arg('cursor_created_at')::timestamptz AND id < sqlc.arg('cursor_id')::uuid)
)
ORDER BY (request_count + vote_count) DESC, created_at DESC, id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: ListProjectsByOwnerActive :many
WITH project_scores AS (
    SELECT
        p.id,
        p.owner_id,
        p.name,
        p.slug,
        p.description,
        p.created_at,
        u.name AS owner_name,
        COUNT(DISTINCT fr.id)::int AS request_count,
        COUNT(v.id)::int AS vote_count
    FROM projects p
    JOIN users u ON u.id = p.owner_id
    LEFT JOIN feature_requests fr ON fr.project_id = p.id AND fr.deleted_at IS NULL
    LEFT JOIN votes v ON v.feature_request_id = fr.id AND v.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND p.owner_id = sqlc.arg('owner_id')::uuid
      AND (sqlc.arg('search')::text = '' OR p.name ILIKE '%' || sqlc.arg('search')::text || '%')
    GROUP BY p.id, p.owner_id, p.name, p.slug, p.description, p.created_at, u.name
)
SELECT *
FROM project_scores
WHERE (
    sqlc.arg('has_cursor')::bool = false
    OR (request_count + vote_count) < sqlc.arg('cursor_score')::int
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR ((request_count + vote_count) = sqlc.arg('cursor_score')::int AND created_at = sqlc.arg('cursor_created_at')::timestamptz AND id < sqlc.arg('cursor_id')::uuid)
)
ORDER BY (request_count + vote_count) DESC, created_at DESC, id DESC
LIMIT sqlc.arg('limit_count')::int;
