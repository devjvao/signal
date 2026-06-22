package main

import (
	"context"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

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

func setupRouter(authHandler *handlers.AuthHandler, projectHandler *handlers.ProjectHandler, webOrigin string) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(webOrigin))

	if err := r.SetTrustedProxies(nil); err != nil {
		panic("failed to set trusted proxies: " + err.Error())
	}

	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	r.POST("/auth/register", authHandler.Register)
	r.POST("/auth/login", authHandler.Login)

	protectedAuth := r.Group("/auth")
	protectedAuth.Use(auth.Middleware(authHandler.JWTSecret))
	protectedAuth.GET("/me", authHandler.Me)

	protectedProjects := r.Group("/projects")
	protectedProjects.Use(auth.Middleware(authHandler.JWTSecret))
	protectedProjects.GET("", projectHandler.List)
	protectedProjects.GET("/mine", projectHandler.ListMine)

	return r
}

func main() {
	err := godotenv.Load()
	if err != nil {
		log.Println("No .env file found")
	}

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

	projectHandler := &handlers.ProjectHandler{
		Queries: db.New(pool),
	}

	r := setupRouter(authHandler, projectHandler, cfg.WebOrigin)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
