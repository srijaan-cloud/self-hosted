CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  grade TEXT
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  wake_ready INTEGER DEFAULT 0,
  reading INTEGER DEFAULT 0,
  breakfast_prep INTEGER DEFAULT 0,
  sleep INTEGER DEFAULT 0,
  homework INTEGER DEFAULT 0,
  sports INTEGER DEFAULT 0,
  play INTEGER DEFAULT 0,
  drawing INTEGER DEFAULT 0,
  painting INTEGER DEFAULT 0,
  helping INTEGER DEFAULT 0,
  UNIQUE(child_id, date),
  FOREIGN KEY(child_id) REFERENCES children(id)
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_name TEXT,
  transports TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO children (name, grade) VALUES ('Lahari', '8th Grade');
INSERT INTO children (name, grade) VALUES ('NagaSourish', '5th Grade');
