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
const I18N = require('./src/i18n');

// ——— Joueurs : liste figée dans le dépôt, fiches rafraîchies chaque jour depuis Wikidata ———
const POOL = require('./src/data/pool.json');
let EXTRA = [];
try { EXTRA = require('./src/data/extra.json').players; } catch (e) { /* liste pas encore construite */ }
G.setPool(POOL.ids, POOL.players, POOL.since, EXTRA);
async function refreshPlayers() {
  try {
    const fresh = await WD.fetchPlayers(POOL.ids);
    if (fresh.length < POOL.ids.length * 0.8) throw new Error(`seulement ${fresh.length} fiches reçues`);
    const got = new Set(fresh.map((p) => p.id));
    G.setPool(POOL.ids, [...fresh, ...POOL.players.filter((p) => !got.has(p.id))], POOL.since);
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
app.disable('x-powered-by');
// Protections de base du navigateur : pas d'affichage du site dans un cadre d'un autre site (anti-clickjacking),
// HTTPS forcé, types de fichiers respectés, pas d'adresse complète transmise aux autres sites.
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(compression({ level: 1 })); // réponses compressées 3 à 5 fois, au niveau le plus rapide pour ménager le processeur
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
// Limite d'appels : 300 par minute et par visiteur (un joueur normal en fait une vingtaine), et bien plus par
// adresse IP, car sur mobile des centaines de personnes partagent parfois la même adresse chez l'opérateur.
// Évite qu'un script inonde le serveur ou la base.
const HITS = new Map();
setInterval(() => HITS.clear(), 60 * 1000).unref();
const bump = (k) => { const n = (HITS.get(k) || 0) + 1; HITS.set(k, n); return n; };
app.use('/api', (req, res, next) => {
  const aid = /^[a-f0-9]{32}$/.test(req.cookies.aid || '') ? req.cookies.aid : '';
  const over = aid ? bump('a' + aid) > 300 || bump('i' + req.ip) > 20000 : bump('n' + req.ip) > 3000;
  if (over) return res.status(429).json({ error: 'Trop de requêtes, attends une minute.' });
  next();
});

// Langue : celle choisie sur le site (cookie lang), sinon celle du téléphone ou du navigateur.
// En anglais, toutes les réponses de l'API sont traduites juste avant l'envoi.
app.use('/api', (req, res, next) => {
  req.lang = I18N.pick(req);
  if (req.lang === 'en') { const json = res.json.bind(res); res.json = (body) => json(I18N.deep(body)); }
  next();
});

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

// Jour joué : aujourd'hui, ou un jour passé à rattraper (sans points ni série)
function dayOf(req) {
  const today = G.today();
  const d = String((req.body && req.body.day) || req.query.day || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return today;
  const i = G.dayIndex(d);
  return i >= 0 && i < G.dayIndex(today) && G.dayFromIndex(i) === d ? d : today;
}
// une partie finie : trouvé le jour même (won), rattrapé plus tard (late) ou abandonnée
const DONE = new Set(['won', 'late', 'gaveup']);

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
  // au-delà de quelques centaines de joueurs, une liste d'identifiants devient plus lourde que de tout lire
  const rows = userIds.length > 300
    ? await db.all("SELECT user_id, day FROM games WHERE status = 'won' AND user_id IS NOT NULL")
    : await db.all(`SELECT user_id, day FROM games WHERE status = 'won' AND user_id IN (${userIds.map(() => '?').join(',')})`, ...userIds);
  for (const r of rows) { const s = out.get(r.user_id); if (s) s.add(r.day); }
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

// les jours passés de ce joueur : fini ou pas
async function myDays(req) {
  const [col, val] = owner(req);
  const rows = await db.all(`SELECT day, status FROM games WHERE ${col} = ?`, val);
  return Object.fromEntries(rows.map((r) => [r.day, r.status]));
}
// le jour passé le plus récent qu'il reste à trouver, et combien il en reste
function catchup(mine, before) {
  let next = null, left = 0;
  for (let i = G.dayIndex(before) - 1; i >= 0; i--) {
    const d = G.dayFromIndex(i);
    if (DONE.has(mine[d])) continue;
    left++;
    if (!next) next = { day: d, number: i + 1 };
  }
  return next ? { ...next, left } : null;
}

async function state(req, day = G.today()) {
  const today = G.today();
  const past = day !== today;
  const idx = G.dayIndex(day);
  const target = G.playerOfDay(day);
  const g = (await getGame(req, day, false)) || { status: 'playing', guesses: [], hints: 0 };
  const n = g.guesses.length;
  const over = g.status !== 'playing';
  const yIdx = G.dayIndex(today) - 1;
  const yesterday = !past && yIdx >= 0 ? G.playerOfDay(G.dayFromIndex(yIdx)) : null;
  const [rank, stats, yStats, user, mine] = await Promise.all([
    g.status === 'won' ? db.get("SELECT COUNT(*) n FROM games WHERE day = ? AND status = 'won' AND finished_at <= ?", day, g.finished_at).then((r) => r.n) : null,
    dayStats(day),
    yesterday ? dayStats(G.dayFromIndex(yIdx)) : null,
    publicUser(req),
    myDays(req),
  ]);
  // le nom d'hier reste caché tant qu'on peut encore le chercher
  const yOpen = yesterday && DONE.has(mine[G.dayFromIndex(yIdx)]);
  return {
    day, number: idx + 1, past, late: g.status === 'late',
    status: g.status === 'late' ? 'won' : g.status, guesses: g.guesses,
    best: g.guesses.reduce((m, x) => Math.max(m, x.temp), 0),
    hints: Array.from({ length: g.hints }, (_, k) => G.hintText(target, k)),
    hintReady: !over && g.hints < G.MAX_HINTS && n >= (g.hints + 1) * G.HINT_EVERY,
    nextHintAt: g.hints < G.MAX_HINTS ? (g.hints + 1) * G.HINT_EVERY : null,
    answer: over ? G.card(target) : null,
    card: G.revealCard(target, g.guesses, g.hints, over),
    rank, stats,
    score: g.status === 'won' ? { ...G.score(target, n, g.hints), points: g.points ?? G.score(target, n, g.hints).points } : null,
    yesterday: yesterday ? { day: G.dayFromIndex(yIdx), id: yOpen ? yesterday.id : null, name: yOpen ? yesterday.name : null, stats: yStats } : null,
    catchup: catchup(mine, today),
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
app.get('/api/today', A(async (req, res) => res.json(await state(req, dayOf(req)))));

app.post('/api/guess', A(async (req, res) => {
  const day = dayOf(req);
  const past = day !== G.today();
  const target = G.playerOfDay(day);
  const q = String((req.body || {}).q || '').slice(0, 80);
  const r = G.resolve({ q });
  if (!r) return res.status(400).json({ error: `Je ne trouve rien pour « ${q.trim()} ». Essaie un joueur, un club, une ville, un pays, un poste, une génération…` });
  if (r.error) return res.status(400).json({ error: r.error });
  const g = await getGame(req, day, true);
  if (g.status !== 'playing') return res.status(400).json({ error: past ? 'Cette partie est terminée.' : 'La partie du jour est terminée.' });
  const key = r.type === 'player' ? r.player.id : r.clue.id;
  const dup = g.guesses.find((x) => x.key === key);
  if (dup) return res.json({ ...(await state(req, day)), dup: dup.n });
  let entry;
  if (r.type === 'player') {
    const c = G.compare(target, r.player);
    entry = { n: g.guesses.length + 1, key, type: 'player', label: r.player.name, temp: c.temp, tags: c.tags };
  } else {
    const c = G.askClue(target, r.clue);
    entry = { n: g.guesses.length + 1, key, type: 'clue', label: r.clue.label, cat: r.clue.kind, temp: c.temp, yes: c.yes };
  }
  // la température ne monte que sur une bonne nouvelle : un « oui », ou un joueur qui partage quelque chose
  const prev = g.guesses.length ? g.guesses[g.guesses.length - 1].temp : 0;
  const good = r.type === 'player' ? entry.tags.some((t) => t.ok) : entry.yes;
  entry.temp = good ? Math.max(prev, G.heat(target, [...g.guesses, entry])) : prev;
  g.guesses.push(entry);
  const won = r.type === 'player' && r.player.id === target.id;
  // un jour passé trouvé après coup rejoint l'album, sans points ni série
  const pts = won && !past ? G.score(target, g.guesses.length, g.hints).points : null;
  await db.run('UPDATE games SET guesses = ?, status = ?, points = ?, finished_at = ? WHERE id = ?',
    JSON.stringify(g.guesses), won ? (past ? 'late' : 'won') : 'playing', pts, won ? db.now() : g.finished_at, g.id);
  if (won || g.guesses.length === 1) STATS.delete(day);
  if (won && !past) LB = null;
  res.json({ ...(await state(req, day)), last: entry.n });
}));

app.post('/api/hint', A(async (req, res) => {
  const day = dayOf(req);
  const g = await getGame(req, day, true);
  if (g.status !== 'playing') return res.status(400).json({ error: 'Partie terminée.' });
  if (g.hints >= G.MAX_HINTS || g.guesses.length < (g.hints + 1) * G.HINT_EVERY)
    return res.status(400).json({ error: "Pas encore d'indice disponible." });
  await db.run('UPDATE games SET hints = hints + 1 WHERE id = ?', g.id);
  res.json(await state(req, day));
}));

app.post('/api/giveup', A(async (req, res) => {
  const day = dayOf(req);
  const g = await getGame(req, day, true);
  if (g.status === 'playing') await db.run("UPDATE games SET status = 'gaveup', finished_at = ? WHERE id = ?", db.now(), g.id);
  res.json(await state(req, day));
}));

// ——— Fiches joueurs ———
// Une fiche est visible quand ta partie du jour où il est sorti est finie : trouvé, rattrapé ou abandonné.
// Tant qu'elle ne l'est pas, le joueur reste à chercher, même des jours après.
app.get('/api/player/:id', A(async (req, res) => {
  const p = G.BY_ID[req.params.id];
  const idx = G.dayIndex(G.today());
  const days = [];
  if (p) for (let i = 0; i <= idx; i++) if (G.playerOfDay(G.dayFromIndex(i)).id === p.id) days.push(G.dayFromIndex(i));
  const mine = days.length ? await myDays(req) : {};
  const when = [...days].reverse().find((d) => DONE.has(mine[d]));
  if (!when) return res.status(404).json({ error: 'Fiche pas encore débloquée : trouve-le d\'abord.', day: days[days.length - 1] || null });
  const g = await getGame(req, when, false);
  const mineG = g ? { status: g.status === 'late' ? 'won' : g.status, late: g.status === 'late', guesses: g.guesses.length } : null;
  res.json({ ...G.card(p), day: when, number: G.dayIndex(when) + 1, mine: mineG, stats: await dayStats(when) });
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
    const visible = m && DONE.has(m.status);
    days.push({
      day: d, number: i + 1, today: i === idx,
      status: m ? m.status : null, guesses: m ? m.n : 0, hints: m ? m.hints : 0,
      player: visible ? { id: p.id, name: p.name, pos: G.card(p).pos, nat: G.card(p).nat[0], img: p.img ? p.img.replace(/^http:/, 'https:') + '?width=240' : null } : null,
    });
  }
  res.json({ days, user, total: G.PLAYERS.length, edition: { day, number: idx + 1 } });
}));

// classement : identique pour tout le monde, recalculé au plus toutes les 15 s (ou dès qu'un joueur trouve)
let LB = null;
async function board(day) {
  if (LB && LB.day === day && Date.now() - LB.t < 15000) return LB;
  const [users, today] = await Promise.all([
    db.all(`SELECT u.id, u.username, COALESCE(SUM(g.points), 0) total, COUNT(g.id) found,
      COALESCE(SUM(CASE WHEN g.day = ? THEN g.points END), 0) today
    FROM users u JOIN games g ON g.user_id = u.id AND g.status = 'won' GROUP BY u.id, u.username`, day),
    db.all(`SELECT u.id, u.username, g.points pts, ${J('g.guesses')} n
      FROM games g JOIN users u ON u.id = g.user_id WHERE g.day = ? AND g.status = 'won' ORDER BY g.points DESC, g.finished_at`, day),
  ]);
  const won = await wonDays(users.map((u) => u.id));
  const rows = users.map((u) => ({ id: u.id, username: u.username, total: u.total, found: u.found, today: u.today, ...streakFrom(won.get(u.id)) }));
  LB = { day, t: Date.now(), rows, today };
  return LB;
}

app.get('/api/leaderboard', A(async (req, res) => {
  const day = G.today();
  const { rows, today: todayRows } = await board(day);
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
  const today = ranked(todayRows);
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
// scrypt est volontairement lent (50 ms) : on le fait tourner à côté pour ne pas bloquer les autres joueurs
const scrypt = require('util').promisify(crypto.scrypt);
const hash = async (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + (await scrypt(pw, salt, 32)).toString('hex');
const check = async (pw, stored) => {
  const [salt, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), await scrypt(pw, salt, 32));
};

async function openSession(req, res, userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, db.now());
  res.cookie('sid', token, cookieOpts);
  // les parties jouées sans compte sur cet appareil rejoignent le compte
  await db.run('UPDATE games SET user_id = ?, anon = NULL WHERE anon = ? AND day NOT IN (SELECT day FROM games WHERE user_id = ?)', userId, req.aid, userId);
}

const attempts = new Map();
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (!a.some((t) => now - t < 10 * 60 * 1000)) attempts.delete(k); }, 10 * 60 * 1000).unref();
// Anti-force brute : 20 essais par 10 min pour un même pseudo depuis une même adresse,
// et 300 au total par adresse et par action (assez pour une école ou un réseau mobile partagé)
function slowDown(req, res, next) {
  const now = Date.now();
  const who = String((req.body && req.body.username) || '').toLowerCase().slice(0, 30);
  for (const [k, max] of [[req.ip + req.path + '|' + who, 20], [req.ip + req.path, 300]]) {
    const a = (attempts.get(k) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (a.length >= max) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans quelques minutes.' });
    a.push(now);
    attempts.set(k, a);
  }
  next();
}

app.post('/api/signup', slowDown, A(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = String(username).trim();
  if (!/^[\p{L}0-9_.-]{3,20}$/u.test(u)) return res.status(400).json({ error: 'Pseudo : 3 à 20 caractères, lettres, chiffres, point, tiret ou underscore.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Mot de passe : 6 caractères minimum.' });
  if (await db.get('SELECT 1 x FROM users WHERE lower(username) = lower(?)', u)) return res.status(400).json({ error: 'Ce pseudo est déjà pris.' });
  const r = await db.run('INSERT INTO users (username, pass, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id', u, await hash(String(password)), db.now());
  if (!r.rows.length) return res.status(400).json({ error: 'Ce pseudo est déjà pris.' });
  await openSession(req, res, r.rows[0].id);
  res.json({ ok: true });
}));

app.post('/api/login', slowDown, A(async (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = await db.get('SELECT * FROM users WHERE lower(username) = lower(?)', String(username).trim());
  if (!u || !(await check(String(password), u.pass))) return res.status(400).json({ error: 'Pseudo ou mot de passe incorrect.' });
  await openSession(req, res, u.id);
  res.json({ ok: true });
}));

// droit à l'effacement (RGPD) : le compte, ses sessions et ses parties disparaissent
app.post('/api/delete-account', slowDown, A(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Tu n’es pas connecté.' });
  const u = await db.get('SELECT pass FROM users WHERE id = ?', req.user.id);
  if (!(await check(String((req.body || {}).password || ''), u.pass))) return res.status(400).json({ error: 'Mot de passe incorrect.' });
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
const indexFor = (lang) => {
  let h = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
    .replace('href="/style.css"', `href="/style.css?v=${stamp('style.css')}"`)
    .replace('src="/app.js"', `src="/app.js?v=${stamp('app.js')}"`)
    .replace('</head>', () => `${adHead}<script>window.FOOTIX = ${JSON.stringify({ ...CONFIG, lang }).replace(/</g, '\\u003c')};</script>\n</head>`);
  if (lang === 'en') {
    for (const [fr, en] of [
      ['<html lang="fr">', '<html lang="en">'],
      ['FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer'],
      ['FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer'],
      ['Chaque jour, un footballeur à deviner : légendes et joueurs actuels de Ligue 1, Premier League, Bundesliga, Liga et Serie A.', 'A footballer to guess every day: legends and current players from the Premier League, LaLiga, Serie A, Bundesliga and Ligue 1.'],
      ["Un footballeur à deviner chaque jour. Trouve-le en moins d'essais que tes potes.", 'A footballer to guess every day. Find him in fewer tries than your friends.'],
      ['<span>Jouer</span>', '<span>Play</span>'], ['<span>Classement</span>', '<span>Ranking</span>'], ['<span>Ligues</span>', '<span>Leagues</span>'], ['<span>Règles</span>', '<span>Rules</span>'],
      ['FoOotix — un joueur par jour, tiré au sort parmi les cinq grands championnats européens.', "FoOotix — one player a day, drawn from Europe's top five leagues."],
      ['Résumés et photos : <a href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a>', 'Summaries and photos: <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>'],
      ['>Mentions légales<', '>Legal notice<'], ['>Confidentialité et cookies<', '>Privacy and cookies<'], ['>Gérer mes cookies<', '>Manage cookies<'],
      ['hreflang="en" lang="en">English version<', 'hreflang="fr" lang="fr">Version française<'],
    ]) h = h.split(fr).join(en);
  }
  return h;
};
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
require('./src/stats')({ app, db, G, A, slowDown, DOMAIN });

// Fichiers du site compressés une fois pour toutes au démarrage (au lieu de l'être à chaque visite)
const zlib = require('zlib');
function packed(body, type, cache) {
  const raw = Buffer.from(body);
  return {
    type, cache, raw,
    br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }),
    gz: zlib.gzipSync(raw, { level: 9 }),
  };
}
function sendPacked(req, res, f) {
  const enc = req.acceptsEncodings('br', 'gzip');
  res.set({ 'Content-Type': f.type, 'Cache-Control': f.cache, Vary: res.get('Vary') || 'Accept-Encoding' });
  if (enc === 'br') return res.set('Content-Encoding', 'br').end(f.br);
  if (enc === 'gzip') return res.set('Content-Encoding', 'gzip').end(f.gz);
  res.end(f.raw);
}
const ASSET_CACHE = PROD ? 'public, max-age=2592000' : 'no-cache';
const ASSETS = {
  '/app.js': packed(fs.readFileSync(path.join(PUB, 'app.js')), 'application/javascript; charset=utf-8', ASSET_CACHE),
  '/style.css': packed(fs.readFileSync(path.join(PUB, 'style.css')), 'text/css; charset=utf-8', ASSET_CACHE),
};
const PAGES = { fr: packed(indexFor('fr'), 'text/html; charset=utf-8', 'no-cache'), en: packed(indexFor('en'), 'text/html; charset=utf-8', 'no-cache') };
app.get(['/app.js', '/style.css'], (req, res) => sendPacked(req, res, ASSETS[req.path]));

app.get(['/', '/index.html', '/jour/:day', '/album', '/classement', '/compte', '/regles', '/confidentialite', '/mentions-legales', '/ligues', '/ligue/:code', '/joueur/:id'], (req, res) => {
  res.set('Vary', 'Accept-Encoding, Accept-Language, Cookie');
  sendPacked(req, res, PAGES[I18N.pick(req)]);
  // Neon s'endort après 5 min sans requête et met près d'une seconde à se réveiller : on le réveille
  // pendant que le navigateur charge la page, pour que les premières données arrivent sans attente.
  // Pas pour UptimeRobot et les robots, sinon la base ne dormirait jamais (quota gratuit).
  if (!/bot|crawl|spider|monitor|uptime|preview|curl|wget|headless/i.test(req.get('user-agent') || '')) db.get('SELECT 1 x').catch(() => {});
});
app.use(express.static(PUB, { maxAge: PROD ? '30d' : 0, index: false }));

const port = process.env.PORT || 3000;
db.ready.then(() => app.listen(port, () => console.log(`FoOotix tourne sur http://localhost:${port}`)))
  .catch((e) => { console.error('Base de données injoignable :', e.message); process.exit(1); });
