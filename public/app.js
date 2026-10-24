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
const PREFETCH = { '/': ['today'], '/album': ['album'], '/collection': ['collection'], '/classement': ['leaderboard', 'me'], '/ligues': ['leagues'],  '/regles': ['me'], '/compte': ['me'] };
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
    ? `<a class="pts" href="/classement" data-link title="${L('Tes points cumulés et ta série', 'Your total points and streak')}"><b>${user.points}</b> pts · ${L('série', 'streak')} <b>${user.streak}</b></a><a class="me" href="/compte" data-link>${esc(user.username)}</a>`
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
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === p || (a.getAttribute('href') === '/' && p.startsWith('/jour/')) || (a.getAttribute('href') === '/classement' && (p === '/ligues' || p.startsWith('/ligue/'))) || (a.getAttribute('href') === '/duel' && p.startsWith('/duel'))));
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
    if (p === '/classement') return await pageRank();
    if (p === '/compte') return pageAuth();
    if (p === '/regles' || p === '/joueurs') { if (!(await pageSsr(p))) throw new Error(L('Page indisponible, réessaie.', 'Page unavailable, try again.')); return; }
    if (p === '/ligues') return await pageLeagues();
    if (p === '/duel') return await pageDuel();
    const du = p.match(/^\/duel\/([A-Za-z0-9]{5})$/);
    if (du) return await pageDuel(du[1].toUpperCase());
    const lg = p.match(/^\/ligue\/([A-Za-z0-9]{6})$/);
    if (lg) return await pageLeague(lg[1].toUpperCase());
    if (p === '/confidentialite') return pagePrivacy();
    if (p === '/mentions-legales') return pageLegal();
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
            <h1>${L('Es-tu un vrai FoOotix&nbsp;?', 'Are you a real FoOotix?')}</h1>
            <p>${st.past
              ? L(`Rattrapage du ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}&nbsp;: s'il est trouvé, il rejoint ton album, mais sans points ni série. <a href="/" data-link>Retour au joueur du jour</a>`, `Catching up on ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}: find him to add him to your album, but no points or streak. <a href="/" data-link>Back to today's player</a>`)
              : L('Un joueur, un club, une ville, un pays, un poste, une génération&nbsp;: chaque découverte remplit sa carte.', 'A player, a club, a city, a country, a position, a generation: every discovery fills in his card.')}</p>
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
        <div><dt>NAT</dt><dd>${v(c.nat?.name)}</dd></div>
        <div><dt>${L('NÉ', 'BORN')}</dt><dd>${v(c.born)}</dd></div>
        <div><dt>CLUB</dt><dd title="${esc(c.club || '')}">${v(shortClub(c.club))}</dd></div>
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
  if (justEnded && st.status === 'gaveup' && prevCard) spinReveal($('#fcard'), prevCard);
  if (justEnded && st.status === 'won') confetti();
  $('#path').innerHTML = clubPath(st.card.path, over);
  $('#packcta').innerHTML = packCta(st);
  if (justEnded && st.status === 'gaveup') $('#path').firstElementChild?.classList.add('late');
  $('#gauge').innerHTML = `<div class="big"><span class="deg" style="color:${heat(t)}">${t}°</span><span class="word">${best ? word(t) : L('À toi', 'Your turn')}</span></div>
    <div class="scale"><i style="width:${t}%;background:${heat(t)}"></i></div>
    <div class="scale-legend"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <div class="bestof">${best ? L('Elle monte à chaque piste qui resserre l’étau.', 'It rises with every clue that narrows it down.') : L('Fais un premier essai pour la remplir.', 'Make a first guess to fill it.')}</div>`;

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
      <div class="end-share"><div class="kicker">${L('Défie tes potes', 'Challenge your friends')}</div>${shareBox(resultText(st), location.origin)}</div>
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
  if (ready) {
    const title = ready > 1 ? L('2 packs à ouvrir', '2 packs to open') : p.bonus === 'ready' ? L('Pack bonus gagné !', 'Bonus pack won!') : L('Ton pack du jour t’attend', "Today's pack is waiting");
    return `<a class="packcta" href="/collection" data-link><span class="mini-pack ${!p.main ? '' : 'bonus'}"><b>FoO</b>${ready > 1 ? '<i>2</i>' : ''}</span>
      <span class="pc-t"><b>${title}</b><small>${L('5 cartes à collectionner. Plus le joueur est connu, plus sa carte est rare.', '5 cards to collect. The more famous the player, the rarer the card.')}</small></span>
      <span class="btn solid">${L('Ouvrir un pack', 'Open a pack')}</span></a>`;
  }
  if (p.bonus === 'locked' && st.status === 'playing') return `<div class="packcta off"><span class="mini-pack bonus"><b>+1</b></span>
    <span class="pc-t"><b>${L('Un pack bonus à gagner', 'A bonus pack to win')}</b><small>${L('Trouve le joueur du jour pour ouvrir un 2<sup>e</sup> pack dans ta collection.', 'Find the daily player to open a 2nd pack in your collection.')}</small></span></div>`;
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
      const st = await api('guess', { q, day: DAY });
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
  app.innerHTML = `<div id="wp"></div><p style="margin-top:18px"><a class="btn" href="/album" data-link>${L('Mon album', 'My album')}</a> <a class="btn" href="/" data-link>${L('Jouer', 'Play')}</a></p>`;
  await showWiki($('#wp'), p, head);
}

