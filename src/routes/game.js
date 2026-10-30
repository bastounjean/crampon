// ——— Jeu du jour, fiches joueurs, album et packs ———
const crypto = require('crypto');
const db = require('../db');
const G = require('../game');
const C = require('../core');
const { A, owner, J, GAMES, forget, side, getGame, saved, publicUser, STATS, dayStats, myDays, catchup, judge, DONE, dayOf } = C;

module.exports = function routes({ app }) {
  async function state(req, day = G.today(), pending = null) {
    // ce qui dépend de l'écriture en cours (points, série, pack bonus) se lit une fois qu'elle est faite
    const after = (f) => (pending ? pending.then(f) : f());
    const today = G.today();
    const past = day !== today;
    const idx = G.dayIndex(day);
    const target = G.playerOfDay(day);
    const g = (await getGame(req, day, false)) || { status: 'playing', guesses: [], hints: 0, hintList: [] };
    const n = g.guesses.length;
    const over = g.status !== 'playing';
    const yIdx = G.dayIndex(today) - 1;
    const yesterday = !past && yIdx >= 0 ? G.playerOfDay(G.dayFromIndex(yIdx)) : null;
    const [rank, stats, yStats, user, mine, packs] = await Promise.all([
      g.status === 'won' ? (pending || Promise.resolve()).then(() => db.get("SELECT COUNT(*) n FROM games WHERE day = ? AND status = 'won' AND finished_at <= ?", day, g.finished_at)).then((r) => r.n) : null,
      dayStats(day),
      yesterday ? dayStats(G.dayFromIndex(yIdx)) : null,
      after(() => side(req, 'user', () => publicUser(req))),
      after(() => side(req, 'days', () => myDays(req))),
      past ? null : after(() => side(req, 'packs:' + day, () => packState(req, day))),
    ]);
    // le nom d'hier reste caché tant qu'on peut encore le chercher
    const yOpen = yesterday && DONE.has(mine[G.dayFromIndex(yIdx)]);
    return {
      day, number: idx + 1, past, late: g.status === 'late',
      status: g.status === 'late' ? 'won' : g.status, guesses: g.guesses,
      best: g.guesses.reduce((m, x) => Math.max(m, x.temp), 0),
      hints: g.hintList.map((h) => G.hintText(target, h)),
      hintReady: !over && g.hints < G.MAX_HINTS && n >= G.hintAt(g.hints),
      nextHintAt: g.hints < G.MAX_HINTS ? G.hintAt(g.hints) : null,
      answer: over ? G.card(target) : null,
      card: G.revealCard(target, g.guesses, g.hintList, over),
      rank, stats,
      score: g.status === 'won' ? { ...G.score(target, n, g.hints), points: g.points ?? G.score(target, n, g.hints).points } : null,
      yesterday: yesterday ? { day: G.dayFromIndex(yIdx), id: yOpen ? yesterday.id : null, name: yOpen ? yesterday.name : null, stats: yStats } : null,
      catchup: catchup(mine, today),
      packs,
      user,
    };
  }

  // ——— API jeu ———
  app.get('/api/today', A(async (req, res) => res.json(await state(req, dayOf(req)))));

  app.get('/api/suggest', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(G.suggest(String(req.query.q || '').slice(0, 40)));
  });
  app.post('/api/guess', A(async (req, res) => {
    const day = dayOf(req);
    const past = day !== G.today();
    const target = G.playerOfDay(day);
    const q = String((req.body || {}).q || '').slice(0, 80);
    const id = String((req.body || {}).id || '').slice(0, 40);
    if (!G.resolve({ q, id })) return res.status(400).json({ error: judge(target, [], q).error });
    const g = await getGame(req, day, true);
    if (g.status !== 'playing') return res.status(400).json({ error: past ? 'Cette partie est terminée.' : 'La partie du jour est terminée.' });
    const j = judge(target, g.guesses, q, id);
    if (j.error) return res.status(400).json({ error: j.error });
    if (j.dup) return res.json({ ...(await state(req, day)), dup: j.dup });
    const { entry, won } = j;
    g.guesses.push(entry);
    // un jour passé trouvé après coup rejoint l'album, sans points ni série
    const pts = won && !past ? G.score(target, g.guesses.length, g.hints).points : null;
    if (won) { g.status = past ? 'late' : 'won'; g.points = pts; g.finished_at = db.now(); forget(req); GAMES.set(`${owner(req).join(':')}:${day}`, g); }
    // l'écriture et la réponse partent en même temps
    const write = saved(req, db.run('UPDATE games SET guesses = ?, status = ?, points = ?, finished_at = ? WHERE id = ?',
      JSON.stringify(g.guesses), g.status, g.points ?? null, g.finished_at ?? null, g.id));
    if (won || g.guesses.length === 1) STATS.delete(day);
    if (won && !past) C.resetBoard();
    res.json({ ...(await state(req, day, write)), last: entry.n });
  }));

  app.post('/api/hint', A(async (req, res) => {
    const day = dayOf(req);
    const g = await getGame(req, day, true);
    if (g.status !== 'playing') return res.status(400).json({ error: 'Partie terminée.' });
    if (g.hints >= G.MAX_HINTS || g.guesses.length < G.hintAt(g.hints))
      return res.status(400).json({ error: "Pas encore d'indice disponible." });
    // indice intelligent : jamais une info que le joueur a déjà trouvée
    const h = G.nextHint(G.playerOfDay(day), g.guesses, g.hintList);
    if (!h) return res.status(400).json({ error: 'Tu as déjà trouvé tout ce que les indices pourraient te dire.' });
    g.hintList = [...g.hintList, h];
    g.hints = g.hintList.length;
    res.json(await state(req, day, saved(req, db.run('UPDATE games SET hints = ?, hint_list = ? WHERE id = ?', g.hints, JSON.stringify(g.hintList), g.id))));
  }));

  app.post('/api/giveup', A(async (req, res) => {
    const day = dayOf(req);
    const g = await getGame(req, day, true);
    let write = null;
    if (g.status === 'playing') {
      g.status = 'gaveup'; g.finished_at = db.now();
      forget(req); GAMES.set(`${owner(req).join(':')}:${day}`, g);
      write = saved(req, db.run("UPDATE games SET status = 'gaveup', finished_at = ? WHERE id = ?", g.finished_at, g.id));
    }
    res.json(await state(req, day, write));
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

  // ——— Collection : un pack FoOotix par jour, à part du jeu ———
  // Le pack bonus (gagné en trouvant le joueur du jour) est rangé sous le jour suivi de « #2 ».
  const BONUS = (day) => day + '#2';
  async function packState(req, day = G.today()) {
    const [col, val] = owner(req);
    const [rows, g] = await Promise.all([
      db.all(`SELECT day FROM packs WHERE ${col} = ? AND day IN (?, ?)`, val, day, BONUS(day)),
      db.get(`SELECT status FROM games WHERE ${col} = ? AND day = ?`, val, day),
    ]);
    const has = new Set(rows.map((r) => r.day));
    return { main: has.has(day), bonus: has.has(BONUS(day)) ? 'opened' : g && g.status === 'won' ? 'ready' : 'locked' };
  }
  async function collection(req) {
    const [col, val] = owner(req);
    const day = G.today();
    const rows = await db.all(`SELECT p.day, c.slot, c.player_id FROM cards c JOIN packs p ON p.id = c.pack_id WHERE p.${col} = ? ORDER BY p.id, c.slot`, val);
    const owned = new Map();
    const today = { [day]: [], [BONUS(day)]: [] };
    for (const r of rows) {
      const pl = G.BY_ID[r.player_id];
      if (!pl) continue;
      const o = owned.get(pl.id) || { ...G.collectCard(pl), n: 0 };
      o.n++;
      owned.set(pl.id, o);
      if (today[r.day]) today[r.day].push({ ...G.collectCard(pl), isNew: o.n === 1 });
    }
    const st = await packState(req, day);
    return { day, packs: { ...st, mainCards: today[day], bonusCards: today[BONUS(day)] }, cards: [...owned.values()], totals: G.deckTotals() };
  }
  app.get('/api/collection', A(async (req, res) => {
    const [c, user] = await Promise.all([collection(req), publicUser(req)]);
    res.json({ ...c, user });
  }));
  app.post('/api/pack', A(async (req, res) => {
    const [col, val] = owner(req);
    const day = G.today();
    const bonus = !!(req.body || {}).bonus;
    forget(req);
    if (bonus && (await packState(req, day)).bonus === 'locked') return res.status(400).json({ error: 'Trouve le joueur du jour pour gagner le pack bonus.' });
    const r = await db.run(`INSERT INTO packs (day, ${col}, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`, bonus ? BONUS(day) : day, val, db.now());
    if (r.rows.length) {
      const ids = G.drawPack((n) => crypto.randomInt(n));
      for (let i = 0; i < ids.length; i++) await db.run('INSERT INTO cards (pack_id, slot, player_id) VALUES (?, ?, ?)', r.rows[0].id, i, ids[i]);
    }
    const [c, user] = await Promise.all([collection(req), publicUser(req)]);
    res.json({ ...c, user, opened: bonus ? 'bonus' : 'main', already: !r.rows.length });
  }));
};
