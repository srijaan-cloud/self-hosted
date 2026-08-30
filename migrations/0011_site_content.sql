-- Singleton row holding every piece of admin-editable marketing copy on the
-- public site (hero, services, lifecycle, execution steps/stats, contact
-- details) as one JSON blob, so a director can rewrite the homepage without
-- a code change. Missing keys fall back to defaults in server/index.js.
CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
