// ——— Comptes ———
const crypto = require('crypto');
const db = require('../db');
const G = require('../game');
const C = require('../core');
const { A, slowDown, SESS, cookieOpts, forget, publicUser } = C;

module.exports = function routes({ app }) {
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
    await db.run('UPDATE packs SET user_id = ?, anon = NULL WHERE anon = ? AND day NOT IN (SELECT day FROM packs WHERE user_id = ?)', userId, req.aid, userId);
    forget({ user: { id: userId } }, req.aid);
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
    forget(req);
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
};
