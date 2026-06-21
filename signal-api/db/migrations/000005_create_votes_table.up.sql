CREATE TABLE votes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
    user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX votes_feature_request_user_active_idx
    ON votes (feature_request_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX votes_user_id_idx ON votes (user_id);

CREATE TRIGGER votes_set_updated_at BEFORE UPDATE ON votes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
