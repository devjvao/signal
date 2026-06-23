-- name: ListFeatureRequests :many
SELECT
    fr.id,
    fr.project_id,
    fr.created_by,
    fr.title,
    fr.description,
    fr.status,
    fr.created_at,
    u.name AS created_by_name,
    COALESCE(v.cnt, 0)::int AS upvote_count,
    EXISTS (
        SELECT 1 FROM votes vv
        WHERE vv.feature_request_id = fr.id
          AND vv.user_id = sqlc.arg('viewer_id')::uuid
          AND vv.deleted_at IS NULL
    ) AS viewer_has_voted
FROM feature_requests fr
JOIN users u ON u.id = fr.created_by
LEFT JOIN (
    SELECT feature_request_id, count(*) AS cnt
    FROM votes
    WHERE deleted_at IS NULL
    GROUP BY feature_request_id
) v ON v.feature_request_id = fr.id
WHERE fr.project_id = sqlc.arg('project_id')::uuid
  AND fr.deleted_at IS NULL
  AND (sqlc.arg('status')::text = '' OR fr.status = sqlc.arg('status')::text)
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR COALESCE(v.cnt, 0)::int < sqlc.arg('cursor_count')::int
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at < sqlc.arg('cursor_created_at')::timestamptz)
    OR (COALESCE(v.cnt, 0)::int = sqlc.arg('cursor_count')::int AND fr.created_at = sqlc.arg('cursor_created_at')::timestamptz AND fr.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY upvote_count DESC, fr.created_at DESC, fr.id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: ListFeatureRequestsNewest :many
SELECT
    fr.id,
    fr.project_id,
    fr.created_by,
    fr.title,
    fr.description,
    fr.status,
    fr.created_at,
    u.name AS created_by_name,
    COALESCE(v.cnt, 0)::int AS upvote_count,
    EXISTS (
        SELECT 1 FROM votes vv
        WHERE vv.feature_request_id = fr.id
          AND vv.user_id = sqlc.arg('viewer_id')::uuid
          AND vv.deleted_at IS NULL
    ) AS viewer_has_voted
FROM feature_requests fr
JOIN users u ON u.id = fr.created_by
LEFT JOIN (
    SELECT feature_request_id, count(*) AS cnt
    FROM votes
    WHERE deleted_at IS NULL
    GROUP BY feature_request_id
) v ON v.feature_request_id = fr.id
WHERE fr.project_id = sqlc.arg('project_id')::uuid
  AND fr.deleted_at IS NULL
  AND (sqlc.arg('status')::text = '' OR fr.status = sqlc.arg('status')::text)
  AND (
    sqlc.arg('has_cursor')::bool = false
    OR fr.created_at < sqlc.arg('cursor_created_at')::timestamptz
    OR (fr.created_at = sqlc.arg('cursor_created_at')::timestamptz AND fr.id < sqlc.arg('cursor_id')::uuid)
  )
ORDER BY fr.created_at DESC, fr.id DESC
LIMIT sqlc.arg('limit_count')::int;

-- name: GetFeatureRequestByID :one
SELECT
    fr.id,
    fr.project_id,
    fr.created_by,
    fr.title,
    fr.description,
    fr.status,
    fr.created_at,
    u.name AS created_by_name,
    p.owner_id AS project_owner_id,
    COALESCE(v.cnt, 0)::int AS upvote_count,
    EXISTS (
        SELECT 1 FROM votes vv
        WHERE vv.feature_request_id = fr.id
          AND vv.user_id = sqlc.arg('viewer_id')::uuid
          AND vv.deleted_at IS NULL
    ) AS viewer_has_voted
FROM feature_requests fr
JOIN users u ON u.id = fr.created_by
JOIN projects p ON p.id = fr.project_id
LEFT JOIN (
    SELECT feature_request_id, count(*) AS cnt
    FROM votes
    WHERE deleted_at IS NULL
    GROUP BY feature_request_id
) v ON v.feature_request_id = fr.id
WHERE fr.id = sqlc.arg('id')::uuid AND fr.deleted_at IS NULL;

-- name: CreateFeatureRequest :one
INSERT INTO feature_requests (project_id, created_by, title, description)
VALUES (sqlc.arg('project_id')::uuid, sqlc.arg('created_by')::uuid, sqlc.arg('title'), sqlc.arg('description'))
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: UpdateFeatureRequest :one
UPDATE feature_requests
SET title = sqlc.arg('title'), description = sqlc.arg('description')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: UpdateFeatureRequestStatus :one
UPDATE feature_requests
SET status = sqlc.arg('status')
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL
RETURNING id, project_id, created_by, title, description, status, created_at;

-- name: SoftDeleteFeatureRequest :exec
UPDATE feature_requests
SET deleted_at = now()
WHERE id = sqlc.arg('id')::uuid AND deleted_at IS NULL;