// ——— Page : album ———
async function pageAlbum() {
  const a = await api('album');
  renderWho(a.user, a.edition);
  const got = (d) => d.status === 'won' || d.status === 'late';
  const won = a.days.filter(got).length;
  const past = a.days.filter((d) => !d.today).length;
  app.innerHTML = `
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
const colCard = (c) => fifaCard({ ...c, name: cardName(c.name) }, c.rating, false, 't-' + c.tier);
const CARD_BACK = '<div class="fut back"><div class="fut-in"><b>FoO</b><span>FoOotix</span></div></div>';
const packDate = () => fmtDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }), { day: 'numeric', month: 'short' });
const nextPack = (c) => (!c.packs.main ? 'main' : c.packs.bonus === 'ready' ? 'bonus' : null);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageCollection() {
  const c = await api('collection');
  renderWho(c.user);
  drawCollection(c);
}
function drawCollection(c) {
  const total = Object.values(c.totals).reduce((a, b) => a + b, 0);
  const have = (t) => c.cards.filter((x) => x.tier === t).length;
  const nx = nextPack(c);
  app.innerHTML = `
    <div class="pagehead">
      <div><div class="kicker">${L('Un pack par jour', 'One pack a day')}</div><h1>Pack Opening</h1>
      <p>${L('Chaque jour, un pack de 5 cartes à ouvrir, et un pack bonus si tu trouves le joueur du jour. Plus un joueur est connu, plus sa carte est rare.', 'A pack of 5 cards to open every day, plus a bonus pack if you find the daily player. The more famous the player, the rarer the card.')}</p></div>
      <div class="counters">
        <div><b>${c.cards.length}</b><span>/ ${total}</span></div>
        ${TIERS.slice(0, 3).map((t) => `<div><b>${have(t)}</b><span>${TIER_NAME[t]}</span></div>`).join('')}
      </div>
    </div>
    ${c.user ? '' : `<p class="nudge" style="margin:0 0 20px">${L('Sans compte, ta collection ne vit que sur cet appareil. <a href="/compte" data-link>Crée un compte</a> pour la garder.', 'Without an account, your collection only lives on this device. <a href="/compte" data-link>Create an account</a> to keep it.')}</p>`}
    <section class="packzone" id="packzone">${nx ? packBox(nx, c) : openedBox(c)}</section>
    <section>
      <div class="colbar"><h2>${L('Mes cartes', 'My cards')}</h2>
        <div class="chips">${['all', ...TIERS].map((t) => `<button type="button" class="chip ${COL_FILTER === t ? 'on' : ''}" data-t="${t}">${t === 'all' ? L('Toutes', 'All') : TIER_NAME[t]} <span>${t === 'all' ? c.cards.length : have(t)}/${t === 'all' ? total : c.totals[t]}</span></button>`).join('')}</div>
      </div>
      <div class="cgrid" id="cgrid"></div>
    </section>
    ${adSlot('wide')}`;
  const grid = () => {
    const list = c.cards.filter((x) => COL_FILTER === 'all' || x.tier === COL_FILTER).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    $('#cgrid').innerHTML = list.length
      ? list.map((x) => `<button type="button" class="cslot" data-id="${esc(x.id)}" aria-label="${esc(x.name)}"><span class="mini">${colCard(x)}</span>${x.n > 1 ? `<span class="tag">×${x.n}</span>` : ''}</button>`).join('')
      : `<p class="empty">${c.cards.length ? L('Pas encore de carte de cette rareté.', 'No card of this rarity yet.') : L('Ouvre ton premier pack pour commencer ta collection.', 'Open your first pack to start your collection.')}</p>`;
    $('#cgrid').querySelectorAll('.cslot').forEach((b) => b.addEventListener('click', () => zoomCard(c.cards.find((x) => x.id === b.dataset.id))));
  };
  grid();
  app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    COL_FILTER = b.dataset.t;
    app.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
    grid();
  }));
  if (nx) packDrag(nx);
  else tick();
}
// une carte de la collection en grand, par-dessus la page
function zoomCard(c) {
  if (!c) return;
  const o = document.createElement('div');
  o.className = 'cardzoom';
  o.innerHTML = `<div class="cz-in">${colCard(c)}<p><b>${esc(c.name)}</b> · ${TIER_NAME[c.tier]}${c.n > 1 ? ` · ×${c.n}` : ''}</p><button type="button" class="btn">${L('Fermer', 'Close')}</button></div>`;
  const close = () => { o.remove(); document.removeEventListener('keydown', esc_); };
  const esc_ = (e) => { if (e.key === 'Escape') close(); };
  o.addEventListener('click', close);
  document.addEventListener('keydown', esc_);
  document.body.appendChild(o);
}
function oddsLine() {
  return `<p class="odds">${L('Chances par carte', 'Odds per card')} : ${['bronze', 'silver', 'gold', 'legend'].map((t) => `<span>${TIER_NAME[t]} ${ODDS[t]} %</span>`).join(' · ')}. ${L('La 5<sup>e</sup> carte est au moins Argent.', 'The 5th card is at least Silver.')}</p>`;
}
function packBox(kind, c) {
  const two = kind === 'main' && c.packs.bonus === 'ready';
  return `<div class="pack-stage">
    ${two ? `<div class="kicker">${L('2 packs à ouvrir aujourd’hui', '2 packs to open today')}</div>` : kind === 'bonus' ? `<div class="kicker">${L('Pack bonus : tu as trouvé le joueur du jour', 'Bonus pack: you found the daily player')}</div>` : ''}
    <div class="pack ${kind === 'bonus' ? 'bonus' : ''}" id="pack" role="button" tabindex="0" aria-label="${L('Ouvrir le pack', 'Open the pack')}">
      <div class="pack-body">
        <div class="pack-kick">${kind === 'bonus' ? L('Pack bonus', 'Bonus pack') : L('Pack du jour', "Today's pack")}</div>
        <div class="pack-logo">FoOotix</div>
        <div class="pack-n">5 ${L('cartes', 'cards')}</div>
        <div class="pack-foot"><span>foootix.com</span><span>${esc(packDate())}</span></div>
      </div>
      <div class="pack-top"><span>FoOotix</span></div>
    </div>
    <p class="pack-hint">${L('Glisse le pack sur le côté pour le déchirer', 'Swipe the pack sideways to tear it open')}</p>
    <button type="button" class="linkbtn" id="packbtn">${L('ou ouvre-le d’un clic', 'or open it with a click')}</button>
    ${oddsLine()}
  </div>`;
}
function openedBox(c) {
  const today = [...c.packs.mainCards, ...c.packs.bonusCards];
  return `<div class="pack-done"><div class="kicker">${L('Packs du jour ouverts', "Today's packs are open")}</div>
    <p>${L('Prochain pack dans', 'Next pack in')} <b id="cd"></b></p>
    ${c.packs.bonus === 'locked' ? `<p class="bonus-tip">${L('Trouve le joueur du jour pour gagner un pack bonus.', 'Find the daily player to win a bonus pack.')} <a href="/" data-link>${L('Jouer', 'Play')}</a></p>` : ''}</div>
    <div class="today-row">${today.map((x) => `<div class="tr-c"><span class="mini">${colCard(x)}</span><span class="tag ${x.isNew ? 'new' : ''}">${x.isNew ? L('Nouvelle', 'New') : L('Doublon', 'Duplicate')}</span></div>`).join('')}</div>`;
}

// glisser le pack : le haut se décolle et suit le doigt, puis se déchire au-delà de la moitié de la largeur
function packDrag(kind) {
  const pack = $('#pack');
  const top = $('.pack-top', pack), body = $('.pack-body', pack);
  let x0 = null, dx = 0, raf = 0, done = false;
  const paint = () => {
    raf = 0;
    const w = pack.offsetWidth, k = Math.min(1, Math.abs(dx) / (w * 0.5)), dir = Math.sign(dx) || 1;
    top.style.transformOrigin = dir > 0 ? '0 100%' : '100% 100%';
    top.style.transform = `translate(${dx * 0.7}px, ${-k * 26}px) rotate(${dir * k * -14}deg)`;
    body.style.transform = `rotate(${dir * k * 1.5}deg)`;
    if (k >= 1) open(dir);
  };
  pack.addEventListener('pointerdown', (e) => {
    if (done) return;
    x0 = e.clientX; dx = 0;
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
    x0 = null;
    pack.classList.remove('drag');
    const from = top.style.transform;
    top.style.transform = body.style.transform = '';
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
    const req = api('pack', kind === 'bonus' ? { bonus: true } : {});
    if (top.animate && !reduced()) {
      const from = top.style.transform || 'none';
      top.animate([{ transform: from }, { transform: `translate(${dir * 340}px, -140px) rotate(${dir * 50}deg)`, opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.25,.6,.4,1)', fill: 'forwards' });
      await sleep(250);
      body.animate([{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.04)', filter: 'brightness(1.4)', offset: 0.35 }, { transform: 'translateY(70px) scale(.92)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    }
    let j;
    try {
      [j] = await Promise.all([req, sleep(reduced() ? 0 : 600)]);
    } catch (e) {
      PACKING = false;
      $('#packzone').innerHTML = `<p class="msg">${esc(e.message)}</p>`;
      return;
    }
    CACHE.set('collection', { t: Date.now(), p: Promise.resolve(j), json: JSON.stringify(j) });
    revealStage(j, kind);
  }
}

// les cartes une à une : chaque clic retourne la suivante, la plus rare arrive en dernier
function revealStage(j, kind) {
  const cards = kind === 'bonus' ? j.packs.bonusCards : j.packs.mainCards;
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
    center.innerHTML = `<div class="flip r-${cards[k].tier}"><div class="flip-in"><div class="flip-back">${CARD_BACK}</div><div class="flip-front">${colCard(cards[k])}</div></div></div>`;
    tagEl.innerHTML = '';
    const f = center.firstElementChild;
    if (f.animate && !reduced()) f.animate([{ transform: 'translateY(60px) scale(.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.8,.3,1)' });
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
  const flipNormal = (f) => new Promise((r) => { f.classList.add('up'); setTimeout(r, 520); });
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
    if (last) await flipFinal(f, cards[i]); else await flipNormal(f);
    flipped = true;
    tagEl.innerHTML = tagHtml(cards[i]);
    const c = cards[i];
    msg.textContent = last
      ? (c.tier === 'legend' ? L(`Une Légende : ${c.name} !`, `A Legend: ${c.name}!`) : `${c.name} · ${TIER_NAME[c.tier]}`)
      : `${i + 1}/${cards.length} · ${c.name} · ${TIER_NAME[c.tier]}`;
    if (last) {
      PACKING = false;
      const more = kind === 'main' && j.packs.bonus === 'ready';
      $('#stageact').innerHTML = `${more ? `<button type="button" class="btn solid" id="nextpack">${L('Ouvrir le pack bonus', 'Open the bonus pack')}</button>` : ''}<button type="button" class="btn ${more ? '' : 'solid'}" id="tocol">${L('Voir ma collection', 'See my collection')}</button>`;
      const redraw = () => { const y = window.scrollY; drawCollection(j); window.scrollTo(0, y); };
      $('#tocol').onclick = () => { redraw(); $('#cgrid')?.scrollIntoView({ behavior: 'smooth' }); };
      if (more) $('#nextpack').onclick = redraw;
    }
    busy = false;
  };
  zone.querySelector('.stage').addEventListener('click', (e) => { if (!e.target.closest('.stage-act')) step(); });
  // la première carte sort du pack, face cachée
  i = 0;
  put(0);
  center.firstElementChild.style.cursor = 'pointer';
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
      <div class="kicker">${L('1 contre 1 · 90 secondes', '1 vs 1 · 90 seconds')}</div>
      <h1>Duel</h1>
      <p class="dl-p">${L('Le même joueur mystère pour vous deux, pas celui du jour. Posez vos questions, proposez des noms : le premier qui le trouve gagne. Personne au bout de 90 secondes ? Match nul.', 'The same mystery player for both of you, not the daily one. Ask questions, guess names: first to find him wins. Nobody after 90 seconds? It’s a draw.')}</p>
      ${err ? `<p class="msg">${esc(err)}</p>` : ''}
      <div class="dl-act">
        <button class="btn solid big" id="d-rand">${L('Adversaire au hasard', 'Random opponent')}</button>
        <button class="btn big" id="d-friend">${L('Défier un pote', 'Challenge a friend')}</button>
        <button class="btn big" id="d-bot">${L('Contre le robot', 'Against the bot')}</button>
      </div>
    </div>`;
  $('#d-rand').onclick = async () => duelStart(await fetchJSON('duel/queue', {}), 'random');
  $('#d-friend').onclick = async () => duelStart(await fetchJSON('duel/friend', {}), 'friend');
  $('#d-bot').onclick = async () => duelStart(await fetchJSON('duel/bot', {}), 'bot');
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
      <h1>${L('Envoie-lui ce lien', 'Send them this link')}</h1>
      <div class="dw-code">${esc(v.code)}</div>
      <p>${L('Le duel démarre dès qu’il arrive.', 'The duel starts as soon as they join.')}</p>
      ${shareBox(L('Je te défie en duel sur FoOotix : le premier qui trouve le joueur gagne ⚔️', 'I challenge you to a FoOotix duel: first to find the player wins ⚔️'), link, L('Envoyer le lien', 'Send the link'))}
      <p class="dw-link">${esc(link)}</p>
      <div class="dw-dots"><i></i><i></i><i></i></div>
      <button class="linkbtn" id="d-cancel">${L('Annuler', 'Cancel')}</button>
    </div>`;
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
        <div class="dclock"><b id="d-clock">1:30</b><div class="dtime"><i id="d-time"></i></div></div>
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
      const r = await fetchJSON(`duel/${DU.id}/guess`, { q });
      input.value = '';
      msg.textContent = r.dup ? L(`Déjà proposé (essai n° ${r.dup}).`, `Already guessed (guess #${r.dup}).`) : '';
      duelUpdate(r);
      if (DU.phase === 'playing') input.focus();
    } catch (err) { msg.textContent = err.message; input.select(); }
  });
  input.focus();
  // chrono : la barre fond, et vire au rouge dans les 10 dernières secondes
  DU.clock = setInterval(() => {
    const cur = DU.v;
    const left = Math.max(0, cur.endAt - dnow());
    const el = $('#d-clock');
    if (!el) return;
    const s = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('#d-time').style.width = (left / cur.duration) * 100 + '%';
    $('.dclock').classList.toggle('hurry', s <= 10);
  }, 100);
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
  const word = v.result === 'win' ? L('Victoire', 'Victory') : v.result === 'lose' ? L('Défaite', 'Defeat') : L('Temps écoulé', "Time's up");
  const secs = Math.round((v.endAt - v.startAt) / 1000);
  const sub = v.result === 'win' ? L(`Trouvé en ${secs} secondes et ${v.me.guesses.length} essais.`, `Found in ${secs} seconds and ${v.me.guesses.length} guesses.`)
    : v.result === 'lose' ? L(`${v.opp.name} l’a trouvé en ${secs} secondes.`, `${v.opp.name} found him in ${secs} seconds.`)
      : L('Personne ne l’a trouvé : match nul.', 'Nobody found him: it’s a draw.');
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
async function pageRank() {
  const [r, me] = await Promise.all([api('leaderboard'), api('me')]);
  renderWho(me.user, me);
  const empty = (cols) => `<tr><td colspan="${cols}" class="muted">${L("Personne pour l'instant. Trouve le joueur du jour avec un compte pour ouvrir le bal.", "Nobody yet. Find today's player with an account to get things started.")}</td></tr>`;
  const row = (x, cells) => `<tr class="${x.me ? 'me' : ''} ${x.gap ? 'gap' : ''}"><td>${x.rank}</td><td>${esc(x.username)}${x.me ? ` <span class="muted">${L('(toi)', '(you)')}</span>` : ''}</td>${cells}</tr>`;
  const podium = (list, val) => list.length ? `<div class="podium">${list.slice(0, 3).map((x, i) => `<div class="p${i + 1}"><div class="pl">${ord(i + 1)}</div><div class="nm">${esc(x.username)}</div><div class="pt">${val(x)}</div></div>`).join('')}</div>` : '';
  const tabs = {
    points: () => `${podium(r.points, (x) => `${x.total} pts`)}
      <table class="rank"><thead><tr><th>#</th><th>${L('Joueur', 'Player')}</th><th class="r">Points</th><th class="r opt">${L("Aujourd'hui", 'Today')}</th><th class="r opt">${L('Trouvés', 'Found')}</th><th class="r opt">${L('Série', 'Streak')}</th></tr></thead><tbody>
      ${r.points.length ? r.points.map((x) => row(x, `<td class="r big">${x.total}</td><td class="r opt">${x.today ? '+' + x.today : '–'}</td><td class="r opt">${x.found}</td><td class="r opt">${x.streak}</td>`)).join('') : empty(6)}</tbody></table>
      <p class="rank-note">${L("Les points s'additionnent jour après jour. Moins tu poses de questions, plus tu marques, et un joueur peu connu rapporte jusqu'à deux fois plus qu'une star. Chaque indice retire 10 %.", 'Points add up day after day. The fewer questions you ask, the more you score, and a little-known player is worth up to twice as much as a star. Each hint costs 10%.')}</p>`,
    today: () => `${podium(r.today, (x) => `${x.pts} pts`)}
      <table class="rank"><thead><tr><th>#</th><th>${L('Joueur', 'Player')}</th><th class="r">Points</th><th class="r">${L('Essais', 'Guesses')}</th></tr></thead><tbody>
      ${r.today.length ? r.today.map((x) => row(x, `<td class="r big">${x.pts}</td><td class="r">${x.n}</td>`)).join('') : empty(4)}</tbody></table>`,
    streaks: () => `${podium(r.streaks, (x) => `${x.streak} ${L('jour', 'day')}${s_(x.streak)}`)}
      <div class="rank-wrap"><table class="rank"><caption>${L('Séries en cours', 'Current streaks')}</caption><thead><tr><th>#</th><th>${L('Joueur', 'Player')}</th><th class="r">${L('Jours', 'Days')}</th></tr></thead><tbody>
      ${r.streaks.length ? r.streaks.map((x) => row(x, `<td class="r big">${x.streak}</td>`)).join('') : empty(3)}</tbody></table>
      <table class="rank"><caption>Records</caption><thead><tr><th>#</th><th>${L('Joueur', 'Player')}</th><th class="r">${L('Jours', 'Days')}</th></tr></thead><tbody>
      ${r.records.length ? r.records.map((x) => row(x, `<td class="r">${x.best}</td>`)).join('') : empty(3)}</tbody></table></div>
      <p class="rank-note">${L("Une série, c'est le nombre de jours d'affilée où tu as trouvé le joueur. Un jour sans, ou un abandon, et elle repart de zéro.", 'A streak is the number of days in a row you found the player. Miss a day, or give up, and it resets to zero.')}</p>`,
  };
  const names = { points: L('Général', 'Overall'), today: L("Aujourd'hui", 'Today'), streaks: L('Séries', 'Streaks') };
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">${L(`${r.players} joueur${s_(r.players)} classé${s_(r.players)}`, `${r.players} ranked player${s_(r.players)}`)}</div><h1>${L('Classement', 'Ranking')}</h1><p><a href="/ligues" data-link>${L('Mes ligues entre potes', 'My private leagues')}</a> · ${me.user ? L(`Tu as <b>${me.user.points} points</b> et une série de <b>${me.user.streak} jour${s_(me.user.streak)}</b>.`, `You have <b>${me.user.points} points</b> and a <b>${me.user.streak}-day</b> streak.`) : L(`Seuls les joueurs avec un compte sont classés. <a href="/compte" data-link>Crée le tien</a>.`, `Only players with an account are ranked. <a href="/compte" data-link>Create yours</a>.`)}</p></div></div>
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
      try { await api(path, Object.fromEntries(new FormData(f))); go(nextPath()); } catch (err) { $('.msg', f).textContent = err.message; }
    };
  }
}

