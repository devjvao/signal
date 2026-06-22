package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupTestRouter(secret []byte) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/protected", Middleware(secret), func(c *gin.Context) {
		userID, _ := UserID(c)
		c.JSON(http.StatusOK, gin.H{"userID": userID})
	})
	return r
}

func TestMiddleware_ValidToken(t *testing.T) {
	secret := []byte("test-secret")
	token, err := GenerateToken(secret, "user-123", "ada@example.com")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	r := setupTestRouter(secret)
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", w.Code)
	}
}

func TestMiddleware_MissingHeader(t *testing.T) {
	r := setupTestRouter([]byte("test-secret"))
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}

func TestMiddleware_InvalidToken(t *testing.T) {
	r := setupTestRouter([]byte("test-secret"))
	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected status 401, got %d", w.Code)
	}
}
