process.removeAllListeners('warning'); // masque l'avertissement "SQLite expérimental" de Node 22
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
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
// Pas de mise à jour au démarrage : la petite machine gratuite de Render doit d'abord répondre,
// sinon le déploiement peut rester bloqué. On attend que la liste ait 24 h (10 min minimum).
if (process.env.NO_REFRESH !== '1') {
  const DAY = 24 * 3600 * 1000;
  const age = Date.now() - new Date(POOL.generated || 0).getTime();
  const first = Math.max(10 * 60 * 1000, DAY - age);
  setTimeout(() => { refreshPlayers(); setInterval(refreshPlayers, DAY); }, first);
  console.log(`Prochaine mise à jour des joueurs dans ${Math.round(first / 60000)} min.`);
}

const app = express();
app.set('trust proxy', 1);

// L'adresse Render renvoie vers le vrai domaine. Le choix entre www et sans www est laissé à Render
// (il redirige déjà l'un vers l'autre : le refaire ici créait une boucle).
const DOMAIN = process.env.SITE_DOMAIN || 'foootix.com';
app.use((req, res, next) => {
  if ((req.hostname || '').toLowerCase().endsWith('.onrender.com')) return res.redirect(301, `https://${DOMAIN}${req.originalUrl}`);
  next();
});
app.use(compression()); // fichiers et réponses compressés : 3 à 5 fois moins lourds à télécharger
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

const PROD = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 24 * 395 }; // 13 mois, la limite conseillée par la CNIL

// Express 4 n'attrape pas les erreurs des fonctions async : on les renvoie proprement
const A = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'Petit souci de serveur, réessaie dans un instant.' });
});

const SESS = new Map(); // sessions gardées 5 min en mémoire pour éviter une requête à chaque clic

// ——— Identité : compte connecté, sinon visiteur anonyme ———
app.use('/api', A(async (req, res, next) => {
  const sid = req.cookies.sid;
  if (sid) {
    const c = SESS.get(sid);
    if (c && Date.now() - c.t < 5 * 60 * 1000) req.user = c.user;
    else {
      req.user = (await db.get('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', sid)) || null;
      if (SESS.size > 5000) SESS.clear();
      SESS.set(sid, { t: Date.now(), user: req.user });
    }
  }
  let aid = req.cookies.aid;
  if (!aid || !/^[a-f0-9]{32}$/.test(aid)) {
    aid = crypto.randomBytes(16).toString('hex');
    res.cookie('aid', aid, cookieOpts);
  }
  req.aid = aid;
  next();
}));

const owner = (req) => (req.user ? ['user_id', req.user.id] : ['anon', req.aid]);
const J = db.jlen;

async function getGame(req, day, create) {
  const [col, val] = owner(req);
  let g = await db.get(`SELECT * FROM games WHERE day = ? AND ${col} = ?`, day, val);
  if (!g && create) {
    await db.run(`INSERT INTO games (day, ${col}) VALUES (?, ?) ON CONFLICT DO NOTHING`, day, val);
    g = await db.get(`SELECT * FROM games WHERE day = ? AND ${col} = ?`, day, val);
  }
  if (g) g.guesses = JSON.parse(g.guesses);
  return g;
}

