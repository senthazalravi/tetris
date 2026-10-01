-- Email is collected at sign-up, only to send notifications. It is never used
-- to sign in or recover an account. Accounts created before this migration
-- have none.
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
