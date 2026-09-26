ALTER TABLE sessions ADD COLUMN lock_questions INTEGER NOT NULL DEFAULT 1
  CHECK (lock_questions IN (0, 1));
