package handlers

import (
	"encoding/base64"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgtype"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type ProjectHandler struct {
	Queries *db.Queries
}

type projectResponse struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description"`
	OwnerID     string  `json:"ownerId"`
	OwnerName   string  `json:"ownerName"`
	CreatedAt   string  `json:"createdAt"`
}

type projectsListResponse struct {
	Projects   []projectResponse `json:"projects"`
	NextCursor *string           `json:"nextCursor"`
}

const (
	defaultProjectsLimit = 10
	maxProjectsLimit     = 50
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type projectCursor struct {
	createdAt time.Time
	id        string
}

func parseProjectsLimit(c *gin.Context) (int, bool) {
	raw := c.Query("limit")
	if raw == "" {
		return defaultProjectsLimit, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxProjectsLimit {
		return 0, false
	}
	return limit, true
}

func parseProjectsCursor(c *gin.Context) (*projectCursor, bool) {
	raw := c.Query("cursor")
	if raw == "" {
		return nil, true
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, false
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 || !uuidPattern.MatchString(parts[1]) {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return nil, false
	}
	return &projectCursor{createdAt: createdAt, id: parts[1]}, true
}

func encodeProjectsCursor(createdAt time.Time, id string) string {
	raw := createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func newProjectResponse(id, ownerID, name, slug string, description pgtype.Text, createdAt pgtype.Timestamptz, ownerName string) projectResponse {
	var desc *string
	if description.Valid {
		d := description.String
		desc = &d
	}
	return projectResponse{
		ID:          id,
		Name:        name,
		Slug:        slug,
		Description: desc,
		OwnerID:     ownerID,
		OwnerName:   ownerName,
		CreatedAt:   createdAt.Time.UTC().Format(time.RFC3339),
	}
}

// zeroUUID is a well-typed dummy value for the cursor_id query parameter when there is no
// cursor. The SQL query's "has_cursor = false" clause short-circuits before this value is
// semantically used, but Postgres still type-checks/binds it as a uuid, so it must parse.
const zeroUUID = "00000000-0000-0000-0000-000000000000"

func cursorParams(cursor *projectCursor) (hasCursor bool, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, zeroUUID
	}
	return true, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}

func (h *ProjectHandler) List(c *gin.Context) {
	limit, ok := parseProjectsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseProjectsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
	rows, err := h.Queries.ListProjects(c.Request.Context(), db.ListProjectsParams{
		HasCursor:       hasCursor,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
		LimitCount:      int32(limit + 1),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	projects := make([]projectResponse, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeProjectsCursor(last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, projectsListResponse{Projects: projects, NextCursor: nextCursor})
}

func (h *ProjectHandler) ListMine(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	limit, ok := parseProjectsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseProjectsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	hasCursor, cursorCreatedAt, cursorID := cursorParams(cursor)
	rows, err := h.Queries.ListProjectsByOwner(c.Request.Context(), db.ListProjectsByOwnerParams{
		OwnerID:         userID,
		HasCursor:       hasCursor,
		CursorCreatedAt: cursorCreatedAt,
		CursorID:        cursorID,
		LimitCount:      int32(limit + 1),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}

	projects := make([]projectResponse, 0, len(rows))
	for _, row := range rows {
		projects = append(projects, newProjectResponse(row.ID, row.OwnerID, row.Name, row.Slug, row.Description, row.CreatedAt, row.OwnerName))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeProjectsCursor(last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, projectsListResponse{Projects: projects, NextCursor: nextCursor})
}
