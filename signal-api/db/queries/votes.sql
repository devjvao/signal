-- name: CreateVote :exec
INSERT INTO votes (feature_request_id, user_id)
VALUES (sqlc.arg('feature_request_id')::uuid, sqlc.arg('user_id')::uuid);

-- name: RemoveVote :exec
UPDATE votes
SET deleted_at = now()
WHERE feature_request_id = sqlc.arg('feature_request_id')::uuid
  AND user_id = sqlc.arg('user_id')::uuid
  AND deleted_at IS NULL;
