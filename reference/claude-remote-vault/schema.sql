-- continuity-vault schema (Cloudflare D1 / SQLite)
-- Apply once: wrangler d1 execute <database-name> --remote --file schema.sql

CREATE TABLE IF NOT EXISTS files (
  path        TEXT PRIMARY KEY,
  content     TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT
);

-- Every prior state of every file. Written before each write, patch, append and delete.
CREATE TABLE IF NOT EXISTS versions (
  path      TEXT NOT NULL,
  version   INTEGER NOT NULL,
  content   TEXT NOT NULL,
  saved_at  TEXT NOT NULL,
  saved_by  TEXT,
  PRIMARY KEY (path, version)
);
CREATE INDEX IF NOT EXISTS idx_versions_path ON versions(path, version DESC);

-- Optional photo shelf: metadata here, image bytes in a KV namespace bound as PHOTOS.
CREATE TABLE IF NOT EXISTS photos (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  who           TEXT,
  date          TEXT,
  why           TEXT,
  content_type  TEXT NOT NULL DEFAULT 'image/jpeg',
  size          INTEGER,
  kv_key        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_photos_date ON photos(date DESC);
