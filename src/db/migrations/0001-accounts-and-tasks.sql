CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX app_sessions_expiry ON app_sessions(expires_at);
CREATE TABLE app_auth_throttle (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  started_at timestamptz NOT NULL
);
CREATE INDEX app_auth_throttle_expiry ON app_auth_throttle(started_at);
CREATE TABLE app_tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_tasks_owner ON app_tasks(user_id, created_at);
