CREATE TABLE assistant_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  instructions text NOT NULL CHECK(length(instructions) BETWEEN 1 AND 4000)
);
CREATE TABLE assistant_members (
  user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE
);
CREATE TABLE assistant_conversations (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 100),
  busy boolean NOT NULL DEFAULT false,
  busy_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user ON assistant_conversations(user_id, created_at DESC);
CREATE TABLE assistant_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK(role IN ('user','assistant')),
  content text NOT NULL CHECK(length(content) <= 20000),
  request_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assistant_approvals (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  conversation_id text REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK(capability IN ('email.send')),
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','waiting','done','unknown','failed')),
  decided_by uuid REFERENCES app_users(id),
  job_id text,
  result jsonb,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, id)
);
CREATE TABLE assistant_operations (
  key text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  capability text NOT NULL,
  input jsonb NOT NULL,
  job_id text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
