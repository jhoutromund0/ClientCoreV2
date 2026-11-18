ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS user_agent TEXT,
    ADD COLUMN IF NOT EXISTS ip TEXT,
    ADD COLUMN IF NOT EXISTS flash JSONB;

DELETE FROM sessions WHERE absolute_expires_at IS NULL;
ALTER TABLE sessions ALTER COLUMN absolute_expires_at SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_id_idx ON sessions(id);
CREATE INDEX IF NOT EXISTS sessions_user_seen_idx ON sessions(user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS users_name_id_idx ON users(name, id);

CREATE TABLE IF NOT EXISTS login_attempts (
    bucket_key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts > 0),
    next_attempt_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS login_attempts_window_idx ON login_attempts(window_started_at);

CREATE TABLE IF NOT EXISTS password_links (
    token_hash CHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS password_links_expires_idx ON password_links(expires_at);
