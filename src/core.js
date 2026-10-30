// Ce que les routes partagent : identité du joueur, parties en mémoire, séries, stats du jour, classement,
// jugement d'un essai et protections (erreurs async, anti-force brute).
const db = require('./db');
const G = require('./game');

const PROD = process.env.NODE_ENV === 'production';
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 1000 * 60 * 60 * 24 * 395 }; // 13 mois, la limite conseillée par la CNIL

// Express 4 n'attrape pas les erreurs des fonctions async : on les renvoie proprement
const A = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  if (!res.headersSent) res.status(500).json({ error: 'Petit souci de serveur, réessaie dans un instant.' });
});

const SESS = new Map(); // sessions gardées 5 min en mémoire pour éviter une requête à chaque clic

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

// Les parties en cours restent en mémoire (une seule machine) : un essai n'attend plus qu'une écriture en base.
// Les petites infos du joueur (compte, jours joués, packs) aussi, et sont oubliées dès qu'elles changent.
const GAMES = new Map();
const SIDE = new Map();
const ownerKey = (req) => owner(req).join(':');
function forget(req, aid) {
  const keys = [ownerKey(req)];
  if (aid) keys.push('anon:' + aid);
  for (const m of [GAMES, SIDE]) for (const k of m.keys()) if (keys.some((o) => k.startsWith(o + ':'))) m.delete(k);
}
async function side(req, name, fn) {
  const k = ownerKey(req) + ':' + name;
  const c = SIDE.get(k);
  if (c && Date.now() - c.t < 60000) return c.v;
  const v = await fn();
  if (SIDE.size > 20000) SIDE.clear();
  SIDE.set(k, { t: Date.now(), v });
  return v;
}
async function getGame(req, day, create) {
  const [col, val] = owner(req);
  const key = `${col}:${val}:${day}`;
  if (GAMES.has(key)) return GAMES.get(key);
  let g = await db.get(`SELECT * FROM games WHERE day = ? AND ${col} = ?`, day, val);
  if (!g && create) {
    await db.run(`INSERT INTO games (day, ${col}) VALUES (?, ?) ON CONFLICT DO NOTHING`, day, val);
    g = await db.get(`SELECT * FROM games WHERE day = ? AND ${col} = ?`, day, val);
  }
  if (!g) return g;
  g.guesses = JSON.parse(g.guesses);
  g.hintList = g.hint_list ? JSON.parse(g.hint_list) : G.hintList(g.hints);
  if (GAMES.size > 20000) GAMES.clear();
  GAMES.set(key, g);
  return g;
}
// une écriture qui échoue : on oublie la copie en mémoire pour relire la base la prochaine fois
const saved = (req, p) => p.catch((e) => { forget(req); throw e; });

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

// une proposition (joueur ou question) face au joueur à trouver : la ligne ajoutée au tableau des essais
function judge(target, guesses, q, id) {
  const r = G.resolve({ q, id });
  if (!r) return { error: `Je ne trouve rien pour « ${q.trim()} ». Essaie un joueur, un club, une ville, un pays, un poste, une génération…` };
  if (r.error) return { error: r.error };
  const key = r.type === 'player' ? r.player.id : r.clue.id;
  const dup = guesses.find((x) => x.key === key);
  if (dup) return { dup: dup.n };
  let entry;
  if (r.type === 'player') {
    const c = G.compare(target, r.player);
    entry = { n: guesses.length + 1, key, type: 'player', label: r.player.name, temp: c.temp, tags: c.tags };
  } else {
    const c = G.askClue(target, r.clue);
    entry = { n: guesses.length + 1, key, type: 'clue', label: r.clue.label, cat: r.clue.kind, temp: c.temp, yes: c.yes };
  }
  // la température ne monte que sur une bonne nouvelle : un « oui », ou un joueur qui partage quelque chose
  const prev = guesses.length ? guesses[guesses.length - 1].temp : 0;
  const good = r.type === 'player' ? entry.tags.some((t) => t.ok) : entry.yes;
  entry.temp = good ? Math.max(prev, G.heat(target, [...guesses, entry])) : prev;
  return { entry, won: r.type === 'player' && r.player.id === target.id };
}

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
const resetBoard = () => { LB = null; };

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

module.exports = {
  PROD, cookieOpts, A, SESS, dayOf, DONE, owner, J, GAMES, ownerKey, forget, side, getGame, saved,
  wonDays, streakFrom, streakOf, publicUser, STATS, dayStats, myDays, catchup, judge, board, resetBoard, slowDown,
};
