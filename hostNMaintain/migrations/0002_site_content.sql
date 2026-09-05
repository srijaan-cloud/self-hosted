-- Singleton row holding every piece of admin-editable marketing copy on the
-- public site (hero, what-we-do, process, features, clients, contact, footer)
-- as one JSON blob, so the admin can rewrite the homepage without a code
-- change. Missing keys fall back to defaults in server/index.js. Same pattern
-- as tapasyaConstructions/migrations/0011_site_content.sql.
CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
