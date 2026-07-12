CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  join_name TEXT NOT NULL COLLATE NOCASE UNIQUE
    CHECK (length(join_name) BETWEEN 3 AND 24)
    CHECK (join_name NOT GLOB '*[^a-z0-9-]*'),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 100),
  language TEXT NOT NULL CHECK (language IN ('en', 'fi')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'ended')),
  presented_position INTEGER,
  furthest_presented_position INTEGER NOT NULL DEFAULT -1 CHECK (furthest_presented_position >= -1),
  display_theme TEXT NOT NULL DEFAULT 'light' CHECK (display_theme IN ('light', 'dark')),
  comment_wall_visible INTEGER NOT NULL DEFAULT 1 CHECK (comment_wall_visible IN (0, 1)),
  comments_public_at_end INTEGER CHECK (comments_public_at_end IN (0, 1)),
  control_revision INTEGER NOT NULL DEFAULT 0 CHECK (control_revision >= 0),
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  CHECK (
    (status = 'draft' AND started_at IS NULL AND ended_at IS NULL)
    OR (status = 'live' AND started_at IS NOT NULL AND ended_at IS NULL)
    OR (status = 'ended' AND started_at IS NOT NULL AND ended_at IS NOT NULL)
  )
);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  type TEXT NOT NULL CHECK (type IN ('single_choice', 'feedback')),
  prompt TEXT NOT NULL CHECK (length(trim(prompt)) BETWEEN 1 AND 240),
  status TEXT NOT NULL DEFAULT 'unshown' CHECK (status IN ('unshown', 'open', 'closed')),
  opened_at TEXT,
  closed_at TEXT,
  participation_denominator INTEGER CHECK (participation_denominator >= 0),
  UNIQUE (session_id, position),
  UNIQUE (session_id, id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  CHECK (
    (status = 'unshown' AND opened_at IS NULL AND closed_at IS NULL AND participation_denominator IS NULL)
    OR (status = 'open' AND opened_at IS NOT NULL AND closed_at IS NULL AND participation_denominator IS NULL)
    OR (status = 'closed' AND opened_at IS NOT NULL AND closed_at IS NOT NULL AND participation_denominator IS NOT NULL)
  )
);

CREATE UNIQUE INDEX one_open_question_per_session
  ON questions(session_id)
  WHERE status = 'open';

CREATE UNIQUE INDEX one_feedback_question_per_session
  ON questions(session_id)
  WHERE type = 'feedback';

CREATE TABLE options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 100),
  UNIQUE (question_id, position),
  UNIQUE (question_id, id),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE TABLE guest_identities (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE (session_id, id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX guest_identities_by_session
  ON guest_identities(session_id, joined_at);

CREATE TABLE votes (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, guest_id),
  FOREIGN KEY (session_id, question_id) REFERENCES questions(session_id, id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, guest_id) REFERENCES guest_identities(session_id, id) ON DELETE CASCADE,
  FOREIGN KEY (question_id, option_id) REFERENCES options(question_id, id)
);

CREATE INDEX votes_by_question_option
  ON votes(question_id, option_id);

CREATE TABLE comments (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  guest_id TEXT NOT NULL,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 160),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (question_id, guest_id),
  FOREIGN KEY (session_id, question_id) REFERENCES questions(session_id, id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, guest_id) REFERENCES guest_identities(session_id, id) ON DELETE CASCADE
);

CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  password_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX admin_sessions_by_expiry ON admin_sessions(expires_at);

CREATE TABLE request_receipts (
  session_id TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (session_id, actor_key, request_id),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX request_receipts_by_created_at
  ON request_receipts(created_at);

CREATE TRIGGER votes_require_open_single_choice_insert
BEFORE INSERT ON votes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM questions
    WHERE id = NEW.question_id
      AND session_id = NEW.session_id
      AND type = 'single_choice'
      AND status = 'open'
  ) THEN RAISE(ABORT, 'question_not_open') END;
END;

CREATE TRIGGER votes_require_open_single_choice_update
BEFORE UPDATE ON votes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM questions
    WHERE id = NEW.question_id
      AND session_id = NEW.session_id
      AND type = 'single_choice'
      AND status = 'open'
  ) THEN RAISE(ABORT, 'question_not_open') END;
END;

CREATE TRIGGER comments_require_open_feedback_insert
BEFORE INSERT ON comments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM questions
    WHERE id = NEW.question_id
      AND session_id = NEW.session_id
      AND type = 'feedback'
      AND status = 'open'
  ) THEN RAISE(ABORT, 'question_not_open') END;
END;

CREATE TRIGGER comments_require_open_feedback_update
BEFORE UPDATE ON comments
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM questions
    WHERE id = NEW.question_id
      AND session_id = NEW.session_id
      AND type = 'feedback'
      AND status = 'open'
  ) THEN RAISE(ABORT, 'question_not_open') END;
END;
