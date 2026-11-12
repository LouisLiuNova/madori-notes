BEGIN;

CREATE TABLE profiles (
  id uuid PRIMARY KEY,
  username_key text NOT NULL UNIQUE,
  username text NOT NULL,
  recovery_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  digest text PRIMARY KEY,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_profile_idx ON sessions(profile_id);

CREATE TABLE progress (
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  level_id text NOT NULL,
  board jsonb NOT NULL,
  hints integer NOT NULL CHECK (hints BETWEEN 0 AND 3),
  revision integer NOT NULL CHECK (revision > 0),
  completed_at timestamptz,
  completed_hints integer CHECK (completed_hints BETWEEN 0 AND 3),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, level_id),
  CHECK ((completed_at IS NULL) = (completed_hints IS NULL))
);

CREATE TABLE daily_challenges (
  challenge_date date PRIMARY KEY,
  seed text NOT NULL,
  level jsonb NOT NULL,
  witnesses jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_reports (
  challenge_date date PRIMARY KEY REFERENCES daily_challenges(challenge_date) ON DELETE CASCADE,
  quality jsonb NOT NULL,
  elapsed_ms integer NOT NULL CHECK (elapsed_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rate_windows (
  bucket text NOT NULL,
  window_start bigint NOT NULL,
  hits integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (bucket, window_start)
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE generation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_windows ENABLE ROW LEVEL SECURITY;

COMMIT;
