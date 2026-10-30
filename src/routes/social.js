// ——— Classement et ligues entre potes ———
const crypto = require('crypto');
const db = require('../db');
const G = require('../game');
const C = require('../core');
const { A, slowDown, wonDays, streakFrom, publicUser, board, J } = C;

module.exports = function routes({ app }) {
  app.get('/api/leaderboard', A(async (req, res) => {
    const day = G.today();
    const { rows, today: todayRows } = await board(day);
    const me = req.user ? req.user.id : null;
    const ranked = (list) => list.map((x, i) => ({ ...x, rank: i + 1, me: x.id === me }));
    // seulement le podium, et ton propre rang : le nombre de joueurs classés n'est jamais montré
    const top = (list) => {
      const mine = list.find((x) => x.me);
      return { top: list.slice(0, 3).map(({ id, ...x }) => x), mine: mine ? (({ id, ...x }) => x)(mine) : null };
    };
    const points = ranked([...rows].sort((a, b) => b.total - a.total || b.found - a.found || a.username.localeCompare(b.username)));
    const streaks = ranked(rows.filter((x) => x.streak > 0).sort((a, b) => b.streak - a.streak || b.total - a.total));
    const records = ranked([...rows].sort((a, b) => b.best - a.best || b.total - a.total));
    const today = ranked(todayRows);
    res.json({ points: top(points), streaks: top(streaks), records: top(records), today: top(today) });
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
};
