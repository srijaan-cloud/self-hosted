-- Public-facing showcase data, shown to viewers/guests instead of internal
-- financials: floor plans / progress photos, customer reviews, and per-project
-- pricing summary (deliberately separate from the internal cost-tracking tables).

ALTER TABLE projects ADD COLUMN price_per_sqft REAL;
ALTER TABLE projects ADD COLUMN total_area_sqft REAL;
ALTER TABLE projects ADD COLUMN sold_price_total REAL;
ALTER TABLE projects ADD COLUMN amenities TEXT;

CREATE TABLE IF NOT EXISTS project_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'gallery', -- floor_plan | progress | gallery
  image_key TEXT NOT NULL,
  title TEXT,
  caption TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  review_text TEXT,
  date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
