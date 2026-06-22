package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"signal-api/internal/db"
	"signal-api/internal/handlers"
)

func TestHealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authHandler := &handlers.AuthHandler{
		Queries:   db.New(nil),
		JWTSecret: []byte("test-secret"),
	}
	projectHandler := &handlers.ProjectHandler{Queries: db.New(nil)}
	featureRequestHandler := &handlers.FeatureRequestHandler{Queries: db.New(nil)}
	r := setupRouter(authHandler, projectHandler, featureRequestHandler, "http://localhost:5173")

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/health", nil)
	if err != nil {
		t.Fatal(err)
	}
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
