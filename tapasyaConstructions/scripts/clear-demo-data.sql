-- Run once real projects are ready to replace the demo data seeded by
-- migrations/0002_seed_demo_data.sql. NOT a migration — run manually:
--   npx wrangler d1 execute tapasya-constructions --remote --file scripts/clear-demo-data.sql
-- Leaves material_types (the master list) intact; clears everything else.

DELETE FROM payments;
DELETE FROM project_funding;
DELETE FROM equipment_entries;
DELETE FROM labor_entries;
DELETE FROM material_entries;
DELETE FROM vendors;
DELETE FROM project_assignments;
DELETE FROM projects;
