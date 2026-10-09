ALTER TABLE sessions ADD COLUMN screen_comments INTEGER NOT NULL DEFAULT 0
  CHECK (screen_comments IN (0, 1));
