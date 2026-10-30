// ——— Front : la page HTML (avec son contenu pour les moteurs), les fichiers du site, robots, sitemap ———
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const G = require('./game');
const I18N = require('./i18n');
const { A, PROD, dayStats } = require('./core');
const SHARE = require('./shareimg');

module.exports = function front({ app, db, DOMAIN }) {
  // la page porte l'empreinte des fichiers : après une mise à jour, le navigateur recharge le nouveau code
  const PUB = path.join(__dirname, '..', 'public');
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
      .replace('href="/favicon.svg"', `href="/favicon.svg?v=${stamp('favicon.svg')}"`)
      .replace('</head>', () => `${adHead}<script>window.FOOTIX = ${JSON.stringify({ ...CONFIG, lang }).replace(/</g, '\\u003c')};</script>\n</head>`);
    if (lang === 'en') {
      for (const [fr, en] of [
        ['<html lang="fr">', '<html lang="en">'],
        ['FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer'],
        ['FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer'],
        ['Chaque jour, un footballeur à deviner : légendes et joueurs actuels de Ligue 1, Premier League, Bundesliga, Liga et Serie A.', 'A footballer to guess every day: legends and current players from the Premier League, LaLiga, Serie A, Bundesliga and Ligue 1.'],
        ["Un footballeur à deviner chaque jour. Trouve-le en moins d'essais que tes potes.", 'One mystery footballer a day. Can you guess him in fewer tries than your friends?'],
        ['content="https://foootix.com/og.png"', 'content="https://foootix.com/og-en.png"'],
        ['<span>Jouer</span>', '<span>Play</span>'], ['<span>Classement</span>', '<span>Ranking</span>'], ['<span>Duel</span>', '<span>Duel</span>'],
        ['FoOotix — un joueur par jour, tiré au sort parmi les cinq grands championnats européens.', "FoOotix — one player a day, drawn from Europe's top five leagues."],
        ['Résumés et photos : <a href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a>', 'Summaries and photos: <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>'],
        ['>Règles du jeu<', '>How to play<'], ['>Archives<', '>Archive<'], ['>Mentions légales<', '>Legal notice<'], ['>Confidentialité et cookies<', '>Privacy and cookies<'], ['>Gérer mes cookies<', '>Manage cookies<'],
        ['hreflang="en" lang="en">English version<', 'hreflang="fr" lang="fr">Version française<'],
      ]) h = h.split(fr).join(en);
    }
    return h;
  };
  app.get('/robots.txt', (req, res) => res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: https://${DOMAIN}/sitemap.xml\n`));
  app.get('/sitemap.xml', (req, res) => {
    const pages = ['/', '/en', '/regles', '/joueurs', '/classement', '/collection', '/duel'];
    for (let i = 0; i < G.dayIndex(G.today()); i++) pages.push('/joueur/' + G.playerOfDay(G.dayFromIndex(i)).id);
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map((p) => `<url><loc>https://${DOMAIN}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
  });
  app.get('/ads.txt', (req, res) => {
    if (!ADS) return res.status(404).type('text').send('');
    res.type('text').send(`google.com, ${ADS.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
  });

  // Fichiers du site compressés une fois pour toutes au démarrage (au lieu de l'être à chaque visite)
  function packed(body, type, cache, quality = 11) {
    const raw = Buffer.from(body);
    return {
      type, cache, raw,
      br: zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } }),
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
  const BASE = { fr: indexFor('fr'), en: indexFor('en') };
  const render = require('./pages')({ G, dayStats });
  // chaque page arrive avec son vrai contenu, son titre et son adresse canonique (gardée 10 min en mémoire)
  const HTML = new Map();
  const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  async function pageFor(pathName, lang) {
    const key = `${lang}:${pathName}:${G.today()}`;
    const c = HTML.get(key);
    if (c && Date.now() - c.t < 600000) return c.v;
    // /en : la page d'accueil en anglais, pour les liens partagés à l'étranger (aperçu et texte en anglais)
    // /r/… : un résultat partagé. La page d'accueil, avec un aperçu (titre, image) propre à ce score
    const shared = pathName.startsWith('/r/') ? SHARE.parse(pathName.slice(3)) : null;
    const r = await render(pathName === '/en' || shared ? '/' : pathName, lang);
    let h = BASE[lang];
    const url = `https://${DOMAIN}${pathName}`;
    h = h.replace('<link rel="canonical" href="https://foootix.com/">', `<link rel="canonical" href="${attr(url)}">`)
      .replace('<meta property="og:url" content="https://foootix.com/">', `<meta property="og:url" content="${attr(url)}">`);
    if (pathName === '/en' || shared) h = h.replace('</head>', '<script>history.replaceState(null, \'\', \'/\' + location.search);</script>\n</head>');
    if (/^\/(compte|duel\/|ligue\/|r\/)/.test(pathName) || !r) h = h.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
    if (r && r.title) h = h.replace(/<title>[^<]*<\/title>/, `<title>${attr(r.title)}</title>`).replace(/(<meta property="og:title" content=")[^"]*/, `$1${attr(r.title)}`);
    if (r && r.desc) h = h.replace(/(<meta name="description" content=")[^"]*/, `$1${attr(r.desc)}`).replace(/(<meta property="og:description" content=")[^"]*/, `$1${attr(r.desc)}`);
    if (shared) {
      const w = SHARE.words(shared);
      h = h.replace(/(<meta property="og:title" content=")[^"]*/, `$1${attr(w.title)}`)
        .replace(/(<meta property="og:description" content=")[^"]*/, `$1${attr(w.desc)}`)
        .replace(/(<meta property="og:image" content=")[^"]*/, `$1https://${DOMAIN}${attr(pathName)}.png`);
    }
    h = h.replace('<main id="app"></main>', () => `<main id="app">${(r && r.main) || ''}</main>${r && r.about ? `\n<section class="about" id="about">${r.about}</section>` : ''}`);
    const v = { ...packed(h, 'text/html; charset=utf-8', 'no-cache', 5), missing: !r };
    if (HTML.size > 3000) HTML.clear();
    HTML.set(key, { t: Date.now(), v });
    return v;
  }
  app.get(['/app.js', '/style.css'], (req, res) => sendPacked(req, res, ASSETS[req.path]));
  app.get('/en', A(async (req, res) => {
    res.cookie('lang', 'en', { maxAge: 1000 * 60 * 60 * 24 * 365, sameSite: 'lax', secure: PROD });
    res.set('Vary', 'Accept-Encoding');
    sendPacked(req, res, await pageFor('/en', 'en'));
  }));

  // l'image d'un résultat partagé : calculée une fois, puis gardée en mémoire et chez les réseaux sociaux
  const IMG = new Map();
  app.get(/^\/r\/([\w-]+)\.png$/, (req, res) => {
    const code = req.params[0];
    const r = SHARE.parse(code);
    if (!r) return res.status(404).end();
    let img = IMG.get(code);
    if (!img) { img = SHARE.render(r); if (IMG.size > 500) IMG.clear(); IMG.set(code, img); }
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' }).end(img);
  });
  app.get('/r/:code', A(async (req, res, next) => {
    if (!SHARE.parse(req.params.code)) return next();
    res.set('Vary', 'Accept-Encoding, Accept-Language, Cookie');
    sendPacked(req, res, await pageFor(req.path, I18N.pick(req)));
  }));

  app.get(['/', '/index.html', '/jour/:day', '/album', '/collection', '/classement', '/compte', '/regles', '/confidentialite', '/mentions-legales', '/ligues', '/ligue/:code', '/duel', '/duel/:code', '/joueur/:id', '/joueurs'], A(async (req, res) => {
    res.set('Vary', 'Accept-Encoding, Accept-Language, Cookie');
    const page = await pageFor(req.path === '/index.html' ? '/' : req.path, I18N.pick(req));
    if (page.missing) res.status(404);
    sendPacked(req, res, page);
    // Neon s'endort après 5 min sans requête et met près d'une seconde à se réveiller : on le réveille
    // pendant que le navigateur charge la page, pour que les premières données arrivent sans attente.
    // Pas pour UptimeRobot et les robots, sinon la base ne dormirait jamais (quota gratuit).
    if (!/bot|crawl|spider|monitor|uptime|preview|curl|wget|headless/i.test(req.get('user-agent') || '')) db.get('SELECT 1 x').catch(() => {});
  }));
  app.use(express.static(PUB, { maxAge: PROD ? '30d' : 0, index: false }));
};
