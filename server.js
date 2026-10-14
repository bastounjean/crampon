process.removeAllListeners('warning'); // masque l'avertissement "SQLite expérimental" de Node 22
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./src/db');
const G = require('./src/game');
const WD = require('./src/wikidata');

// ——— Joueurs : liste figée dans le dépôt, fiches rafraîchies chaque jour depuis Wikidata ———
const POOL = require('./src/data/pool.json');
G.setPool(POOL.ids, POOL.players);
async function refreshPlayers() {
  try {
    const fresh = await WD.fetchPlayers(POOL.ids);
    if (fresh.length < POOL.ids.length * 0.8) throw new Error(`seulement ${fresh.length} fiches reçues`);
    const got = new Set(fresh.map((p) => p.id));
    G.setPool(POOL.ids, [...fresh, ...POOL.players.filter((p) => !got.has(p.id))]);
    console.log(`Fiches mises à jour depuis Wikidata (${fresh.length}).`);
  } catch (e) {
    console.warn('Wikidata injoignable, on garde les fiches enregistrées :', e.message);
  }
}
if (process.env.NO_REFRESH !== '1') {
  setTimeout(refreshPlayers, 5000);
  setInterval(refreshPlayers, 24 * 3600 * 1000);
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const PROD = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 24 * 400 };

// ——— Identité : compte connecté, sinon visiteur anonyme ———
app.use((req, res, next) => {
  const sid = req.cookies.sid;
  if (sid) {
    req.user = db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(sid) || null;
  }
  let aid = req.cookies.aid;
  if (!aid || !/^[a-f0-9]{32}$/.test(aid)) {
    aid = crypto.randomBytes(16).toString('hex');
    res.cookie('aid', aid, cookieOpts);
  }
  req.aid = aid;
  next();
});

const owner = (req) => (req.user ? ['user_id', req.user.id] : ['anon', req.aid]);

function getGame(req, day, create) {
  const [col, val] = owner(req);
  let g = db.prepare(`SELECT * FROM games WHERE day = ? AND ${col} = ?`).get(day, val);
  if (!g && create) {
    db.prepare(`INSERT INTO games (day, ${col}) VALUES (?, ?)`).run(day, val);
    g = db.prepare(`SELECT * FROM games WHERE day = ? AND ${col} = ?`).get(day, val);
  }
  if (g) g.guesses = JSON.parse(g.guesses);
  return g;
}

function streakOf(userId) {
  const days = new Set(db.prepare("SELECT day FROM games WHERE user_id = ? AND status = 'won'").all(userId).map((r) => r.day));
  let i = G.dayIndex(G.today());
  if (!days.has(G.dayFromIndex(i))) i--; // la série tient toujours si aujourd'hui n'est pas encore joué
  let n = 0;
  while (i >= 0 && days.has(G.dayFromIndex(i))) { n++; i--; }
  const best = (() => {
    let b = 0, cur = 0;
    for (let k = 0; k <= G.dayIndex(G.today()); k++) { cur = days.has(G.dayFromIndex(k)) ? cur + 1 : 0; b = Math.max(b, cur); }
    return b;
  })();
  return { streak: n, best, found: days.size };
}

function publicUser(req) {
  if (!req.user) return null;
  return { username: req.user.username, ...streakOf(req.user.id) };
}

function dayStats(day) {
  const r = db.prepare("SELECT COUNT(*) n, AVG(json_array_length(guesses)) avg FROM games WHERE day = ? AND status = 'won'").get(day);
  const players = db.prepare("SELECT COUNT(*) n FROM games WHERE day = ? AND json_array_length(guesses) > 0").get(day).n;
  return { found: r.n, avg: r.avg ? Math.round(r.avg) : null, players };
}

