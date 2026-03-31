CREATE TABLE IF NOT EXISTS site_content (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Legacy: poprzednie sesje panelu (przy logowaniu haslem). Przy Firebase nie jest uzywane.
CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  event_type TEXT,
  preferred_date TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hall_key TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  label TEXT NOT NULL,
  notes TEXT,
  guests_count INTEGER,
  exclusive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  cover_image_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gallery_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  alt_text TEXT DEFAULT '',
  mime_type TEXT NOT NULL,
  blob_data BLOB NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  blob_data BLOB NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_room_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  alt_text TEXT DEFAULT '',
  mime_type TEXT NOT NULL,
  blob_data BLOB NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_mail_templates (
  service TEXT NOT NULL,
  key TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (service, key)
);

CREATE TABLE IF NOT EXISTS hotel_rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_per_night REAL NOT NULL DEFAULT 0,
  max_guests INTEGER NOT NULL DEFAULT 2,
  beds_single INTEGER NOT NULL DEFAULT 0,
  beds_double INTEGER NOT NULL DEFAULT 1,
  beds_child INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  image_urls_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel_reservations (
  id TEXT PRIMARY KEY,
  human_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_prefix TEXT NOT NULL DEFAULT '',
  phone_national TEXT NOT NULL DEFAULT '',
  phone_e164 TEXT NOT NULL DEFAULT '',
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  total_price REAL NOT NULL DEFAULT 0,
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  room_ids_json TEXT NOT NULL DEFAULT '[]',
  confirmation_token_hash TEXT,
  email_verification_expires_at INTEGER,
  pending_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hotel_res_status_dates ON hotel_reservations(status, date_from, date_to);

CREATE TABLE IF NOT EXISTS restaurant_settings (
  id TEXT PRIMARY KEY,
  table_count INTEGER NOT NULL,
  max_guests_per_table INTEGER NOT NULL,
  reservation_open_time TEXT NOT NULL,
  reservation_close_time TEXT NOT NULL,
  time_slot_minutes INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL,
  zone TEXT NOT NULL DEFAULT 'sala',
  active INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id TEXT PRIMARY KEY,
  human_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_prefix TEXT NOT NULL DEFAULT '',
  phone_national TEXT NOT NULL DEFAULT '',
  phone_e164 TEXT NOT NULL DEFAULT '',
  reservation_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  tables_count INTEGER NOT NULL,
  guests_count INTEGER NOT NULL,
  join_tables INTEGER NOT NULL DEFAULT 0,
  assigned_table_ids_json TEXT NOT NULL DEFAULT '[]',
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  cleanup_buffer_minutes INTEGER NOT NULL DEFAULT 30,
  confirmation_token_hash TEXT,
  email_verification_expires_at INTEGER,
  pending_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rest_res_status_time ON restaurant_reservations(status, start_ms, end_ms);

CREATE TABLE IF NOT EXISTS venue_settings (
  id TEXT PRIMARY KEY,
  hall_open_time TEXT NOT NULL,
  hall_close_time TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_halls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  hall_kind TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  exclusive_rule TEXT NOT NULL DEFAULT 'optional',
  buffer_minutes INTEGER NOT NULL DEFAULT 60,
  full_block_guest_threshold INTEGER NOT NULL DEFAULT 100,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS venue_reservations (
  id TEXT PRIMARY KEY,
  human_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  hall_id TEXT NOT NULL,
  hall_name_snapshot TEXT NOT NULL,
  hall_kind_snapshot TEXT NOT NULL,
  full_block_guest_threshold_snap INTEGER NOT NULL DEFAULT 100,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone_prefix TEXT NOT NULL DEFAULT '',
  phone_national TEXT NOT NULL DEFAULT '',
  phone_e164 TEXT NOT NULL DEFAULT '',
  reservation_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  duration_hours REAL NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  start_time_label TEXT NOT NULL DEFAULT '',
  end_time_label TEXT NOT NULL DEFAULT '',
  guests_count INTEGER NOT NULL DEFAULT 0,
  exclusive INTEGER NOT NULL DEFAULT 0,
  full_block INTEGER NOT NULL DEFAULT 0,
  event_type TEXT NOT NULL DEFAULT '',
  customer_note TEXT NOT NULL DEFAULT '',
  admin_note TEXT NOT NULL DEFAULT '',
  confirmation_token_hash TEXT,
  email_verification_expires_at INTEGER,
  pending_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_venue_res_status_time ON venue_reservations(status, hall_id, start_ms, end_ms);
