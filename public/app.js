'use strict';

const $ = (s, el = document) => el.querySelector(s);
// Langue : choisie par le serveur (téléphone en français → français, sinon anglais), changeable en bas de page
const LANG = (window.FOOTIX || {}).lang === 'en' ? 'en' : 'fr';
const EN = LANG === 'en';
const L = (fr, en) => (EN ? en : fr);
const LOC = EN ? 'en-GB' : 'fr-FR';
const s_ = (n) => ((EN ? n !== 1 : n > 1) ? 's' : ''); // pluriel : « 0 joueur » mais « 0 players »
const ord = (n) => EN ? `${n}<sup>${[, 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th'}</sup>` : `${n}<sup>${n === 1 ? 'er' : 'e'}</sup>`;
const app = $('#app');
const SSR0 = { path: location.pathname, html: app.innerHTML, title: document.title };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

async function fetchJSON(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || L('Erreur réseau', 'Network error'));
  return j;
}
// Les pages déjà vues s'affichent tout de suite depuis la mémoire, même anciennes, puis se mettent à jour
// en fond : si la nouvelle version diffère, la page ouverte se redessine toute seule.
const CACHE = new Map();
const USED = new Set(); // données lues par la page affichée
const AUTH = /^(login|signup|logout|delete-account)$/;
function api(path, body, bg) {
  if (body) {
    // un changement de compte rend tout faux ; une action de jeu périme seulement les autres pages
    if (AUTH.test(path)) CACHE.clear();
    else { CACHE.delete('today'); CACHE.delete('me'); CACHE.forEach((c) => { c.t = 0; }); }
    const r = fetchJSON(path, body);
    // essai, indice, abandon : la réponse est déjà l'état complet du jeu, on le garde pour le retour sur l'onglet
    if (/^(guess|hint|giveup)$/.test(path)) r.then((j) => CACHE.set(j.past ? 'today?day=' + j.day : 'today', { t: Date.now(), p: Promise.resolve(j), json: JSON.stringify(j) }), () => {});
    return r;
  }
  if (!bg) USED.add(path);
  const c = CACHE.get(path);
  if (c && !c.pending) {
    if (Date.now() - c.t > 15000 && !c.refreshing) refresh(path);
    return c.p;
  }
  if (c) return c.p;
  return refresh(path);
}
function refresh(path) {
  const old = CACHE.get(path);
  const e = { t: Date.now(), pending: true };
  e.p = fetchJSON(path).then((j) => { e.pending = false; e.t = Date.now(); e.json = JSON.stringify(j); return j; });
  if (old && !old.pending) {
    // tant que la nouvelle version n'est pas là, on garde l'ancienne pour un affichage instantané
    old.refreshing = true;
    e.p.then(() => {
      CACHE.set(path, e);
      if (e.json !== old.json) window.dispatchEvent(new CustomEvent('fresh', { detail: path }));
    }, () => { old.refreshing = false; });
  } else {
    CACHE.set(path, e);
    e.p.catch(() => CACHE.delete(path));
  }
  return e.p;
}
// charge d'avance ce qu'affiche un onglet, dès qu'on le survole ou qu'on pose le doigt dessus
const PREFETCH = { '/': ['today'], '/album': ['album'], '/collection': ['collection'], '/marche': ['market'], '/classement': ['leaderboard', 'me'], '/ligues': ['leagues'],  '/regles': ['me'], '/compte': ['me'] };
function prefetch(href) { (PREFETCH[href] || []).forEach((p) => api(p, null, true).catch(() => {})); }
['mouseover', 'touchstart'].forEach((ev) => document.addEventListener(ev, (e) => {
  const a = e.target.closest && e.target.closest('a[data-link]');
  if (a) prefetch(a.getAttribute('href'));
}, { passive: true }));

const fmtDate = (d, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString(LOC, { timeZone: 'UTC', ...opts });

// ——— Température ———
function heat(t) {
  const stops = document.documentElement.dataset.theme === 'light'
    ? [[0, [47, 93, 138]], [35, [120, 130, 120]], [60, [185, 130, 28]], [100, [196, 55, 29]]]
    : [[0, [111, 159, 214]], [35, [150, 160, 150]], [60, [217, 164, 65]], [100, [228, 92, 60]]];
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const k = (t - a[0]) / (b[0] - a[0] || 1);
  return `rgb(${a[1].map((v, i) => Math.round(v + (b[1][i] - v) * k)).join(',')})`;
}
// un « non » ne fait pas monter le thermomètre, mais il élimine une piste : on le dit, pour ne pas décourager
function gaugeTip(st, best) {
  if (!st.guesses.length) return L('Fais un premier essai pour la remplir.', 'Make a first guess to fill it.');
  const last = st.guesses[st.guesses.length - 1];
  const nos = st.guesses.filter((g) => g.type === 'clue' && !g.yes).length;
  if (st.status === 'playing' && last.type === 'clue' && !last.yes)
    return L(`Non, mais c'est une piste de moins : ${nos} déjà écartée${nos > 1 ? 's' : ''}. Chaque « non » resserre aussi l'étau.`, `No, but that's one less option: ${nos} ruled out so far. Every "no" narrows it down too.`);
  return best ? L('Elle monte à chaque piste qui resserre l’étau.', 'It rises with every clue that narrows it down.') : L('Fais un premier essai pour la remplir.', 'Make a first guess to fill it.');
}
function word(t) {
  if (t >= 100) return L('Trouvé', 'Found');
  if (t >= 85) return L('Tout proche', 'So close');
  if (t >= 65) return L('Brûlant', 'Burning');
  if (t >= 45) return L('Chaud', 'Hot');
  if (t >= 25) return L('Tiède', 'Warm');
  if (t >= 10) return L('Froid', 'Cold');
  return L('Glacial', 'Freezing');
}

// ——— En-tête ———
let ME = null;
function renderWho(user, ed) {
  ME = user;
  if (ed) renderEdition(ed);
  $('#who').innerHTML = user
    ? `<a class="purse" href="/collection" data-link title="${L('Tes pièces', 'Your coins')}"><i class="coin"></i><b>${Number(user.coins || 0).toLocaleString('fr-FR')}</b></a><a class="pts" href="/classement" data-link title="${L('Tes points cumulés et ta série', 'Your total points and streak')}"><b>${user.points}</b> pts · ${L('série', 'streak')} <b>${user.streak}</b></a><a class="me" href="/compte" data-link>${esc(user.username)}</a>`
    : `<a class="login" href="/compte" data-link>${L('Se connecter', 'Log in')}</a>`;
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await api('logout', {}); go('/'); };
}
function renderEdition(st) {
  $('#edition').innerHTML = `<b>${L('N°', 'No.')} ${st.number}</b> · ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}`;
}

