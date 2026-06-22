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
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func setupRouter(authHandler *handlers.AuthHandler, projectHandler *handlers.ProjectHandler, featureRequestHandler *handlers.FeatureRequestHandler, webOrigin string) *gin.Engine {
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
	protectedProjects.GET("/:id", projectHandler.Get)
	protectedProjects.POST("", projectHandler.Create)
	protectedProjects.PUT("/:id", projectHandler.Update)
	protectedProjects.DELETE("/:id", projectHandler.Delete)
	protectedProjects.GET("/:id/feature-requests", featureRequestHandler.List)
	protectedProjects.POST("/:id/feature-requests", featureRequestHandler.Create)

	protectedFeatureRequests := r.Group("/feature-requests")
	protectedFeatureRequests.Use(auth.Middleware(authHandler.JWTSecret))
	protectedFeatureRequests.PUT("/:id", featureRequestHandler.Update)
	protectedFeatureRequests.PUT("/:id/status", featureRequestHandler.UpdateStatus)
	protectedFeatureRequests.DELETE("/:id", featureRequestHandler.Delete)
	protectedFeatureRequests.POST("/:id/vote", featureRequestHandler.Vote)
	protectedFeatureRequests.DELETE("/:id/vote", featureRequestHandler.Unvote)

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

	featureRequestHandler := &handlers.FeatureRequestHandler{
		Queries: db.New(pool),
	}

	r := setupRouter(authHandler, projectHandler, featureRequestHandler, cfg.WebOrigin)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
}