// ——— Page : règles ———
// règles, archives, fiches : pages écrites par le serveur. On garde celle reçue au chargement, sinon on la redemande.
const TITLE = L('FoOotix · le joueur mystère du jour', 'FoOotix · the daily mystery footballer');
async function pageSsr(p) {
  api('me').then((m) => renderWho(m.user, m), () => {});
  if (p === SSR0.path && SSR0.html.trim()) { app.innerHTML = SSR0.html; document.title = SSR0.title; return true; }
  const r = await fetch(p, { headers: { Accept: 'text/html' } }).catch(() => null);
  if (!r || !r.ok) return false;
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  const m = doc.querySelector('#app');
  if (!m || !m.innerHTML.trim() || p !== location.pathname) return false;
  app.innerHTML = m.innerHTML;
  document.title = doc.title;
  return true;
}

// ——— Pages : mentions légales et confidentialité ———
const todo = (v, what) => v ? esc(v) : `<mark>${what} ${L('à compléter', 'to be filled in')}</mark>`;
const contact = () => CFG.contact
  ? (CFG.contact.includes('@') ? `<a href="mailto:${esc(CFG.contact)}">${esc(CFG.contact)}</a>` : esc(CFG.contact))
  : todo('', L('Adresse e-mail de contact', 'Contact email address'));
