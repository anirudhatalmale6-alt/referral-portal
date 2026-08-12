"use strict";
/**
 * Database layer. SQLite via better-sqlite3 — a single file on disk, no separate
 * database server to run or pay for. If the practice ever outgrows it the schema
 * moves to PostgreSQL with very little rework.
 */
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "portal.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- admin | staff | auth | viewer
  password_hash TEXT NOT NULL,
  must_change    INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Lookup tables. Everything in here is managed by the practice from the Admin
-- screen; nothing is hard-coded in the application.
CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, category TEXT NOT NULL DEFAULT 'Other',
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
-- kind drives colour + workflow: pending_lop | ready | scheduled | inoffice | done | negative
CREATE TABLE IF NOT EXISTS statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'done',
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS attorneys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, firm TEXT, phone TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS referring_doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, practice TEXT, phone TEXT, email TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  pid          TEXT UNIQUE,
  first_name   TEXT NOT NULL,
  middle_name  TEXT,
  last_name    TEXT NOT NULL,
  dob          TEXT,
  phone        TEXT,
  alt_phone    TEXT,
  email        TEXT,
  doi          TEXT,               -- date of injury / accident
  gender       TEXT,
  address      TEXT,
  city         TEXT,
  state        TEXT,
  zip          TEXT,
  payer        TEXT NOT NULL DEFAULT 'LOP',
  attorney_id  INTEGER REFERENCES attorneys(id),
  doctor_id    INTEGER REFERENCES referring_doctors(id),
  order_date   TEXT,
  lop_status   TEXT NOT NULL DEFAULT 'Pending',   -- Pending | Approved
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_lop ON patients(lop_status);

CREATE TABLE IF NOT EXISTS procedures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  exam        TEXT NOT NULL,
  scheduled_at TEXT,               -- 'YYYY-MM-DDTHH:MM', blank until scheduled
  facility    TEXT,
  provider    TEXT,
  status      TEXT NOT NULL DEFAULT 'Pending LOP',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_proc_patient ON procedures(patient_id);
CREATE INDEX IF NOT EXISTS idx_proc_sched ON procedures(scheduled_at);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'note',  -- note | sms
  author_id  INTEGER REFERENCES users(id),
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_patient ON notes(patient_id);

-- Every write is recorded. Required for HIPAA and genuinely useful when someone
-- asks "who changed this patient's status?".
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

module.exports = db;