// séries calculées en une requête pour toute une liste de joueurs
async function wonDays(userIds) {
  const out = new Map(userIds.map((id) => [id, new Set()]));
  if (!userIds.length) return out;
  const rows = await db.all(`SELECT user_id, day FROM games WHERE status = 'won' AND user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
  for (const r of rows) out.get(r.user_id).add(r.day);
  return out;
}
function streakFrom(days) {
  const last = G.dayIndex(G.today());
  let i = last;
  if (!days.has(G.dayFromIndex(i))) i--; // la série tient toujours si aujourd'hui n'est pas encore joué
  let n = 0;
  while (i >= 0 && days.has(G.dayFromIndex(i))) { n++; i--; }
  let best = 0, cur = 0;
  for (let k = 0; k <= last; k++) { cur = days.has(G.dayFromIndex(k)) ? cur + 1 : 0; best = Math.max(best, cur); }
  return { streak: n, best, found: days.size };
}
const streakOf = async (userId) => streakFrom((await wonDays([userId])).get(userId));

// Chaque requête vers la base coûte un aller-retour : on les lance en parallèle quand on peut.
async function publicUser(req) {
  if (!req.user) return null;
  const [{ p }, st] = await Promise.all([
    db.get("SELECT COALESCE(SUM(points), 0) p FROM games WHERE user_id = ? AND status = 'won'", req.user.id),
    streakOf(req.user.id),
  ]);
  return { username: req.user.username, points: p, ...st };
}

// stats du jour : mêmes chiffres pour tout le monde, gardés 20 s en mémoire
const STATS = new Map();
async function dayStats(day) {
  const c = STATS.get(day);
  if (c && Date.now() - c.t < 20000) return c.v;
  const r = await db.get(`SELECT COUNT(*) FILTER (WHERE status = 'won') n, AVG(CASE WHEN status = 'won' THEN ${J('guesses')} END) avg,
      COUNT(*) FILTER (WHERE ${J('guesses')} > 0) players FROM games WHERE day = ?`, day);
  const v = { found: r.n, avg: r.avg ? Math.round(r.avg) : null, players: r.players };
  if (STATS.size > 50) STATS.clear();
  STATS.set(day, { t: Date.now(), v });
  return v;
}

async function state(req) {
  const day = G.today();
  const idx = G.dayIndex(day);
  const target = G.playerOfDay(day);
  const g = (await getGame(req, day, false)) || { status: 'playing', guesses: [], hints: 0 };
  const n = g.guesses.length;
  const over = g.status !== 'playing';
  const yesterday = idx > 0 ? G.playerOfDay(G.dayFromIndex(idx - 1)) : null;
  const [rank, stats, yStats, user] = await Promise.all([
    g.status === 'won' ? db.get("SELECT COUNT(*) n FROM games WHERE day = ? AND status = 'won' AND finished_at <= ?", day, g.finished_at).then((r) => r.n) : null,
    dayStats(day),
    yesterday ? dayStats(G.dayFromIndex(idx - 1)) : null,
    publicUser(req),
  ]);
  return {
    day, number: idx + 1, status: g.status, guesses: g.guesses,
    best: g.guesses.reduce((m, x) => Math.max(m, x.temp), 0),
    hints: Array.from({ length: g.hints }, (_, k) => G.hintText(target, k)),
    hintReady: !over && g.hints < G.MAX_HINTS && n >= (g.hints + 1) * G.HINT_EVERY,
    nextHintAt: g.hints < G.MAX_HINTS ? (g.hints + 1) * G.HINT_EVERY : null,
    answer: over ? G.card(target) : null,
    card: G.revealCard(target, g.guesses, g.hints, over),
    rank, stats,
    score: g.status === 'won' ? { ...G.score(target, n, g.hints), points: g.points ?? G.score(target, n, g.hints).points } : null,
    yesterday: yesterday ? { id: yesterday.id, name: yesterday.name, stats: yStats } : null,
    user,
  };
}

// Diagnostic : temps d'un aller-retour vers la base, et depuis quand le serveur est réveillé
app.get('/api/health', A(async (req, res) => {
  const pings = [];
  for (let i = 0; i < 3; i++) { const t = Date.now(); await db.get('SELECT 1 x'); pings.push(Date.now() - t); }
  res.set('Cache-Control', 'no-store');
  res.json({ base: db.kind, ping_base_ms: pings, serveur_eveille_depuis_min: Math.round(process.uptime() / 60) });
}));

// ——— API jeu ———
app.get('/api/today', A(async (req, res) => res.json(await state(req))));

app.post('/api/guess', A(async (req, res) => {
  const day = G.today();
  const target = G.playerOfDay(day);
  const q = String((req.body || {}).q || '').slice(0, 80);
  const r = G.resolve({ q });
  if (!r) return res.status(400).json({ error: `Je ne trouve rien pour « ${q.trim()} ». Essaie un joueur, un club, une ville, un pays, un poste, une génération…` });
  if (r.error) return res.status(400).json({ error: r.error });
  const g = await getGame(req, day, true);
  if (g.status !== 'playing') return res.status(400).json({ error: 'La partie du jour est terminée.' });
  const key = r.type === 'player' ? r.player.id : r.clue.id;
  const dup = g.guesses.find((x) => x.key === key);
  if (dup) return res.json({ ...(await state(req)), dup: dup.n });
  let entry;
  if (r.type === 'player') {
    const c = G.compare(target, r.player);
    entry = { n: g.guesses.length + 1, key, type: 'player', label: r.player.name, temp: c.temp, tags: c.tags };
  } else {
    const c = G.askClue(target, r.clue);
    entry = { n: g.guesses.length + 1, key, type: 'clue', label: r.clue.label, cat: r.clue.kind, temp: c.temp, yes: c.yes };
  }
  entry.temp = G.heat(target, [...g.guesses, entry]);
  g.guesses.push(entry);
  const won = r.type === 'player' && r.player.id === target.id;
  const pts = won ? G.score(target, g.guesses.length, g.hints).points : null;
  await db.run('UPDATE games SET guesses = ?, status = ?, points = ?, finished_at = ? WHERE id = ?',
    JSON.stringify(g.guesses), won ? 'won' : 'playing', pts, won ? db.now() : g.finished_at, g.id);
  if (won || g.guesses.length === 1) STATS.delete(day);
  res.json({ ...(await state(req)), last: entry.n });
}));

app.post('/api/hint', A(async (req, res) => {
  const g = await getGame(req, G.today(), true);
  if (g.status !== 'playing') return res.status(400).json({ error: 'Partie terminée.' });
  if (g.hints >= G.MAX_HINTS || g.guesses.length < (g.hints + 1) * G.HINT_EVERY)
    return res.status(400).json({ error: "Pas encore d'indice disponible." });
  await db.run('UPDATE games SET hints = hints + 1 WHERE id = ?', g.id);
  res.json(await state(req));
}));

app.post('/api/giveup', A(async (req, res) => {
  const g = await getGame(req, G.today(), true);
  if (g.status === 'playing') await db.run("UPDATE games SET status = 'gaveup', finished_at = ? WHERE id = ?", db.now(), g.id);
  res.json(await state(req));
}));

// ——— Fiches joueurs ———
// Une fiche est visible si le joueur est sorti un jour passé, ou si c'est celui du jour et que ta partie est finie.
app.get('/api/player/:id', A(async (req, res) => {
  const p = G.BY_ID[req.params.id];
  const day = G.today();
  const idx = G.dayIndex(day);
  let ok = false, when = null;
  if (p) {
    for (let i = 0; i < idx; i++) if (G.playerOfDay(G.dayFromIndex(i)).id === p.id) { ok = true; when = G.dayFromIndex(i); }
    if (G.playerOfDay(day).id === p.id) {
      const g = await getGame(req, day, false);
      if (g && g.status !== 'playing') { ok = true; when = day; }
    }
  }
  if (!ok) return res.status(404).json({ error: 'Fiche pas encore débloquée.' });
  let mine = null;
  const g = await getGame(req, when, false);
  if (g) mine = { status: g.status, guesses: g.guesses.length };
  res.json({ ...G.card(p), day: when, number: G.dayIndex(when) + 1, mine, stats: await dayStats(when) });
}));

app.get('/api/album', A(async (req, res) => {
  const day = G.today();
  const idx = G.dayIndex(day);
  const [col, val] = owner(req);
  const [rows, user] = await Promise.all([db.all(`SELECT day, status, ${J('guesses')} n, hints FROM games WHERE ${col} = ?`, val), publicUser(req)]);
  const mine = Object.fromEntries(rows.map((r) => [r.day, r]));
  const days = [];
  for (let i = idx; i >= 0; i--) {
    const d = G.dayFromIndex(i);
    const p = G.playerOfDay(d);
    const m = mine[d];
    const visible = i < idx || (m && m.status !== 'playing');
    days.push({
      day: d, number: i + 1, today: i === idx,
      status: m ? m.status : null, guesses: m ? m.n : 0, hints: m ? m.hints : 0,
      player: visible ? { id: p.id, name: p.name, pos: G.card(p).pos, nat: G.card(p).nat[0], img: p.img ? p.img.replace(/^http:/, 'https:') + '?width=240' : null } : null,
    });
  }
  res.json({ days, user, total: G.PLAYERS.length, edition: { day, number: idx + 1 } });
}));

app.get('/api/leaderboard', A(async (req, res) => {
  const day = G.today();
  const users = await db.all(`SELECT u.id, u.username, COALESCE(SUM(g.points), 0) total, COUNT(g.id) found,
      COALESCE(SUM(CASE WHEN g.day = ? THEN g.points END), 0) today
    FROM users u JOIN games g ON g.user_id = u.id AND g.status = 'won' GROUP BY u.id, u.username`, day);
  const won = await wonDays(users.map((u) => u.id));
  const rows = users.map((u) => ({ id: u.id, username: u.username, total: u.total, found: u.found, today: u.today, ...streakFrom(won.get(u.id)) }));
  const me = req.user ? req.user.id : null;
  const ranked = (list) => list.map((x, i) => ({ ...x, rank: i + 1, me: x.id === me }));
  const top = (list, n) => {
    const out = list.slice(0, n);
    const mine = list.find((x) => x.me);
    if (mine && mine.rank > n) out.push({ ...mine, gap: true });
    return out.map(({ id, ...x }) => x);
  };
  const points = ranked([...rows].sort((a, b) => b.total - a.total || b.found - a.found || a.username.localeCompare(b.username)));
  const streaks = ranked(rows.filter((x) => x.streak > 0).sort((a, b) => b.streak - a.streak || b.total - a.total));
  const records = ranked([...rows].sort((a, b) => b.best - a.best || b.total - a.total));
  const today = ranked(await db.all(`SELECT u.id, u.username, g.points pts, ${J('g.guesses')} n
      FROM games g JOIN users u ON u.id = g.user_id WHERE g.day = ? AND g.status = 'won' ORDER BY g.points DESC, g.finished_at`, day));
  res.json({ points: top(points, 50), streaks: top(streaks, 20), records: top(records, 10), today: top(today, 20), players: rows.length });
}));

// ——— Ligues entre potes ———
// Une ligue = un code à 6 lettres à partager. Le classement reprend les points cumulés de chacun.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans O/0 ni I/1, pour les dicter sans erreur
const newCode = () => Array.from(crypto.randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const leagueBy = (code) => db.get('SELECT * FROM leagues WHERE code = ?', String(code || '').toUpperCase());
const needUser = (req, res) => { if (req.user) return true; res.status(401).json({ error: 'Crée un compte pour jouer en ligue.' }); return false; };

async function leagueTable(leagueId, meId) {
  const day = G.today();
  const rows = await db.all(`SELECT u.id, u.username,
      COALESCE(SUM(CASE WHEN g.status = 'won' THEN g.points END), 0) total,
      COALESCE(SUM(CASE WHEN g.status = 'won' THEN 1 END), 0) found,
      MAX(CASE WHEN g.day = ? THEN g.status END) st,
      MAX(CASE WHEN g.day = ? THEN g.points END) today,
      MAX(CASE WHEN g.day = ? THEN ${J('g.guesses')} END) n
    FROM league_members m JOIN users u ON u.id = m.user_id LEFT JOIN games g ON g.user_id = u.id
    WHERE m.league_id = ? GROUP BY u.id, u.username`, day, day, day, leagueId);
  const won = await wonDays(rows.map((r) => r.id));
  return rows
    .map((r) => ({ username: r.username, total: r.total, found: r.found, today: r.st === 'won' ? r.today : null, todayStatus: r.st || null, n: r.n || 0, streak: streakFrom(won.get(r.id)).streak, me: r.id === meId }))
    .sort((a, b) => b.total - a.total || b.found - a.found || a.username.localeCompare(b.username))
    .map((x, i) => ({ ...x, rank: i + 1 }));
}

app.get('/api/leagues', A(async (req, res) => {
  if (!req.user) return res.json({ leagues: [], user: null });
  const ls = await db.all(`SELECT l.id, l.code, l.name, l.owner_id, (SELECT COUNT(*) FROM league_members x WHERE x.league_id = l.id) members
    FROM leagues l JOIN league_members m ON m.league_id = l.id WHERE m.user_id = ? ORDER BY m.joined_at`, req.user.id);
  const [user, ...tables] = await Promise.all([publicUser(req), ...ls.map((l) => leagueTable(l.id, req.user.id))]);
  const leagues = ls.map((l, i) => ({ code: l.code, name: l.name, members: l.members, mine: l.owner_id === req.user.id, rank: (tables[i].find((x) => x.me) || {}).rank, leader: tables[i][0] && tables[i][0].username }));
  res.json({ user, leagues });
}));

app.post('/api/leagues', slowDown, A(async (req, res) => {
  if (!needUser(req, res)) return;
  const name = String((req.body || {}).name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) return res.status(400).json({ error: 'Donne un nom à ta ligue (2 caractères minimum).' });
  if ((await db.get('SELECT COUNT(*) n FROM leagues WHERE owner_id = ?', req.user.id)).n >= 10) return res.status(400).json({ error: 'Tu as déjà créé 10 ligues.' });
  let code;
  do code = newCode(); while (await leagueBy(code));
  const r = await db.run('INSERT INTO leagues (code, name, owner_id, created_at) VALUES (?, ?, ?, ?) RETURNING id', code, name, req.user.id, db.now());
  await db.run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?)', r.rows[0].id, req.user.id, db.now());
  res.json({ code });
}));

app.get('/api/leagues/:code', A(async (req, res) => {
  const l = await leagueBy(req.params.code);
  if (!l) return res.status(404).json({ error: 'Aucune ligue avec ce code. Vérifie les lettres.' });
  const me = req.user ? req.user.id : null;
  const member = !!(me && await db.get('SELECT 1 x FROM league_members WHERE league_id = ? AND user_id = ?', l.id, me));
  const owner = l.owner_id && await db.get('SELECT username FROM users WHERE id = ?', l.owner_id);
  const table = await leagueTable(l.id, me);
  res.json({
    code: l.code, name: l.name, owner: owner ? owner.username : null, mine: l.owner_id === me, member,
    created: l.created_at, number: G.dayIndex(G.today()) + 1,
    table: member ? table : table.slice(0, 3).map(({ username, total, rank }) => ({ username, total, rank })), size: table.length,
    user: await publicUser(req),
  });
}));

app.post('/api/leagues/:code/join', slowDown, A(async (req, res) => {
  if (!needUser(req, res)) return;
  const l = await leagueBy(req.params.code);
  if (!l) return res.status(404).json({ error: 'Aucune ligue avec ce code. Vérifie les lettres.' });
  if ((await db.get('SELECT COUNT(*) n FROM league_members WHERE league_id = ?', l.id)).n >= 200) return res.status(400).json({ error: 'Cette ligue est complète (200 joueurs).' });
  if ((await db.get('SELECT COUNT(*) n FROM league_members WHERE user_id = ?', req.user.id)).n >= 30) return res.status(400).json({ error: 'Tu es déjà dans 30 ligues.' });
  await db.run('INSERT INTO league_members (league_id, user_id, joined_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', l.id, req.user.id, db.now());
  res.json({ code: l.code });
}));

app.post('/api/leagues/:code/leave', A(async (req, res) => {
  if (!needUser(req, res)) return;
  const l = await leagueBy(req.params.code);
  if (!l) return res.status(404).json({ error: 'Ligue introuvable.' });
  await db.run('DELETE FROM league_members WHERE league_id = ? AND user_id = ?', l.id, req.user.id);
  const next = await db.get('SELECT user_id FROM league_members WHERE league_id = ? ORDER BY joined_at LIMIT 1', l.id);
  if (!next) await db.run('DELETE FROM leagues WHERE id = ?', l.id);
  else if (l.owner_id === req.user.id) await db.run('UPDATE leagues SET owner_id = ? WHERE id = ?', next.user_id, l.id);
  res.json({ ok: true });
}));

// ——— Comptes ———
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const check = (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, salt, 32));
};

async function openSession(req, res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, db.now());
  res.cookie('sid', token, cookieOpts);
  // les parties jouées sans compte sur cet appareil rejoignent le compte
  await db.run('UPDATE games SET user_id = ?, anon = NULL WHERE anon = ? AND day NOT IN (SELECT day FROM games WHERE user_id = ?)', userId, req.aid, userId);
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

app.post('/api/signup', slowDown, A(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = String(username).trim();
  if (!/^[\p{L}0-9_.-]{3,20}$/u.test(u)) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères, lettres, chiffres, point, tiret ou underscore.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (await db.get('SELECT 1 x FROM users WHERE lower(username) = lower(?)', u)) return res.status(400).json({ error: 'Ce pseudo est déjà pris.' });
  const r = await db.run('INSERT INTO users (username, pass, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id', u, hash(String(password)), db.now());
  if (!r.rows.length) return res.status(400).json({ error: 'Ce pseudo est déjà pris.' });
  await openSession(req, res, r.rows[0].id);
  res.json({ ok: true });
}));

app.post('/api/login', slowDown, A(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', String(username).trim());
  if (!u || !check(String(password), u.pass)) return res.status(400).json({ error: 'Pseudo ou mot de passe incorrect.' });
  await openSession(req, res, u.id);
  res.json({ ok: true });
}));

// droit à l'effacement (RGPD) : le compte, ses sessions et ses parties disparaissent
app.post('/api/delete-account', slowDown, A(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Tu n’es pas connecté.' });
  const u = await db.get('SELECT pass FROM users WHERE id = ?', req.user.id);
  if (!check(String((req.body || {}).password || ''), u.pass)) return res.status(400).json({ error: 'Mot de passe incorrect.' });
  await db.run('DELETE FROM users WHERE id = ?', req.user.id);
  SESS.clear();
  res.clearCookie('sid');
  res.json({ ok: true });
}));

app.post('/api/logout', A(async (req, res) => {
  if (req.cookies.sid) { SESS.delete(req.cookies.sid); await db.run('DELETE FROM sessions WHERE token = ?', req.cookies.sid); }
  res.clearCookie('sid');
  res.json({ ok: true });
}));

app.get('/api/me', A(async (req, res) => res.json({ user: await publicUser(req), day: G.today(), number: G.dayIndex(G.today()) + 1 })));

// ——— Front ———
// la page porte l'empreinte des fichiers : après une mise à jour, le navigateur recharge le nouveau code
const PUB = path.join(__dirname, 'public');
const stamp = (f) => require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, f))).digest('hex').slice(0, 10);

// Pub et mentions légales : rien ne s'active tant que les variables ne sont pas remplies sur Render.
//   ADSENSE_CLIENT  ca-pub-1234567890123456 (charge AdSense, son bandeau cookies et /ads.txt)
//   ADSENSE_SLOT    identifiant d'un bloc "display" AdSense (sinon seules les annonces automatiques)
//   SITE_OWNER, SITE_ADDRESS, SITE_CONTACT  pour les mentions légales et la confidentialité
//   ADS_PREVIEW=1   affiche des cadres gris à la place des pubs, pour voir la mise en page
const env = (k) => String(process.env[k] || '').trim();
const ADS = /^ca-pub-\d{10,20}$/.test(env('ADSENSE_CLIENT')) ? env('ADSENSE_CLIENT') : '';
const CONFIG = {
  ads: ADS,
  slot: /^\d{5,15}$/.test(env('ADSENSE_SLOT')) ? env('ADSENSE_SLOT') : '',
  preview: env('ADS_PREVIEW') === '1',
  owner: env('SITE_OWNER'),
  address: env('SITE_ADDRESS'),
  contact: env('SITE_CONTACT'),
};
const adHead = ADS ? `<meta name="google-adsense-account" content="${ADS}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS}" crossorigin="anonymous"></script>
` : '';
const INDEX = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  .replace('href="/style.css"', `href="/style.css?v=${stamp('style.css')}"`)
  .replace('src="/app.js"', `src="/app.js?v=${stamp('app.js')}"`)
  .replace('</head>', () => `${adHead}<script>window.FOOTIX = ${JSON.stringify(CONFIG).replace(/</g, '\\u003c')};</script>\n</head>`);
app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://${DOMAIN}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const pages = ['/', '/regles', '/classement', '/album', '/ligues'];
  for (let i = 0; i < G.dayIndex(G.today()); i++) pages.push('/joueur/' + G.playerOfDay(G.dayFromIndex(i)).id);
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>https://${DOMAIN}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
});
app.get('/ads.txt', (req, res) => {
  if (!ADS) return res.status(404).type('text').send('');
  res.type('text').send(`google.com, ${ADS.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
});
app.get(['/', '/index.html', '/album', '/classement', '/compte', '/regles', '/confidentialite', '/mentions-legales', '/ligues', '/ligue/:code', '/joueur/:id'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(INDEX);
});
app.use(express.static(PUB, { maxAge: PROD ? '30d' : 0, index: false }));

const port = process.env.PORT || 3000;
db.ready.then(() => app.listen(port, () => console.log(`FoOotix tourne sur http://localhost:${port}`)))
  .catch((e) => { console.error('Base de données injoignable :', e.message); process.exit(1); });
