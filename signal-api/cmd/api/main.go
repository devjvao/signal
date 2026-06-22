package main

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"signal-api/internal/auth"
	"signal-api/internal/config"
	"signal-api/internal/db"
	"signal-api/internal/handlers"
)

func corsMiddleware(allowedOrigin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", allowedOrigin)
		c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func setupRouter(authHandler *handlers.AuthHandler, webOrigin string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(webOrigin))

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/auth/register", authHandler.Register)
	r.POST("/auth/login", authHandler.Login)

	protected := r.Group("/auth")
	protected.Use(auth.Middleware(authHandler.JWTSecret))
	protected.GET("/me", authHandler.Me)

	return r
}

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	pool, err := pgxpool.New(context.Background(), cfg.DBURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	authHandler := &handlers.AuthHandler{
		Queries:   db.New(pool),
		JWTSecret: []byte(cfg.JWTSecret),
	}

	r := setupRouter(authHandler, cfg.WebOrigin)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