const HOST = `Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, ${L('États-Unis', 'USA')} (render.com)`;

function pageLegal() {
  api('me').then((m) => renderWho(m.user, m));
  app.innerHTML = EN ? `
    <div class="pagehead"><div><div class="kicker">Who's behind FoOotix</div><h1>Legal notice</h1></div></div>
    <div class="prose">
      <h2>Publisher</h2>
      <p>${todo(CFG.owner, 'Publisher name')}<br>${todo(CFG.address, 'Postal address')}<br>Contact: ${contact()}</p>
      <p>Publication director: ${todo(CFG.owner, 'Name')}.</p>
      <h2>Host</h2>
      <p>${HOST}.</p>
      <h2>Content</h2>
      <p>Player profiles (clubs, dates, positions, nationalities) come from <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>, under the CC0 licence. Summaries and anecdotes come from <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>, under the <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> licence, and may be reused under the same terms. Photos come from Wikimedia Commons; the author and licence of each one are listed on its Commons page.</p>
      <p>Club names and crests are trademarks of their owners. They are only used to identify the clubs where the players played. FoOotix is not affiliated with any club or league, nor with FIFA, UEFA or any football federation.</p>
      <p>Spotted a mistake, or a crest or photo that should be removed? Write to ${contact()}, we'll fix it quickly.</p>
    </div>` : `
    <div class="pagehead"><div><div class="kicker">Qui est derrière FoOotix</div><h1>Mentions légales</h1></div></div>
    <div class="prose">
      <h2>Éditeur</h2>
      <p>${todo(CFG.owner, 'Nom de l’éditeur')}<br>${todo(CFG.address, 'Adresse postale')}<br>Contact&nbsp;: ${contact()}</p>
      <p>Directeur de la publication&nbsp;: ${todo(CFG.owner, 'Nom')}.</p>
      <h2>Hébergeur</h2>
      <p>${HOST}.</p>
      <h2>Contenus</h2>
      <p>Les fiches des joueurs (clubs, dates, postes, nationalités) viennent de <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>, sous licence CC0. Les résumés et anecdotes viennent de <a href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a>, sous licence <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr" target="_blank" rel="noopener">CC BY-SA 4.0</a>, et peuvent être réutilisés aux mêmes conditions. Les photos viennent de Wikimedia Commons&nbsp;; l’auteur et la licence de chacune sont indiqués sur sa page Commons.</p>
      <p>Les noms et logos des clubs sont des marques appartenant à leurs propriétaires. Ils servent uniquement à identifier les clubs où les joueurs ont évolué. FoOotix n’est lié à aucun club, aucune ligue, ni à la FIFA, l’UEFA ou la FFF.</p>
      <p>Une erreur, un logo ou une photo à retirer&nbsp;? Écris à ${contact()}, on corrige rapidement.</p>
    </div>`;
}

