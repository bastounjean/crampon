// ——— Duel : deux joueurs, le même footballeur à trouver ———
const crypto = require('crypto');
const db = require('../db');
const G = require('../game');
const C = require('../core');
const { A, judge } = C;

module.exports = function routes({ app }) {
  // ——— Duel : deux joueurs, le même footballeur à trouver, le premier qui trouve gagne ———
  // Les duels sont gardés en mémoire pour répondre vite, et recopiés en base à chaque changement :
  // un redémarrage ou une mise à jour du site ne coupe plus les duels en cours.
  // Pas de chrono : le duel dure jusqu'à ce que l'un trouve, ou qu'un joueur abandonne.
  // Un duel sans nouvelle depuis 30 min disparaît de la mémoire, et de la base au bout de 2 h sans changement.
  const DUEL_INTRO = 5000; // présentation « VS » puis 3, 2, 1
  const DUELS = new Map();
  let QUEUE = null; // joueur qui attend un adversaire au hasard : { key, name, t, duel }
  const ROOMS = new Map(); // code d'invitation → duel en attente du pote
  const meKey = (req) => (req.user ? 'u' + req.user.id : 'a' + req.aid);
  const meName = (req) => (req.user ? req.user.username : 'Invité ' + parseInt(req.aid.slice(0, 4), 16) % 1000);
  setInterval(() => {
    const now = Date.now();
    for (const [id, d] of DUELS) if (now - (d.seen || d.created) > 30 * 60 * 1000) DUELS.delete(id);
    for (const [c, id] of ROOMS) if (!DUELS.has(id)) ROOMS.delete(c);
    if (QUEUE && now - QUEUE.t > 30000) QUEUE = null;
    db.run('DELETE FROM duels WHERE updated_at < ?', new Date(now - 2 * 3600 * 1000).toISOString()).catch((e) => console.warn('Duels :', e.message));
  }, 60000).unref();

  // en base, le joueur à trouver est rangé par son identifiant
  const save = (d) => db.run(`INSERT INTO duels (id, code, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  d.id, d.code || null, JSON.stringify({ ...d, target: d.target.id }), db.now());
  const revive = (row) => {
    if (!row) return null;
    const d = JSON.parse(row.data);
    if (DUELS.has(d.id)) return DUELS.get(d.id); // relu deux fois en même temps : un seul exemplaire
    d.target = G.BY_ID[d.target];
    if (!d.target) return null;
    DUELS.set(d.id, d);
    if (d.code && !d.startAt) ROOMS.set(d.code, d.id);
    return d;
  };
  const getDuel = async (id) => DUELS.get(id) || revive(await db.get('SELECT data FROM duels WHERE id = ?', id));
  const byCode = async (code) => (ROOMS.has(code) ? getDuel(ROOMS.get(code)) : revive(await db.get('SELECT data FROM duels WHERE code = ? ORDER BY updated_at DESC LIMIT 1', code)));

  async function newDuel(a, code) {
    const id = crypto.randomBytes(8).toString('hex');
    const d = { id, code, created: Date.now(), target: G.duelPick((n) => crypto.randomInt(n)), players: [{ ...a, guesses: [] }], startAt: null, winner: null };
    DUELS.set(id, d);
    await save(d);
    return d;
  }
  async function startDuel(d, b) {
    d.players.push({ ...b, guesses: [] });
    d.startAt = Date.now() + DUEL_INTRO;
    if (b.bot) d.bot = botPlan();
    await save(d);
  }
  // le robot : quelques essais qui chauffent peu à peu, et il finit par trouver (entre 40 s et 3 min)
  function botPlan() {
    const findAt = 40000 + crypto.randomInt(140000);
    const steps = [];
    let t = 0, temp = 0;
    const end = findAt;
    while ((t += 5000 + crypto.randomInt(6000)) < end) {
      if (crypto.randomInt(100) < 55) temp = Math.min(92, temp + 6 + crypto.randomInt(18));
      steps.push({ t, temp });
    }
    return { findAt, steps };
  }
  function duelOver(d, now = Date.now()) {
    if (d.winner) return true;
    if (d.bot && now >= d.startAt + d.bot.findAt) { d.winner = 'bot'; d.wonAt = d.startAt + d.bot.findAt; return true; }
    return false;
  }
  function duelView(d, key) {
    const now = Date.now();
    const over = d.startAt ? duelOver(d, now) : false;
    const me = d.players.find((p) => p.key === key);
    const opp = d.players.find((p) => p.key !== key);
    let oppInfo = null;
    if (opp && opp.bot) {
      const done = d.bot.steps.filter((x) => now >= d.startAt + x.t);
      oppInfo = { name: opp.name, bot: true, n: done.length + (d.winner === 'bot' ? 1 : 0), temp: d.winner === 'bot' ? 100 : (done[done.length - 1] || { temp: 0 }).temp };
    } else if (opp) {
      oppInfo = { name: opp.name, n: opp.guesses.length, temp: opp.guesses.reduce((m, g) => Math.max(m, g.temp), 0) };
    }
    const result = !over ? null : d.winner === key ? 'win' : 'lose';
    return {
      id: d.id, code: d.code, now, startAt: d.startAt, endAt: d.wonAt || null, quit: d.quit ? (d.quit === key ? 'me' : 'opp') : null,
      phase: !d.startAt ? 'waiting' : now < d.startAt ? 'intro' : over ? 'over' : 'playing',
      me: me ? { name: me.name, guesses: me.guesses } : null,
      opp: oppInfo, result,
      card: G.revealCard(d.target, me ? me.guesses : [], 0, over),
      answer: over ? G.card(d.target) : null,
    };
  }
  const myDuel = async (req) => {
    const d = await getDuel(String(req.params.id || '').slice(0, 32));
    return d && d.players.some((p) => p.key === meKey(req)) ? d : null;
  };
  // adversaire au hasard : on rejoint celui qui attend, sinon on attend
  app.post('/api/duel/queue', A(async (req, res) => {
    const me = { key: meKey(req), name: meName(req) };
    if (QUEUE && QUEUE.key !== me.key && Date.now() - QUEUE.t < 5000 && DUELS.has(QUEUE.duel)) {
      const d = DUELS.get(QUEUE.duel);
      QUEUE = null;
      await startDuel(d, me);
      return res.json(duelView(d, me.key));
    }
    if (QUEUE && QUEUE.key === me.key && DUELS.has(QUEUE.duel)) { QUEUE.t = Date.now(); return res.json(duelView(DUELS.get(QUEUE.duel), me.key)); }
    const d = await newDuel(me);
    QUEUE = { ...me, t: Date.now(), duel: d.id };
    res.json(duelView(d, me.key));
  }));
  app.post('/api/duel/bot', A(async (req, res) => {
    const me = { key: meKey(req), name: meName(req) };
    if (QUEUE && QUEUE.key === me.key) { DUELS.delete(QUEUE.duel); QUEUE = null; }
    const d = await newDuel(me);
    await startDuel(d, { key: 'bot', name: 'Robot FoOotix', bot: true });
    res.json(duelView(d, me.key));
  }));
  // défier un pote : un code à partager, le duel démarre quand il arrive
  app.post('/api/duel/friend', A(async (req, res) => {
    const me = { key: meKey(req), name: meName(req) };
    let code;
    do code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); while (ROOMS.has(code));
    const d = await newDuel(me, code);
    ROOMS.set(code, d.id);
    res.json(duelView(d, me.key));
  }));
  app.post('/api/duel/join/:code', A(async (req, res) => {
    const d = await byCode(String(req.params.code).toUpperCase().slice(0, 5));
    const me = { key: meKey(req), name: meName(req) };
    if (!d) return res.status(404).json({ error: 'Aucun duel avec ce code, ou il a expiré. Vérifie les lettres ou demande un nouveau code à ton pote.' });
    if (d.players.some((p) => p.key === me.key)) return res.json(duelView(d, me.key));
    if (d.players.length > 1) return res.status(400).json({ error: 'Ce duel a déjà commencé.' });
    await startDuel(d, me);
    res.json(duelView(d, me.key));
  }));
  app.post('/api/duel/:id/leave', A(async (req, res) => {
    const d = await myDuel(req);
    if (d && !d.startAt) {
      DUELS.delete(d.id); if (QUEUE && QUEUE.duel === d.id) QUEUE = null; if (d.code) ROOMS.delete(d.code);
      await db.run('DELETE FROM duels WHERE id = ?', d.id);
    }
    res.json({ ok: true });
  }));
  // abandonner : l'adversaire gagne
  app.post('/api/duel/:id/giveup', A(async (req, res) => {
    const d = await myDuel(req);
    if (!d) return res.status(404).json({ error: 'Duel introuvable.' });
    const key = meKey(req);
    if (d.startAt && !duelOver(d)) {
      const opp = d.players.find((p) => p.key !== key);
      d.winner = opp ? opp.key : null;
      d.wonAt = Date.now();
      d.quit = key;
      await save(d);
    }
    res.json(duelView(d, key));
  }));
  app.get('/api/duel/:id', A(async (req, res) => {
    const d = await myDuel(req);
    if (!d) return res.status(404).json({ error: 'Duel introuvable.' });
    if (QUEUE && QUEUE.duel === d.id) QUEUE.t = Date.now(); // toujours là
    d.seen = Date.now();
    res.set('Cache-Control', 'no-store');
    res.json(duelView(d, meKey(req)));
  }));
  app.post('/api/duel/:id/guess', A(async (req, res) => {
    const d = await myDuel(req);
    if (!d) return res.status(404).json({ error: 'Duel introuvable.' });
    const now = Date.now();
    if (!d.startAt || now < d.startAt) return res.status(400).json({ error: 'Le duel n’a pas encore commencé.' });
    if (duelOver(d, now)) return res.json(duelView(d, meKey(req)));
    const me = d.players.find((p) => p.key === meKey(req));
    const j = judge(d.target, me.guesses, String((req.body || {}).q || '').slice(0, 80), String((req.body || {}).id || '').slice(0, 40));
    if (j.error) return res.status(400).json({ error: j.error });
    if (j.dup) return res.json({ ...duelView(d, me.key), dup: j.dup });
    me.guesses.push(j.entry);
    if (j.won) { d.winner = me.key; d.wonAt = now; }
    await save(d);
    res.json({ ...duelView(d, me.key), last: j.entry.n });
  }));
};
