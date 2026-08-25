CREATE TABLE IF NOT EXISTS staff_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'site_engineer', -- director | site_engineer | accountant
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  client_name TEXT,
  site_address TEXT,
  city TEXT,
  start_date TEXT,
  expected_end_date TEXT,
  actual_end_date TEXT,
  status TEXT NOT NULL DEFAULT 'planning', -- planning | ongoing | on_hold | completed
  total_budget REAL NOT NULL DEFAULT 0,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_assignments (
  project_id INTEGER NOT NULL,
  staff_user_id INTEGER NOT NULL,
  PRIMARY KEY (project_id, staff_user_id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(staff_user_id) REFERENCES staff_users(id)
);

CREATE TABLE IF NOT EXISTS material_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  default_unit TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  gst_number TEXT,
  address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS material_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  material_type_id INTEGER NOT NULL,
  vendor_id INTEGER,
  date TEXT NOT NULL,
  quantity_ordered REAL NOT NULL DEFAULT 0,
  quantity_received REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL,
  rate_per_unit REAL NOT NULL DEFAULT 0,
  amount_total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  invoice_number TEXT,
  bill_attachment_key TEXT,
  status TEXT NOT NULL DEFAULT 'ordered', -- ordered | partial | received | cancelled
  notes TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(material_type_id) REFERENCES material_types(id),
  FOREIGN KEY(vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  material_entry_id INTEGER,
  category TEXT NOT NULL DEFAULT 'material', -- material | labor | equipment | transport | misc | advance
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL, -- cash | gpay | phonepe | cheque | netbanking | bank_transfer | card | other
  transaction_id TEXT,
  cheque_number TEXT,
  bank_name TEXT,
  paid_to TEXT,
  paid_by TEXT,
  receipt_attachment_key TEXT,
  remarks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(material_entry_id) REFERENCES material_entries(id)
);

CREATE TABLE IF NOT EXISTS labor_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  trade TEXT NOT NULL, -- mason | carpenter | electrician | plumber | helper | other
  contractor_name TEXT,
  worker_count INTEGER NOT NULL DEFAULT 1,
  wage_rate REAL NOT NULL DEFAULT 0,
  amount_total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS equipment_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  equipment_name TEXT NOT NULL,
  vendor TEXT,
  date_from TEXT,
  date_to TEXT,
  rate REAL NOT NULL DEFAULT 0,
  rate_unit TEXT NOT NULL DEFAULT 'per_day', -- per_day | per_hour | per_trip
  amount_total REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS project_funding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'client', -- client | owner | loan
  amount REAL NOT NULL,
  payment_mode TEXT NOT NULL,
  transaction_id TEXT,
  remarks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);

INSERT INTO material_types (name, default_unit) VALUES ('Steel', 'kg');
INSERT INTO material_types (name, default_unit) VALUES ('Cement', 'bags');
INSERT INTO material_types (name, default_unit) VALUES ('Sand', 'cu.ft');
INSERT INTO material_types (name, default_unit) VALUES ('Tiles', 'sq.ft');
INSERT INTO material_types (name, default_unit) VALUES ('Granite', 'sq.ft');
INSERT INTO material_types (name, default_unit) VALUES ('Putty', 'bags');
INSERT INTO material_types (name, default_unit) VALUES ('RMC', 'cu.m');
INSERT INTO material_types (name, default_unit) VALUES ('Bricks', 'pieces');
INSERT INTO material_types (name, default_unit) VALUES ('Other', 'units');
