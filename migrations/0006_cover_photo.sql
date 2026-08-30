-- Lets an admin pick which uploaded photo (floor plan, progress, or gallery)
-- represents a project on the showcase grid, instead of always defaulting to
-- the first floor plan.
ALTER TABLE projects ADD COLUMN cover_media_id INTEGER;
