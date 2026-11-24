import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('DONOR','CHARITY','ADMIN')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  profile_address TEXT, profile_photo_data BLOB, profile_photo_type TEXT,
  id_proof_data BLOB, id_proof_type TEXT, id_proof_name TEXT);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS charities(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
  image TEXT, contact_email TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  review_note TEXT, archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS campaigns(
  id INTEGER PRIMARY KEY, charity_id INTEGER NOT NULL REFERENCES charities(id),
  title TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL, category TEXT NOT NULL,
  goal_paise INTEGER NOT NULL CHECK(goal_paise > 0), start_date TEXT NOT NULL, end_date TEXT NOT NULL, image TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','PENDING','ACTIVE','PAUSED','REJECTED','COMPLETED')),
  review_note TEXT, archived_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_campaign_status ON campaigns(status, category);
CREATE TABLE IF NOT EXISTS donations(
  id INTEGER PRIMARY KEY, donor_id INTEGER NOT NULL REFERENCES users(id), campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0), currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED','REFUNDED')),
  simulated INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_don_campaign ON donations(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_don_donor ON donations(donor_id);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, donation_id INTEGER NOT NULL UNIQUE REFERENCES donations(id),
  provider TEXT NOT NULL, provider_ref TEXT, order_id TEXT NOT NULL UNIQUE,
  amount_paise INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SUCCESS','FAILED','CANCELLED','EXPIRED','UNDER_REVIEW','REFUNDED')),
  utr TEXT, expires_at TEXT NOT NULL, instructions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS payment_events(delivery_id TEXT PRIMARY KEY, order_id TEXT, received_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS campaign_updates(
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id), author_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), type TEXT NOT NULL, message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit_logs(
  id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER,
  detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

export function openDb(path = ':memory:') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const campaignColumns = db.prepare('PRAGMA table_info(campaigns)').all();
  if (!campaignColumns.some((column) => column.name === 'archived_at')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN archived_at TEXT');
  }
  for (const [name, type] of [
    ['image_data', 'BLOB'],
    ['image_type', 'TEXT'],
    ['document_data', 'BLOB'],
    ['document_type', 'TEXT'],
    ['document_name', 'TEXT'],
  ]) {
    if (!campaignColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${type}`);
  }
  if (!campaignColumns.some((column) => column.name === 'resumed_at')) {
    db.exec('ALTER TABLE campaigns ADD COLUMN resumed_at TEXT');
  }
  const charityColumns = db.prepare('PRAGMA table_info(charities)').all();
  if (!charityColumns.some((column) => column.name === 'archived_at')) {
    db.exec('ALTER TABLE charities ADD COLUMN archived_at TEXT');
  }
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  for (const [name, type] of [
    ['profile_address', 'TEXT'],
    ['profile_photo_data', 'BLOB'],
    ['profile_photo_type', 'TEXT'],
    ['id_proof_data', 'BLOB'],
    ['id_proof_type', 'TEXT'],
    ['id_proof_name', 'TEXT'],
  ]) {
    if (!userColumns.some((column) => column.name === name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
  }
  return db;
}
export const tx = (db, fn) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