function state(req) {
  const day = G.today();
  const idx = G.dayIndex(day);
  const target = G.playerOfDay(day);
  const g = getGame(req, day, false) || { status: 'playing', guesses: [], hints: 0 };
  const n = g.guesses.length;
  const over = g.status !== 'playing';
  let rank = null;
  if (g.status === 'won') {
    rank = db.prepare("SELECT COUNT(*) n FROM games WHERE day = ? AND status = 'won' AND finished_at <= ?").get(day, g.finished_at).n;
  }
  const yesterday = idx > 0 ? G.playerOfDay(G.dayFromIndex(idx - 1)) : null;
  return {
    day, number: idx + 1, status: g.status, guesses: g.guesses,
    best: g.guesses.reduce((m, x) => Math.max(m, x.temp), 0),
    hints: Array.from({ length: g.hints }, (_, k) => G.hintText(target, k)),
    hintReady: !over && g.hints < G.MAX_HINTS && n >= (g.hints + 1) * G.HINT_EVERY,
    nextHintAt: g.hints < G.MAX_HINTS ? (g.hints + 1) * G.HINT_EVERY : null,
    answer: over ? G.card(target) : null,
    card: G.revealCard(target, g.guesses, g.hints, over),
    rank, stats: dayStats(day),
    yesterday: yesterday ? { id: yesterday.id, name: yesterday.name, stats: dayStats(G.dayFromIndex(idx - 1)) } : null,
    user: publicUser(req),
  };
}

// ——— API jeu ———
app.get('/api/today', (req, res) => res.json(state(req)));

app.post('/api/guess', (req, res) => {
  const day = G.today();
  const target = G.playerOfDay(day);
  const q = String((req.body || {}).q || '').slice(0, 80);
  const r = G.resolve({ q });
  if (!r) return res.status(400).json({ error: `Je ne trouve rien pour « ${q.trim()} ». Essaie un joueur, un club, une ville, un pays, un poste, une génération…` });
  if (r.error) return res.status(400).json({ error: r.error });
  const g = getGame(req, day, true);
  if (g.status !== 'playing') return res.status(400).json({ error: 'La partie du jour est terminée.' });
  const key = r.type === 'player' ? r.player.id : r.clue.id;
  const dup = g.guesses.find((x) => x.key === key);
  if (dup) return res.json({ ...state(req), dup: dup.n });
  let entry;
  if (r.type === 'player') {
    const c = G.compare(target, r.player);
    entry = { n: g.guesses.length + 1, key, type: 'player', label: r.player.name, temp: c.temp, tags: c.tags };
  } else {
    const c = G.askClue(target, r.clue);
    entry = { n: g.guesses.length + 1, key, type: 'clue', label: r.clue.label, cat: r.clue.kind, temp: c.temp, yes: c.yes };
  }
  g.guesses.push(entry);
  const won = r.type === 'player' && r.player.id === target.id;
  db.prepare(`UPDATE games SET guesses = ?, status = ?, finished_at = ${won ? "strftime('%Y-%m-%d %H:%M:%f','now')" : 'finished_at'} WHERE id = ?`)
    .run(JSON.stringify(g.guesses), won ? 'won' : 'playing', g.id);
  res.json({ ...state(req), last: entry.n });
});

app.post('/api/hint', (req, res) => {
  const day = G.today();
  const g = getGame(req, day, true);
  if (g.status !== 'playing') return res.status(400).json({ error: 'Partie terminée.' });
  if (g.hints >= G.MAX_HINTS || g.guesses.length < (g.hints + 1) * G.HINT_EVERY)
    return res.status(400).json({ error: "Pas encore d'indice disponible." });
  db.prepare('UPDATE games SET hints = hints + 1 WHERE id = ?').run(g.id);
  res.json(state(req));
});

app.post('/api/giveup', (req, res) => {
  const g = getGame(req, G.today(), true);
  if (g.status === 'playing') db.prepare("UPDATE games SET status = 'gaveup', finished_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?").run(g.id);
  res.json(state(req));
});

// ——— Fiches joueurs ———
// Une fiche est visible si le joueur est sorti un jour passé, ou si c'est celui du jour et que ta partie est finie.
app.get('/api/player/:id', (req, res) => {
  const p = G.BY_ID[req.params.id];
  const day = G.today();
  const idx = G.dayIndex(day);
  let ok = false, when = null;
  if (p) {
    for (let i = 0; i < idx; i++) if (G.playerOfDay(G.dayFromIndex(i)).id === p.id) { ok = true; when = G.dayFromIndex(i); }
    if (G.playerOfDay(day).id === p.id) {
      const g = getGame(req, day, false);
      if (g && g.status !== 'playing') { ok = true; when = day; }
    }
  }
  if (!ok) return res.status(404).json({ error: 'Fiche pas encore débloquée.' });
  let mine = null;
  const g = getGame(req, when, false);
  if (g) mine = { status: g.status, guesses: g.guesses.length };
  res.json({ ...G.card(p), day: when, number: G.dayIndex(when) + 1, mine, stats: dayStats(when) });
});

