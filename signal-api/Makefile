.PHONY: run migrate-up migrate-down sqlc-gen

run:
	go run ./cmd/api

migrate-up:
	migrate -path db/migrations -database "$(DB_URL)" up

migrate-down:
	migrate -path db/migrations -database "$(DB_URL)" down 1

sqlc-gen:
	sqlc generate
