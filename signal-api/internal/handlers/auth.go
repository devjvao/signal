package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type AuthHandler struct {
	Queries   *db.Queries
	JWTSecret []byte
}

type userResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
}

type registerRequest struct {
	Name     string `json:"name" binding:"required"`
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	row, err := h.Queries.CreateUser(c.Request.Context(), db.CreateUserParams{
		Name:         req.Name,
		Email:        req.Email,
		PasswordHash: hash,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			c.JSON(http.StatusConflict, gin.H{"error": "email is already registered"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"user": userResponse{
		ID:        row.ID,
		Name:      row.Name,
		Email:     row.Email,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}})
}

type loginRequest struct {
	Email    string `json:"email" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type loginResponse struct {
	Token string       `json:"token"`
	User  userResponse `json:"user"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	row, err := h.Queries.GetUserByEmail(c.Request.Context(), req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	if !auth.CheckPassword(req.Password, row.PasswordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	token, err := auth.GenerateToken(h.JWTSecret, row.ID, row.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, loginResponse{
		Token: token,
		User: userResponse{
			ID:        row.ID,
			Name:      row.Name,
			Email:     row.Email,
			CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
		},
	})
}

func (h *AuthHandler) Me(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	row, err := h.Queries.GetUserByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"user": userResponse{
		ID:        row.ID,
		Name:      row.Name,
		Email:     row.Email,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}})
}
