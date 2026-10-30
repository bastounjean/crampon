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

const C = require('./src/core');
const { A, SESS, cookieOpts } = C;

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

// Diagnostic : temps d'un aller-retour vers la base, et depuis quand le serveur est réveillé
app.get('/api/health', A(async (req, res) => {
  const pings = [];
  for (let i = 0; i < 3; i++) { const t = Date.now(); await db.get('SELECT 1 x'); pings.push(Date.now() - t); }
  res.set('Cache-Control', 'no-store');
  res.json({ base: db.kind, ping_base_ms: pings, serveur_eveille_depuis_min: Math.round(process.uptime() / 60) });
}));

require('./src/routes/game')({ app });
require('./src/routes/duel')({ app });
require('./src/routes/social')({ app });
require('./src/routes/accounts')({ app });
require('./src/stats')({ app, db, G, A, slowDown: C.slowDown, DOMAIN });
require('./src/front')({ app, db, DOMAIN });

const port = process.env.PORT || 3000;
// Les tirages sont enregistrés en base dès qu'un jour commence : une mise à jour des fiches
// (ou de la règle des joueurs décédés) ne peut jamais changer le joueur d'un jour déjà commencé.
async function lockDraws() {
  const load = async () => {
    const rows = await db.all('SELECT day, player_id FROM draws');
    G.fixDraws(Object.fromEntries(rows.map((r) => [r.day, r.player_id])));
    return new Set(rows.map((r) => r.day));
  };
  const have = await load();
  let added = 0;
  for (let i = 0; i <= G.dayIndex(G.today()); i++) {
    const d = G.dayFromIndex(i);
    if (have.has(d)) continue;
    await db.run('INSERT INTO draws (day, player_id) VALUES (?, ?) ON CONFLICT DO NOTHING', d, G.playerOfDay(d).id);
    added++;
  }
  if (added) await load();
}
setInterval(() => lockDraws().catch((e) => console.warn('Tirages :', e.message)), 5 * 60 * 1000).unref();
db.ready.then(() => lockDraws().catch((e) => console.warn('Tirages :', e.message)))
  .then(() => app.listen(port, () => console.log(`FoOotix tourne sur http://localhost:${port}`)))
  .catch((e) => { console.error('Base de données injoignable :', e.message); process.exit(1); });
