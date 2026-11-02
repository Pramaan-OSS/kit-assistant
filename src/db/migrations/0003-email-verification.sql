-- #1177: an account's email is verified once its owner opens the one-time link sent to it. Until then the app sends
-- that address nothing else (lib/accounts.ts verifiedEmail), so no one can sign up as someone else and have the app
-- write to them. Only a token's HMAC is kept, as for sessions; a link works once, for a day, for the address it went to.
ALTER TABLE app_users ADD COLUMN email_verified_at timestamptz;
CREATE TABLE app_email_verifications (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_email_verifications_user ON app_email_verifications(user_id);
