-- Unifies the admin-created username/password accounts with self-service
-- Google/OTP-verified accounts into a single users table, and adds explicit
-- per-user "all projects" scoping (rather than overloading "no assignment
-- rows" to mean either "no access" or "all access").
--
-- Role model: director (full access, all projects) | site_supervisor (can
-- edit their scoped project(s)) | auditor (read-only, scoped project(s)) |
-- viewer (read-only, all projects — the default for any new self-service
-- login). No real staff/role data exists in production yet, so no
-- data-preserving remap is needed beyond the rename itself.

ALTER TABLE staff_users RENAME TO users;
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN all_projects_access INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

UPDATE users SET role = 'site_supervisor' WHERE role = 'site_engineer';
UPDATE users SET all_projects_access = 1 WHERE role = 'director';

ALTER TABLE project_assignments RENAME COLUMN staff_user_id TO user_id;
