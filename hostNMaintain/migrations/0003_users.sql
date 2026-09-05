-- Records every successful Google sign-in (admin or not), so the admin can
-- see who has logged in. `role` is stored now (default 'viewer') even though
-- nothing enforces it yet — admin access is still solely ADMIN_EMAIL + OTP
-- (see server/oauth.js) — this is groundwork for role-based access, not a
-- live permission system yet.
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  first_login_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT NOT NULL DEFAULT (datetime('now'))
);
