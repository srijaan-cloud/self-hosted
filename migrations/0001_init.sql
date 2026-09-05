CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login TEXT
);

-- One row per booked date+session. Absence of a row for a given date/session
-- means it's available. session is 'full_day', 'morning', or 'evening' — a
-- 'full_day' row for a date occupies the whole day, so the app must reject
-- creating a 'morning'/'evening' row for a date that already has a 'full_day'
-- row (and reject creating 'full_day' if either half is already booked).
CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date TEXT NOT NULL,
  session TEXT NOT NULL CHECK (session IN ('full_day', 'morning', 'evening')),
  customer_name TEXT,
  event_type TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_date, session)
);

CREATE INDEX idx_bookings_event_date ON bookings(event_date);

CREATE TABLE gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key TEXT NOT NULL,
  caption TEXT,
  uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP
);
