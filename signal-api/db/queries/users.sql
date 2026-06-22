-- name: CreateUser :one
INSERT INTO users (name, email, password_hash)
VALUES ($1, $2, $3)
RETURNING id, name, email, password_hash, created_at, updated_at, deleted_at;

-- name: GetUserByEmail :one
SELECT id, name, email, password_hash, created_at, updated_at, deleted_at
FROM users
WHERE email = $1 AND deleted_at IS NULL;

-- name: GetUserByID :one
SELECT id, name, email, password_hash, created_at, updated_at, deleted_at
FROM users
WHERE id = $1 AND deleted_at IS NULL;