app.get('/api/album', (req, res) => {
  const day = G.today();
  const idx = G.dayIndex(day);
  const [col, val] = owner(req);
  const mine = Object.fromEntries(db.prepare(`SELECT day, status, json_array_length(guesses) n, hints FROM games WHERE ${col} = ?`).all(val).map((r) => [r.day, r]));
  const days = [];
  for (let i = idx; i >= 0; i--) {
    const d = G.dayFromIndex(i);
    const p = G.playerOfDay(d);
    const m = mine[d];
    const visible = i < idx || (m && m.status !== 'playing');
    days.push({
      day: d, number: i + 1, today: i === idx,
      status: m ? m.status : null, guesses: m ? m.n : 0, hints: m ? m.hints : 0,
      player: visible ? { id: p.id, name: p.name, pos: G.card(p).pos, nat: G.card(p).nat[0] } : null,
    });
  }
  res.json({ days, user: publicUser(req), total: G.PLAYERS.length, edition: { day, number: idx + 1 } });
});

app.get('/api/leaderboard', (req, res) => {
  const users = db.prepare("SELECT u.id, u.username, COUNT(g.id) found, AVG(json_array_length(g.guesses)) avg FROM users u JOIN games g ON g.user_id = u.id AND g.status = 'won' GROUP BY u.id").all();
  const rows = users.map((u) => ({ username: u.username, found: u.found, avg: Math.round(u.avg), ...streakOf(u.id) }));
  const day = G.today();
  const fastest = db.prepare("SELECT u.username, json_array_length(g.guesses) n FROM games g JOIN users u ON u.id = g.user_id WHERE g.day = ? AND g.status = 'won' ORDER BY n, g.finished_at LIMIT 10").all(day);
  res.json({
    streaks: [...rows].sort((a, b) => b.streak - a.streak || b.found - a.found).slice(0, 20),
    found: [...rows].sort((a, b) => b.found - a.found || a.avg - b.avg).slice(0, 20),
    today: fastest,
  });
});

// ——— Comptes ———
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
};

function openSession(req, res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);
  res.cookie('sid', token, cookieOpts);
  // les parties jouées sans compte sur cet appareil rejoignent le compte
  db.prepare('UPDATE games SET user_id = ?, anon = NULL WHERE anon = ? AND day NOT IN (SELECT day FROM games WHERE user_id = ?)').run(userId, req.aid, userId);
}

const attempts = new Map();
function slowDown(req, res, next) {
  const k = req.ip;
  const now = Date.now();
  const a = (attempts.get(k) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (a.length > 20) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
  a.push(now);
  attempts.set(k, a);
  next();
}

app.post('/api/signup', slowDown, (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = String(username).trim();
  if (!/^[\p{L}0-9_.-]{3,20}$/u.test(u)) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères, lettres, chiffres, point, tiret ou underscore.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) return res.status(400).json({ error: 'Ce pseudo est déjà pris.' });
  const r = db.prepare('INSERT INTO users (username, pass) VALUES (?, ?)').run(u, hash(String(password)));
  openSession(req, res, r.lastInsertRowid);
  res.json({ ok: true });
});

app.post('/api/login', slowDown, (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!u || !check(String(password), u.pass)) return res.status(400).json({ error: 'Pseudo ou mot de passe incorrect.' });
  openSession(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => res.json({ user: publicUser(req), day: G.today(), number: G.dayIndex(G.today()) + 1 }));

// ——— Front ———
// la page porte l'empreinte des fichiers : après une mise à jour, le navigateur recharge le nouveau code
const PUB = path.join(__dirname, 'public');
const stamp = (f) => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, f))).digest('hex').slice(0, 10);
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  .replace('href="/style.css"', `href="/style.css?v=${stamp('style.css')}"`)
  .replace('src="/app.js"', `src="/app.js?v=${stamp('app.js')}"`);
app.get(['/', '/index.html', '/album', '/classement', '/compte', '/regles', '/joueur/:id'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX);
});
app.use(express.static(PUB, { maxAge: PROD ? '30d' : 0, index: false }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Footix tourne sur http://localhost:${port}`));
