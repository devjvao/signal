package handlers

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"signal-api/internal/auth"
	"signal-api/internal/db"
)

type FeatureRequestHandler struct {
	Queries *db.Queries
}

type featureRequestResponse struct {
	ID             string  `json:"id"`
	ProjectID      string  `json:"projectId"`
	Title          string  `json:"title"`
	Description    *string `json:"description"`
	Status         string  `json:"status"`
	CreatedBy      string  `json:"createdBy"`
	CreatedByName  string  `json:"createdByName"`
	UpvoteCount    int32   `json:"upvoteCount"`
	ViewerHasVoted bool    `json:"viewerHasVoted"`
	CreatedAt      string  `json:"createdAt"`
}

type featureRequestsListResponse struct {
	FeatureRequests []featureRequestResponse `json:"featureRequests"`
	NextCursor      *string                  `json:"nextCursor"`
}

const (
	defaultFeatureRequestsLimit = 10
	maxFeatureRequestsLimit     = 50
)

var validFeatureRequestStatuses = map[string]bool{
	"open": true, "planned": true, "in_progress": true, "completed": true, "rejected": true,
}

type featureRequestCursor struct {
	count     int32
	createdAt time.Time
	id        string
}

func parseFeatureRequestsLimit(c *gin.Context) (int, bool) {
	raw := c.Query("limit")
	if raw == "" {
		return defaultFeatureRequestsLimit, true
	}
	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 || limit > maxFeatureRequestsLimit {
		return 0, false
	}
	return limit, true
}

func parseFeatureRequestsCursor(c *gin.Context) (*featureRequestCursor, bool) {
	raw := c.Query("cursor")
	if raw == "" {
		return nil, true
	}
	decoded, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, false
	}
	parts := strings.SplitN(string(decoded), "|", 3)
	if len(parts) != 3 || !uuidPattern.MatchString(parts[2]) {
		return nil, false
	}
	count, err := strconv.Atoi(parts[0])
	if err != nil {
		return nil, false
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return nil, false
	}
	return &featureRequestCursor{count: int32(count), createdAt: createdAt, id: parts[2]}, true
}

func encodeFeatureRequestsCursor(count int32, createdAt time.Time, id string) string {
	raw := strconv.Itoa(int(count)) + "|" + createdAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func featureRequestCursorParams(cursor *featureRequestCursor) (hasCursor bool, count int32, createdAt pgtype.Timestamptz, id string) {
	if cursor == nil {
		return false, 0, pgtype.Timestamptz{Time: time.Unix(0, 0), Valid: true}, zeroUUID
	}
	return true, cursor.count, pgtype.Timestamptz{Time: cursor.createdAt, Valid: true}, cursor.id
}

func newFeatureRequestResponse(id, projectID, createdBy, title string, description pgtype.Text, status string, createdAt pgtype.Timestamptz, createdByName string, upvoteCount int32, viewerHasVoted bool) featureRequestResponse {
	var desc *string
	if description.Valid {
		d := description.String
		desc = &d
	}
	return featureRequestResponse{
		ID:             id,
		ProjectID:      projectID,
		Title:          title,
		Description:    desc,
		Status:         status,
		CreatedBy:      createdBy,
		CreatedByName:  createdByName,
		UpvoteCount:    upvoteCount,
		ViewerHasVoted: viewerHasVoted,
		CreatedAt:      createdAt.Time.UTC().Format(time.RFC3339),
	}
}

// respondWithFeatureRequest re-reads the row (refreshing upvoteCount / viewerHasVoted) and writes it.
func (h *FeatureRequestHandler) respondWithFeatureRequest(c *gin.Context, viewerID, id string, status int) {
	fr, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: viewerID, ID: id})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	c.JSON(status, gin.H{"featureRequest": newFeatureRequestResponse(
		fr.ID, fr.ProjectID, fr.CreatedBy, fr.Title, fr.Description, fr.Status, fr.CreatedAt, fr.CreatedByName, fr.UpvoteCount, fr.ViewerHasVoted,
	)})
}

