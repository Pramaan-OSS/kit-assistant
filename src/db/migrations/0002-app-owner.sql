-- The app's owner is the account Pramaan's owner pass opens (lib/accounts.ts), never the first to sign up.
-- It has no email or password until the owner chooses them, and there is only ever one.
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL, ALTER COLUMN password_hash DROP NOT NULL;
CREATE UNIQUE INDEX app_users_one_owner ON app_users (role) WHERE role = 'owner';
-- Each pass opens the app once: its nonce is kept until the pass has expired.
CREATE TABLE app_owner_passes (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_owner_passes_expiry ON app_owner_passes(expires_at);
