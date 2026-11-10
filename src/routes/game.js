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
  // cartes que l'on possède : celles de ses packs (sauf revendues ou achetées par un autre), et celles achetées sur le marché
  const mine = (req) => (req.user
    ? ['(c.holder = ? OR (c.holder IS NULL AND p.user_id = ?))', [req.user.id, req.user.id]]
    : ['(c.holder IS NULL AND p.anon = ?)', [req.aid]]);
  const ALIVE = '(c.gone IS NULL OR c.gone = 0)';
  const ACTIVE = 'l.buyer IS NULL AND l.cancelled = 0';
  async function coins(req) {
    if (!req.user) return null;
    const w = await db.get('SELECT coins FROM wallets WHERE user_id = ?', req.user.id);
    return w ? w.coins : 0;
  }
  const credit = (userId, n) => db.run('INSERT INTO wallets (user_id, coins) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET coins = wallets.coins + excluded.coins', userId, n);
  // débit seulement si le solde suffit : renvoie vrai si c'est fait
  const debit = async (userId, n) => (await db.run('UPDATE wallets SET coins = coins - ? WHERE user_id = ? AND coins >= ?', n, userId, n)).changes > 0;

  async function collection(req) {
    const day = G.today();
    const [cond, params] = mine(req);
    const [rows, listed, st, wallet] = await Promise.all([
      db.all(`SELECT p.day, c.slot, c.player_id FROM cards c JOIN packs p ON p.id = c.pack_id WHERE ${ALIVE} AND ${cond} ORDER BY p.id, c.slot`, ...params),
      req.user ? db.all(`SELECT l.id, l.player_id, l.price FROM listings l WHERE l.seller = ? AND ${ACTIVE}`, req.user.id) : [],
      packState(req, day),
      coins(req),
    ]);
    const owned = new Map();
    const today = { [day]: [], [BONUS(day)]: [] };
    for (const r of rows) {
      const pl = G.BY_ID[r.player_id];
      if (!pl) continue;
      const o = owned.get(pl.id) || { ...G.collectCard(pl), n: 0, listed: 0 };
      o.n++;
      owned.set(pl.id, o);
      if (today[r.day]) today[r.day].push({ ...G.collectCard(pl), isNew: o.n === 1 });
    }
    for (const l of listed) { const o = owned.get(l.player_id); if (o) o.listed++; }
    return {
      day, packs: { ...st, mainCards: today[day], bonusCards: today[BONUS(day)] }, cards: [...owned.values()], totals: G.deckTotals(),
      coins: wallet, listings: listed.map((l) => ({ id: l.id, player: l.player_id, price: l.price })),
      prices: { sell: G.SELL, shop: G.SHOP, max: G.MAX_PRICE },
    };
  }
  app.get('/api/collection', A(async (req, res) => {
    const [c, user] = await Promise.all([collection(req), publicUser(req)]);
    res.json({ ...c, user });
  }));
  // ouvre un pack : enregistre ses cartes et les renvoie dans l'ordre de sortie
  async function openPack(day, col, val, kind) {
    const r = await db.run(`INSERT INTO packs (day, ${col}, kind, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`, day, val, kind === 'base' ? null : kind, db.now());
    if (!r.rows.length) return null;
    const ids = G.drawPack((n) => crypto.randomInt(n), kind);
    for (let i = 0; i < ids.length; i++) await db.run('INSERT INTO cards (pack_id, slot, player_id) VALUES (?, ?, ?)', r.rows[0].id, i, ids[i]);
    return ids.map((id) => G.collectCard(G.BY_ID[id]));
  }
  async function withNew(req, fresh) {
    const [c, user] = await Promise.all([collection(req), publicUser(req)]);
    // « nouvelle » : la carte n'était pas déjà dans la collection avant ce pack
    if (fresh) {
      const count = Object.fromEntries(c.cards.map((x) => [x.id, x.n]));
      const seen = {};
      fresh = fresh.map((x) => { seen[x.id] = (seen[x.id] || 0) + 1; return { ...x, isNew: count[x.id] === seen[x.id] }; });
    }
    return { ...c, user, fresh };
  }
  app.post('/api/pack', A(async (req, res) => {
    const [col, val] = owner(req);
    const day = G.today();
    const bonus = !!(req.body || {}).bonus;
    forget(req);
    if (bonus && (await packState(req, day)).bonus === 'locked') return res.status(400).json({ error: 'Trouve le joueur du jour pour gagner le pack bonus.' });
    const fresh = await openPack(bonus ? BONUS(day) : day, col, val, bonus ? 'gold' : 'base');
    res.json({ ...(await withNew(req, fresh)), opened: bonus ? 'bonus' : 'main', kind: bonus ? 'gold' : 'base', already: !fresh });
  }));

  // ——— Pièces, boutique et marché (compte obligatoire) ———
  const needUser = (req, res) => {
    if (req.user) return true;
    res.status(401).json({ error: 'Crée un compte pour vendre et acheter des cartes.' });
    return false;
  };
  // une carte de ce joueur que l'on possède et qui n'est pas déjà en vente
  const freeCard = (req, playerId) => db.get(`SELECT c.pack_id, c.slot FROM cards c JOIN packs p ON p.id = c.pack_id
      WHERE c.player_id = ? AND ${ALIVE} AND ${mine(req)[0]}
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.pack_id = c.pack_id AND l.slot = c.slot AND ${ACTIVE})
      ORDER BY c.pack_id DESC, c.slot LIMIT 1`, playerId, ...mine(req)[1]);

  // revente directe à FoOotix, au prix fixe de la rareté
  app.post('/api/sell', A(async (req, res) => {
    if (!needUser(req, res)) return;
    const id = String((req.body || {}).id || '');
    if (!G.BY_ID[id]) return res.status(400).json({ error: 'Carte inconnue.' });
    const c = await freeCard(req, id);
    if (!c) return res.status(400).json({ error: 'Tu n’as pas cette carte (ou elle est déjà en vente).' });
    const r = await db.run(`UPDATE cards SET gone = 1 WHERE pack_id = ? AND slot = ? AND (gone IS NULL OR gone = 0)
      AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.pack_id = cards.pack_id AND l.slot = cards.slot AND ${ACTIVE})`, c.pack_id, c.slot);
    if (!r.changes) return res.status(409).json({ error: 'Cette carte vient de changer, réessaie.' });
    const gain = G.SELL[G.tierOf(id)];
    await credit(req.user.id, gain);
    res.json({ ...(await withNew(req)), gain });
  }));

  // boutique : booster Or ou Légende contre des pièces
  app.post('/api/shop', A(async (req, res) => {
    if (!needUser(req, res)) return;
    const kind = String((req.body || {}).kind || '');
    const price = G.SHOP[kind];
    if (!price) return res.status(400).json({ error: 'Booster inconnu.' });
    if (!(await debit(req.user.id, price))) return res.status(400).json({ error: 'Pas assez de pièces.' });
    let fresh;
    try {
      fresh = await openPack('achat:' + crypto.randomUUID(), 'user_id', req.user.id, kind);
    } catch (e) {
      await credit(req.user.id, price);
      throw e;
    }
    res.json({ ...(await withNew(req, fresh)), kind });
  }));

  // le marché : les cartes en vente par les joueurs
  app.get('/api/market', A(async (req, res) => {
    const rows = await db.all(`SELECT l.id, l.player_id, l.price, l.seller, l.created_at, u.username FROM listings l JOIN users u ON u.id = l.seller
      WHERE ${ACTIVE} ORDER BY l.id DESC LIMIT 400`);
    const [wallet, user] = await Promise.all([coins(req), publicUser(req)]);
    res.json({
      user, coins: wallet, prices: { sell: G.SELL, shop: G.SHOP, max: G.MAX_PRICE },
      listings: rows.filter((r) => G.BY_ID[r.player_id]).map((r) => ({
        id: r.id, price: r.price, seller: r.username, mine: !!req.user && r.seller === req.user.id, at: r.created_at,
        card: G.collectCard(G.BY_ID[r.player_id]),
      })),
    });
  }));
  // mettre une carte en vente : au moins le prix de revente directe
  app.post('/api/market/list', A(async (req, res) => {
    if (!needUser(req, res)) return;
    const id = String((req.body || {}).id || '');
    const price = Math.round(Number((req.body || {}).price));
    if (!G.BY_ID[id]) return res.status(400).json({ error: 'Carte inconnue.' });
    const min = G.SELL[G.tierOf(id)];
    if (!Number.isFinite(price) || price < min || price > G.MAX_PRICE) return res.status(400).json({ error: `Prix entre ${min} et ${G.MAX_PRICE} pièces.` });
    const c = await freeCard(req, id);
    if (!c) return res.status(400).json({ error: 'Tu n’as pas cette carte (ou elle est déjà en vente).' });
    try {
      await db.run('INSERT INTO listings (pack_id, slot, player_id, seller, price, created_at) VALUES (?, ?, ?, ?, ?, ?)', c.pack_id, c.slot, id, req.user.id, price, db.now());
    } catch {
      return res.status(409).json({ error: 'Cette carte est déjà en vente.' });
    }
    res.json(await withNew(req));
  }));
  app.post('/api/market/cancel', A(async (req, res) => {
    if (!needUser(req, res)) return;
    const r = await db.run(`UPDATE listings SET cancelled = 1 WHERE id = ? AND seller = ? AND buyer IS NULL AND cancelled = 0`, Number((req.body || {}).listing), req.user.id);
    if (!r.changes) return res.status(400).json({ error: 'Cette vente n’existe plus.' });
    res.json(await withNew(req));
  }));
  // acheter : on paie d'abord, puis on réserve l'annonce ; si quelqu'un l'a prise avant, on est remboursé
  app.post('/api/market/buy', A(async (req, res) => {
    if (!needUser(req, res)) return;
    const l = await db.get(`SELECT * FROM listings l WHERE l.id = ? AND ${ACTIVE}`, Number((req.body || {}).listing));
    if (!l) return res.status(400).json({ error: 'Cette carte n’est plus en vente.' });
    if (l.seller === req.user.id) return res.status(400).json({ error: 'C’est ta propre vente.' });
    if (!(await debit(req.user.id, l.price))) return res.status(400).json({ error: 'Pas assez de pièces.' });
    const r = await db.run('UPDATE listings SET buyer = ?, sold_at = ? WHERE id = ? AND buyer IS NULL AND cancelled = 0', req.user.id, db.now(), l.id);
    if (!r.changes) {
      await credit(req.user.id, l.price);
      return res.status(409).json({ error: 'Quelqu’un vient de l’acheter avant toi.' });
    }
    await db.run('UPDATE cards SET holder = ? WHERE pack_id = ? AND slot = ?', req.user.id, l.pack_id, l.slot);
    await credit(l.seller, l.price);
    res.json({ ...(await withNew(req)), bought: G.collectCard(G.BY_ID[l.player_id]) });
  }));
};
