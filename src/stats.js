// Statistiques de visite, rien que pour le propriétaire du site : foootix.com/stats
// Mesure maison, sans outil extérieur : un visiteur = un appareil par jour (empreinte du cookie aid,
// jamais l'adresse IP). Les compteurs sont gardés en mémoire puis écrits dans la base toutes les 15 s.
const crypto = require('crypto');
const express = require('express');

const BOT = /bot|crawl|spider|slurp|preview|monitor|uptime|headless|lighthouse|curl|wget|python|axios|node-fetch/i;
const PAGES = ['/', '/album', '/classement', '/compte', '/regles', '/confidentialite', '/mentions-legales', '/ligues', '/ligue', '/joueur'];

module.exports = function stats({ app, db, G, A, slowDown, DOMAIN }) {
  const VBUF = new Map(); // "jour|visiteur" → { views, ref, mobile }
  const PBUF = new Map(); // "jour|page" → vues
  const LIVE = new Map(); // visiteur → dernière page vue (pour « en ce moment »)

  app.post('/api/hit', (req, res) => {
    res.status(204).end();
    const ua = req.get('user-agent') || '';
    if (!ua || BOT.test(ua)) return;
    const { p = '', r = '' } = req.body || {};
    const path = String(p).replace(/^\/(joueur|ligue)\/.*/, '/$1');
    if (!PAGES.includes(path)) return;
    let ref = null;
    const src = /^src:([\w.-]{1,30})$/i.exec(String(r));
    if (src) ref = 'lien « ' + src[1].toLowerCase() + ' »';
    else try {
      const h = new URL(String(r)).hostname.replace(/^www\./, '').toLowerCase();
      if (h && !h.endsWith(DOMAIN) && !h.endsWith('onrender.com')) ref = h.slice(0, 80);
    } catch {}
    const day = G.today();
    const vid = crypto.createHash('sha256').update('v:' + req.aid).digest('hex').slice(0, 16);
    const k = day + '|' + vid;
    const v = VBUF.get(k) || { views: 0, ref: null, mobile: /Mobi|Android|iPhone/i.test(ua) ? 1 : 0 };
    v.views++;
    v.ref = v.ref || ref;
    VBUF.set(k, v);
    PBUF.set(day + '|' + path, (PBUF.get(day + '|' + path) || 0) + 1);
    LIVE.set(vid, Date.now());
  });

  let flushing = false;
  async function flush() {
    for (const [k, t] of LIVE) if (Date.now() - t > 10 * 60 * 1000) LIVE.delete(k);
    if (flushing || (!VBUF.size && !PBUF.size)) return;
    flushing = true;
    const vs = [...VBUF]; const ps = [...PBUF];
    VBUF.clear(); PBUF.clear();
    try {
      // écrit par paquets de 200 lignes : une seule requête au lieu d'une par visiteur
      for (let i = 0; i < vs.length; i += 200) {
        const part = vs.slice(i, i + 200);
        await db.run(`INSERT INTO visits (day, vid, views, ref, mobile) VALUES ${part.map(() => '(?, ?, ?, ?, ?)').join(', ')}
          ON CONFLICT (day, vid) DO UPDATE SET views = visits.views + excluded.views, ref = COALESCE(visits.ref, excluded.ref)`,
        ...part.flatMap(([k, v]) => [...k.split('|'), v.views, v.ref, v.mobile]));
      }
      if (ps.length) {
        await db.run(`INSERT INTO page_views (day, path, views) VALUES ${ps.map(() => '(?, ?, ?)').join(', ')}
          ON CONFLICT (day, path) DO UPDATE SET views = page_views.views + excluded.views`, ...ps.flatMap(([k, n]) => [...k.split('|'), n]));
      }
    } catch (e) { console.warn('Stats non enregistrées :', e.message); }
    flushing = false;
  }
  setInterval(flush, 15000).unref();
  process.once('SIGTERM', () => flush().finally(() => process.exit(0)));

  // ——— Accès : un mot de passe dans ADMIN_PASSWORD sur Render ———
  const PASS = String(process.env.ADMIN_PASSWORD || '');
  const TOKEN = PASS ? crypto.createHmac('sha256', PASS).update('foootix-stats').digest('hex') : '';
  const isAdmin = (req) => {
    const c = String(req.cookies.adm || '');
    return TOKEN && c.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(TOKEN));
  };
  const admCookie = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 90, path: '/stats' };

  app.post('/stats', slowDown, express.urlencoded({ extended: false, limit: '2kb' }), (req, res) => {
    if (req.body && req.body.out) { res.clearCookie('adm', { path: '/stats' }); return res.redirect(303, '/stats'); }
    const p = String((req.body && req.body.password) || '');
    if (TOKEN && p.length === PASS.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(PASS))) {
      res.cookie('adm', TOKEN, admCookie);
      return res.redirect(303, '/stats');
    }
    res.status(401).type('html').send(page(login('Mot de passe incorrect.')));
  });

  app.get('/stats', A(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (!PASS) return res.type('html').send(page(`<p>Pour ouvrir cette page, ajoute une variable <b>ADMIN_PASSWORD</b> (le mot de passe de ton choix) dans Render, onglet Environment, puis reviens ici.</p>`));
    if (!isAdmin(req)) return res.type('html').send(page(login()));
    await flush();
    res.type('html').send(page(await report()));
  }));

  async function report() {
    const today = G.today();
    const ti = G.dayIndex(today);
    const days = Array.from({ length: 30 }, (_, i) => G.dayFromIndex(ti - i));
    const from = days[days.length - 1];
    const from7 = days[6];
    const paris = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
    const [vis, games, users, refs, pages, loyal, tot] = await Promise.all([
      db.all('SELECT day, COUNT(*) n, SUM(views) v, SUM(mobile) m FROM visits WHERE day >= ? GROUP BY day', from),
      db.all("SELECT day, COUNT(*) n, SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) w FROM games WHERE day >= ? GROUP BY day", from),
      db.all('SELECT created_at FROM users WHERE created_at >= ?', new Date(Date.now() - 32 * 86400000).toISOString()),
      db.all('SELECT ref, COUNT(*) n FROM visits WHERE day >= ? AND ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 12', from),
      db.all('SELECT path, SUM(views) n FROM page_views WHERE day >= ? GROUP BY path ORDER BY n DESC', from7),
      db.get('SELECT COUNT(*) n FROM (SELECT vid FROM visits WHERE day >= ? GROUP BY vid HAVING COUNT(*) >= 2) t', from7),
      db.get('SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM leagues) l, (SELECT COUNT(DISTINCT vid) FROM visits WHERE day >= ?) w, (SELECT COUNT(*) FROM visits WHERE day >= ? AND ref IS NULL) d, (SELECT COUNT(*) FROM visits WHERE day >= ?) a', from7, from, from),
    ]);
    const V = new Map(vis.map((r) => [r.day, r]));
    const Gm = new Map(games.map((r) => [r.day, r]));
    const U = new Map();
    for (const r of users) { const d = paris.format(new Date(r.created_at)); U.set(d, (U.get(d) || 0) + 1); }
    const live = [...LIVE.values()].filter((t) => Date.now() - t < 5 * 60 * 1000).length;
    for (const [k, t] of LIVE) if (Date.now() - t > 10 * 60 * 1000) LIVE.delete(k);

    const t = V.get(today) || { n: 0, v: 0, m: 0 };
    const tg = Gm.get(today) || { n: 0, w: 0 };
    const y = V.get(days[1]) || { n: 0 };
    const max = Math.max(1, ...days.map((d) => (V.get(d) || {}).n || 0));
    const fmt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const pct = (a, b) => (b ? Math.round((100 * a) / b) + ' %' : '–');
    const NAMES = { '/': 'Jeu du jour', '/album': 'Album', '/classement': 'Classement', '/compte': 'Compte', '/regles': 'Règles', '/ligues': 'Ligues', '/ligue': 'Page d\'une ligue', '/joueur': 'Fiches joueurs', '/confidentialite': 'Confidentialité', '/mentions-legales': 'Mentions légales' };
    const totalPv = pages.reduce((s, r) => s + r.n, 0);

    const warn = process.env.SECRET ? '' : '<p class="err"><b>Attention :</b> la variable SECRET n\'est pas définie sur Render. Quelqu\'un qui lit le code peut deviner les joueurs des prochains jours. Préviens Claude avant de la créer : la changer modifie aussi les joueurs déjà passés.</p>';
    return `${warn}
      <div class="kpis">
        <div><b>${live}</b><span>en ce moment</span></div>
        <div><b>${t.n}</b><span>visiteurs aujourd'hui <em>(hier ${y.n})</em></span></div>
        <div><b>${t.v || 0}</b><span>pages vues aujourd'hui</span></div>
        <div><b>${tg.n}</b><span>parties lancées, ${tg.w} trouvées</span></div>
        <div><b>${tot.w}</b><span>visiteurs sur 7 jours, ${loyal.n} revenus au moins 2 jours</span></div>
        <div><b>${tot.u}</b><span>comptes, ${tot.l} ligue${tot.l > 1 ? 's' : ''}</span></div>
      </div>
      <h2>30 derniers jours</h2>
      <table><thead><tr><th>Jour</th><th class="r">Visiteurs</th><th class="opt"></th><th class="r opt">Pages vues</th><th class="r opt">Mobile</th><th class="r">Parties</th><th class="r">Trouvées</th><th class="r">Comptes</th></tr></thead><tbody>
      ${days.map((d) => {
        const v = V.get(d) || { n: 0, v: 0, m: 0 }; const g = Gm.get(d) || { n: 0, w: 0 };
        return `<tr${d === today ? ' class="now"' : ''}><td>${fmt(d)}</td><td class="r"><b>${v.n}</b></td><td class="bar opt"><i style="width:${(100 * v.n) / max}%"></i></td><td class="r opt">${v.v || 0}</td><td class="r opt">${pct(v.m, v.n)}</td><td class="r">${g.n}</td><td class="r">${g.w}</td><td class="r">${U.get(d) || 0}</td></tr>`;
      }).join('')}
      </tbody></table>
      <div class="two">
        <div><h2>D'où ils viennent <em>(30 jours)</em></h2>
          <table><tbody>
          <tr><td>Accès direct, appli ou lien partagé en message</td><td class="r">${tot.d}</td><td class="r muted">${pct(tot.d, tot.a)}</td></tr>
          ${refs.map((r) => `<tr><td>${esc(r.ref)}</td><td class="r">${r.n}</td><td class="r muted">${pct(r.n, tot.a)}</td></tr>`).join('')}
          </tbody></table></div>
        <div><h2>Pages vues <em>(7 jours)</em></h2>
          <table><tbody>
          ${pages.map((r) => `<tr><td>${NAMES[r.path] || esc(r.path)}</td><td class="r">${r.n}</td><td class="r muted">${pct(r.n, totalPv)}</td></tr>`).join('') || '<tr><td class="muted">Rien pour l\'instant</td></tr>'}
          </tbody></table></div>
      </div>
      <p class="muted">Un visiteur = un appareil (téléphone, ordinateur) sur une journée. Les robots et UptimeRobot ne sont pas comptés. Les chiffres datent du ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}.</p>
      <form method="post"><button name="out" value="1">Se déconnecter</button></form>`;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const login = (err = '') => `<form method="post" class="login"><label>Mot de passe<input type="password" name="password" autofocus autocomplete="current-password"></label><button>Entrer</button>${err ? `<p class="err">${err}</p>` : ''}</form>`;
  const page = (body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Stats · FoOotix</title>
<style>
:root{--bg:#f6f4ee;--ink:#1c1c1a;--mut:#6b6a63;--line:#dcd8cc;--bar:#1d5236;--acc:#f0c548}
@media (prefers-color-scheme:dark){:root{--bg:#141614;--ink:#ecebe6;--mut:#9a998f;--line:#2c302c;--bar:#13392a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
header{background:var(--bar);color:#fff;padding:12px 16px;font-weight:700}header span{color:var(--acc)}
main{max-width:980px;margin:0 auto;padding:16px}
h2{font-size:16px;margin:28px 0 8px}em{font-style:normal;color:var(--mut);font-weight:400}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border-top:2px solid var(--ink)}
.kpis div{padding:10px 8px 12px 0;border-bottom:1px solid var(--line)}.kpis b{display:block;font-size:28px;line-height:1.1}.kpis span{color:var(--mut);font-size:13px}
table{width:100%;border-collapse:collapse}th,td{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:12px;color:var(--mut);font-weight:600}.r{text-align:right}.muted{color:var(--mut)}tr.now td{background:color-mix(in srgb,var(--acc) 22%,transparent)}
td.bar{width:30%;min-width:60px}td.bar i{display:block;height:9px;background:var(--bar)}
@media (prefers-color-scheme:dark){td.bar i{background:var(--acc)}}
.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}.two td:first-child{white-space:normal}
@media (max-width:640px){.two{grid-template-columns:1fr}.opt{display:none}th,td{padding:5px 3px}}
.login{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:24px}label{display:flex;flex-direction:column;gap:4px;font-size:13px;color:var(--mut)}
input{font:inherit;padding:8px 10px;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:3px}
button{font:inherit;padding:8px 14px;border:1px solid var(--ink);background:transparent;color:var(--ink);border-radius:3px;cursor:pointer}
.err{color:#b3261e;width:100%}form:last-child{margin-top:20px}
</style></head><body><header>FoOotix<span>.com</span> · statistiques</header><main>${body}</main></body></html>`;
};
