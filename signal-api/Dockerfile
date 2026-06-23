# ---- build stage ----
FROM golang:1.26-alpine AS build
WORKDIR /src

RUN apk add --no-cache git

# Install the golang-migrate CLI (postgres driver) for the runtime image.
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api ./cmd/api

# ---- runtime stage ----
FROM alpine:3.20
WORKDIR /app

# ca-certificates lets pgx open TLS connections to the managed Postgres.
RUN apk add --no-cache ca-certificates

COPY --from=build /out/api /app/api
COPY --from=build /go/bin/migrate /usr/local/bin/migrate
COPY --from=build /src/db/migrations /app/db/migrations

EXPOSE 8080
CMD ["/app/api"]
