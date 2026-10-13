const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const local = path.join(__dirname, '..', 'data', 'crampon.db');
let file = process.env.DB_PATH || local;
try {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.accessSync(path.dirname(file), fs.constants.W_OK);
} catch {
  // dossier absent ou non inscriptible (ex. pas de disque sur Render gratuit) : on se rabat sur ./data
  console.warn(`DB_PATH inutilisable (${file}), base locale utilisée à la place.`);
  file = local;
  fs.mkdirSync(path.dirname(file), { recursive: true });
}
const db = new DatabaseSync(file);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon TEXT,
  status TEXT NOT NULL DEFAULT 'playing',  -- playing | won | gaveup
  guesses TEXT NOT NULL DEFAULT '[]',
  hints INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  UNIQUE (day, user_id),
  UNIQUE (day, anon)
);
CREATE INDEX IF NOT EXISTS games_day ON games(day, status);
`);

module.exports = db;
