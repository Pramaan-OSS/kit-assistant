-- #1250: a member who forgot their password asks for a link (lib/accounts.ts reset-request); it goes only to a verified
-- address. Opening it sets a new password and ends every session of the account. Only a token's HMAC is kept, as for
-- sessions; one live link per account (a new request replaces it), working once, for an hour.
CREATE TABLE app_password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
