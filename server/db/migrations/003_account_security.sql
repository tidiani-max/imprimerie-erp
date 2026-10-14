-- Account security: deactivate a user without deleting their history, and end old sessions
-- when a password is changed or reset (token_version is checked on every request).
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;
