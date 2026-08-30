-- Owner/client contact number(s) for a project, comma-separated free text.
-- Internal-only (not exposed via /api/public/projects) since it's the client's
-- personal contact info, not a public enquiry line.
ALTER TABLE projects ADD COLUMN owner_phone TEXT;