// ——— Publicité ———
// Rien ne s'affiche tant que le compte AdSense n'est pas branché (variables sur Render).
// Le bandeau de consentement est celui de Google (« Confidentialité et messages » dans AdSense),
// il bloque les cookies publicitaires tant que le visiteur n'a pas choisi.
const CFG = window.FOOTIX || {};
// lien de parrainage : foootix.com/?parrain=pseudo — gardé jusqu'à la création du compte
try { const pr = new URLSearchParams(location.search).get('parrain'); if (pr) localStorage.setItem('parrain', pr.slice(0, 30)); } catch {}
const parrain = () => { try { return localStorage.getItem('parrain') || ''; } catch { return ''; } };
function adSlot(where) {
  if (CFG.preview) return `<div class="ad ad-${where}"><span>${L('Publicité', 'Advertisement')}</span><div class="ad-fake"></div></div>`;
  if (!CFG.ads || !CFG.slot) return '';
  return `<div class="ad ad-${where}"><span>${L('Publicité', 'Advertisement')}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(CFG.ads)}" data-ad-slot="${esc(CFG.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
}
function fillAds() {
  if (!CFG.ads) return;
  document.querySelectorAll('ins.adsbygoogle:not([data-adsbygoogle-status])').forEach(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch {}
  });
}
if (CFG.ads) {
  window.googlefc = window.googlefc || {};
  window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
  const c = $('#cookies');
  c.hidden = false;
  $('a', c).onclick = (e) => { e.preventDefault(); window.googlefc.callbackQueue.push(() => window.googlefc.showRevocationMessage()); };
}
// changer de langue : retenu un an dans un cookie, puis on recharge la page
$('#lang').onclick = (e) => {
  e.preventDefault();
  document.cookie = `lang=${EN ? 'fr' : 'en'}; max-age=${3600 * 24 * 365}; path=/; samesite=lax`;
  location.reload();
};

// ——— Routeur ———
function go(path) { history.pushState({}, '', path); route(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', () => route());
// nouvelles données arrivées en fond pour la page affichée : on la redessine sans bouger
// (sauf le jeu, qui se met à jour par ses propres actions, et si on est en train d'écrire)
window.addEventListener('fresh', (e) => {
  if (!USED.has(e.detail) || PACKING || location.pathname.startsWith('/duel') || location.pathname === '/' || location.pathname.startsWith('/jour/') || location.pathname === '/compte') return;
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  route({ quiet: true });
});

// compteur de visites maison (voir /stats) : la page vue, et d'où vient le visiteur à son arrivée
// un lien de campagne comme foootix.com/?s=tiktok1 est compté à part dans /stats, puis retiré de l'adresse
let REF = document.referrer;
{
  const q = new URLSearchParams(location.search);
  const src = q.get('s') || q.get('utm_source');
  if (src) {
    REF = 'src:' + src;
    q.delete('s'); q.delete('utm_source'); q.delete('utm_medium'); q.delete('utm_campaign');
    history.replaceState(history.state, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }
}
function hit(p) {
  try { fetch('/api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p, r: REF }), keepalive: true }).catch(() => {}); } catch {}
  REF = '';
}

let ROUTE = 0;
async function route({ quiet = false } = {}) {
  const p = location.pathname;
  const id = ++ROUTE;
  USED.clear();
  // si la page n'est pas prête presque tout de suite, on le montre (sinon on croit que le clic n'a pas marché)
  const wait = setTimeout(() => { if (id === ROUTE) app.classList.add('loading'); }, 120);
  if (!quiet) hit(p);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === p || (a.getAttribute('href') === '/' && p.startsWith('/jour/')) || (a.getAttribute('href') === '/classement' && (p === '/ligues' || p.startsWith('/ligue/'))) || (a.getAttribute('href') === '/duel' && p.startsWith('/duel')) || (a.getAttribute('href') === '/collection' && (p === '/album' || p === '/marche'))));
  if (!quiet) window.scrollTo(0, 0);
  clearInterval(window.__tick);
  stopDuel();
  // la présentation sous la page n'appartient qu'à la page reçue au chargement
  if (p !== SSR0.path) $('#about')?.remove();
  document.title = p === SSR0.path ? SSR0.title : TITLE;
  try {
    if (p === '/') return await pageGame();
    const jd = p.match(/^\/jour\/(\d{4}-\d{2}-\d{2})$/);
    if (jd) return await pageGame(jd[1]);
    if (p === '/album') return await pageAlbum();
    if (p === '/collection') return await pageCollection();
    if (p === '/marche') return await pageMarket();
    if (p === '/classement') return await pageRank();
    if (p === '/compte') return pageAuth();
    if (['/regles', '/joueurs', '/astuces', '/a-propos'].includes(p)) { if (!(await pageSsr(p))) throw new Error(L('Page indisponible, réessaie.', 'Page unavailable, try again.')); return; }
    if (p === '/ligues') return await pageLeagues();
    if (p === '/duel') return await pageDuel();
    const du = p.match(/^\/duel\/([A-Za-z0-9]{5})$/);
    if (du) return await pageDuel(du[1].toUpperCase());
    const lg = p.match(/^\/ligue\/([A-Za-z0-9]{6})$/);
    if (lg) return await pageLeague(lg[1].toUpperCase());
    if (p === '/confidentialite' || p === '/mentions-legales') return await pageLegalSsr(p);
    const m = p.match(/^\/joueur\/([\w-]+)$/);
    if (m) return await pagePlayer(m[1]);
    app.innerHTML = `<p>${L('Page introuvable.', 'Page not found.')} <a href="/" data-link>${L('Retour au jeu', 'Back to the game')}</a></p>`;
  } catch (e) {
    app.innerHTML = `<p class="msg">${esc(e.message)}</p>`;
  } finally {
    clearTimeout(wait);
    if (id === ROUTE) app.classList.remove('loading');
    fillAds();
  }
}


// ——— Page : jeu ———
let ST = null;
let PLAYING = false;
let DAY = null; // jour passé en cours de rattrapage, null pour le joueur du jour

// la carte tourne sur elle-même, puis se retourne sur le joueur
function spinReveal(box, oldHtml) {
  const fresh = box.innerHTML;
  box.innerHTML = oldHtml;
  const el = box.firstElementChild;
  if (!el.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { box.innerHTML = fresh; return; }
  box.classList.add('spinning');
  el.animate([{ transform: 'rotateY(0)' }, { transform: 'rotateY(990deg)' }], { duration: 1300, easing: 'cubic-bezier(.5,0,.9,.6)' }).onfinish = () => {
    box.innerHTML = fresh;
    box.firstElementChild.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0)' }], { duration: 650, easing: 'cubic-bezier(.2,.9,.3,1.15)' })
      .onfinish = () => box.classList.remove('spinning');
  };
}

// thème : sombre par défaut, clair au choix (mémorisé dans le navigateur)
function initTheme() {
  const b = $('#theme');
  const label = () => {
    const light = document.documentElement.dataset.theme === 'light';
    b.innerHTML = `${light ? '◐' : '◑'} <span>${light ? L('Mode sombre', 'Dark mode') : L('Mode clair', 'Light mode')}</span>`;
    b.title = light ? L('Passer en mode sombre', 'Switch to dark mode') : L('Passer en mode clair', 'Switch to light mode');
  };
  b.onclick = () => {
    const light = document.documentElement.dataset.theme !== 'light';
    if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('theme', light ? 'light' : 'dark'); } catch (e) {}
    label();
    if (ST && $('#gauge')) drawGame();
  };
  label();
}
initTheme();

// confettis, dessinés à la main sur un canevas
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas');
  c.className = 'confetti';
  document.body.appendChild(c);
  const x = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const cols = ['#c4371d', '#d8bb62', '#1f5f3f', '#2f5d8a', getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), '#ecd88f'];
  const bits = Array.from({ length: 160 }, (_, i) => ({
    x: W / 2 + (Math.random() - .5) * 120, y: H * .45,
    vx: (Math.random() - .5) * 16, vy: -Math.random() * 15 - 6,
    w: 6 + Math.random() * 6, h: 3 + Math.random() * 4, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
    c: cols[i % cols.length],
  }));
  const t0 = performance.now();
  (function frame(t) {
    x.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += .38; b.vx *= .985; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      x.save(); x.translate(b.x, b.y); x.rotate(b.r); x.scale(1, Math.cos(b.r * 2));
      x.fillStyle = b.c; x.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); x.restore();
    }
    if (t - t0 < 3500) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
async function pageGame(day = null) {
  const st = await api(day ? 'today?day=' + day : 'today');
  // jour pas encore passé ou trop ancien : le serveur renvoie le joueur du jour
  if (day && !st.past) { history.replaceState({}, '', '/'); day = null; }
  DAY = day;
  PLAYING = false;
  ST = st;
  renderWho(st.user);
  renderEdition(st);
  app.innerHTML = `
    <div class="game">
      <div class="left">
        <div class="hero">
          <div id="banner"></div>
          <div class="intro">
            <div class="kicker">${L('Le joueur mystère n°', 'Mystery player No.')} ${st.number}${st.past ? ` · ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}` : ''}</div>
            <h1>${L('Connais-tu vraiment le foot&nbsp;?', 'Do you really know football?')}</h1>
            <p>${st.past
              ? L(`Rattrapage du ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}&nbsp;: s'il est trouvé, il rejoint ton album, mais sans points ni série. <a href="/" data-link>Retour au joueur du jour</a>`, `Catching up on ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}: find him to add him to your album, but no points or streak. <a href="/" data-link>Back to today's player</a>`)
              : L('Un joueur, un club, une ville, un pays, un poste, une génération&nbsp;: chaque découverte remplit sa carte.', 'Name a player, a club, a country or a position. Every clue fills in his card.')}</p>
          </div>
          <div class="search" id="search">
            <form autocomplete="off">
              <input id="q" placeholder="${L('Écris ici', 'Type here')}" aria-label="${L('Ta proposition', 'Your guess')}" spellcheck="false" autocapitalize="off" autocorrect="off">
              <button>${L('Tenter', 'Guess')}</button>
            </form>
            <div class="msg" id="msg"></div>
          </div>
          <div class="lastg" id="lastg"></div>
          <div class="play">
            <div id="fcard"></div>
            <div class="play-side">
              <section class="gauge" id="gauge"></section>
              <div id="path"></div>
            </div>
          </div>
        </div>
        <div id="packcta"></div>
        <div id="reveal"></div>
        <details class="board-wrap" id="bw" open><summary id="bws" style="display:none"></summary><table class="board" id="board"></table></details>
        ${st.user ? '' : `<div class="nudge">${L('Tu joues sans compte. <a href="/compte" data-link>Crée un compte</a> pour garder ta série et remplir ton album, ta partie du jour sera conservée.', 'You are playing without an account. <a href="/compte" data-link>Create one</a> to keep your streak and fill your album. Today\'s game will be kept.')}</div>`}
        ${adSlot('wide')}
      </div>
      <aside>
        <section id="facts"></section>
        <section class="hints" id="hints"></section>
        <section class="daystats" id="daystats"></section>
        ${adSlot('side')}
      </aside>
    </div>`;
  bindSearch();
  drawGame();
}

// Carte façon FIFA : vide au départ, elle se remplit avec ce que tu découvres.
const SILHOUETTE = `<svg viewBox="0 0 200 200" class="silh" aria-hidden="true"><path d="M100 22c-21 0-35 16-35 39 0 15 6 28 15 36l-1 11c-26 6-47 18-56 32-4 7-6 17-6 30v30h166v-30c0-13-2-23-6-30-9-14-30-26-56-32l-1-11c9-8 15-21 15-36 0-23-14-39-35-39z"/></svg>`;
const shortClub = (n) => n && n.replace(/^(FC|AS|AC|SS|SSC|US|OGC|RC|SC|CF|CD|RCD|SV|VfB|VfL|TSG|1\. FC|Olympique|Stade|Real Club|Club Atlético)\s+/i, '').replace(/\s+(FC|CF|AFC|SAD|AC|BC)$/i, '').replace(/^(de la|de|du|des) /i, '');
// sigle de secours quand le club n'a pas de logo libre sur Wikimedia
const crestText = (n) => (shortClub(n) || n || '?').replace(/[^\p{L}\d ]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w)).slice(0, 3).map((w) => w[0].toUpperCase()).join('') || '?';
function crest(c) {
  const mono = `<span class="mono" style="${c.color ? `background:${esc(c.color)};color:#fff` : ''}">${esc(crestText(c.name))}</span>`;
  return c.logo ? `<img src="${esc(/Special:FilePath/.test(c.logo) ? c.logo + "?width=64" : c.logo)}" alt="${esc(c.name)}" loading="lazy" onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${mono}</template>` : mono;
}
const ARROW = '<span class="arr" aria-hidden="true"><svg viewBox="0 0 28 12"><path d="M0 6h24M19 1l6 5-6 5"/></svg></span>';
function clubPath(path, over) {
  if (!path || !path.length) return '';
  const found = path.filter(Boolean).length;
  return `<div class="path">
    <div class="path-h"><span>${L('Son parcours', 'His career')}</span><span>${found}/${path.length} club${s_(path.length)}</span></div>
    <ol>${path.map((c, i) => `<li>${i ? ARROW : ''}` + (c
      ? `<div class="club on${c.logo && /white|blanc|bianco|weiss|negativ|inverted/i.test(decodeURIComponent(c.logo)) ? ' dk' : ''}" title="${esc(c.name)}"><span class="crest">${crest(c)}</span><span class="cn">${esc(shortClub(c.name))}</span></div></li>`
      : `<div class="club" title="${L(`Club n°${i + 1}, pas encore trouvé`, `Club #${i + 1}, not found yet`)}"><span class="crest"><span class="q">?</span></span><span class="cn">${ord(i + 1)} club</span></div></li>`)).join('')}</ol>
    ${found || over ? '' : `<p class="path-tip">${L('Chaque club trouvé prend sa place, dans l\'ordre de sa carrière.', 'Each club you find takes its place, in career order.')}</p>`}
  </div>`;
}
function fifaCard(c, rating, found, cls = '') {
  const v = (x, ph = '?') => (x == null || x === '' ? `<span class="ph">${ph}</span>` : esc(x));
  const flag = c.nat && c.nat.iso ? `<img src="https://flagcdn.com/w80/${esc(c.nat.iso)}.png" alt="${esc(c.nat.iso.toUpperCase())}" title="${esc(c.nat.name)}" onerror="this.replaceWith(this.alt)">` : '<span class="ph box">?</span>';
  return `<div class="fut ${found ? 'done' : ''} ${cls}">
    <div class="fut-in">
      <div class="fut-side">
        <div class="fut-rate">${rating}</div>
        <div class="fut-pos">${v(c.pos)}</div>
        <div class="fut-flag">${flag}</div>
      </div>
      <div class="fut-pic">${c.photo ? `<img src="${esc(c.photo)}" alt="" onerror="this.outerHTML=SILHOUETTE">` : SILHOUETTE}</div>
      <div class="fut-name">${c.name ? esc(c.name) : '<span class="ph">• • • • • •</span>'}</div>
      <dl class="fut-stats">
        <div title="${L('Nationalité (passeport)', 'Nationality (passport)')}"><dt>NAT</dt><dd>${v(c.cit)}</dd></div>
        <div title="${L('Sélection nationale (équipe pour laquelle il joue)', 'National team he plays for')}"><dt>${L('SÉL', 'TEAM')}</dt><dd>${v(c.nat?.name)}</dd></div>
        <div><dt>${L('NÉ', 'BORN')}</dt><dd>${v(c.born)}</dd></div>
        <div><dt>${L('CHAMP', 'LEAGUE')}</dt><dd>${v(c.leagues.join(' '))}</dd></div>
        <div><dt>CONT</dt><dd>${v(c.cont)}</dd></div>
        <div><dt>${L('STATUT', 'STATUS')}</dt><dd>${v(c.status)}</dd></div>
      </dl>
      <div class="fut-bo">${L("Ballon d'or : ", "Ballon d'Or: ")}${c.bo === null ? '<span class="ph">?</span>' : c.bo ? L('oui', 'yes') : L('non', 'no')}</div>
    </div>
  </div>`;
}

function drawGame(lastN) {
  const st = ST;
  const over = st.status !== 'playing';
  $('#search').hidden = over;
  document.querySelector('.intro').hidden = over;

  // carte et jauge
  const best = st.guesses.reduce((m, g) => (g.temp > (m?.temp ?? -1) ? g : m), null);
  const t = best ? best.temp : 0;
  const prevCard = $('#fcard').innerHTML;
  const justEnded = PLAYING && over; // la partie vient de se terminer sous les yeux du joueur
  PLAYING = !over;
  $('#fcard').innerHTML = fifaCard(st.card, best ? t : '?', st.status === 'won');
  // la carte mystère s'incline vers la souris ou le doigt, avec un reflet
  if (!$('#fcard').dataset.tilt) { $('#fcard').dataset.tilt = 1; tilt3d(() => $('#fcard .fut'), $('#fcard'), 9); }
  if (justEnded && st.status === 'gaveup' && prevCard) spinReveal($('#fcard'), prevCard);
  if (justEnded && st.status === 'won') confetti();
  $('#path').innerHTML = clubPath(st.card.path, over);
  $('#packcta').innerHTML = packCta(st);
  if (justEnded && st.status === 'gaveup') $('#path').firstElementChild?.classList.add('late');
  $('#gauge').innerHTML = `<div class="big"><span class="deg" style="color:${heat(t)}">${t}°</span><span class="word">${best ? word(t) : L('À toi', 'Your turn')}</span></div>
    <div class="scale"><i style="width:${t}%;background:${heat(t)}"></i></div>
    <div class="scale-legend"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <div class="bestof">${gaugeTip(st, best)}</div>`;

  // bannière de fin + page Wikipédia
  if (over) {
    const a = st.answer;
    const n = st.guesses.length;
    const won = st.status === 'won';
    $('#banner').innerHTML = `<div class="end ${won ? '' : 'lost'} ${justEnded && !won ? 'late' : ''}">
      <div class="kicker">${L('Le joueur mystère n°', 'Mystery player No.')} ${st.number}${st.past ? ` · ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}` : ''}</div>
      <h1><span>${st.past ? L('Le joueur de ce jour-là était', 'That day\'s player was') : L('Le joueur du jour est', "Today's player is")}</span> ${esc(a.name)}</h1>
      <p>${st.past
        ? won
          ? L(`Rattrapé en ${n} essai${s_(n)}. Il rejoint ton album, sans points ni série pour un jour passé.`, `Caught up in ${n} ${n > 1 ? 'tries' : 'try'}. He joins your album, with no points or streak for a past day.`)
          : L(`Tu as abandonné : il ne rejoindra pas ton album.`, `You gave up: he won't join your album.`)
        : won
        ? L(`Trouvé en ${n} essai${s_(n)}${st.hints.length ? ` et ${st.hints.length} indice${s_(st.hints.length)}` : ''}. Tu es ${st.rank === 1 ? 'le premier' : 'le ' + st.rank + '<sup>e</sup>'} à le trouver aujourd'hui.`,
          `Found in ${n} ${n > 1 ? 'tries' : 'try'}${st.hints.length ? ` and ${st.hints.length} hint${s_(st.hints.length)}` : ''}. You are the ${ord(st.rank)} to find him today.`)
        : L(`Tu as abandonné : il ne rejoindra pas ton album, et pas de points aujourd'hui.`, `You gave up: he won't join your album, and no points today.`)}</p>
      ${won && st.score ? `<div class="scorebox"><span class="pts">+${st.score.points}</span><span class="det">points · ${st.score.guesses} ${L('essai', st.score.guesses > 1 ? 'trie' : 'try')}${L(s_(st.score.guesses), st.score.guesses > 1 ? 's' : '')}${st.score.hints ? `, ${st.score.hints} ${L('indice', 'hint')}${s_(st.score.hints)}` : ''}<br>${L('rareté', 'rarity')} ${'★'.repeat(st.score.stars)}${'☆'.repeat(5 - st.score.stars)} (×${EN ? st.score.mult : String(st.score.mult).replace('.', ',')})${st.user ? '' : L(' · <a href="/compte" data-link>crée un compte</a> pour les garder', ' · <a href="/compte" data-link>create an account</a> to keep them')}</span></div>` : ''}
      <div class="end-share"><div class="kicker">${L('Défie tes potes', 'Challenge your friends')}</div>${shareBox(resultText(st), shareUrl(st))}</div>
      ${catchupBox(st)}
      <div class="end-act">${st.past ? `<a class="btn" href="/" data-link>${L('Joueur du jour', "Today's player")}</a>` : `<a class="btn" href="/ligues" data-link>${L('Mes ligues', 'My leagues')}</a>`}<a class="btn" href="/album" data-link>${L('Mon album', 'My album')}</a>${st.past ? '' : `<span class="muted">${L('Prochain joueur dans', 'Next player in')} <span class="countdown" id="cd"></span></span>`}</div>
    </div>`;
    tick();
    const rv = $('#reveal');
    if (!rv.dataset.done) { rv.dataset.done = 1; showWiki(rv, a); }
  } else $('#banner').innerHTML = '';

  if (over && !$('#bw').dataset.closed) {
    $('#bw').dataset.closed = 1; $('#bw').open = false;
    $('#bws').style.display = ''; $('#bws').textContent = `${L('Tes essais', 'Your guesses')} (${st.guesses.length})`;
  }
  // tableau des essais : le dernier en haut, puis du plus chaud au plus froid
  const rows = [...st.guesses].sort((a, b) => b.temp - a.temp || b.n - a.n);
  const last = st.guesses.find((g) => g.n === (lastN || st.guesses.length));
  const row = (g, cls = '') => `<tr class="${cls}">
      <td class="n">${g.n}</td>
      <td class="lbl">${esc(g.label)}${g.type === 'clue' ? `<small>${esc(g.cat)}</small>` : ''}
        <div class="tags">${g.type === 'clue'
          ? `<span class="tag ${g.yes ? 'yes' : 'no'}">${g.yes ? L('Oui', 'Yes') : L('Non', 'No')}</span>`
          : g.tags.map((t) => `<span class="tag ${t.ok ? 'ok' : t.half ? 'half' : ''}">${t.dir === 'up' ? '↑ ' : t.dir === 'down' ? '↓ ' : ''}${esc(t.t)}</span>`).join('')}</div></td>
      <td class="t" style="color:${heat(g.temp)}">${g.temp}°</td>
      <td class="bar"><div class="minibar"><i style="width:${g.temp}%;background:${heat(g.temp)}"></i></div></td>
    </tr>`;
  $('#lastg').innerHTML = last && !over
    ? `<span class="lg-n">${L('Essai', 'Guess')} ${last.n}</span><b>${esc(last.label)}</b><span class="lg-t" style="color:${heat(last.temp)}">${last.temp}°</span>${last.type === 'clue'
        ? `<span class="tag ${last.yes ? 'yes' : 'no'}">${last.yes ? L('Oui', 'Yes') : L('Non', 'No')}</span>`
        : last.tags.map((t) => `<span class="tag ${t.ok ? 'ok' : t.half ? 'half' : ''}">${t.dir === 'up' ? '↑ ' : t.dir === 'down' ? '↓ ' : ''}${esc(t.t)}</span>`).join('')}`
    : '';
  $('#board').innerHTML = st.guesses.length
    ? `<thead><tr><th>${L('N°', '#')}</th><th>${L('Proposition', 'Guess')}</th><th style="text-align:right">Temp.</th><th class="bar"></th></tr></thead><tbody>
       ${rows.map((g) => row(g, last && !over && g.n === last.n ? 'last' : '')).join('')}</tbody>`
    : '';

  // ce que tu sais
  const clues = st.guesses.filter((g) => g.type === 'clue');
  $('#facts').innerHTML = `<h3>${L('Ce que tu sais', 'What you know')}</h3>` + (clues.length
    ? `<ul class="facts">${[...clues].sort((a, b) => b.yes - a.yes).map((g) => `<li class="${g.yes ? '' : 'no'}"><span>${esc(g.label)}</span><span class="${g.yes ? 'y' : 'nn'}">${g.yes ? L('OUI', 'YES') : L('non', 'no')}</span></li>`).join('')}</ul>`
    : `<p class="muted" style="font-size:14px;margin:0">${L('Rien encore. Tape « Ligue 1 », « Brésil » ou « gardien » pour poser une question.', 'Nothing yet. Type “Premier League”, “Brazil” or “goalkeeper” to ask a question.')}</p>`);

  // indices
  const n = st.guesses.length;
  $('#hints').innerHTML = `<h3>${L('Indices', 'Hints')}</h3>
    ${st.hints.length ? `<ol>${st.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : ''}
    ${over ? '' : st.hintReady
      ? `<button class="btn" id="hint">${L('Révéler un indice', 'Reveal a hint')}</button>`
      : st.nextHintAt ? `<p class="muted" style="font-size:14px;margin:0 0 10px">${L(`Prochain indice après ${st.nextHintAt} essais (encore ${st.nextHintAt - n}).`, `Next hint after ${st.nextHintAt} guesses (${st.nextHintAt - n} to go).`)}</p>` : ''}
    ${over ? '' : `<p style="margin:12px 0 0"><button class="linkbtn muted" id="giveup">${L('Abandonner et voir la réponse', 'Give up and see the answer')}</button></p>`}`;
  const h = $('#hint');
  if (h) h.onclick = async () => { ST = await api('hint', { day: DAY }); drawGame(); };
  const gu = $('#giveup');
  if (gu) gu.onclick = async () => {
    if (!confirm(st.past
      ? L('Abandonner ? Ce joueur ne rejoindra pas ton album.', "Give up? This player won't join your album.")
      : L("Abandonner ? Le joueur du jour ne rejoindra pas ton album et ta série repartira de zéro.", "Give up? Today's player won't join your album and your streak will reset to zero."))) return;
    ST = await api('giveup', { day: DAY }); renderWho(ST.user); drawGame();
  };

  // stats du jour
  const s = st.stats;
  const y = st.yesterday;
  const yname = y && y.name ? `<a href="/joueur/${y.id}" data-link><b style="font-family:inherit">${esc(y.name)}</b></a>` : '';
  $('#daystats').innerHTML = `<h3>${st.past ? L('Ce jour-là', 'That day') : L("Aujourd'hui", 'Today')}</h3>
    <p>${L(`<b>${s.found}</b> joueur${s.found > 1 ? 's ont' : ' a'} trouvé${s.avg ? `, en <b>${s.avg}</b> essais en moyenne` : ''}.`,
      `<b>${s.found}</b> player${s_(s.found)} found him${s.avg ? `, in <b>${s.avg}</b> guesses on average` : ''}.`)}</p>
    ${y ? y.name
      ? `<p>${L(`Hier, c'était ${yname} (${y.stats.found} l'ont trouvé).`, `Yesterday it was ${yname} (${y.stats.found} found him).`)}</p>`
      : `<p>${L(`Le joueur d'hier, ${y.stats.found} l'ont trouvé. <a href="/jour/${y.day}" data-link>Et toi&nbsp;?</a>`, `Yesterday's player: ${y.stats.found} found him. <a href="/jour/${y.day}" data-link>Can you?</a>`)}</p>` : ''}`;
}

// encart « ouvrir un pack » : le pack du jour, et le pack bonus gagné en trouvant le joueur
function packCta(st) {
  const p = st.packs;
  if (!p) return '';
  const ready = (p.main ? 0 : 1) + (p.bonus === 'ready' ? 1 : 0);
  const mini = (k, n) => `<span class="mini-booster">${boosterArt(k)}${n > 1 ? '<i>2</i>' : ''}</span>`;
  if (ready) {
    const title = ready > 1 ? L('2 boosters à ouvrir', '2 boosters to open') : p.bonus === 'ready' ? L('Booster Or gagné !', 'Gold booster won!') : L('Ton booster du jour t’attend', "Today's booster is waiting");
    return `<a class="packcta" href="/collection" data-link>${mini(!p.main ? 'base' : 'gold', ready)}
      <span class="pc-t"><b>${title}</b><small>${L('Plus le joueur est connu, plus sa carte est rare.', 'The more famous the player, the rarer the card.')}</small></span>
      <span class="btn solid">${L('Ouvrir', 'Open')}</span></a>`;
  }
  if (p.bonus === 'locked' && st.status === 'playing') return `<div class="packcta off">${mini('gold', 1)}
    <span class="pc-t"><b>${L('Un booster Or à gagner', 'A Gold booster to win')}</b><small>${L('Trouve le joueur du jour : 5 cartes dont au moins une Or.', 'Find the daily player: 5 cards with at least one Gold.')}</small></span></div>`;
  return '';
}

// une fois la partie finie : le jour passé le plus récent qu'il reste à trouver
function catchupBox(st) {
  const c = st.catchup;
  if (!c) return '';
  return `<div class="catchup"><div class="kicker">${L('Rattrape les jours d’avant', 'Catch up on past days')}</div>
    <p>${L(`Il te reste <b>${c.left}</b> joueur${s_(c.left)} à trouver. Sans points, mais ils rejoignent ton album.`, `You still have <b>${c.left}</b> player${s_(c.left)} to find. No points, but they join your album.`)}</p>
    <a class="btn solid" href="/jour/${c.day}" data-link>${L(`Jouer le n° ${c.number}`, `Play No. ${c.number}`)} · ${esc(fmtDate(c.day, { day: 'numeric', month: 'long' }))}</a></div>`;
}

function tick() {
  const el = $('#cd');
  if (!el) return;
  const upd = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((p) => [p.type, +p.value || 0]));
    let left = 86400 - (parts.hour * 3600 + parts.minute * 60 + parts.second);
    if (left <= 0) { clearInterval(window.__tick); return route(); }
    const pad = (x) => String(x).padStart(2, '0');
    el.textContent = `${pad(Math.floor(left / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
  };
  upd();
  window.__tick = setInterval(upd, 1000);
}

// ——— Partage ———
// Un seul bouton : sur téléphone (et la plupart des ordis), il ouvre la feuille de partage du système
// avec toutes les applis et les contacts. Là où elle n'existe pas, le texte est copié.
function shareBox(text, url, label = L('Partager', 'Share')) {
  const id = 'sh' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const full = `${text}\n${url}`;
      try { await navigator.clipboard.writeText(full); btn.textContent = L('Copié, colle-le où tu veux', 'Copied, paste it anywhere'); } catch { prompt(L('Copie ce texte :', 'Copy this text:'), full); }
    };
  });
  return `<div class="sharebox"><button class="btn solid sh" id="${id}" type="button"><svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5M6 11H4v10h16V11h-2"/></svg>${label}</button></div>`;
}
// le lien partagé porte le score : l'aperçu (WhatsApp, X, Discord…) affiche une image du résultat
// « ?s=partage » compte à part dans /stats les visiteurs arrivés par un partage
function shareUrl(st) {
  const sq = (t) => (t >= 100 ? 4 : t >= 75 ? 3 : t >= 50 ? 2 : t >= 25 ? 1 : 0);
  const n = Math.min(999, st.guesses.length);
  const code = `${st.number}-${st.status === 'won' ? 'w' : 'g'}${n}-${Math.min(9, st.hints.length)}-${st.guesses.slice(-18).map((g) => sq(g.temp)).join('')}${EN ? '-en' : ''}`;
  return `${location.origin}/r/${code}?s=partage`;
}
function resultText(st) {
  const sq = (t) => (t >= 100 ? '✅' : t >= 75 ? '🟥' : t >= 50 ? '🟧' : t >= 25 ? '🟨' : '🟦');
  const marks = st.guesses.slice(-18).map((g) => sq(g.temp));
  const rows = [];
  for (let i = 0; i < marks.length; i += 6) rows.push(marks.slice(i, i + 6).join(''));
  const n = st.guesses.length;
  const head = st.status === 'won'
    ? L(`Trouvé en ${n} essai${s_(n)}${st.hints.length ? ` et ${st.hints.length} indice${s_(st.hints.length)}` : ''}`, `Found in ${n} ${n > 1 ? 'tries' : 'try'}${st.hints.length ? ` and ${st.hints.length} hint${s_(st.hints.length)}` : ''}`) + (st.score ? ` · +${st.score.points} pts` : '')
    : L(`Abandon après ${n} essai${s_(n)} 🏳️`, `Gave up after ${n} ${n > 1 ? 'tries' : 'try'} 🏳️`);
  return `FoOotix.com ${L('n°', '#')}${st.number} ⚽\n${head}\n${rows.join('\n')}\n${L('Et toi, tu le trouves en combien ?', 'How many tries will you need?')}`;
}

// suggestions sous la barre, à partir de 3 lettres. Un choix dans la liste remplit la barre et l'envoie.
const SUGG = new Map();
function attachSuggest(input) {
  const form = input.form;
  const list = document.createElement('ul');
  list.className = 'sugg'; list.hidden = true;
  form.appendChild(list);
  let items = [], sel = -1, seq = 0, timer;
  const draw = () => {
    list.hidden = !items.length;
    list.innerHTML = items.map((it, i) => `<li class="${i === sel ? 'on' : ''}" data-i="${i}"><span>${esc(it.name || it.label)}</span><span class="k">${esc(it.kind || '')}</span></li>`).join('');
  };
  const pick = (it) => {
    input.value = it.name || it.label;
    input.dataset.pick = it.id; input.dataset.pickFor = input.value;
    items = []; draw();
    form.requestSubmit();
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (norm(q).length < 3) { items = []; draw(); return; }
    const n = ++seq;
    timer = setTimeout(async () => {
      const k = norm(q);
      if (!SUGG.has(k)) SUGG.set(k, fetchJSON('suggest?q=' + encodeURIComponent(q)).catch(() => []));
      const r = await SUGG.get(k);
      if (n !== seq || document.activeElement !== input) return;
      items = r; sel = -1; draw();
    }, 90);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    else if (e.key === 'Escape') { items = []; draw(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(items[sel]); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); pick(items[+li.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(() => { items = []; draw(); }, 120));
  form.addEventListener('submit', () => { seq++; clearTimeout(timer); items = []; draw(); });
}
// l'identifiant de la suggestion choisie, si la barre contient toujours ce qu'elle a rempli
const pickOf = (input, q) => (input.dataset.pickFor === q ? input.dataset.pick : undefined);

function bindSearch() {
  const input = $('#q'), msg = $('#msg');
  input.addEventListener('input', () => { msg.textContent = ''; });
  $('#search form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || input.dataset.busy) return;
    // retour immédiat pendant que le serveur répond : la proposition s'affiche tout de suite
    input.dataset.busy = 1;
    $('#search').classList.add('busy');
    $('#lastg').innerHTML = `<span class="lg-n">${L('Essai', 'Guess')} ${ST.guesses.length + 1}</span><b>${esc(q)}</b><span class="lg-wait"><i></i><i></i><i></i></span>`;
    try {
      const st = await api('guess', { q, id: pickOf(input, q), day: DAY });
      ST = st;
      input.value = '';
      msg.textContent = st.dup ? L(`Déjà proposé (essai n° ${st.dup}).`, `Already guessed (guess #${st.dup}).`) : '';
      if (st.status === 'won') renderWho(st.user);
      drawGame(st.dup || st.last);
      if (st.status === 'playing') input.focus();
    } catch (err) {
      msg.textContent = err.message;
      drawGame();
      input.select();
    } finally {
      delete input.dataset.busy;
      $('#search')?.classList.remove('busy');
    }
  });
  attachSuggest(input);
  input.focus();
}

// ——— Page Wikipédia du joueur ———
// les fiches pointent vers Wikipédia en français ; en anglais, on suit le lien vers la page anglaise
const FRWIKI = 'https://fr.wikipedia.org';
const WIKI = EN ? 'https://en.wikipedia.org' : FRWIKI;
const wikiUrl = (title) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const EN_TITLE = {};
async function wikiTitle(frTitle) {
  if (!EN) return frTitle;
  if (EN_TITLE[frTitle]) return EN_TITLE[frTitle];
  const r = await fetch(`${FRWIKI}/w/api.php?action=query&prop=langlinks&lllang=en&redirects=1&format=json&origin=*&titles=${encodeURIComponent(frTitle)}`);
  const j = await r.json();
  const pg = Object.values((j.query && j.query.pages) || {})[0];
  const t = pg && pg.langlinks && pg.langlinks[0] && pg.langlinks[0]['*'];
  if (!t) throw new Error('no English page');
  return (EN_TITLE[frTitle] = t);
}

async function fetchWikiHtml(title) {
  const r = await fetch(`${WIKI}/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
  if (!r.ok) throw new Error('Wikipedia ' + r.status);
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  doc.querySelectorAll('script, link, meta, base, .navbox, .navbox-container, .bandeau-portail, .homonymie, .bandeau-container, .metadata, .noprint, .mw-editsection, [role="navigation"]').forEach((e) => e.remove());
  doc.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href');
    if (h.startsWith('./')) a.href = `${WIKI}/wiki/${h.slice(2)}`;
    else if (h.startsWith('//')) a.href = 'https:' + h;
    else if (h.startsWith('/')) a.href = WIKI + h;
    if (!h.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener'; }
  });
  doc.querySelectorAll('a').forEach((a) => { if (/^(modifier( le code)?|edit|edit source)$/i.test(a.textContent.trim())) (a.closest('.navbar, p, div') || a).remove(); });
  doc.querySelectorAll('img').forEach((img) => {
    for (const at of ['src', 'srcset']) {
      const v = img.getAttribute(at);
      if (v) img.setAttribute(at, v.replace(/(^|\s|,)\/\//g, '$1https://'));
    }
    img.loading = 'lazy';
  });
  // on coupe les sections de fin (notes, liens externes, voir aussi)
  doc.querySelectorAll('section').forEach((s) => {
    const h = s.querySelector(':scope > h2');
    if (h && /^(notes|références|liens externes|voir aussi|bibliographie|annexes|references|external links|see also|bibliography|further reading|sources)/i.test(h.textContent.trim())) s.remove();
  });
  return doc.body.innerHTML;
}

async function showWiki(el, p, head = '') {
  el.innerHTML = `<article class="wikiart">${head}<div class="wa-top"><span>${L("Wikipédia, l'encyclopédie libre", 'Wikipedia, the free encyclopedia')}</span><a id="wlink" href="${EN ? FRWIKI + '/wiki/' + encodeURIComponent((p.title || p.name).replace(/ /g, '_')) : wikiUrl(p.title || p.name)}" target="_blank" rel="noopener">${L('Ouvrir sur Wikipédia ↗', 'Open on Wikipedia ↗')}</a></div><h1 class="wa-title">${esc(p.title || p.name)}</h1><div class="mw-parser-output" id="wbody"><p class="note">${L('Chargement de la page Wikipédia…', 'Loading the Wikipedia page…')}</p></div></article>`;
  try {
    const body = $('#wbody', el);
    const title = await wikiTitle(p.title || p.name);
    if (EN) { $('.wa-title', el).textContent = title; $('#wlink', el).href = wikiUrl(title); }
    body.innerHTML = await fetchWikiHtml(title);
    if (body.scrollHeight > 2000) {
      body.classList.add('wa-clip');
      body.insertAdjacentHTML('afterend', `<button class="btn wa-more">${L("Lire tout l'article", 'Read the whole article')}</button>`);
      $('.wa-more', el).onclick = (e) => { body.classList.remove('wa-clip'); e.target.remove(); };
    }
  } catch {
    $('#wbody', el).innerHTML = fallbackCard(p);
  }
}

// si Wikipédia ne répond pas : une fiche maison à partir de nos données
function fallbackCard(p) {
  const span = (c) => c.to == null ? (c.from ? `${L('depuis', 'since')} ${c.from}` : '') : c.from === c.to ? `${c.from}` : `${c.from ?? '?'}–${c.to}`;
  return `<p class="note">${L("Wikipédia n'a pas répondu, voici la fiche résumée.", "Wikipedia didn't answer, here is a short profile.")}</p>
    <p><b>${esc(p.name)}</b>, ${L('né le', 'born')} ${esc(fmtDate(p.born, { day: 'numeric', month: 'long', year: 'numeric' }))}${p.place ? ` ${L('à', 'in')} ${esc(p.place)}` : ''}, ${esc(p.pos.toLowerCase())} (${esc(p.nat.join(' / '))}).</p>
    <h2>${L('Carrière en club', 'Club career')}</h2>
    <table class="wikitable"><tr><th>${L('Période', 'Years')}</th><th>Club</th><th>${L('Championnat', 'League')}</th></tr>
    ${p.clubs.map((c) => `<tr><td>${span(c)}</td><td>${esc(c.club)}${c.loan ? L(' (prêt)', ' (loan)') : ''}</td><td>${esc(c.leagueName || '—')}</td></tr>`).join('')}</table>
    ${p.nt ? `<h2>${L('Sélection', 'National team')}</h2><p>${esc(p.nt.team)}${p.nt.from ? `, ${p.nt.from}–${p.nt.to ?? ''}` : ''}${p.nt.caps ? L(` : ${p.nt.caps} sélections, ${p.nt.goals ?? 0} buts`, `: ${p.nt.caps} caps, ${p.nt.goals ?? 0} goals`) : ''}.</p>` : ''}`;
}

async function pagePlayer(id) {
  // fiche pas encore débloquée pour ce joueur : la fiche écrite par le serveur
  const [p, me] = await Promise.all([api('player/' + id).catch(async (e) => { if (await pageSsr(location.pathname)) return null; throw e; }), api('me').catch(() => null)]);
  if (!p) return;
  if (me) renderWho(me.user, me);
  const s = p.stats;
  const mine = p.mine
    ? p.mine.status === 'won' ? p.mine.late ? L(`Tu l'as rattrapé en <b>${p.mine.guesses}</b> essai${s_(p.mine.guesses)}, il est dans ton album.`, `You caught up on him in <b>${p.mine.guesses}</b> ${p.mine.guesses > 1 ? 'tries' : 'try'}, he's in your album.`) : L(`Tu l'as trouvé en <b>${p.mine.guesses}</b> essai${s_(p.mine.guesses)}, il est dans ton album.`, `You found him in <b>${p.mine.guesses}</b> ${p.mine.guesses > 1 ? 'tries' : 'try'}, he's in your album.`)
      : p.mine.status === 'gaveup' ? L('Tu as abandonné ce jour-là.', 'You gave up that day.') : L(`Tu ne l'as pas trouvé (${p.mine.guesses} essais).`, `You didn't find him (${p.mine.guesses} guesses).`)
    : L("Tu n'as pas joué ce jour-là.", "You didn't play that day.");
  const when = esc(fmtDate(p.day, { day: 'numeric', month: 'long', year: 'numeric' }));
  const head = `<div class="wa-crampon">${L(`Joueur mystère n° ${p.number} du ${when}.`, `Mystery player #${p.number}, ${when}.`)} ${mine} ${L(`${s.found} joueur${s_(s.found)} l'${s.found > 1 ? 'ont' : 'a'} trouvé.`, `${s.found} player${s_(s.found)} found him.`)}</div>`;
  app.innerHTML = `<div id="wp"></div><p style="margin-top:18px"><a class="btn" href="/album" data-link>${L('Mon album', 'My album')}</a> <a class="btn" href="/" data-link>${L('Jouer', 'Play')}</a></p>${adSlot('wide')}`;
  await showWiki($('#wp'), p, head);
}

// ——— Collection : les packs et l'album, sous un seul onglet ———
const subTabs = (on) => `<nav class="subtabs">${[['/collection', L('Boosters', 'Boosters')], ['/marche', L('Marché', 'Market')], ['/album', L('Album', 'Album')]].map(([h, t]) => `<a href="${h}" data-link class="${h === on ? 'on' : ''}">${t}</a>`).join('')}</nav>`;

// ——— Page : album ———
async function pageAlbum() {
  const a = await api('album');
  renderWho(a.user, a.edition);
  const got = (d) => d.status === 'won' || d.status === 'late';
  const won = a.days.filter(got).length;
  const past = a.days.filter((d) => !d.today).length;
  app.innerHTML = `${subTabs('/album')}
    <div class="pagehead">
      <div><div class="kicker">${L('Les joueurs du jour', 'Daily players')}</div><h1>${L('Mon album', 'My album')}</h1>
      <p>${L('Un joueur par jour. Ceux que tu n’as pas trouvés restent cachés : tu peux encore les chercher, sans points.', "One player a day. The ones you haven't found stay hidden: you can still look for them, with no points.")}</p></div>
      <div class="counters">
        <div><b>${won}</b><span>${L('trouvés', 'found')}</span></div>
        <div><b>${past - a.days.filter((d) => !d.today && got(d)).length}</b><span>${L('à rattraper', 'to catch up')}</span></div>
        <div><b>${a.user ? a.user.streak : '—'}</b><span>${L('série', 'streak')}</span></div>
        <div><b>${a.user ? a.user.best : '—'}</b><span>record</span></div>
      </div>
    </div>
    ${a.user ? '' : `<p class="nudge" style="margin:0 0 20px">${L('Sans compte, ton album ne vit que sur cet appareil. <a href="/compte" data-link>Crée un compte</a> pour le garder.', 'Without an account, your album only lives on this device. <a href="/compte" data-link>Create an account</a> to keep it.')}</p>`}
    <div class="album">${a.days.map(slot).join('')}</div>
    ${adSlot('wide')}`;
}
function slot(d) {
  const date = fmtDate(d.day, { day: 'numeric', month: 'short' });
  if (d.today && d.status !== 'won' && d.status !== 'gaveup') {
    return `<a class="slot today" href="/" data-link><div class="top"><span>${L('N°', 'No.')} ${d.number}</span><span>${date}</span></div>
      <div class="face"><div><div class="q">?</div><div class="sub">${d.guesses ? L(`${d.guesses} essai${s_(d.guesses)}, continue`, `${d.guesses} guess${d.guesses > 1 ? 'es' : ''}, keep going`) : L('À trouver aujourd’hui', 'To find today')}</div></div></div>
      <div class="bot">${L("Aujourd'hui", 'Today')}</div></a>`;
  }
  if (!d.player) {
    return `<a class="slot s-open" href="/jour/${d.day}" data-link><div class="top"><span>${L('N°', 'No.')} ${d.number}</span><span>${date}</span></div>
      <div class="face"><div><div class="q">?</div><div class="sub">${d.guesses ? L(`${d.guesses} essai${s_(d.guesses)}, continue`, `${d.guesses} guess${d.guesses > 1 ? 'es' : ''}, keep going`) : L('Encore à trouver', 'Still to find')}</div></div></div>
      <div class="bot">${L('Jouer, sans points', 'Play, no points')}</div></a>`;
  }
  const cls = d.status === 'won' || d.status === 'late' ? 's-won' : 's-gaveup s-missed';
  const bot = d.status === 'won' ? L(`Trouvé · ${d.guesses} essai${s_(d.guesses)}`, `Found · ${d.guesses} ${d.guesses > 1 ? 'tries' : 'try'}`)
    : d.status === 'late' ? L(`Rattrapé · ${d.guesses} essai${s_(d.guesses)}`, `Caught up · ${d.guesses} ${d.guesses > 1 ? 'tries' : 'try'}`) : L('Abandonné', 'Gave up');
  return `<a class="slot ${cls} ${d.today ? 'today' : ''}" href="/joueur/${d.player.id}" data-link><div class="top"><span>${L('N°', 'No.')} ${d.number}</span><span>${date}</span></div>
    <div class="pic">${d.player.img ? `<img src="${esc(d.player.img)}" alt="" loading="lazy" onerror="this.outerHTML=SILHOUETTE">` : SILHOUETTE}</div>
    <div class="face"><div><div class="nm">${esc(d.player.name)}</div><div class="sub">${esc(d.player.pos)} · ${esc(d.player.nat)}</div></div></div>
    <div class="bot">${bot}</div></a>`;
}

// ——— Page : collection (un pack par jour, à part du jeu de devinette) ———
let PACKING = false; // pack en cours d'ouverture : pas de rafraîchissement de page pendant l'animation
let COL_FILTER = 'all';
const TIERS = ['legend', 'gold', 'silver', 'bronze'];
const TIER_NAME = { legend: L('Légende', 'Legend'), gold: L('Or', 'Gold'), silver: L('Argent', 'Silver'), bronze: 'Bronze' };
const ODDS = { bronze: 70, silver: 23, gold: 6, legend: 1 };
const PARTICLE = /^(de|da|di|del|della|van|von|der|den|dos|das|du|le|la|el|al|ter|ten|mac)$/i;
// nom court comme sur une vraie carte : « Kevin De Bruyne » → « De Bruyne »
function cardName(n) {
  if (n.length <= 14) return n;
  const w = n.split(' ');
  if (w.length < 2) return n;
  let k = w.length - 1;
  while (k > 1 && PARTICLE.test(w[k - 1])) k--;
  return w.slice(k).join(' ');
}
// même carte que sur la page Jouer, aux couleurs de sa rareté
// carte de collection : épurée, la photo en grand, le nom, le club et la rareté
function colCard(c) {
  const flag = c.nat && c.nat.iso ? `<img src="https://flagcdn.com/w80/${esc(c.nat.iso)}.png" alt="${esc(c.nat.iso.toUpperCase())}" title="${esc(c.nat.name)}" onerror="this.replaceWith(this.alt)">` : '';
  return `<div class="fut cmp t-${c.tier}"><div class="fut-in">
    <div class="fut-side"><div class="fut-rate">${c.rating}</div><div class="fut-pos">${esc(c.pos || '')}</div><div class="fut-flag">${flag}</div></div>
    <div class="cmp-pic">${c.photo ? `<img src="${esc(c.photo)}" alt="" loading="lazy" onerror="this.outerHTML=SILHOUETTE">` : SILHOUETTE}</div>
    <div class="cmp-name">${esc(cardName(c.name))}</div>
    <div class="cmp-sub">${esc(c.club || '')}</div>
    <div class="cmp-tier"><i></i>${TIER_NAME[c.tier]}</div>
  </div></div>`;
}
const CARD_BACK = '<div class="fut back"><div class="fut-in"><b>FoO</b><span>FoOotix</span></div></div>';
const packDate = () => fmtDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }), { day: 'numeric', month: 'short' });
const nextPack = (c) => (!c.packs.main ? 'main' : c.packs.bonus === 'ready' ? 'bonus' : null);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEST = (cards) => TIERS.find((t) => cards.some((x) => x.tier === t)) || 'bronze';
const GLOW = { bronze: '#f0a868', silver: '#e4ecf5', gold: '#ffc21a', legend: 'rainbow' };
const RAINBOW = ['#ff5ea8', '#ffb347', '#fff36b', '#6dffa8', '#5ecbff', '#a98bff'];
const glowCss = (c) => (c === 'rainbow' ? '#ff9de0' : c); // couleur unie quand un dégradé ne passe pas

// effet 3D : l'objet s'incline vers le doigt ou la souris, et un reflet de lumière le suit.
// Sans pointeur, il se balance doucement tout seul. Écrit des variables CSS (--rx, --ry, --mx, --my…)
function tilt3d(getEl, area, max = 14) {
  const st = { on: true };
  if (reduced()) return st;
  let tx = 0, ty = 0, x = 0, y = 0, last = -1e9;
  const t0 = performance.now();
  area.addEventListener('pointermove', (e) => {
    const r = area.getBoundingClientRect();
    tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    last = performance.now();
  });
  area.addEventListener('pointerleave', () => { last = -1e9; });
  (function frame(t) {
    if (!area.isConnected) return;
    let gx, gy;
    if (!st.on) gx = gy = 0;
    else if (t - last < 1400) { gx = tx; gy = ty; }
    else { const s = (t - t0) / 1000; gx = Math.sin(s * 1.2) * 0.5; gy = Math.cos(s * 0.9) * 0.3; }
    x += (gx - x) * 0.1; y += (gy - y) * 0.1;
    const el = getEl();
    if (el) {
      el.style.setProperty('--ry', (x * max).toFixed(2) + 'deg');
      el.style.setProperty('--rx', (-y * max).toFixed(2) + 'deg');
      el.style.setProperty('--mx', (50 + x * 50).toFixed(1) + '%');
      el.style.setProperty('--my', (50 + y * 50).toFixed(1) + '%');
      el.style.setProperty('--bx', (50 + x * 45).toFixed(1) + '%');
      el.style.setProperty('--by', (50 + y * 45).toFixed(1) + '%');
    }
    requestAnimationFrame(frame);
  })(t0);
  return st;
}
// gerbe d'étincelles lumineuses autour d'un point de l'écran
function sparks(x, y, color, n = 40, power = 1, up = false) {
  if (reduced() || !n) return;
  const c = document.createElement('canvas');
  c.className = 'sparks';
  document.body.appendChild(c);
  const g = c.getContext('2d');
  const W = (c.width = innerWidth), H = (c.height = innerHeight);
  const bits = Array.from({ length: n }, () => {
    const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2, v = (2 + Math.random() * 8) * power;
    return { x: x + (up ? (Math.random() - 0.5) * 160 : 0), y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.2 + Math.random() * 2.6, life: 35 + Math.random() * 40, age: 0,
      c: color === 'rainbow' ? RAINBOW[Math.floor(Math.random() * RAINBOW.length)] : color };
  });
  (function frame() {
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    let alive = 0;
    for (const b of bits) {
      if (b.age++ > b.life) continue;
      alive++;
      b.vy += 0.14; b.vx *= 0.97; b.vy *= 0.97; b.x += b.vx; b.y += b.vy;
      g.globalAlpha = 1 - b.age / b.life;
      g.fillStyle = b.c;
      g.beginPath(); g.arc(b.x, b.y, b.r * 2.4, 0, 7); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(b.x, b.y, b.r, 0, 7); g.fill();
    }
    if (alive) requestAnimationFrame(frame); else c.remove();
  })();
}
// éclair de lumière plein écran, centré sur un point
function flash(x, y, color) {
  if (reduced()) return;
  const f = document.createElement('div');
  f.className = 'flash';
  f.style.background = color === 'rainbow'
    ? `radial-gradient(circle at ${x}px ${y}px, #fff 0, rgba(255,255,255,.9) 10%, transparent 60%), conic-gradient(from 0deg at ${x}px ${y}px, #ff5ea8aa, #ffb347aa, #fff36baa, #6dffa8aa, #5ecbffaa, #a98bffaa, #ff5ea8aa)`
    : `radial-gradient(circle at ${x}px ${y}px, #fff 0, ${color} 22%, transparent 70%)`;
  document.body.appendChild(f);
  f.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 700, easing: 'ease-out' }).onfinish = () => f.remove();
}
const mid = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r]; };

async function pageCollection() {
  const c = await api('collection');
  renderWho(c.user);
  drawCollection(c);
}
const coinTag = (n) => `<span class="coins"><i class="coin"></i><b>${Number(n).toLocaleString('fr-FR')}</b></span>`;
const BOOSTER = {
  base: { name: L('Booster Base', 'Base booster'), line: L('5 cartes · la 5<sup>e</sup> au moins Argent', '5 cards · the 5th at least Silver'), peek: 3 },
  gold: { name: L('Booster Or', 'Gold booster'), line: L('5 cartes · 1 Or garantie', '5 cards · 1 Gold guaranteed'), peek: 3 },
  legend: { name: L('Booster Légende', 'Legend booster'), line: L('1 carte · 1 Légende garantie', '1 card · 1 Legend guaranteed'), peek: 1 },
};
// petit message qui apparaît en bas de l'écran
function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
let COL = null; // dernière collection affichée
let SEL = null; // booster choisi dans le carrousel
const BOUGHT = {}; // boosters payés (les pièces partent à l'ouverture)
function drawCollection(c) {
  COL = c;
  const total = Object.values(c.totals).reduce((a, b) => a + b, 0);
  const have = (t) => c.cards.filter((x) => x.tier === t).length;
  const pct = Math.max(0.6, (c.cards.length / total) * 100);
  app.innerHTML = `${subTabs('/collection')}
    <div class="pagehead soft">
      <div><div class="kicker">${L('Un booster gratuit par jour', 'One free booster a day')}</div><h1>${L('Boosters', 'Boosters')}</h1></div>
    </div>
    ${c.user ? '' : `<p class="nudge">${L('Sans compte, ta collection ne vit que sur cet appareil, et tu ne peux ni vendre ni acheter. <a href="/compte" data-link>Crée un compte</a> pour tout débloquer.', 'Without an account, your collection only lives on this device and you can’t buy or sell. <a href="/compte" data-link>Create an account</a> to unlock everything.')}</p>`}
    <section class="packzone" id="packzone"></section>
    ${c.user ? earnBox(c) : ''}
    <section>
      <div class="colhead">
        <h2>${L('Ma collection', 'My collection')}</h2>
        <div class="colprog"><div class="cp-n"><b>${c.cards.length}</b> / ${total} ${L('cartes', 'cards')}</div><div class="cp-bar"><i style="width:${pct}%"></i></div></div>
      </div>
      <div class="chips">${['all', ...TIERS].map((t) => `<button type="button" class="chip ${t !== 'all' ? 'g-' + t : ''} ${COL_FILTER === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? L('Toutes', 'All') : `<i class="gem"></i>${TIER_NAME[t]}`} <span>${t === 'all' ? c.cards.length : have(t)}/${t === 'all' ? total : c.totals[t]}</span></button>`).join('')}</div>
      <div class="cgrid" id="cgrid"></div>
    </section>
    ${adSlot('wide')}`;
  const grid = () => {
    const list = c.cards.filter((x) => COL_FILTER === 'all' || x.tier === COL_FILTER).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    $('#cgrid').innerHTML = list.length
      ? list.map((x) => `<button type="button" class="cslot" data-id="${esc(x.id)}" aria-label="${esc(x.name)}"><span class="mini">${colCard(x)}</span>${x.n > 1 ? `<span class="badge">×${x.n}</span>` : ''}${x.listed ? `<span class="ribbon">${L('En vente', 'For sale')}</span>` : ''}</button>`).join('')
      : `<p class="empty">${c.cards.length ? L('Pas encore de carte de cette rareté.', 'No card of this rarity yet.') : L('Ouvre ton premier booster pour commencer ta collection.', 'Open your first booster to start your collection.')}</p>`;
    $('#cgrid').querySelectorAll('.cslot').forEach((b) => b.addEventListener('click', () => zoomCard(c.cards.find((x) => x.id === b.dataset.id), c)));
  };
  grid();
  app.querySelectorAll('.chips .chip').forEach((b) => b.addEventListener('click', () => {
    COL_FILTER = b.dataset.t;
    app.querySelectorAll('.chips .chip').forEach((x) => x.classList.toggle('on', x === b));
    grid();
  }));
  bindEarn(c);
  drawChooser(c);
}

// ——— Choisir son booster : un carrousel, celui du milieu se déchire ———
const KINDS = ['base', 'gold', 'legend'];
function boosterState(c, k) {
  if (k === 'base') return c.packs.main ? { open: false, why: 'done' } : { open: true, opener: () => api('pack', {}) };
  if (k === 'gold' && c.packs.bonus === 'ready') return { open: true, free: true, opener: () => api('pack', { bonus: true }) };
  if (BOUGHT[k]) return { open: true, paid: true, opener: () => api('shop', { kind: k }) };
  return { open: false, why: 'buy' };
}
function drawChooser(c) {
  const zone = $('#packzone');
  if (!SEL) SEL = KINDS.find((k) => boosterState(c, k).open) || 'base';
  const i = KINDS.indexOf(SEL);
  const order = [KINDS[(i + 2) % 3], SEL, KINDS[(i + 1) % 3]];
  const st = boosterState(c, SEL);
  const pr = c.prices || { shop: {} };
  const B = BOOSTER[SEL];
  const seg = (on, label, state) => `<div class="seg ${state}"><i>${state === 'locked' ? LOCK : ''}</i><span>${label}</span></div>`;
  let act;
  if (st.open) act = `<p class="pack-hint">${L('Glisse le long du haut du booster pour le déchirer', 'Swipe along the top of the booster to tear it open')}</p>
      <button type="button" class="btn solid big" id="packbtn">${st.paid ? L('Ouvrir', 'Open') + ` · ${coinTag(pr.shop[SEL])}` : L('Ouvrir', 'Open')}</button>`;
  else if (SEL === 'base') act = `<p class="pack-hint">${L('Prochain booster gratuit dans', 'Next free booster in')} <b id="cd" class="mono"></b></p>`;
  else if (!c.user) act = `<a class="btn solid big" href="/compte" data-link>${L('Crée un compte pour l’acheter', 'Create an account to buy it')}</a>`;
  else {
    const can = (c.coins || 0) >= pr.shop[SEL];
    act = `${SEL === 'gold' ? `<p class="pack-hint muted">${c.packs.bonus === 'opened' ? L('Booster Or du jour déjà ouvert.', 'Today’s Gold booster is open.') : L('Gratuit si tu trouves le joueur du jour.', 'Free if you find the daily player.')} ${c.packs.bonus === 'locked' ? `<a href="/" data-link>${L('Jouer', 'Play')}</a>` : ''}</p>` : ''}
      <button type="button" class="btn solid big" data-buy="${SEL}" ${can ? '' : 'disabled'}>${L('Acheter', 'Buy')} ${coinTag(pr.shop[SEL])}</button>
      ${can ? '' : `<p class="pack-hint muted">${L(`Il te manque ${pr.shop[SEL] - (c.coins || 0)} pièces. Revends des cartes ou regarde une vidéo.`, `You need ${pr.shop[SEL] - (c.coins || 0)} more coins. Sell cards or watch a video.`)}</p>`}`;
  }
  zone.innerHTML = `<div class="chooser">
    <div class="daily"><div class="daily-segs">${seg(true, 'Base', c.packs.main ? 'done' : 'ready')}${seg(true, L('Or', 'Gold'), c.packs.bonus === 'opened' ? 'done' : c.packs.bonus === 'ready' ? 'ready' : 'locked')}</div>
      <div class="daily-t"><b>${(c.packs.main ? 1 : 0) + (c.packs.bonus === 'opened' ? 1 : 0)}</b>/2 ${L('boosters gratuits aujourd’hui', 'free boosters today')}</div></div>
    <div class="carousel">
      <button type="button" class="car-arrow l" data-go="-1" aria-label="${L('Booster précédent', 'Previous booster')}">‹</button>
      ${order.map((k, n) => n === 1
        ? `<div class="car-it mid">${packShell(k, st.open)}</div>`
        : `<button type="button" class="car-it side ${n === 0 ? 'l' : 'r'}" data-k="${k}" aria-label="${BOOSTER[k].name}">${packShell(k, false, true)}</button>`).join('')}
      <button type="button" class="car-arrow r" data-go="1" aria-label="${L('Booster suivant', 'Next booster')}">›</button>
    </div>
    <div class="car-info">
      <h3>${B.name}</h3>
      <p class="car-line">${B.line}${SEL === 'legend' ? ` · ${L('uniquement en boutique', 'shop only')}` : ''}</p>
      <div class="car-act">${act}</div>
      ${SEL === 'legend' ? '' : oddsLine(SEL)}
    </div>
  </div>`;
  const pick = (k) => { SEL = k; drawChooser(c); };
  zone.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.k)));
  zone.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => pick(KINDS[(i + 3 + +b.dataset.go) % 3])));
  zone.querySelector('[data-buy]')?.addEventListener('click', (e) => { BOUGHT[e.currentTarget.dataset.buy] = true; drawChooser(c); });
  if (st.open) packDrag(SEL, () => { if (st.paid) delete BOUGHT[SEL]; return st.opener(); });
  else if (SEL === 'base') tick();
  // inclinaison des boosters sur les côtés aussi, pour la profondeur
  if (!st.open) tilt3d(() => zone.querySelector('.car-it.mid .pack'), zone.querySelector('.carousel'), 12);
}
const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="7" width="10" height="7.5" rx="1.6" fill="currentColor"/></svg>';
// pièces gratuites : vidéo publicitaire et parrainage
function earnBox(c) {
  const v = c.video || { left: 0, coins: 20, perDay: 5 };
  const r = c.referral || { friend: 100, sponsor: 150, invited: 0 };
  const link = `${location.origin}/?parrain=${encodeURIComponent(c.user.username)}`;
  return `<section class="earn">
    <h2>${L('Gagner des pièces', 'Earn coins')}</h2>
    <div class="earn-row">
      <button type="button" class="earn-it vid" id="watch" ${v.left > 0 ? '' : 'disabled'}>
        <span class="ei-ico"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg></span>
        <span class="ei-t"><b>${L('Regarder une vidéo', 'Watch a video')}</b><small>${v.left > 0 ? L(`encore ${v.left} sur ${v.perDay} aujourd’hui`, `${v.left} of ${v.perDay} left today`) : L('reviens demain', 'come back tomorrow')}</small></span>
        <span class="ei-gain">+${v.coins} <i class="coin"></i></span>
      </button>
      <button type="button" class="earn-it ref" id="invite" data-link-url="${esc(link)}">
        <span class="ei-ico"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4" fill="currentColor"/><path d="M2.5 19c.6-3.6 3.3-5.6 6.5-5.6s5.9 2 6.5 5.6z" fill="currentColor"/><path d="M18 8v6M15 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span>
        <span class="ei-t"><b>${L('Inviter un ami', 'Invite a friend')}</b><small>${L(`+${r.friend} pour lui, +${r.sponsor} pour toi quand il trouve son premier joueur`, `+${r.friend} for them, +${r.sponsor} for you when they find their first player`)}${r.invited ? ` · ${r.invited} ${L('invité(s)', 'invited')}` : ''}</small></span>
        <span class="ei-gain">+${r.sponsor} <i class="coin"></i></span>
      </button>
    </div>
  </section>`;
}
function bindEarn(c) {
  $('#invite')?.addEventListener('click', async (e) => {
    const url = e.currentTarget.dataset.linkUrl;
    const text = L('Viens jouer à FoOotix avec moi : devine le footballeur du jour et ouvre des boosters ! On gagne des pièces tous les deux :', 'Come play FoOotix with me: guess the daily footballer and open boosters! We both earn coins:');
    try { if (navigator.share) { await navigator.share({ title: 'FoOotix', text, url }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast(L('Lien d’invitation copié !', 'Invite link copied!')); } catch { prompt(L('Ton lien d’invitation :', 'Your invite link:'), url); }
  });
  $('#watch')?.addEventListener('click', (e) => watchVideo(e.currentTarget));
}
// vidéo récompensée (Google AdSense, « annonces avec récompense ») : les pièces arrivent seulement si la vidéo est vue en entier
function watchVideo(btn) {
  if (!CFG.ads || !window.adsbygoogle) return toast(L('Les vidéos arrivent bientôt.', 'Videos are coming soon.'));
  btn.disabled = true;
  let shown = false;
  window.adsbygoogle.push({
    type: 'reward', name: 'pieces',
    beforeReward: (showAdFn) => { shown = true; showAdFn(); },
    adDismissed: () => toast(L('Regarde la vidéo jusqu’au bout pour gagner tes pièces.', 'Watch the whole video to earn your coins.')),
    adViewed: () => api('reward', {}).then((j) => { toast(L(`+${j.gain} pièces !`, `+${j.gain} coins!`)); renderWho(j.user); const y = scrollY; drawCollection(j); scrollTo(0, y); }, (err) => toast(esc(err.message))),
    adBreakDone: () => { btn.disabled = false; if (!shown) toast(L('Pas de vidéo disponible pour l’instant, réessaie un peu plus tard.', 'No video available right now, try again later.')); },
  });
}
// une carte de la collection en grand, par-dessus la page
function zoomCard(c, col) {
  if (!c) return;
  const o = document.createElement('div');
  o.className = 'cardzoom';
  const pr = col && col.prices;
  const mineL = col ? (col.listings || []).filter((l) => l.player === c.id) : [];
  const free = c.n - (c.listed || 0);
  let act = '';
  if (col && !col.user) act = `<p class="cz-note">${L('<a href="/compte" data-link>Crée un compte</a> pour vendre tes cartes.', '<a href="/compte" data-link>Create an account</a> to sell your cards.')}</p>`;
  else if (col && pr) {
    const min = pr.sell[c.tier];
    act = `<div class="cz-act">
      ${free > 0 ? `<button type="button" class="btn solid" data-a="sell">${L('Revendre à FoOotix', 'Sell to FoOotix')} ${coinTag(min)}</button>
      <form class="cz-list" data-a="list"><label>${L('Prix sur le marché', 'Market price')}<input type="number" name="price" min="${min}" max="${pr.max}" step="1" value="${min * 3}" required></label><button class="btn">${L('Mettre en vente', 'Put on sale')}</button></form>` : ''}
      ${mineL.map((l) => `<div class="cz-sale">${L('En vente à', 'For sale at')} ${coinTag(l.price)} <button type="button" class="linkbtn" data-cancel="${l.id}">${L('Retirer', 'Remove')}</button></div>`).join('')}
    </div>`;
  }
  o.innerHTML = `<div class="cz-in">${colCard(c)}<p><b>${esc(c.name)}</b> · ${TIER_NAME[c.tier]}${c.n > 1 ? ` · ×${c.n}` : ''}</p>${act}<button type="button" class="btn" data-close>${L('Fermer', 'Close')}</button></div>`;
  const close = () => { o.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  const done = (j, msg) => { close(); toast(msg); const y = window.scrollY; drawCollection(j); window.scrollTo(0, y); };
  const fail = (e) => toast(esc(e.message));
  o.addEventListener('click', (e) => { if (e.target === o || e.target.closest('[data-close]')) close(); });
  o.querySelector('[data-a="sell"]')?.addEventListener('click', () => {
    if (c.n === 1 && !confirm(L(`C’est ta seule carte ${c.name}. La revendre ?`, `This is your only ${c.name} card. Sell it?`))) return;
    api('sell', { id: c.id }).then((j) => done(j, L(`+${j.gain} pièces`, `+${j.gain} coins`)), fail);
  });
  o.querySelector('[data-a="list"]')?.addEventListener('submit', (e) => {
    e.preventDefault();
    api('market/list', { id: c.id, price: +e.target.price.value }).then((j) => done(j, L('Carte mise en vente sur le marché', 'Card put on the market')), fail);
  });
  o.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => api('market/cancel', { listing: +b.dataset.cancel }).then((j) => done(j, L('Vente retirée', 'Sale removed')), fail)));
  document.addEventListener('keydown', esc_);
  document.body.appendChild(o);
}
function oddsLine(kind = 'base') {
  return `<p class="odds">${L('Chances par carte', 'Odds per card')} : ${['bronze', 'silver', 'gold', 'legend'].map((t) => `<span>${TIER_NAME[t]} ${ODDS[t]} %</span>`).join(' · ')}. ${kind === 'gold' ? L('La 5<sup>e</sup> carte est au moins Or.', 'The 5th card is at least Gold.') : L('La 5<sup>e</sup> carte est au moins Argent.', 'The 5th card is at least Silver.')}</p>`;
}
// le booster : une illustration (cartes en éventail, ballon, rayons, éclats), une soudure argentée en haut et en bas
let ART_ID = 0;
const ART = {
  base: { bg: ['#05263f', '#0b5f86', '#19b3c8'], ray: '#bff9ff', ring: '#ffd640', cards: ['#c08852', '#c8ccd1', '#ffd640'], rib: '#fff6dc', ribInk: '#08314a', label: 'BOOSTER BASE' },
  gold: { bg: ['#4a1d00', '#b45a00', '#ffb52e'], ray: '#fff0b0', ring: '#fff6d0', cards: ['#ffd640', '#ffe680', '#ffb300'], rib: '#2b1600', ribInk: '#ffd640', label: 'BOOSTER OR' },
  legend: { bg: ['#140630', '#3a1780', '#0d2a6e'], ray: '#ffffff', ring: '#ffffff', cards: ['url(#RB)', 'url(#RB)', 'url(#RB)'], rib: '#ffffff', ribInk: '#1a0b3a', label: 'BOOSTER LÉGENDE' },
};
function boosterArt(kind) {
  const A = ART[kind], u = 'a' + ++ART_ID;
  const RB = `<linearGradient id="${u}rb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5ea8"/><stop offset=".2" stop-color="#ffb347"/><stop offset=".4" stop-color="#fff36b"/><stop offset=".6" stop-color="#6dffa8"/><stop offset=".8" stop-color="#5ecbff"/><stop offset="1" stop-color="#a98bff"/></linearGradient>`;
  const fill = (c) => c.replace('url(#RB)', `url(#${u}rb)`);
  const rays = Array.from({ length: 18 }, (_, k) => `<polygon points="0,0 -11,-300 11,-300" transform="rotate(${k * 20})"/>`).join('');
  const shield = 'M-23,-46 H23 L32,-38 V30 L0,46 L-32,30 V-38 Z';
  const spark = (x, y, r, c) => `<path d="M${x},${y - r} L${x + r * .35},${y} L${x},${y + r} L${x - r * .35},${y} Z" fill="${c}"/>`;
  const star = (x, y, r) => `<path d="M${x},${y - r} Q${x},${y} ${x + r},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r},${y} Q${x},${y} ${x},${y - r}Z" fill="#fff"/>`;
  const gems = kind === 'legend' ? RAINBOW : kind === 'gold' ? ['#fff3b0', '#ffd640', '#ffffff', '#ffe680'] : ['#7df9ff', '#ffd640', '#ffffff', '#c8ccd1'];
  const ball = `<g><circle r="17" fill="#fff" stroke="#1a1a1a" stroke-width="1.6"/><path d="M0,-6.5 L6.2,-2 L3.8,5.3 L-3.8,5.3 L-6.2,-2Z" fill="#1a1a1a"/><path d="M0,-6.5V-16.4M6.2,-2L15.6,-5M3.8,5.3L9.6,13.6M-3.8,5.3L-9.6,13.6M-6.2,-2L-15.6,-5" stroke="#1a1a1a" stroke-width="1.6" fill="none"/></g>`;
  return `<svg class="pb-art" viewBox="0 0 240 284" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="${u}bg" x1="0" y1="0" x2=".6" y2="1"><stop offset="0" stop-color="${A.bg[0]}"/><stop offset=".55" stop-color="${A.bg[1]}"/><stop offset="1" stop-color="${A.bg[2]}"/></linearGradient>
    <radialGradient id="${u}gl" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".45" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${u}cd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/></linearGradient>
    ${RB}
  </defs>
  <rect width="240" height="284" fill="url(#${u}bg)"/>
  <g class="pb-rays" transform="translate(120 150)" fill="${A.ray}" opacity=".13">${rays}</g>
  ${kind === 'legend' ? `<rect class="pb-holo" width="240" height="284" fill="url(#${u}rb)" opacity=".5"/>` : ''}
  <circle cx="120" cy="150" r="118" fill="url(#${u}gl)"/>
  <text x="120" y="17" text-anchor="middle" class="pb-open" fill="${kind === 'gold' ? '#2b1600' : '#fff'}">◂  OUVRIR ICI  ▸</text>
  <text x="120" y="60" text-anchor="middle" class="pb-logo" fill="#fff" stroke="${A.bg[0]}" stroke-width="7" paint-order="stroke" stroke-linejoin="round">Fo<tspan fill="#ffd640">O</tspan>otix</text>
  <g transform="translate(120 152)">
    <circle r="74" fill="${A.bg[0]}" opacity=".35"/>
    <circle r="74" fill="none" stroke="${A.ring}" stroke-width="5"/>
    <circle r="66" fill="none" stroke="${A.ring}" stroke-width="1.2" opacity=".6"/>
    <g transform="rotate(-20) translate(-26 4)"><path d="${shield}" fill="${fill(A.cards[0])}" stroke="#fff" stroke-width="2.5"/><path d="${shield}" fill="url(#${u}cd)"/></g>
    <g transform="rotate(20) translate(26 4)"><path d="${shield}" fill="${fill(A.cards[1])}" stroke="#fff" stroke-width="2.5"/><path d="${shield}" fill="url(#${u}cd)"/></g>
    <g transform="scale(1.18)"><path d="${shield}" fill="${fill(A.cards[2])}" stroke="#fff" stroke-width="2.5"/><path d="${shield}" fill="url(#${u}cd)"/><g transform="translate(0 -4)">${ball}</g>
      <rect x="-19" y="22" width="38" height="6" rx="3" fill="#fff" opacity=".8"/></g>
  </g>
  ${spark(30, 96, 9, gems[0])}${spark(206, 104, 11, gems[1])}${spark(44, 214, 7, gems[2])}${spark(196, 210, 8, gems[3])}${spark(214, 158, 5, gems[0])}${spark(22, 156, 6, gems[1])}
  ${star(58, 82, 6)}${star(186, 70, 8)}${star(176, 228, 5)}
  <g transform="translate(120 246)">
    <path d="M-100,-15 H100 L92,0 L100,15 H-100 L-92,0Z" fill="${A.rib}" stroke="${kind === 'gold' ? '#ffd640' : 'rgba(0,0,0,.25)'}" stroke-width="1.5"/>
    <text y="5.5" text-anchor="middle" class="pb-label" fill="${A.ribInk}">${A.label}</text>
  </g>
  <text x="120" y="278" text-anchor="middle" class="pb-sub" fill="${kind === 'gold' ? '#2b1600' : '#fff'}">${kind === 'legend' ? '1 CARTE · LÉGENDE GARANTIE' : kind === 'gold' ? '5 CARTES · 1 OR GARANTIE' : '5 CARTES · FOOTBALLEURS'}</text>
</svg>`;
}
// l'emballage complet ; live = booster à déchirer (avec les cartes cachées et la lumière)
function packShell(kind, live, side = false) {
  return `<div class="pack-scene" ${live ? 'id="packscene"' : ''}>
    <div class="pack-shadow"></div>
    <div class="pack k-${kind} ${side ? 'still' : ''}" ${live ? `id="pack" role="button" tabindex="0" aria-label="${L('Ouvrir le booster', 'Open the booster')}"` : ''}>
      ${live ? `<div class="pack-peek">${Array.from({ length: BOOSTER[kind].peek }, (_, k) => `<span class="pk pk${k}"><span class="mini">${CARD_BACK}</span></span>`).join('')}</div><div class="pack-beam"></div>` : ''}
      <div class="pack-body">${boosterArt(kind)}<div class="pb-crimp"></div></div>
      ${live ? '<div class="pack-light"></div><div class="tear"><i class="tear-glow"></i><i class="tear-tip"></i></div>' : ''}
      <div class="pack-top"></div>
    </div>
  </div>`;
}
function openedBox(c) {
  const today = [...c.packs.mainCards, ...c.packs.bonusCards];
  return `<div class="pack-done"><div class="kicker">${L('Boosters du jour ouverts', "Today's boosters are open")}</div>
    <p>${L('Prochain booster gratuit dans', 'Next free booster in')} <b id="cd"></b></p>
    ${c.packs.bonus === 'locked' ? `<p class="bonus-tip">${L('Trouve le joueur du jour pour gagner un booster Or.', 'Find the daily player to win a Gold booster.')} <a href="/" data-link>${L('Jouer', 'Play')}</a></p>` : ''}</div>
    <div class="today-row">${today.map((x) => `<div class="tr-c"><span class="mini">${colCard(x)}</span><span class="tag ${x.isNew ? 'new' : ''}">${x.isNew ? L('Nouvelle', 'New') : L('Doublon', 'Duplicate')}</span></div>`).join('')}</div>`;
}

// glisser le pack : le haut se décolle et suit le doigt, puis se déchire au-delà de la moitié de la largeur
function packDrag(kind, opener) {
  const pack = $('#pack');
  const top = $('.pack-top', pack), body = $('.pack-body', pack), light = $('.pack-light', pack), tear = $('.tear', pack);
  let lastSpark = 0;
  const tilt = tilt3d(() => pack, $('#packscene'), 16);
  let x0 = null, dx = 0, raf = 0, done = false;
  const paint = () => {
    raf = 0;
    const w = pack.offsetWidth, k = Math.min(1, Math.abs(dx) / (w * 0.5)), dir = Math.sign(dx) || 1;
    top.style.transformOrigin = dir > 0 ? '0 100%' : '100% 100%';
    top.style.transform = `translate(${dx * 0.7}px, ${-k * 26}px) rotate(${dir * k * -14}deg)`;
    body.style.transform = `rotate(${dir * k * 1.5}deg)`;
    light.style.opacity = (k * 0.9).toFixed(2); // la lumière fuit par la déchirure
    // le trait de lumière suit le doigt le long de la déchirure, avec des étincelles au bout
    tear.style.opacity = k > 0.02 ? 1 : 0;
    tear.style.setProperty('--k', k.toFixed(3));
    tear.classList.toggle('rtl', dir < 0);
    const now = performance.now();
    if (k > 0.05 && k < 1 && now - lastSpark > 70) {
      lastSpark = now;
      const r = tear.getBoundingClientRect();
      sparks(dir > 0 ? r.left + r.width * k : r.right - r.width * k, r.top + r.height / 2, '#fff1b8', 6, 0.5, true);
    }
    if (k >= 1) open(dir);
  };
  pack.addEventListener('pointerdown', (e) => {
    if (done) return;
    x0 = e.clientX; dx = 0; tilt.on = false;
    pack.classList.add('drag', 'touched');
    pack.setPointerCapture(e.pointerId);
  });
  pack.addEventListener('pointermove', (e) => {
    if (x0 == null || done) return;
    dx = e.clientX - x0;
    if (!raf) raf = requestAnimationFrame(paint);
  });
  const back = () => {
    if (x0 == null || done) return;
    x0 = null; tilt.on = true;
    pack.classList.remove('drag');
    const from = top.style.transform;
    top.style.transform = body.style.transform = light.style.opacity = tear.style.opacity = '';
    if (from && top.animate) top.animate([{ transform: from }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  };
  pack.addEventListener('pointerup', back);
  pack.addEventListener('pointercancel', back);
  pack.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(1); } });
  $('#packbtn').addEventListener('click', () => open(1));
  async function open(dir) {
    if (done) return;
    done = true; x0 = null; PACKING = true;
    pack.classList.remove('drag');
    pack.classList.add('touched');
    $('.pack-hint').style.visibility = $('#packbtn').style.visibility = 'hidden';
    const req = opener();
    const anim = !!top.animate && !reduced();
    tilt.on = false;
    if (anim) {
      // 1. le haut du pack s'arrache, un trait de lumière jaillit de la déchirure
      const from = top.style.transform || 'none';
      top.animate([{ transform: from }, { transform: `translate(${dir * 360}px, -160px) rotate(${dir * 60}deg)`, opacity: 0 }], { duration: 700, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' });
      light.style.opacity = '';
      tear.style.setProperty('--k', 1);
      tear.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
      light.animate([{ opacity: 0.9, transform: 'scaleY(1)' }, { opacity: 1, transform: 'scaleY(1.8)' }], { duration: 400, fill: 'forwards' });
      const [lx, ly] = mid(light);
      sparks(lx, ly, '#ffe9a8', 36, 0.8, true);
      pack.classList.add('charging');
    }
    let j;
    try {
      [j] = await Promise.all([req, sleep(anim ? 700 : 0)]);
    } catch (e) {
      PACKING = false;
      $('#packzone').innerHTML = `<p class="msg">${esc(e.message)}</p>`;
      if (kind !== 'base') setTimeout(() => route({ quiet: true }), 2500);
      return;
    }
    CACHE.set('collection', { t: Date.now(), p: Promise.resolve(j), json: JSON.stringify(j) });
    if (anim) {
      // 2. la lumière prend la couleur de la meilleure carte du pack, et les cartes sortent du pack
      const best = BEST(j.fresh || []), glow = GLOW[best], rare = best === 'legend' || best === 'gold';
      pack.style.setProperty('--glow', glowCss(glow));
      if (glow === 'rainbow') pack.classList.add('g-rainbow');
      pack.classList.remove('charging');
      pack.classList.add('glowing');
      $('.pack-beam', pack).animate([{ opacity: 0, transform: 'scaleY(.2)' }, { opacity: 1, transform: 'scaleY(1)' }], { duration: 500, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
      pack.querySelectorAll('.pk').forEach((p, k) => p.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${-150 - k * 14}px) rotate(${(k - 1) * 6}deg)` }], { duration: 620, delay: 120 + k * 90, easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'forwards' }));
      const [lx, ly] = mid(light);
      sparks(lx, ly, glow, best === 'legend' ? 120 : rare ? 80 : 45, 1.1, true);
      await sleep(rare ? 1150 : 850);
      // 3. éclair : le pack disparaît, place aux cartes
      const [fx, fy] = mid(pack);
      flash(fx, fy, glow);
      await sleep(170);
    }
    revealStage(j, kind);
  }
}

// les cartes une à une : chaque clic retourne la suivante, la plus rare arrive en dernier
function revealStage(j, kind) {
  const cards = j.fresh || [];
  const zone = $('#packzone');
  zone.innerHTML = `<div class="stage">
    <p class="rev-msg" id="revmsg">${L('Touche la carte pour la retourner', 'Tap the card to flip it')}</p>
    <div class="stage-c" id="stagec"></div>
    <div class="stage-tag" id="stagetag"></div>
    <div class="strip" id="strip">${cards.map(() => `<div class="sl"><span class="mini">${CARD_BACK}</span></div>`).join('')}</div>
    <div class="stage-act" id="stageact"></div>
  </div>`;
  const center = $('#stagec'), msg = $('#revmsg'), tagEl = $('#stagetag');
  let i = -1, flipped = false, busy = false;
  const tagHtml = (c) => `<span class="tag ${c.isNew ? 'new' : ''}">${c.isNew ? L('Nouvelle', 'New') : L('Doublon', 'Duplicate')}</span>`;
  const put = (k) => {
    center.innerHTML = `<div class="flip r-${cards[k].tier}"><div class="tilt"><div class="flip-in"><div class="flip-back">${CARD_BACK}</div><div class="flip-front">${colCard(cards[k])}</div></div></div></div>`;
    tagEl.innerHTML = '';
    const f = center.firstElementChild;
    if (f.animate && !reduced()) f.animate([{ transform: 'translateY(140px) rotateX(55deg) scale(.6)', opacity: 0 }, { transform: 'translateY(-12px) rotateX(-6deg) scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.2,.8,.3,1)' });
    $('#strip').children[k].classList.add('cur');
    return f;
  };
  // la carte retournée part se ranger dans sa case en bas
  const stash = (k) => {
    const slot = $('#strip').children[k];
    const from = center.firstElementChild.getBoundingClientRect();
    slot.classList.remove('cur');
    slot.innerHTML = `<span class="mini">${colCard(cards[k])}</span>`;
    const to = slot.getBoundingClientRect();
    if (!slot.animate || reduced()) return;
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.innerHTML = colCard(cards[k]);
    Object.assign(ghost.style, { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.appendChild(ghost);
    slot.style.visibility = 'hidden';
    ghost.animate([{ transform: 'none' }, { transform: `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${to.width / from.width})` }], { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
      .onfinish = () => { ghost.remove(); slot.style.visibility = ''; };
  };
  // éclat de lumière à la couleur de la rareté quand la carte se retourne
  const burst = (c, big) => {
    const [x, y] = mid(center);
    const n = { bronze: 0, silver: 22, gold: 60, legend: 110 }[c.tier];
    sparks(x, y, GLOW[c.tier], big ? n * 1.6 : n, big ? 1.5 : 1);
    if (c.tier === 'gold' || c.tier === 'legend') {
      if (!reduced()) {
        const ring = document.createElement('div');
        ring.className = 'ring';
        ring.style.setProperty('--glow', glowCss(GLOW[c.tier]));
        if (c.tier === 'legend') ring.classList.add('rainbow');
        center.appendChild(ring);
        ring.animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }], { duration: 800, easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => ring.remove();
      }
      if (big) flash(x, y, GLOW[c.tier]);
    }
    if (big && c.tier === 'legend' && !reduced()) zone.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-8px,4px)' }, { transform: 'translate(7px,-5px)' }, { transform: 'translate(-4px,3px)' }, { transform: 'none' }], { duration: 380 });
  };
  const flipNormal = (f, c) => new Promise((r) => { f.classList.add('up'); setTimeout(() => burst(c, false), 220); setTimeout(r, 520); });
  // la dernière : elle tremble, puis tourne plusieurs fois sur elle-même avant de se poser
  const flipFinal = async (f, c) => {
    const rare = c.tier === 'legend' || c.tier === 'gold';
    msg.textContent = c.tier === 'legend' ? L('Attention…', 'Wait for it…') : L('Dernière carte…', 'Last card…');
    center.classList.add('charge', 'ray-' + c.tier);
    await sleep(reduced() ? 0 : rare ? 1100 : 700);
    center.classList.remove('charge');
    center.classList.add('rays');
    const inner = $('.flip-in', f);
    if (inner.animate && !reduced()) {
      inner.style.transition = 'none';
      await new Promise((r) => {
        inner.animate([
          { transform: 'rotateY(0) scale(1)' },
          { transform: 'rotateY(720deg) scale(1.18) translateY(-16px)', offset: 0.55 },
          { transform: 'rotateY(1260deg) scale(1)' },
        ], { duration: rare ? 2000 : 1500, easing: 'cubic-bezier(.35,.05,.2,1)' }).onfinish = r;
      });
    }
    f.classList.add('up');
    burst(c, true);
    if (c.tier === 'legend') confetti();
  };
  const step = async () => {
    if (busy || (i === cards.length - 1 && flipped)) return;
    busy = true;
    let f = center.firstElementChild;
    if (flipped) {
      stash(i);
      i++;
      flipped = false;
      f = put(i);
      await sleep(reduced() ? 0 : 200);
    }
    const last = i === cards.length - 1;
    if (last) await flipFinal(f, cards[i]); else await flipNormal(f, cards[i]);
    flipped = true;
    tagEl.innerHTML = tagHtml(cards[i]);
    const c = cards[i];
    msg.textContent = last
      ? (c.tier === 'legend' ? L(`Une Légende : ${c.name} !`, `A Legend: ${c.name}!`) : `${c.name} · ${TIER_NAME[c.tier]}`)
      : `${i + 1}/${cards.length} · ${c.name} · ${TIER_NAME[c.tier]}`;
    if (last) {
      PACKING = false;
      const more = !!nextPack(j);
      SEL = null;
      $('#stageact').innerHTML = `${more ? `<button type="button" class="btn solid" id="nextpack">${L('Booster suivant', 'Next booster')}</button>` : `<button type="button" class="btn solid" id="nextpack">${L('Choisir un booster', 'Pick a booster')}</button>`}<button type="button" class="btn" id="tocol">${L('Voir ma collection', 'See my collection')}</button>`;
      const redraw = () => { const y = window.scrollY; drawCollection(j); window.scrollTo(0, y); };
      $('#tocol').onclick = () => { redraw(); $('#cgrid')?.scrollIntoView({ behavior: 'smooth' }); };
      $('#nextpack').onclick = () => { redraw(); $('#packzone')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    }
    busy = false;
  };
  zone.querySelector('.stage').addEventListener('click', (e) => { if (!e.target.closest('.stage-act')) step(); });
  // la première carte sort du pack, face cachée
  i = 0;
  put(0);
  tilt3d(() => center.querySelector('.tilt'), center, 13);
  center.firstElementChild.style.cursor = 'pointer';
}

// ——— Page : marché (les cartes mises en vente par les joueurs, achetées avec des pièces) ———
let MK_FILTER = 'all', MK_Q = '';
async function pageMarket() {
  const m = await api('market');
  renderWho(m.user);
  drawMarket(m);
}
function drawMarket(m) {
  app.innerHTML = `${subTabs('/marche')}
    <div class="pagehead">
      <div><div class="kicker">${L('Achète et vends entre joueurs', 'Buy and sell between players')}</div><h1>${L('Marché', 'Market')}</h1>
      <p>${L('Les cartes mises en vente par les autres joueurs. Pour vendre les tiennes, touche une carte dans ta <a href="/collection" data-link>collection</a>.', 'Cards put on sale by other players. To sell yours, tap a card in your <a href="/collection" data-link>collection</a>.')}</p></div>
      <div class="mk-count"><b>${m.listings.length}</b> ${L('cartes en vente', 'cards for sale')}</div>
    </div>
    ${m.user ? '' : `<p class="nudge">${L('<a href="/compte" data-link>Crée un compte</a> pour acheter et vendre des cartes.', '<a href="/compte" data-link>Create an account</a> to buy and sell cards.')}</p>`}
    <div class="colbar">
      <div class="chips">${['all', ...TIERS, 'mine'].map((t) => `<button type="button" class="chip ${MK_FILTER === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? L('Toutes', 'All') : t === 'mine' ? L('Mes ventes', 'My sales') : TIER_NAME[t]}</button>`).join('')}</div>
      <input class="mk-q" id="mkq" type="search" placeholder="${L('Chercher un joueur', 'Search a player')}" value="${esc(MK_Q)}">
    </div>
    <div class="cgrid mk-grid" id="mkgrid"></div>
    ${adSlot('wide')}`;
  const norm = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const grid = () => {
    const q = norm(MK_Q.trim());
    const list = m.listings.filter((l) => (MK_FILTER === 'all' || (MK_FILTER === 'mine' ? l.mine : l.card.tier === MK_FILTER)) && (!q || norm(l.card.name).includes(q)));
    $('#mkgrid').innerHTML = list.length
      ? list.map((l) => `<div class="mk-it"><button type="button" class="cslot" data-z="${l.id}"><span class="mini">${colCard(l.card)}</span></button>
        <div class="mk-p">${coinTag(l.price)}<small>${l.mine ? L('Ta vente', 'Your sale') : L('par', 'by') + ' ' + esc(l.seller)}</small></div>
        ${l.mine ? `<button type="button" class="btn" data-cancel="${l.id}">${L('Retirer', 'Remove')}</button>`
          : m.user ? `<button type="button" class="btn ${m.coins >= l.price ? 'solid' : ''}" data-buy="${l.id}" ${m.coins >= l.price ? '' : 'disabled'}>${L('Acheter', 'Buy')}</button>` : ''}</div>`).join('')
      : `<p class="empty">${m.listings.length ? L('Aucune carte ne correspond.', 'No card matches.') : L('Personne ne vend de carte pour l’instant. Sois le premier : touche une carte de ta collection.', 'Nobody is selling yet. Be the first: tap a card in your collection.')}</p>`;
    $('#mkgrid').querySelectorAll('[data-z]').forEach((b) => b.addEventListener('click', () => zoomCard({ ...m.listings.find((l) => l.id === +b.dataset.z).card, n: 1 })));
    $('#mkgrid').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const l = m.listings.find((x) => x.id === +b.dataset.buy);
      if (!confirm(L(`Acheter ${l.card.name} pour ${l.price} pièces ?`, `Buy ${l.card.name} for ${l.price} coins?`))) return;
      b.disabled = true;
      api('market/buy', { listing: l.id }).then(async (j) => {
        toast(L(`${esc(j.bought.name)} rejoint ta collection !`, `${esc(j.bought.name)} joins your collection!`));
        if (j.bought.tier === 'legend' || j.bought.tier === 'gold') { const [x, y] = mid(b); sparks(x, y, GLOW[j.bought.tier], 60); }
        drawMarket(await fetchJSON('market'));
      }, (e) => { toast(esc(e.message)); b.disabled = false; });
    }));
    $('#mkgrid').querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', () => {
      api('market/cancel', { listing: +b.dataset.cancel }).then(async () => { toast(L('Vente retirée', 'Sale removed')); drawMarket(await fetchJSON('market')); }, (e) => toast(esc(e.message)));
    }));
  };
  grid();
  app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    MK_FILTER = b.dataset.t;
    app.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    grid();
  }));
  $('#mkq').addEventListener('input', (e) => { MK_Q = e.target.value; grid(); });
}

// ——— Page : duel (1 contre 1, le même joueur à trouver, le premier qui trouve gagne) ———
const DU = { id: null, poll: 0, clock: 0, phase: null, mode: null, off: 0, v: null, oppTemp: 0 };
function stopDuel() {
  clearInterval(DU.poll); clearInterval(DU.clock);
  DU.poll = DU.clock = 0;
  // on quitte la file d'attente si on change de page avant d'avoir trouvé un adversaire
  if (DU.id && DU.phase === 'waiting') fetchJSON(`duel/${DU.id}/leave`, {}).catch(() => {});
  DU.id = DU.phase = DU.v = null;
}
async function pageDuel(code) {
  if (code) {
    try { return duelStart(await fetchJSON('duel/join/' + code, {}), 'friend'); } catch (e) {
      history.replaceState({}, '', '/duel');
      return duelLobby(e.message);
    }
  }
  duelLobby();
}
function duelLobby(err) {
  api('me').then((m) => renderWho(m.user, m)).catch(() => {});
  app.innerHTML = `
    <div class="duel-lobby">
      <div class="dl-hero">
        <div class="dl-l"><span>${L('Toi', 'You')}</span></div>
        <div class="dl-vs">VS</div>
        <div class="dl-r"><span>?</span></div>
      </div>
      <div class="kicker">${L('1 contre 1 · sans chrono', '1 vs 1 · no timer')}</div>
      <h1>Duel</h1>
      <p class="dl-p">${L('Le même joueur mystère pour vous deux, pas celui du jour. Posez vos questions, proposez des noms : le premier qui le trouve gagne. Pas de chrono, mais celui qui abandonne perd.', 'The same mystery player for both of you, not the daily one. Ask questions, guess names: first to find him wins. No timer, but whoever gives up loses.')}</p>
      <div class="dl-act">
        <button class="btn solid big" id="d-rand">${L('Adversaire au hasard', 'Random opponent')}</button>
        <button class="btn big" id="d-friend">${L('Défier un pote', 'Challenge a friend')}</button>
        <button class="btn big" id="d-bot">${L('Contre le robot', 'Against the bot')}</button>
      </div>
      <form class="dl-join" id="d-join">
        <label for="d-code">${L('Un pote t’a donné un code ?', 'Got a code from a friend?')}</label>
        <div class="dl-join-row"><input id="d-code" class="codein" maxlength="5" required autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC23" aria-label="${L('Code du duel', 'Duel code')}"><button class="btn solid">${L('Rejoindre', 'Join')}</button></div>
        <p class="msg" id="d-jm">${err ? esc(err) : ''}</p>
      </form>
    </div>
    ${adSlot('wide')}`;
  $('#d-rand').onclick = async () => duelStart(await fetchJSON('duel/queue', {}), 'random');
  $('#d-friend').onclick = async () => duelStart(await fetchJSON('duel/friend', {}), 'friend');
  $('#d-bot').onclick = async () => duelStart(await fetchJSON('duel/bot', {}), 'bot');
  $('#d-code').oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); };
  $('#d-join').onsubmit = (e) => {
    e.preventDefault();
    const code = $('#d-code').value;
    if (code.length !== 5) { $('#d-jm').textContent = L('Le code fait 5 caractères.', 'The code is 5 characters long.'); return; }
    go('/duel/' + code);
  };
}
function duelStart(v, mode) {
  stopDuel();
  DU.id = v.id; DU.mode = mode; DU.oppTemp = 0;
  duelUpdate(v);
  DU.poll = setInterval(async () => {
    if (!location.pathname.startsWith('/duel')) return stopDuel();
    try { duelUpdate(await fetchJSON('duel/' + DU.id)); } catch (e) { /* réseau : on réessaie à la prochaine seconde */ }
  }, 1000);
}
// le serveur donne l'heure : on s'y cale pour que les deux joueurs voient le même chrono
const dnow = () => Date.now() + DU.off;
function duelUpdate(v) {
  if (!DU.id || v.id !== DU.id) return;
  DU.off = v.now - Date.now();
  DU.v = v;
  // l'intro et la partie démarrent à l'heure prévue, sans attendre la réponse suivante du serveur
  let phase = v.phase;
  if (phase === 'intro' && dnow() >= v.startAt) phase = 'playing';
  if (phase !== DU.phase) {
    DU.phase = phase;
    if (phase === 'waiting') duelWaiting(v);
    if (phase === 'intro') duelIntro(v);
    if (phase === 'playing') duelPlay(v);
    if (phase === 'over') duelOverScreen(v);
  }
  if (phase === 'playing') duelRefresh(v);
  if (phase === 'over') { clearInterval(DU.poll); clearInterval(DU.clock); }
}
function duelWaiting(v) {
  if (v.code) {
    const link = `${location.origin}/duel/${v.code}`;
    app.innerHTML = `<div class="duel-wait">
      <div class="kicker">${L('Défie un pote', 'Challenge a friend')}</div>
      <h1>${L('Donne-lui ce code', 'Give them this code')}</h1>
      <div class="dw-code">${esc(v.code)}</div>
      <p><button class="linkbtn" id="d-copy" type="button">${L('Copier le code', 'Copy the code')}</button></p>
      <p>${L('Il le tape dans la page Duel, ou ouvre le lien. Le duel démarre dès qu’il arrive.', 'They type it on the Duel page, or open the link. The duel starts as soon as they join.')}</p>
      ${shareBox(L(`Je te défie en duel sur FoOotix : le premier qui trouve le joueur gagne ⚔️ Code : ${v.code}`, `I challenge you to a FoOotix duel: first to find the player wins ⚔️ Code: ${v.code}`), link, L('Envoyer le lien', 'Send the link'))}
      <p class="dw-link">${esc(link)}</p>
      <div class="dw-dots"><i></i><i></i><i></i></div>
      <button class="linkbtn" id="d-cancel">${L('Annuler', 'Cancel')}</button>
    </div>`;
    $('#d-copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(v.code); e.target.textContent = L('Code copié', 'Code copied'); } catch { prompt(L('Copie ce code :', 'Copy this code:'), v.code); }
    };
  } else {
    app.innerHTML = `<div class="duel-wait">
      <div class="kicker">${L('Adversaire au hasard', 'Random opponent')}</div>
      <h1>${L('Recherche d’un adversaire', 'Looking for an opponent')}</h1>
      <div class="radar"><i></i><i></i><i></i><b>?</b></div>
      <p id="d-since">${L('En attente…', 'Waiting…')}</p>
      <div id="d-botoffer" hidden><p>${L('Personne pour l’instant. Tu peux jouer contre le robot en attendant.', 'Nobody right now. You can play the bot meanwhile.')}</p><button class="btn solid" id="d-bot2">${L('Jouer contre le robot', 'Play the bot')}</button></div>
      <button class="linkbtn" id="d-cancel">${L('Annuler', 'Cancel')}</button>
    </div>`;
    const t0 = Date.now();
    DU.clock = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      const el = $('#d-since');
      if (!el) return;
      el.textContent = L(`En attente depuis ${s} s`, `Waiting for ${s}s`);
      if (s >= 10) $('#d-botoffer').hidden = false;
    }, 1000);
    $('#d-bot2').onclick = async () => duelStart(await fetchJSON('duel/bot', {}), 'bot');
  }
  $('#d-cancel').onclick = () => { stopDuel(); duelLobby(); };
}
function duelIntro(v) {
  clearInterval(DU.clock);
  app.innerHTML = `<div class="vs-screen">
    <div class="vs-l"><span>${L('Toi', 'You')}</span><b>${esc(v.me.name)}</b></div>
    <div class="vs-r"><span>${v.opp.bot ? L('Robot', 'Bot') : L('Adversaire', 'Opponent')}</span><b>${esc(v.opp.name)}</b></div>
    <div class="vs-mid">VS</div>
    <div class="vs-count" id="vscount"></div>
  </div>`;
  let shown = null;
  DU.clock = setInterval(() => {
    const left = v.startAt - dnow();
    if (left <= 0) { clearInterval(DU.clock); duelUpdate({ ...DU.v, phase: 'playing' }); return; }
    const n = Math.ceil(left / 1000);
    if (n <= 3 && n !== shown) {
      shown = n;
      const el = $('#vscount');
      if (el) { el.innerHTML = `<b>${n}</b>`; }
    }
  }, 50);
}
function duelPlay(v) {
  clearInterval(DU.clock);
  app.innerHTML = `
    <div class="duel">
      <div class="duel-top">
        <div class="dp me"><span>${L('Toi', 'You')}</span><b>${esc(v.me.name)}</b><div class="dbar"><i id="d-mybar"></i></div><small id="d-myn"></small></div>
        <div class="dclock"><b>VS</b><button class="linkbtn" id="d-quit" type="button">${L('Abandonner', 'Give up')}</button></div>
        <div class="dp opp" id="d-opp"><span>${v.opp.bot ? L('Robot', 'Bot') : L('Adversaire', 'Opponent')}</span><b>${esc(v.opp.name)}</b><div class="dbar"><i id="d-oppbar"></i></div><small id="d-oppn"></small></div>
      </div>
      <div class="duel-go" id="d-go">GO&nbsp;!</div>
      <div class="search" id="search">
        <form autocomplete="off">
          <input id="q" placeholder="${L('Un joueur, un club, un pays, un poste…', 'A player, a club, a country, a position…')}" aria-label="${L('Ta proposition', 'Your guess')}" spellcheck="false" autocapitalize="off" autocorrect="off">
          <button>${L('Tenter', 'Guess')}</button>
        </form>
        <div class="msg" id="msg"></div>
      </div>
      <div class="lastg" id="lastg"></div>
      <div class="play">
        <div id="fcard"></div>
        <div class="play-side"><div id="path"></div><div class="d-toast" id="d-toast"></div></div>
      </div>
      <table class="board" id="board"></table>
    </div>`;
  const input = $('#q'), msg = $('#msg');
  $('#search form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q || DU.phase !== 'playing') return;
    try {
      const r = await fetchJSON(`duel/${DU.id}/guess`, { q, id: pickOf(input, q) });
      input.value = '';
      msg.textContent = r.dup ? L(`Déjà proposé (essai n° ${r.dup}).`, `Already guessed (guess #${r.dup}).`) : '';
      duelUpdate(r);
      if (DU.phase === 'playing') input.focus();
    } catch (err) { msg.textContent = err.message; input.select(); }
  });
  attachSuggest(input);
  input.focus();
  $('#d-quit').onclick = async () => {
    if (!confirm(L('Abandonner le duel ? Ton adversaire gagnera.', 'Give up the duel? Your opponent will win.'))) return;
    try { duelUpdate(await fetchJSON(`duel/${DU.id}/giveup`, {})); } catch (err) { msg.textContent = err.message; }
  };
}
function duelRefresh(v) {
  const g = v.me.guesses;
  const best = g.reduce((m, x) => Math.max(m, x.temp), 0);
  $('#fcard').innerHTML = fifaCard(v.card, g.length ? best : '?', false);
  $('#path').innerHTML = clubPath(v.card.path, false);
  $('#d-mybar').style.cssText = `width:${best}%;background:${heat(best)}`;
  $('#d-myn').textContent = `${best}° · ${g.length} ${L('essai', 'guess')}${g.length > 1 ? L('s', 'es') : ''}`;
  $('#d-oppbar').style.cssText = `width:${v.opp.temp}%;background:${heat(v.opp.temp)}`;
  $('#d-oppn').textContent = `${v.opp.temp}° · ${v.opp.n} ${L('essai', 'guess')}${v.opp.n > 1 ? L('s', 'es') : ''}`;
  // l'adversaire se rapproche : on le montre
  for (const step of [50, 75, 90]) {
    if (DU.oppTemp < step && v.opp.temp >= step) {
      const t = $('#d-toast');
      t.textContent = L(`${v.opp.name} chauffe : ${v.opp.temp}°`, `${v.opp.name} is getting hot: ${v.opp.temp}°`);
      t.classList.remove('on'); void t.offsetWidth; t.classList.add('on');
      $('#d-opp').classList.remove('flash'); void $('#d-opp').offsetWidth; $('#d-opp').classList.add('flash');
      break;
    }
  }
  DU.oppTemp = v.opp.temp;
  const last = g[g.length - 1];
  const tags = (x) => x.type === 'clue'
    ? `<span class="tag ${x.yes ? 'yes' : 'no'}">${x.yes ? L('Oui', 'Yes') : L('Non', 'No')}</span>`
    : x.tags.map((t) => `<span class="tag ${t.ok ? 'ok' : t.half ? 'half' : ''}">${t.dir === 'up' ? '↑ ' : t.dir === 'down' ? '↓ ' : ''}${esc(t.t)}</span>`).join('');
  $('#lastg').innerHTML = last ? `<span class="lg-n">${L('Essai', 'Guess')} ${last.n}</span><b>${esc(last.label)}</b><span class="lg-t" style="color:${heat(last.temp)}">${last.temp}°</span>${tags(last)}` : '';
  $('#board').innerHTML = g.length ? `<tbody>${[...g].sort((a, b) => b.temp - a.temp || b.n - a.n).map((x) => `<tr class="${last && x.n === last.n ? 'last' : ''}"><td class="n">${x.n}</td><td class="lbl">${esc(x.label)}<div class="tags">${tags(x)}</div></td><td class="t" style="color:${heat(x.temp)}">${x.temp}°</td><td class="bar"><div class="minibar"><i style="width:${x.temp}%;background:${heat(x.temp)}"></i></div></td></tr>`).join('')}</tbody>` : '';
}
function duelOverScreen(v) {
  clearInterval(DU.clock);
  const word = v.result === 'win' ? L('Victoire', 'Victory') : L('Défaite', 'Defeat');
  const secs = Math.max(1, Math.round((v.endAt - v.startAt) / 1000));
  const time = secs < 60 ? L(`${secs} secondes`, `${secs} seconds`) : L(`${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')}`, `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, '0')}`);
  const n = v.me.guesses.length;
  const sub = v.quit === 'opp' ? L(`${v.opp.name} a abandonné.`, `${v.opp.name} gave up.`)
    : v.quit === 'me' ? L('Tu as abandonné.', 'You gave up.')
      : v.result === 'win' ? L(`Trouvé en ${time} et ${n} essai${s_(n)}.`, `Found in ${time} and ${n} ${n > 1 ? 'guesses' : 'guess'}.`)
        : L(`${v.opp.name} l’a trouvé en ${time}.`, `${v.opp.name} found him in ${time}.`);
  app.innerHTML = `<div class="duel-end r-${v.result}">
    <div class="de-word">${word}</div>
    <p class="de-sub">${esc(sub)}</p>
    <div class="de-card" id="decard">${fifaCard(v.card, v.result === 'win' ? 100 : '?', v.result === 'win')}</div>
    <p class="de-ans">${L('C’était', 'It was')} <b>${esc(v.answer.name)}</b></p>
    <div class="dl-act">
      <button class="btn solid big" id="d-again">${DU.mode === 'bot' ? L('Rejouer contre le robot', 'Play the bot again') : DU.mode === 'friend' ? L('Nouveau duel entre potes', 'New duel with a friend') : L('Rejouer', 'Play again')}</button>
      <button class="btn big" id="d-lobby">${L('Retour', 'Back')}</button>
    </div>
  </div>`;
  if (v.result === 'win') confetti();
  const box = $('#decard');
  const el = box.firstElementChild;
  if (el.animate && !reduced()) el.animate([{ transform: 'rotateY(0) scale(.8)', opacity: 0 }, { transform: 'rotateY(720deg) scale(1.05)', opacity: 1, offset: 0.7 }, { transform: 'rotateY(720deg) scale(1)' }], { duration: 1400, easing: 'cubic-bezier(.3,.1,.2,1)' });
  const mode = DU.mode;
  $('#d-again').onclick = async () => duelStart(await fetchJSON(mode === 'bot' ? 'duel/bot' : mode === 'friend' ? 'duel/friend' : 'duel/queue', {}), mode);
  $('#d-lobby').onclick = () => { stopDuel(); duelLobby(); };
}

// ——— Page : classement ———
let RANK_TAB = 'points';
// « 1er novembre » en français, pas « 1 novembre »
const dayName = (d, year = true) => new Date(d + 'T12:00:00Z').toLocaleDateString(LOC, { day: 'numeric', month: 'long', ...(year ? { year: 'numeric' } : {}) }).replace(/^1 /, L('1er ', '1 '));
const monthName = (m) => new Date(m + '-15T12:00:00Z').toLocaleDateString(LOC, { month: 'long', year: 'numeric' });
// l'encart « Joueur TikTok du mois » : le gagnant du dernier mois fini, et qui mène le mois en cours
function tiktokBox(t) {
  if (!t) return '';
  const join = `<a href="/ligue/${t.code}" data-link>${L('Rejoins la ligue TikTok', 'Join the TikTok league')}</a> ${L('avec le code', 'with the code')} <span class="code">${t.code}</span>`;
  const now = t.starts ? L(`La ligue démarre le ${dayName(t.starts, false)}.`, `The league starts on ${dayName(t.starts, false)}.`)
    : t.leader ? L(`En ${monthName(t.month)}, <b>${esc(t.leader.username)}</b> mène avec ${t.leader.total} pts.`, `In ${monthName(t.month)}, <b>${esc(t.leader.username)}</b> leads with ${t.leader.total} pts.`)
    : L(`Personne n'a encore marqué en ${monthName(t.month)}.`, `Nobody has scored yet in ${monthName(t.month)}.`);
  return `<div class="tiktok-box">
    <div class="tt-tag">${L('Joueur TikTok du mois', 'TikTok player of the month')}</div>
    ${t.winner ? `<div class="tt-win"><span class="nm">${esc(t.winner.username)}</span><span class="pt">${t.winner.total} pts · ${monthName(t.winner.month)}</span></div>`
      : `<div class="tt-win"><span class="nm muted">${L('À toi de jouer', 'Up for grabs')}</span><span class="pt">${L('premier gagnant à la fin du mois', 'first winner at the end of the month')}</span></div>`}
    <p>${now} ${join}. ${L("Les points repartent de zéro chaque mois : le premier à la fin du mois s'affiche ici.", 'Points reset every month: whoever is first at the end of the month is shown here.')}</p>
  </div>`;
}
async function pageRank() {
  const [r, me] = await Promise.all([api('leaderboard'), api('me')]);
  renderWho(me.user, me);
  const empty = `<p class="muted">${L("Personne pour l'instant. Trouve le joueur du jour avec un compte pour ouvrir le bal.", "Nobody yet. Find today's player with an account to get things started.")}</p>`;
  // le podium seulement ; pour les autres, juste leur rang (sans dire combien de joueurs sont classés)
  const podium = (b, val) => b.top.length ? `<div class="podium">${b.top.map((x, i) => `<div class="p${i + 1} ${x.me ? 'me' : ''}"><div class="pl">${ord(i + 1)}</div><div class="nm">${esc(x.username)}</div><div class="pt">${val(x)}</div></div>`).join('')}</div>` : empty;
  const mine = (b, val, none) => !me.user ? `<p class="myrank">${L('<a href="/compte" data-link>Crée un compte</a> pour être classé.', '<a href="/compte" data-link>Create an account</a> to be ranked.')}</p>`
    : b.mine ? (b.mine.rank <= 3 ? `<p class="myrank">${L(`Tu es sur le podium : <b>${ord(b.mine.rank)}</b>.`, `You're on the podium: <b>${ord(b.mine.rank)}</b>.`)}</p>` : `<p class="myrank">${L(`Tu es <b>${ord(b.mine.rank)}</b>`, `You are <b>${ord(b.mine.rank)}</b>`)} · ${val(b.mine)}</p>`)
      : `<p class="myrank">${none}</p>`;
  const tabs = {
    points: () => `${podium(r.points, (x) => `${x.total} pts`)}${mine(r.points, (x) => `${x.total} pts`, L('Trouve un joueur du jour pour entrer au classement.', 'Find a daily player to enter the ranking.'))}
      <p class="rank-note">${L("Les points s'additionnent jour après jour. Moins tu poses de questions, plus tu marques, et un joueur peu connu rapporte jusqu'à deux fois plus qu'une star. Chaque indice retire 10 %.", 'Points add up day after day. The fewer questions you ask, the more you score, and a little-known player is worth up to twice as much as a star. Each hint costs 10%.')}</p>`,
    today: () => `${podium(r.today, (x) => `${x.pts} pts · ${x.n} ${L('essai', 'guess')}${x.n > 1 ? L('s', 'es') : ''}`)}${mine(r.today, (x) => `${x.pts} pts`, L("Tu n'as pas encore trouvé le joueur du jour.", "You haven't found today's player yet."))}`,
    streaks: () => `<h3 class="rank-h">${L('Séries en cours', 'Current streaks')}</h3>${podium(r.streaks, (x) => `${x.streak} ${L('jour', 'day')}${s_(x.streak)}`)}${mine(r.streaks, (x) => `${x.streak} ${L('jour', 'day')}${s_(x.streak)}`, L("Pas de série en cours.", 'No current streak.'))}
      <h3 class="rank-h">Records</h3>${podium(r.records, (x) => `${x.best} ${L('jour', 'day')}${s_(x.best)}`)}${mine(r.records, (x) => `${x.best} ${L('jour', 'day')}${s_(x.best)}`, L('Pas encore de record.', 'No record yet.'))}
      <p class="rank-note">${L("Une série, c'est le nombre de jours d'affilée où tu as trouvé le joueur. Un jour sans, ou un abandon, et elle repart de zéro.", 'A streak is the number of days in a row you found the player. Miss a day, or give up, and it resets to zero.')}</p>`,
  };
  const names = { points: L('Général', 'Overall'), today: L("Aujourd'hui", 'Today'), streaks: L('Séries', 'Streaks') };
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">${L('Les meilleurs FoOotix', 'The best FoOotix players')}</div><h1>${L('Classement', 'Ranking')}</h1><p><a href="/ligues" data-link>${L('Mes ligues entre potes', 'My private leagues')}</a> · ${me.user ? L(`Tu as <b>${me.user.points} points</b> et une série de <b>${me.user.streak} jour${s_(me.user.streak)}</b>.`, `You have <b>${me.user.points} points</b> and a <b>${me.user.streak}-day</b> streak.`) : L(`Seuls les joueurs avec un compte sont classés. <a href="/compte" data-link>Crée le tien</a>.`, `Only players with an account are ranked. <a href="/compte" data-link>Create yours</a>.`)}</p></div></div>
    ${tiktokBox(r.tiktok)}
    <div class="board-tabs">${Object.entries(names).map(([k, v]) => `<button data-tab="${k}" class="${k === RANK_TAB ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div id="tab"></div>
    ${adSlot('wide')}`;
  const show = () => {
    $('#tab').innerHTML = tabs[RANK_TAB]();
    app.querySelectorAll('.board-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === RANK_TAB));
  };
  app.querySelectorAll('.board-tabs button').forEach((b) => { b.onclick = () => { RANK_TAB = b.dataset.tab; show(); }; });
  show();
}

// après connexion, on revient là où on était (ex. une invitation de ligue)
function nextPath() {
  const n = new URLSearchParams(location.search).get('next') || '/';
  return /^\/(?!\/)[\w\/-]*$/.test(n) ? n : '/';
}

// ——— Page : compte ———
async function pageAuth() {
  const m = await api('me');
  renderWho(m.user, m);
  if (m.user) {
    app.innerHTML = `
      <div class="pagehead"><div><div class="kicker">${L('Ton vestiaire', 'Your locker room')}</div><h1>${esc(m.user.username)}</h1><p>${L(`<b>${m.user.points}</b> points · <b>${m.user.found}</b> joueur${s_(m.user.found)} trouvé${s_(m.user.found)} · série de <b>${m.user.streak}</b> jour${s_(m.user.streak)} (record ${m.user.best})`, `<b>${m.user.points}</b> points · <b>${m.user.found}</b> player${s_(m.user.found)} found · <b>${m.user.streak}</b>-day streak (record ${m.user.best})`)}</p></div></div>
      <p><a class="btn" href="/album" data-link>${L('Mon album', 'My album')}</a> <a class="btn" href="/classement" data-link>${L('Classement', 'Ranking')}</a> <button class="btn" id="logout">${L('Se déconnecter', 'Log out')}</button></p>
      <details class="danger"><summary>${L('Supprimer mon compte', 'Delete my account')}</summary>
        <form id="fd"><p>${L('Ton compte, tes points, ta série et ton album seront effacés pour de bon.', 'Your account, points, streak and album will be erased for good.')}</p>
          <div class="field"><label for="dp">${L('Mot de passe', 'Password')}</label><input id="dp" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn">${L('Supprimer définitivement', 'Delete permanently')}</button><p class="msg"></p></form>
      </details>`;
    $('#logout').onclick = async () => { await api('logout', {}); go('/'); };
    $('#fd').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('delete-account', Object.fromEntries(new FormData(e.target))); go('/'); } catch (err) { $('#fd .msg').textContent = err.message; }
    };
    return;
  }
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">${L('Ton vestiaire', 'Your locker room')}</div><h1>${L('Compte', 'Account')}</h1><p>${L('Un pseudo et un mot de passe suffisent. Ta partie du jour te suit.', "A username and a password are all you need. Today's game comes with you.")}</p></div></div>
    <div class="auth">
      <form id="fl"><h2>${L('Connexion', 'Log in')}</h2>
        <div class="field"><label for="lu">${L('Pseudo', 'Username')}</label><input id="lu" name="username" autocomplete="username" required></div>
        <div class="field"><label for="lp">${L('Mot de passe', 'Password')}</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn solid">${L('Se connecter', 'Log in')}</button><p class="msg"></p></form>
      <form id="fs"><h2>${L('Nouveau compte', 'New account')}</h2>
        <div class="field"><label for="su">${L('Pseudo', 'Username')}</label><input id="su" name="username" autocomplete="username" required minlength="3" maxlength="20"></div>
        <div class="field"><label for="sp">${L('Mot de passe (6 caractères min.)', 'Password (6 characters min.)')}</label><input id="sp" name="password" type="password" autocomplete="new-password" required minlength="6"></div>
        <button class="btn solid">${L('Créer mon compte', 'Create my account')}</button><p class="msg"></p></form>
    </div>`;
  for (const [id, path] of [['#fl', 'login'], ['#fs', 'signup']]) {
    const f = $(id);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(path, { ...Object.fromEntries(new FormData(f)), ...(path === 'signup' && parrain() ? { ref: parrain() } : {}) }); go(nextPath()); } catch (err) { $('.msg', f).textContent = err.message; }
    };
  }
}

// ——— Page : règles ———
// règles, archives, fiches : pages écrites par le serveur. On garde celle reçue au chargement, sinon on la redemande.
const TITLE = L('FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer');
async function pageSsr(p) {
  api('me').then((m) => renderWho(m.user, m), () => {});
  if (p === SSR0.path && SSR0.html.trim()) { app.innerHTML = SSR0.html + adSlot('wide'); document.title = SSR0.title; return true; }
  const r = await fetch(p, { headers: { Accept: 'text/html' } }).catch(() => null);
  if (!r || !r.ok) return false;
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const m = doc.querySelector('#app');
  if (!m || !m.innerHTML.trim() || p !== location.pathname) return false;
  app.innerHTML = m.innerHTML + adSlot('wide');
  document.title = doc.title;
  return true;
}

// ——— Pages : mentions légales et confidentialité (écrites par le serveur) ———
async function pageLegalSsr(p) {
  if (!(await pageSsr(p))) throw new Error(L('Page indisponible, réessaie.', 'Page unavailable, try again.'));
  const c2 = $('#cookies2');
  if (c2) c2.onclick = (e) => { e.preventDefault(); $('#cookies a').click(); };
}

// ——— Pages : ligues entre potes ———
async function pageLeagues() {
  const r = await api('leagues');
  renderWho(r.user);
  if (!r.user) {
    app.innerHTML = `
      <div class="pagehead"><div><div class="kicker">${L('Entre potes', 'With friends')}</div><h1>${L('Ligues', 'Leagues')}</h1>
      <p>${L('Crée une ligue, envoie le code à tes amis, et comparez vos points chaque jour.', 'Create a league, send the code to your friends, and compare your points every day.')}</p></div></div>
      <p><a class="btn solid" href="/compte?next=/ligues" data-link>${L('Crée un compte pour commencer', 'Create an account to start')}</a></p>`;
    return;
  }
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">${L('Entre potes', 'With friends')}</div><h1>${L('Mes ligues', 'My leagues')}</h1>
    <p>${L("Un classement rien qu'à vous : les points comptent à partir de la création de la ligue.", 'A ranking just for you: points count from the day the league was created.')}</p></div></div>
    ${r.leagues.length ? `<div class="lglist">
      ${r.leagues.map((l) => `<a class="lg" href="/ligue/${l.code}" data-link><span class="nm"><b>${esc(l.name)}</b><span class="code">${l.code}</span></span><span class="meta">${l.members} ${L('joueur', 'player')}${s_(l.members)}${l.leader ? ` · ${L('en tête', 'leader')} : ${esc(l.leader)}` : ''}</span><span class="pl">${ord(l.rank)}</span></a>`).join('')}
      </div>` : `<p class="muted">${L("Tu n'es dans aucune ligue pour l'instant.", "You aren't in any league yet.")}</p>`}
    <div class="auth league-forms">
      <form id="lc"><h2>${L('Créer une ligue', 'Create a league')}</h2>
        <div class="field"><label for="ln">${L('Nom', 'Name')}</label><input id="ln" name="name" maxlength="40" required placeholder="${L('Les potes du foot', 'Sunday league legends')}"></div>
        <button class="btn solid">${L('Créer', 'Create')}</button><p class="msg"></p></form>
      <form id="lj"><h2>${L('Rejoindre', 'Join')}</h2>
        <div class="field"><label for="lcode">${L('Code reçu', 'Code you received')}</label><input id="lcode" name="code" maxlength="6" required autocapitalize="characters" spellcheck="false" class="codein"></div>
        <button class="btn solid">${L('Rejoindre', 'Join')}</button><p class="msg"></p></form>
    </div>`;
  $('#lc').onsubmit = async (e) => {
    e.preventDefault();
    try { const x = await api('leagues', { name: $('#ln').value }); go('/ligue/' + x.code + '?new=1'); } catch (err) { $('#lc .msg').textContent = err.message; }
  };
  $('#lj').onsubmit = async (e) => {
    e.preventDefault();
    const code = $('#lcode').value.trim().toUpperCase();
    try { await api('leagues/' + encodeURIComponent(code) + '/join', {}); go('/ligue/' + code); } catch (err) { $('#lj .msg').textContent = err.message; }
  };
}

const leagueNote = (l) => l.monthly
  ? L(`Les points repartent de zéro le 1er de chaque mois (ce mois-ci, à partir du ${dayName(l.from)}). Le premier à la fin du mois devient Joueur TikTok du mois et s'affiche dans le Classement.`, `Points reset on the 1st of every month (this month, from ${dayName(l.from)}). Whoever is first at the end of the month becomes TikTok player of the month and is shown in the Ranking.`)
  : L(`Les points comptent depuis la création de la ligue, le ${dayName(l.from)}.`, `Points count from the day the league was created, ${dayName(l.from)}.`);

async function pageLeague(code) {
  const l = await api('leagues/' + code);
  renderWho(l.user);
  const url = `${location.origin}/ligue/${l.code}`;
  const invite = shareBox(L(`Rejoins ma ligue « ${l.name} » sur FoOotix.com ⚽ Un joueur à deviner chaque jour, on compare nos points. Code : ${l.code}`, `Join my league “${l.name}” on FoOotix.com ⚽ A footballer to guess every day, we compare our points. Code: ${l.code}`), url, L('Inviter mes potes', 'Invite my friends'));
  const day = (x) => x.todayStatus === 'won' ? `<span class="ok">+${x.today}</span> <span class="muted">(${x.n})</span>`
    : x.todayStatus === 'gaveup' ? `<span class="muted">${L('abandon', 'gave up')}</span>`
    : x.todayStatus === 'playing' && x.n ? `<span class="muted">${L('en cours', 'playing')} (${x.n})</span>` : '<span class="muted">–</span>';
  const head = `<div class="pagehead"><div><div class="kicker">${L('Ligue', 'League')} · ${l.size} ${L('joueur', 'player')}${s_(l.size)}${l.owner ? ` · ${L('créée par', 'created by')} ${esc(l.owner)}` : ''}</div><h1>${esc(l.name)}</h1>
    <p>Code <span class="code big">${l.code}</span></p></div></div>`;
  if (!l.member) {
    app.innerHTML = `${head}
      <p>${L("On t'a invité dans cette ligue.", "You've been invited to this league.")} ${l.user ? '' : L('Crée un compte (un pseudo et un mot de passe), puis rejoins-la en un clic.', 'Create an account (a username and a password), then join in one click.')}</p>
      <p>${l.user ? `<button class="btn solid" id="join">${L('Rejoindre la ligue', 'Join the league')}</button>` : `<a class="btn solid" href="/compte?next=/ligue/${l.code}" data-link>${L('Créer un compte et rejoindre', 'Create an account and join')}</a>`}</p><p class="msg" id="jm"></p>
      ${l.table.length ? `<table class="rank"><caption>${L('En tête', 'Top')}</caption><tbody>${l.table.map((x) => `<tr><td>${x.rank}</td><td>${esc(x.username)}</td><td class="r big">${x.total} pts</td></tr>`).join('')}</tbody></table>` : ''}
      <p class="rank-note">${leagueNote(l)}</p>`;
    const j = $('#join');
    if (j) j.onclick = async () => { try { await api('leagues/' + l.code + '/join', {}); route(); } catch (err) { $('#jm').textContent = err.message; } };
    return;
  }
  const fresh = new URLSearchParams(location.search).has('new');
  app.innerHTML = `${head}
    <div class="invite ${fresh ? 'fresh' : ''}"><div class="kicker">${fresh ? L('Ta ligue est prête, invite tes potes', 'Your league is ready, invite your friends') : L('Inviter des potes', 'Invite friends')}</div>${invite}</div>
    <table class="rank"><thead><tr><th>#</th><th>${L('Joueur', 'Player')}</th><th class="r">Points</th><th class="r">${L('N°', 'No.')} ${l.number}</th><th class="r opt">${L('Série', 'Streak')}</th></tr></thead><tbody>
    ${l.table.map((x) => `<tr class="${x.me ? 'me' : ''}"><td>${x.rank}</td><td>${esc(x.username)}${x.me ? ` <span class="muted">${L('(toi)', '(you)')}</span>` : ''}</td><td class="r big">${x.total}</td><td class="r">${day(x)}</td><td class="r opt">${x.streak}</td></tr>`).join('')}
    </tbody></table>
    <p class="rank-note">${leagueNote(l)} ${L("Le chiffre entre parenthèses, c'est le nombre d'essais du jour.", "The number in brackets is today's guess count.")}</p>
    <p><a class="btn" href="/ligues" data-link>${L('Toutes mes ligues', 'All my leagues')}</a> <button class="btn" id="leave">${L('Quitter la ligue', 'Leave the league')}</button></p>`;
  $('#leave').onclick = async () => {
    if (!confirm(L(`Quitter « ${l.name} » ?`, `Leave “${l.name}”?`))) return;
    await api('leagues/' + l.code + '/leave', {}); go('/ligues');
  };
}

route().then(() => setTimeout(() => Object.keys(PREFETCH).forEach(prefetch), 300));