function pagePrivacy() {
  api('me').then((m) => renderWho(m.user, m));
  const ads = !!CFG.ads;
  app.innerHTML = EN ? `
    <div class="pagehead"><div><div class="kicker">Your data</div><h1>Privacy and cookies</h1><p>What FoOotix keeps about you, why, and how to erase it.</p></div></div>
    <div class="prose">
      <h2>Data controller</h2>
      <p>${todo(CFG.owner, 'Publisher name')}, reachable at ${contact()}.</p>
      <h2>What the site stores</h2>
      <table>
        <tr><th>Data</th><th>Why</th><th>How long</th></tr>
        <tr><td>Username and password (hashed, unreadable even to us)</td><td>Your account</td><td>Until you delete it</td></tr>
        <tr><td>Your games: guesses, hints, result, points</td><td>Game, album, streak, ranking</td><td>As long as the account exists</td></tr>
        <tr><td>IP address</td><td>Limit login attempts</td><td>10 minutes, in memory</td></tr>
        <tr><td>Pages viewed, site you came from, mobile or computer</td><td>Count visits, with no third-party tool and no IP address</td><td>Daily totals, with nothing that identifies you</td></tr>
      </table>
      <p>No email address, no name, nothing is sold. Your username and points appear in the public ranking.</p>
      <h2>Site cookies</h2>
      <table>
        <tr><th>Name</th><th>Purpose</th><th>Duration</th></tr>
        <tr><td><code>aid</code></td><td>Find your game of the day if you play without an account</td><td>13 months</td></tr>
        <tr><td><code>sid</code></td><td>Keep you logged in</td><td>13 months, or until you log out</td></tr>
        <tr><td><code>lang</code></td><td>Remember the language you chose</td><td>1 year</td></tr>
        <tr><td><code>theme</code> (local storage)</td><td>Remember light or dark mode</td><td>Until you clear your browser</td></tr>
      </table>
      <p>These are needed for the game to work: they are not used for ads or tracking, and the law does not require consent for them.</p>
      <h2>Advertising</h2>
      ${ads ? `<p>FoOotix is funded by Google AdSense ads. Google and its partners may set cookies to show ads, personalise them and measure their performance. They are only set with your consent, asked on your first visit. If you refuse, you still see ads, but not personalised ones.</p>
      <p>You can change your mind at any time: <a href="#" id="cookies2">manage cookies</a>. Learn more: <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses data from partner sites</a>.</p>`
      : `<p>There are no ads on FoOotix for now. If they come, this page will be updated and your consent will be asked before any advertising cookie.</p>`}
      <h2>Fonts and images</h2>
      <p>Fonts come from Google Fonts, flags from flagcdn.com, photos and crests from Wikimedia. These services see your IP address when your browser loads their files, without cookies.</p>
      <h2>Hosting</h2>
      <p>The site is hosted by ${HOST}. Accounts and games are stored with Neon, Inc. (neon.tech), in a data centre in the same region. Data may therefore be processed in the United States, under the safeguards provided by the GDPR for such transfers.</p>
      <h2>Your rights</h2>
      <p>You can access, correct or erase your data, or object to its use. The easiest way: delete your account from the <a href="/compte" data-link>Account</a> page, everything is erased at once. For anything else, write to ${contact()}. If you think your rights are not respected, you can complain to the <a href="https://www.cnil.fr/en/complaints" target="_blank" rel="noopener">CNIL</a> (the French data protection authority).</p>
    </div>` : `
    <div class="pagehead"><div><div class="kicker">Tes données</div><h1>Confidentialité et cookies</h1><p>Ce que FoOotix garde sur toi, pourquoi, et comment l’effacer.</p></div></div>
    <div class="prose">
      <h2>Responsable</h2>
      <p>${todo(CFG.owner, 'Nom de l’éditeur')}, joignable à ${contact()}.</p>
      <h2>Ce que le site enregistre</h2>
      <table>
        <tr><th>Donnée</th><th>Pourquoi</th><th>Durée</th></tr>
        <tr><td>Pseudo et mot de passe (chiffré, illisible même pour nous)</td><td>Ton compte</td><td>Jusqu’à ce que tu le supprimes</td></tr>
        <tr><td>Tes parties&nbsp;: propositions, indices, résultat, points</td><td>Jeu, album, série, classement</td><td>Tant que le compte existe</td></tr>
        <tr><td>Adresse IP</td><td>Limiter les tentatives de connexion</td><td>10 minutes, en mémoire</td></tr>
        <tr><td>Pages vues, site d’où tu arrives, mobile ou ordinateur</td><td>Compter les visites, sans outil extérieur ni adresse IP</td><td>Chiffres par jour, sans rien qui t’identifie</td></tr>
      </table>
      <p>Pas d’adresse e-mail, pas de nom, rien n’est revendu. Ton pseudo et tes points apparaissent dans le classement public.</p>
      <h2>Cookies du site</h2>
      <table>
        <tr><th>Nom</th><th>Rôle</th><th>Durée</th></tr>
        <tr><td><code>aid</code></td><td>Retrouver ta partie du jour si tu joues sans compte</td><td>13 mois</td></tr>
        <tr><td><code>sid</code></td><td>Te garder connecté</td><td>13 mois, ou jusqu’à la déconnexion</td></tr>
        <tr><td><code>lang</code></td><td>Retenir la langue choisie</td><td>1 an</td></tr>
        <tr><td><code>theme</code> (stockage local)</td><td>Retenir le mode clair ou sombre</td><td>Jusqu’à ce que tu vides ton navigateur</td></tr>
      </table>
      <p>Ces cookies sont nécessaires au fonctionnement du jeu&nbsp;: ils ne servent ni à la pub ni au suivi, et la loi ne demande pas de consentement pour eux.</p>
      <h2>Publicité</h2>
      ${ads ? `<p>FoOotix est financé par la publicité de Google AdSense. Google et ses partenaires peuvent déposer des cookies pour afficher des annonces, les personnaliser et mesurer leur efficacité. Ils ne sont déposés qu’avec ton accord, demandé à ta première visite. Si tu refuses, tu vois quand même des annonces, mais non personnalisées.</p>
      <p>Tu peux changer d’avis à tout moment&nbsp;: <a href="#" id="cookies2">gérer mes cookies</a>. Pour en savoir plus&nbsp;: <a href="https://policies.google.com/technologies/partner-sites?hl=fr" target="_blank" rel="noopener">comment Google utilise les données des sites partenaires</a>.</p>`
      : `<p>Il n’y a pas de publicité sur FoOotix pour l’instant. Si elle arrive, cette page sera mise à jour et ton accord sera demandé avant tout cookie publicitaire.</p>`}
      <h2>Polices et images</h2>
      <p>Les polices viennent de Google Fonts, les drapeaux de flagcdn.com, les photos et logos de Wikimedia. Ces services voient ton adresse IP quand ton navigateur charge leurs fichiers, sans cookie.</p>
      <h2>Hébergement</h2>
      <p>Le site est hébergé par ${HOST}. Les comptes et les parties sont stockés chez Neon, Inc. (neon.tech), dans un centre de données de la même région. Les données peuvent donc être traitées aux États-Unis, dans le cadre des garanties prévues par le RGPD pour ces transferts.</p>
      <h2>Tes droits</h2>
      <p>Tu peux consulter, corriger ou effacer tes données, ou t’opposer à leur utilisation. Le plus simple&nbsp;: supprimer ton compte depuis la page <a href="/compte" data-link>Compte</a>, tout est effacé d’un coup. Pour le reste, écris à ${contact()}. Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">CNIL</a>.</p>
    </div>`;
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
    <p>${L("Un classement rien qu'à vous, avec les points cumulés de chacun.", "A ranking just for you, with everyone's total points.")}</p></div></div>
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
      ${l.table.length ? `<table class="rank"><caption>${L('En tête', 'Top')}</caption><tbody>${l.table.map((x) => `<tr><td>${x.rank}</td><td>${esc(x.username)}</td><td class="r big">${x.total} pts</td></tr>`).join('')}</tbody></table>` : ''}`;
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
    <p class="rank-note">${L("Les points sont ceux du classement général : chaque joueur trouvé rapporte, même avant d'avoir rejoint la ligue. Le chiffre entre parenthèses, c'est le nombre d'essais du jour.", "Points come from the overall ranking: every player found counts, even before joining the league. The number in brackets is today's guess count.")}</p>
    <p><a class="btn" href="/ligues" data-link>${L('Toutes mes ligues', 'All my leagues')}</a> <button class="btn" id="leave">${L('Quitter la ligue', 'Leave the league')}</button></p>`;
  $('#leave').onclick = async () => {
    if (!confirm(L(`Quitter « ${l.name} » ?`, `Leave “${l.name}”?`))) return;
    await api('leagues/' + l.code + '/leave', {}); go('/ligues');
  };
}

route().then(() => setTimeout(() => Object.keys(PREFETCH).forEach(prefetch), 300));
