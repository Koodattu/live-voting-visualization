ALTER TABLE sessions ADD COLUMN ai_recap_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (ai_recap_enabled IN (0, 1));
ALTER TABLE sessions ADD COLUMN recap_visible INTEGER NOT NULL DEFAULT 0
  CHECK (recap_visible IN (0, 1));
ALTER TABLE sessions ADD COLUMN recap_status TEXT NOT NULL DEFAULT 'idle'
  CHECK (recap_status IN ('idle', 'generating', 'ready', 'failed'));
ALTER TABLE sessions ADD COLUMN recap_content TEXT;
ALTER TABLE sessions ADD COLUMN recap_generation_id TEXT;
