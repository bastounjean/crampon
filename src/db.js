// Base de données : Postgres (Neon) si DATABASE_URL est défini, sinon un fichier SQLite local.
// Même interface asynchrone dans les deux cas : get / all / run, avec des « ? » comme paramètres.
const path = require('path');
const fs = require('fs');

const PG = !!process.env.DATABASE_URL;
const now = () => new Date().toISOString();

// Une seule description des tables, avec les quelques mots qui changent d'un moteur à l'autre
const schema = (id) => `
CREATE TABLE IF NOT EXISTS users (
  id ${id},
  username TEXT NOT NULL,
  pass TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name ON users (lower(username));
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS games (
  id ${id},
  day TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon TEXT,
  status TEXT NOT NULL DEFAULT 'playing',
  guesses TEXT NOT NULL DEFAULT '[]',
  hints INTEGER NOT NULL DEFAULT 0,
  finished_at TEXT,
  points INTEGER,
  UNIQUE (day, user_id),
  UNIQUE (day, anon)
);
CREATE INDEX IF NOT EXISTS games_day ON games (day, status);
CREATE INDEX IF NOT EXISTS games_user ON games (user_id);
CREATE INDEX IF NOT EXISTS games_anon ON games (anon);
CREATE TABLE IF NOT EXISTS leagues (
  id ${id},
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS league_members (
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS league_members_user ON league_members (user_id);
CREATE TABLE IF NOT EXISTS league_winners (
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  username TEXT NOT NULL,
  total INTEGER NOT NULL,
  PRIMARY KEY (league_id, month)
);
CREATE TABLE IF NOT EXISTS packs (
  id ${id},
  day TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  anon TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (day, user_id),
  UNIQUE (day, anon)
);
CREATE INDEX IF NOT EXISTS packs_user ON packs (user_id);
CREATE INDEX IF NOT EXISTS packs_anon ON packs (anon);
CREATE TABLE IF NOT EXISTS cards (
  pack_id INTEGER NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  PRIMARY KEY (pack_id, slot)
);
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  vid TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  ref TEXT,
  mobile INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, vid)
);
CREATE TABLE IF NOT EXISTS draws (
  day TEXT PRIMARY KEY,
  player_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS duels (
  id TEXT PRIMARY KEY,
  code TEXT,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS duels_code ON duels (code);
CREATE TABLE IF NOT EXISTS page_views (
  day TEXT NOT NULL,
  path TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
);
`;

// colonnes ajoutées après la création des tables
const MIGRATIONS = [
  'ALTER TABLE games ADD COLUMN hint_list TEXT', // indices donnés, dans l'ordre (JSON) ; sinon les « hints » premiers de la liste
];

let api;

if (PG) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => parseInt(v, 10)); // COUNT, SUM → nombres
  types.setTypeParser(1700, (v) => parseFloat(v)); // AVG → nombre
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
    max: 10,
    // une connexion neuve vers Neon coûte plusieurs allers-retours (TLS, mot de passe) : on les garde ouvertes
    idleTimeoutMillis: 0,
    keepAlive: true,
  });
  // deux connexions prêtes dès le démarrage
  Promise.all([1, 2].map(() => pool.query('SELECT 1'))).catch(() => {});
  pool.on('error', (e) => console.warn('Postgres :', e.message));
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + ++i); };
  const q = (sql, params) => pool.query(conv(sql), params);
  api = {
    kind: 'postgres',
    ready: pool.query(schema('SERIAL PRIMARY KEY'))
      .then(() => pool.query(MIGRATIONS.map((m) => m.replace('ADD COLUMN', 'ADD COLUMN IF NOT EXISTS')).join(';\n')))
      .then(() => console.log('Base Postgres prête.')),
    get: async (sql, ...p) => (await q(sql, p)).rows[0],
    all: async (sql, ...p) => (await q(sql, p)).rows,
    run: async (sql, ...p) => { const r = await q(sql, p); return { changes: r.rowCount, rows: r.rows }; },
    jlen: (col) => `json_array_length(${col}::json)`,
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const local = path.join(__dirname, '..', 'data', 'crampon.db');
  let file = process.env.DB_PATH || local;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
  } catch {
    console.warn(`DB_PATH inutilisable (${file}), base locale utilisée à la place.`);
    file = local;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(schema('INTEGER PRIMARY KEY'));
  for (const m of MIGRATIONS) try { db.exec(m); } catch { /* déjà fait */ }
  console.log('Base SQLite locale :', file, '(effacée à chaque déploiement sur Render, mets DATABASE_URL pour la garder)');
  api = {
    kind: 'sqlite',
    ready: Promise.resolve(),
    get: async (sql, ...p) => db.prepare(sql).get(...p),
    all: async (sql, ...p) => db.prepare(sql).all(...p),
    run: async (sql, ...p) => {
      if (/\breturning\b/i.test(sql)) { const rows = db.prepare(sql).all(...p); return { changes: rows.length, rows }; }
      const r = db.prepare(sql).run(...p);
      return { changes: r.changes, rows: [] };
    },
    jlen: (col) => `json_array_length(${col})`,
  };
}

api.now = now;
module.exports = api;
