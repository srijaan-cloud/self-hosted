-- Google/OTP self-service accounts have no username or password — 0003 added the
-- email/role columns for them but left username/password_hash/salt NOT NULL from
-- the original staff_users table. SQLite can't drop a NOT NULL via ALTER COLUMN,
-- so recreate the table.

CREATE TABLE users_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT,
  salt TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  email TEXT,
  all_projects_access INTEGER NOT NULL DEFAULT 0,
  last_login TEXT
);

INSERT INTO users_new (id, name, username, password_hash, salt, role, created_at, email, all_projects_access, last_login)
SELECT id, name, username, password_hash, salt, role, created_at, email, all_projects_access, last_login FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