func (h *FeatureRequestHandler) List(c *gin.Context) {
	projectID := c.Param("id")
	if !uuidPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}
	viewerID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	limit, ok := parseFeatureRequestsLimit(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
		return
	}
	cursor, ok := parseFeatureRequestsCursor(c)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid cursor"})
		return
	}

	if _, err := h.Queries.GetProjectByID(c.Request.Context(), projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	hasCursor, cursorCount, cursorCreatedAt, cursorID := featureRequestCursorParams(cursor)
	rows, err := h.Queries.ListFeatureRequests(c.Request.Context(), db.ListFeatureRequestsParams{
		ViewerID:        viewerID,
		ProjectID:       projectID,
		HasCursor:       hasCursor,
		CursorCount:     cursorCount,
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

	items := make([]featureRequestResponse, 0, len(rows))
	for _, row := range rows {
		items = append(items, newFeatureRequestResponse(row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, row.CreatedByName, row.UpvoteCount, row.ViewerHasVoted))
	}

	var nextCursor *string
	if hasMore {
		last := rows[len(rows)-1]
		cur := encodeFeatureRequestsCursor(last.UpvoteCount, last.CreatedAt.Time, last.ID)
		nextCursor = &cur
	}

	c.JSON(http.StatusOK, featureRequestsListResponse{FeatureRequests: items, NextCursor: nextCursor})
}

type createFeatureRequestRequest struct {
	Title       string  `json:"title" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

func (h *FeatureRequestHandler) Create(c *gin.Context) {
	projectID := c.Param("id")
	if !uuidPattern.MatchString(projectID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req createFeatureRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if _, err := h.Queries.GetProjectByID(c.Request.Context(), projectID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "project not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	row, err := h.Queries.CreateFeatureRequest(c.Request.Context(), db.CreateFeatureRequestParams{
		ProjectID:   projectID,
		CreatedBy:   userID,
		Title:       req.Title,
		Description: descriptionToText(req.Description),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	h.respondWithFeatureRequest(c, userID, row.ID, http.StatusCreated)
}

type updateFeatureRequestRequest struct {
	Title       string  `json:"title" binding:"required,max=200"`
	Description *string `json:"description" binding:"omitempty,max=2000"`
}

func (h *FeatureRequestHandler) Update(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req updateFeatureRequestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if existing.UpvoteCount > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "feature request has upvotes"})
		return
	}

	row, err := h.Queries.UpdateFeatureRequest(c.Request.Context(), db.UpdateFeatureRequestParams{
		ID:          id,
		Title:       req.Title,
		Description: descriptionToText(req.Description),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"featureRequest": newFeatureRequestResponse(
		row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, existing.CreatedByName, existing.UpvoteCount, existing.ViewerHasVoted,
	)})
}

type updateFeatureRequestStatusRequest struct {
	Status string `json:"status" binding:"required"`
}

func (h *FeatureRequestHandler) UpdateStatus(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	var req updateFeatureRequestStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil || !validFeatureRequestStatuses[req.Status] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}

	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.ProjectOwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	row, err := h.Queries.UpdateFeatureRequestStatus(c.Request.Context(), db.UpdateFeatureRequestStatusParams{
		ID:     id,
		Status: req.Status,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"featureRequest": newFeatureRequestResponse(
		row.ID, row.ProjectID, row.CreatedBy, row.Title, row.Description, row.Status, row.CreatedAt, existing.CreatedByName, existing.UpvoteCount, existing.ViewerHasVoted,
	)})
}

func (h *FeatureRequestHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy != userID && existing.ProjectOwnerID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if err := h.Queries.SoftDeleteFeatureRequest(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *FeatureRequestHandler) Vote(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	existing, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if existing.CreatedBy == userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	if err := h.Queries.CreateVote(c.Request.Context(), db.CreateVoteParams{FeatureRequestID: id, UserID: userID}); err != nil {
		var pgErr *pgconn.PgError
		if !(errors.As(err, &pgErr) && pgErr.Code == "23505") {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
			return
		}
		// 23505 = unique violation: an active vote already exists. Idempotent — fall through.
	}

	h.respondWithFeatureRequest(c, userID, id, http.StatusOK)
}

func (h *FeatureRequestHandler) Unvote(c *gin.Context) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid feature request id"})
		return
	}
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	if _, err := h.Queries.GetFeatureRequestByID(c.Request.Context(), db.GetFeatureRequestByIDParams{ViewerID: userID, ID: id}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "feature request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	if err := h.Queries.RemoveVote(c.Request.Context(), db.RemoveVoteParams{FeatureRequestID: id, UserID: userID}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
		return
	}
	h.respondWithFeatureRequest(c, userID, id, http.StatusOK)
}
