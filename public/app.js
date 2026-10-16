'use strict';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

async function fetchJSON(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur réseau');
  return j;
}
// Les pages déjà vues s'affichent tout de suite depuis la mémoire, puis se mettent à jour en fond.
// Toute action (essai, connexion…) vide la mémoire pour ne jamais montrer un état périmé.
const CACHE = new Map();
function api(path, body) {
  if (body) { CACHE.clear(); return fetchJSON(path, body); }
  const c = CACHE.get(path);
  if (c && (c.pending || Date.now() - c.t < 60000)) {
    if (!c.pending && !c.refreshing) refresh(path);
    return c.p;
  }
  return refresh(path);
}
function refresh(path) {
  const e = { t: Date.now(), pending: true };
  e.p = fetchJSON(path).then((j) => { e.pending = false; e.t = Date.now(); return j; }, (err) => { CACHE.delete(path); throw err; });
  const old = CACHE.get(path);
  // tant que la nouvelle version n'est pas là, on garde l'ancienne pour un affichage instantané
  if (old && !old.pending) old.refreshing = true;
  if (old && !old.pending) e.p.then(() => CACHE.set(path, e), () => {}); else CACHE.set(path, e);
  return e.p;
}
// charge d'avance ce qu'affiche un onglet, dès qu'on le survole ou qu'on pose le doigt dessus
const PREFETCH = { '/': ['today'], '/album': ['album'], '/classement': ['leaderboard', 'me'], '/ligues': ['leagues'], '/regles': ['me'], '/compte': ['me'] };
function prefetch(href) { (PREFETCH[href] || []).forEach((p) => api(p).catch(() => {})); }
['mouseover', 'touchstart'].forEach((ev) => document.addEventListener(ev, (e) => {
  const a = e.target.closest && e.target.closest('a[data-link]');
  if (a) prefetch(a.getAttribute('href'));
}, { passive: true }));

const fmtDate = (d, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', ...opts });

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
  if (t >= 100) return 'Trouvé';
  if (t >= 85) return 'Tout proche';
  if (t >= 65) return 'Brûlant';
  if (t >= 45) return 'Chaud';
  if (t >= 25) return 'Tiède';
  if (t >= 10) return 'Froid';
  return 'Glacial';
}

// ——— En-tête ———
let ME = null;
function renderWho(user, ed) {
  ME = user;
  if (ed) renderEdition(ed);
  $('#who').innerHTML = user
    ? `<a class="pts" href="/classement" data-link title="Tes points cumulés et ta série"><b>${user.points}</b> pts · série <b>${user.streak}</b></a><a class="me" href="/compte" data-link>${esc(user.username)}</a>`
    : `<a class="login" href="/compte" data-link>Se connecter</a>`;
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await api('logout', {}); go('/'); };
}
function renderEdition(st) {
  $('#edition').innerHTML = `<b>N° ${st.number}</b> · ${esc(fmtDate(st.day, { day: 'numeric', month: 'long' }))}`;
}

// ——— Publicité ———
// Rien ne s'affiche tant que le compte AdSense n'est pas branché (variables sur Render).
// Le bandeau de consentement est celui de Google (« Confidentialité et messages » dans AdSense),
// il bloque les cookies publicitaires tant que le visiteur n'a pas choisi.
const CFG = window.FOOTIX || {};
function adSlot(where) {
  if (CFG.preview) return `<div class="ad ad-${where}"><span>Publicité</span><div class="ad-fake"></div></div>`;
  if (!CFG.ads || !CFG.slot) return '';
  return `<div class="ad ad-${where}"><span>Publicité</span><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(CFG.ads)}" data-ad-slot="${esc(CFG.slot)}" data-ad-format="auto" data-full-width-responsive="true"></ins></div>`;
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

// ——— Routeur ———
function go(path) { history.pushState({}, '', path); route(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', route);

// compteur de visites maison (voir /stats) : la page vue, et d'où vient le visiteur à son arrivée
let REF = document.referrer;
function hit(p) {
  try { fetch('/api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p, r: REF }), keepalive: true }).catch(() => {}); } catch {}
  REF = '';
}

async function route() {
  const p = location.pathname;
  hit(p);
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === p || (a.getAttribute('href') === '/ligues' && p.startsWith('/ligue/'))));
  window.scrollTo(0, 0);
  clearInterval(window.__tick);
  try {
    if (p === '/') return await pageGame();
    if (p === '/album') return await pageAlbum();
    if (p === '/classement') return await pageRank();
    if (p === '/compte') return pageAuth();
    if (p === '/regles') return pageRules();
    if (p === '/ligues') return await pageLeagues();
    const lg = p.match(/^\/ligue\/([A-Za-z0-9]{6})$/);
    if (lg) return await pageLeague(lg[1].toUpperCase());
    if (p === '/confidentialite') return pagePrivacy();
    if (p === '/mentions-legales') return pageLegal();
    const m = p.match(/^\/joueur\/([\w-]+)$/);
    if (m) return await pagePlayer(m[1]);
    app.innerHTML = '<p>Page introuvable. <a href="/" data-link>Retour au jeu</a></p>';
  } catch (e) {
    app.innerHTML = `<p class="msg">${esc(e.message)}</p>`;
  } finally {
    fillAds();
  }
}


// ——— Page : jeu ———
let ST = null;
let PLAYING = false;

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
    b.innerHTML = `${light ? '◐' : '◑'} <span>${light ? 'Mode sombre' : 'Mode clair'}</span>`;
    b.title = light ? 'Passer en mode sombre' : 'Passer en mode clair';
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
async function pageGame() {
  const st = await api('today');
  ST = st;
  renderWho(st.user);
  renderEdition(st);
  app.innerHTML = `
    <div class="game">
      <div class="left">
        <div class="hero">
          <div id="banner"></div>
          <div class="intro">
            <div class="kicker">Le joueur mystère n° ${st.number}</div>
            <h1>Qui se cache derrière le maillot&nbsp;?</h1>
            <p>Un joueur, un club, une ville, un pays, un poste, une génération&nbsp;: chaque découverte remplit sa carte.</p>
          </div>
          <div class="search" id="search">
            <form autocomplete="off">
              <input id="q" placeholder="Écris ici" aria-label="Ta proposition" spellcheck="false" autocapitalize="off" autocorrect="off">
              <button>Tenter</button>
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
        <div id="reveal"></div>
        <details class="board-wrap" id="bw" open><summary id="bws" style="display:none"></summary><table class="board" id="board"></table></details>
        ${st.user ? '' : `<div class="nudge">Tu joues sans compte. <a href="/compte" data-link>Crée un compte</a> pour garder ta série et remplir ton album, ta partie du jour sera conservée.</div>`}
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
    <div class="path-h"><span>Son parcours</span><span>${found}/${path.length} club${path.length > 1 ? 's' : ''}</span></div>
    <ol>${path.map((c, i) => `<li>${i ? ARROW : ''}` + (c
      ? `<div class="club on${c.logo && /white|blanc|bianco|weiss|negativ|inverted/i.test(decodeURIComponent(c.logo)) ? ' dk' : ''}" title="${esc(c.name)}"><span class="crest">${crest(c)}</span><span class="cn">${esc(shortClub(c.name))}</span></div></li>`
      : `<div class="club" title="Club n°${i + 1}, pas encore trouvé"><span class="crest"><span class="q">?</span></span><span class="cn">${i + 1}<sup>${i ? 'e' : 'er'}</sup> club</span></div></li>`)).join('')}</ol>
    ${found || over ? '' : '<p class="path-tip">Chaque club trouvé prend sa place, dans l\'ordre de sa carrière.</p>'}
  </div>`;
}
function fifaCard(c, rating, found) {
  const v = (x, ph = '?') => (x == null || x === '' ? `<span class="ph">${ph}</span>` : esc(x));
  const flag = c.nat && c.nat.iso ? `<img src="https://flagcdn.com/w80/${esc(c.nat.iso)}.png" alt="${esc(c.nat.iso.toUpperCase())}" title="${esc(c.nat.name)}" onerror="this.replaceWith(this.alt)">` : '<span class="ph box">?</span>';
  return `<div class="fut ${found ? 'done' : ''}">
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
        <div><dt>NÉ</dt><dd>${v(c.born)}</dd></div>
        <div><dt>CLUB</dt><dd title="${esc(c.club || '')}">${v(shortClub(c.club))}</dd></div>
        <div><dt>CHAMP</dt><dd>${v(c.leagues.join(' '))}</dd></div>
        <div><dt>CONT</dt><dd>${v(c.cont)}</dd></div>
        <div><dt>STATUT</dt><dd>${v(c.status)}</dd></div>
      </dl>
      <div class="fut-bo">Ballon d'or : ${c.bo === null ? '<span class="ph">?</span>' : c.bo ? 'oui' : 'non'}</div>
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
  if (justEnded && st.status === 'gaveup') $('#path').firstElementChild?.classList.add('late');
  $('#gauge').innerHTML = `<div class="big"><span class="deg" style="color:${heat(t)}">${t}°</span><span class="word">${best ? word(t) : 'À toi'}</span></div>
    <div class="scale"><i style="width:${t}%;background:${heat(t)}"></i></div>
    <div class="scale-legend"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <div class="bestof">${best ? 'Elle monte à chaque piste qui resserre l’étau.' : 'Fais un premier essai pour la remplir.'}</div>`;

  // bannière de fin + page Wikipédia
  if (over) {
    const a = st.answer;
    const n = st.guesses.length;
    const won = st.status === 'won';
    $('#banner').innerHTML = `<div class="end ${won ? '' : 'lost'} ${justEnded && !won ? 'late' : ''}">
      <div class="kicker">Le joueur mystère n° ${st.number}</div>
      <h1><span>Le joueur du jour est</span> ${esc(a.name)}</h1>
      <p>${won
        ? `Trouvé en ${n} essai${n > 1 ? 's' : ''}${st.hints.length ? ` et ${st.hints.length} indice${st.hints.length > 1 ? 's' : ''}` : ''}. Tu es ${st.rank === 1 ? 'le premier' : 'le ' + st.rank + '<sup>e</sup>'} à le trouver aujourd'hui.`
        : `Tu as abandonné : il ne rejoindra pas ton album, et pas de points aujourd'hui.`}</p>
      ${won && st.score ? `<div class="scorebox"><span class="pts">+${st.score.points}</span><span class="det">points · ${st.score.guesses} essai${st.score.guesses > 1 ? 's' : ''}${st.score.hints ? `, ${st.score.hints} indice${st.score.hints > 1 ? 's' : ''}` : ''}<br>rareté ${'★'.repeat(st.score.stars)}${'☆'.repeat(5 - st.score.stars)} (×${String(st.score.mult).replace('.', ',')})${st.user ? '' : ' · <a href="/compte" data-link>crée un compte</a> pour les garder'}</span></div>` : ''}
      <div class="end-share"><div class="kicker">Défie tes potes</div>${shareBox(resultText(st), location.origin)}</div>
      <div class="end-act"><a class="btn" href="/ligues" data-link>Mes ligues</a><a class="btn" href="/album" data-link>Mon album</a><span class="muted">Prochain joueur dans <span class="countdown" id="cd"></span></span></div>
    </div>`;
    tick();
    const rv = $('#reveal');
    if (!rv.dataset.done) { rv.dataset.done = 1; showWiki(rv, a); }
  } else $('#banner').innerHTML = '';

  if (over && !$('#bw').dataset.closed) {
    $('#bw').dataset.closed = 1; $('#bw').open = false;
    $('#bws').style.display = ''; $('#bws').textContent = `Tes essais (${st.guesses.length})`;
  }
  // tableau des essais : le dernier en haut, puis du plus chaud au plus froid
  const rows = [...st.guesses].sort((a, b) => b.temp - a.temp || b.n - a.n);
  const last = st.guesses.find((g) => g.n === (lastN || st.guesses.length));
  const row = (g, cls = '') => `<tr class="${cls}">
      <td class="n">${g.n}</td>
      <td class="lbl">${esc(g.label)}${g.type === 'clue' ? `<small>${esc(g.cat)}</small>` : ''}
        <div class="tags">${g.type === 'clue'
          ? `<span class="tag ${g.yes ? 'yes' : 'no'}">${g.yes ? 'Oui' : 'Non'}</span>`
          : g.tags.map((t) => `<span class="tag ${t.ok ? 'ok' : t.half ? 'half' : ''}">${t.dir === 'up' ? '↑ ' : t.dir === 'down' ? '↓ ' : ''}${esc(t.t)}</span>`).join('')}</div></td>
      <td class="t" style="color:${heat(g.temp)}">${g.temp}°</td>
      <td class="bar"><div class="minibar"><i style="width:${g.temp}%;background:${heat(g.temp)}"></i></div></td>
    </tr>`;
  $('#lastg').innerHTML = last && !over
    ? `<span class="lg-n">Essai ${last.n}</span><b>${esc(last.label)}</b><span class="lg-t" style="color:${heat(last.temp)}">${last.temp}°</span>${last.type === 'clue'
        ? `<span class="tag ${last.yes ? 'yes' : 'no'}">${last.yes ? 'Oui' : 'Non'}</span>`
        : last.tags.map((t) => `<span class="tag ${t.ok ? 'ok' : t.half ? 'half' : ''}">${t.dir === 'up' ? '↑ ' : t.dir === 'down' ? '↓ ' : ''}${esc(t.t)}</span>`).join('')}`
    : '';
  $('#board').innerHTML = st.guesses.length
    ? `<thead><tr><th>N°</th><th>Proposition</th><th style="text-align:right">Temp.</th><th class="bar"></th></tr></thead><tbody>
       ${rows.map((g) => row(g, last && !over && g.n === last.n ? 'last' : '')).join('')}</tbody>`
    : '';

  // ce que tu sais
  const clues = st.guesses.filter((g) => g.type === 'clue');
  $('#facts').innerHTML = `<h3>Ce que tu sais</h3>` + (clues.length
    ? `<ul class="facts">${[...clues].sort((a, b) => b.yes - a.yes).map((g) => `<li class="${g.yes ? '' : 'no'}"><span>${esc(g.label)}</span><span class="${g.yes ? 'y' : 'nn'}">${g.yes ? 'OUI' : 'non'}</span></li>`).join('')}</ul>`
    : `<p class="muted" style="font-size:14px;margin:0">Rien encore. Tape « Ligue 1 », « Brésil » ou « gardien » pour poser une question.</p>`);

  // indices
  const n = st.guesses.length;
  $('#hints').innerHTML = `<h3>Indices</h3>
    ${st.hints.length ? `<ol>${st.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ol>` : ''}
    ${over ? '' : st.hintReady
      ? `<button class="btn" id="hint">Révéler un indice</button>`
      : st.nextHintAt ? `<p class="muted" style="font-size:14px;margin:0 0 10px">Prochain indice après ${st.nextHintAt} essais (encore ${st.nextHintAt - n}).</p>` : ''}
    ${over ? '' : `<p style="margin:12px 0 0"><button class="linkbtn muted" id="giveup">Abandonner et voir la réponse</button></p>`}`;
  const h = $('#hint');
  if (h) h.onclick = async () => { ST = await api('hint', {}); drawGame(); };
  const gu = $('#giveup');
  if (gu) gu.onclick = async () => {
    if (!confirm("Abandonner ? Le joueur du jour ne rejoindra pas ton album et ta série repartira de zéro.")) return;
    ST = await api('giveup', {}); renderWho(ST.user); drawGame();
  };

  // stats du jour
  const s = st.stats;
  $('#daystats').innerHTML = `<h3>Aujourd'hui</h3>
    <p><b>${s.found}</b> joueur${s.found > 1 ? 's ont' : ' a'} trouvé${s.avg ? `, en <b>${s.avg}</b> essais en moyenne` : ''}.</p>
    ${st.yesterday ? `<p>Hier, c'était <a href="/joueur/${st.yesterday.id}" data-link><b style="font-family:inherit">${esc(st.yesterday.name)}</b></a> (${st.yesterday.stats.found} l'ont trouvé).</p>` : ''}`;
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
function shareBox(text, url, label = 'Partager') {
  const id = 'sh' + Math.random().toString(36).slice(2, 7);
  setTimeout(() => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      const full = `${text}\n${url}`;
      try { await navigator.clipboard.writeText(full); btn.textContent = 'Copié, colle-le où tu veux'; } catch { prompt('Copie ce texte :', full); }
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
    ? `Trouvé en ${n} essai${n > 1 ? 's' : ''}${st.hints.length ? ` et ${st.hints.length} indice${st.hints.length > 1 ? 's' : ''}` : ''}${st.score ? ` · +${st.score.points} pts` : ''}`
    : `Abandon après ${n} essai${n > 1 ? 's' : ''} 🏳️`;
  return `FoOotix.com n°${st.number} ⚽\n${head}\n${rows.join('\n')}\nEt toi, tu le trouves en combien ?`;
}

function bindSearch() {
  const input = $('#q'), msg = $('#msg');
  input.addEventListener('input', () => { msg.textContent = ''; });
  $('#search form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    try {
      const st = await api('guess', { q });
      ST = st;
      input.value = '';
      msg.textContent = st.dup ? `Déjà proposé (essai n° ${st.dup}).` : '';
      if (st.status === 'won') renderWho(st.user);
      drawGame(st.dup || st.last);
      if (st.status === 'playing') input.focus();
    } catch (err) {
      msg.textContent = err.message;
      input.select();
    }
  });
  input.focus();
}

// ——— Page Wikipédia du joueur ———
const WIKI = 'https://fr.wikipedia.org';
const wikiUrl = (title) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function fetchWikiHtml(title) {
  const r = await fetch(`${WIKI}/api/rest_v1/page/html/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);
  if (!r.ok) throw new Error('Wikipédia ' + r.status);
  const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
  doc.querySelectorAll('script, link, meta, base, .navbox, .navbox-container, .bandeau-portail, .homonymie, .bandeau-container, .metadata, .noprint, .mw-editsection, [role="navigation"]').forEach((e) => e.remove());
  doc.querySelectorAll('a[href]').forEach((a) => {
    const h = a.getAttribute('href');
    if (h.startsWith('./')) a.href = `${WIKI}/wiki/${h.slice(2)}`;
    else if (h.startsWith('//')) a.href = 'https:' + h;
    else if (h.startsWith('/')) a.href = WIKI + h;
    if (!h.startsWith('#')) { a.target = '_blank'; a.rel = 'noopener'; }
  });
  doc.querySelectorAll('a').forEach((a) => { if (/^modifier( le code)?$/i.test(a.textContent.trim())) (a.closest('.navbar, p, div') || a).remove(); });
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
    if (h && /^(notes|références|liens externes|voir aussi|bibliographie|annexes)/i.test(h.textContent.trim())) s.remove();
  });
  return doc.body.innerHTML;
}

async function showWiki(el, p, head = '') {
  el.innerHTML = `<article class="wikiart">${head}<div class="wa-top"><span>Wikipédia, l'encyclopédie libre</span><a href="${wikiUrl(p.title || p.name)}" target="_blank" rel="noopener">Ouvrir sur Wikipédia ↗</a></div><h1 class="wa-title">${esc(p.title || p.name)}</h1><div class="mw-parser-output" id="wbody"><p class="note">Chargement de la page Wikipédia…</p></div></article>`;
  try {
    const body = $('#wbody', el);
    body.innerHTML = await fetchWikiHtml(p.title || p.name);
    if (body.scrollHeight > 2000) {
      body.classList.add('wa-clip');
      body.insertAdjacentHTML('afterend', `<button class="btn wa-more">Lire tout l'article</button>`);
      $('.wa-more', el).onclick = (e) => { body.classList.remove('wa-clip'); e.target.remove(); };
    }
  } catch {
    $('#wbody', el).innerHTML = fallbackCard(p);
  }
}

// si Wikipédia ne répond pas : une fiche maison à partir de nos données
function fallbackCard(p) {
  const span = (c) => c.to == null ? (c.from ? `depuis ${c.from}` : '') : c.from === c.to ? `${c.from}` : `${c.from ?? '?'}–${c.to}`;
  return `<p class="note">Wikipédia n'a pas répondu, voici la fiche résumée.</p>
    <p><b>${esc(p.name)}</b>, né le ${esc(fmtDate(p.born, { day: 'numeric', month: 'long', year: 'numeric' }))}${p.place ? ` à ${esc(p.place)}` : ''}, ${esc(p.pos.toLowerCase())} (${esc(p.nat.join(' / '))}).</p>
    <h2>Carrière en club</h2>
    <table class="wikitable"><tr><th>Période</th><th>Club</th><th>Championnat</th></tr>
    ${p.clubs.map((c) => `<tr><td>${span(c)}</td><td>${esc(c.club)}${c.loan ? ' (prêt)' : ''}</td><td>${esc(c.leagueName || '—')}</td></tr>`).join('')}</table>
    ${p.nt ? `<h2>Sélection</h2><p>${esc(p.nt.team)}${p.nt.from ? `, ${p.nt.from}–${p.nt.to ?? ''}` : ''}${p.nt.caps ? ` : ${p.nt.caps} sélections, ${p.nt.goals ?? 0} buts` : ''}.</p>` : ''}`;
}

async function pagePlayer(id) {
  const [p, me] = await Promise.all([api('player/' + id), api('me')]);
  renderWho(me.user, me);
  const s = p.stats;
  const mine = p.mine
    ? p.mine.status === 'won' ? `Tu l'as trouvé en <b>${p.mine.guesses}</b> essai${p.mine.guesses > 1 ? 's' : ''}, il est dans ton album.`
      : p.mine.status === 'gaveup' ? 'Tu as abandonné ce jour-là.' : `Tu ne l'as pas trouvé (${p.mine.guesses} essais).`
    : "Tu n'as pas joué ce jour-là.";
  const head = `<div class="wa-crampon">Joueur mystère n° ${p.number} du ${esc(fmtDate(p.day, { day: 'numeric', month: 'long', year: 'numeric' }))}. ${mine} ${s.found} joueur${s.found > 1 ? 's' : ''} l'${s.found > 1 ? 'ont' : 'a'} trouvé.</div>`;
  app.innerHTML = `<div id="wp"></div><p style="margin-top:18px"><a class="btn" href="/album" data-link>Mon album</a> <a class="btn" href="/" data-link>Jouer</a></p>`;
  await showWiki($('#wp'), p, head);
}

// ——— Page : album ———
async function pageAlbum() {
  const a = await api('album');
  renderWho(a.user, a.edition);
  const won = a.days.filter((d) => d.status === 'won').length;
  const past = a.days.filter((d) => !d.today).length;
  app.innerHTML = `
    <div class="pagehead">
      <div><div class="kicker">Ta collection</div><h1>Mon album</h1>
      <p>Un joueur par jour. Ceux que tu rates restent vides pour toujours.</p></div>
      <div class="counters">
        <div><b>${won}</b><span>trouvés</span></div>
        <div><b>${past - a.days.filter((d) => !d.today && d.status === 'won').length}</b><span>manqués</span></div>
        <div><b>${a.user ? a.user.streak : '—'}</b><span>série</span></div>
        <div><b>${a.user ? a.user.best : '—'}</b><span>record</span></div>
      </div>
    </div>
    ${a.user ? '' : `<p class="nudge" style="margin:0 0 20px">Sans compte, ton album ne vit que sur cet appareil. <a href="/compte" data-link>Crée un compte</a> pour le garder.</p>`}
    <div class="album">${a.days.map(slot).join('')}</div>
    ${adSlot('wide')}`;
}
function slot(d) {
  const date = fmtDate(d.day, { day: 'numeric', month: 'short' });
  if (d.today && d.status !== 'won' && d.status !== 'gaveup') {
    return `<a class="slot today" href="/" data-link><div class="top"><span>N° ${d.number}</span><span>${date}</span></div>
      <div class="face"><div><div class="q">?</div><div class="sub">${d.guesses ? `${d.guesses} essai${d.guesses > 1 ? 's' : ''}, continue` : 'À trouver aujourd’hui'}</div></div></div>
      <div class="bot">Aujourd'hui</div></a>`;
  }
  const cls = d.status === 'won' ? 's-won' : d.status === 'gaveup' ? 's-gaveup s-missed' : 's-missed';
  const bot = d.status === 'won' ? `Trouvé · ${d.guesses} essai${d.guesses > 1 ? 's' : ''}` : d.status === 'gaveup' ? 'Abandonné' : 'Manqué';
  return `<a class="slot ${cls} ${d.today ? 'today' : ''}" href="/joueur/${d.player.id}" data-link><div class="top"><span>N° ${d.number}</span><span>${date}</span></div>
    <div class="pic">${d.player.img ? `<img src="${esc(d.player.img)}" alt="" loading="lazy" onerror="this.outerHTML=SILHOUETTE">` : SILHOUETTE}</div>
    <div class="face"><div><div class="nm">${esc(d.player.name)}</div><div class="sub">${esc(d.player.pos)} · ${esc(d.player.nat)}</div></div></div>
    <div class="bot">${bot}</div></a>`;
}

// ——— Page : classement ———
let RANK_TAB = 'points';
async function pageRank() {
  const [r, me] = await Promise.all([api('leaderboard'), api('me')]);
  renderWho(me.user, me);
  const empty = (cols) => `<tr><td colspan="${cols}" class="muted">Personne pour l'instant. Trouve le joueur du jour avec un compte pour ouvrir le bal.</td></tr>`;
  const row = (x, cells) => `<tr class="${x.me ? 'me' : ''} ${x.gap ? 'gap' : ''}"><td>${x.rank}</td><td>${esc(x.username)}${x.me ? ' <span class="muted">(toi)</span>' : ''}</td>${cells}</tr>`;
  const podium = (list, val) => list.length ? `<div class="podium">${list.slice(0, 3).map((x, i) => `<div class="p${i + 1}"><div class="pl">${i + 1}<sup>${i ? 'e' : 'er'}</sup></div><div class="nm">${esc(x.username)}</div><div class="pt">${val(x)}</div></div>`).join('')}</div>` : '';
  const tabs = {
    points: () => `${podium(r.points, (x) => `${x.total} pts`)}
      <table class="rank"><thead><tr><th>#</th><th>Joueur</th><th class="r">Points</th><th class="r opt">Aujourd'hui</th><th class="r opt">Trouvés</th><th class="r opt">Série</th></tr></thead><tbody>
      ${r.points.length ? r.points.map((x) => row(x, `<td class="r big">${x.total}</td><td class="r opt">${x.today ? '+' + x.today : '–'}</td><td class="r opt">${x.found}</td><td class="r opt">${x.streak}</td>`)).join('') : empty(6)}</tbody></table>
      <p class="rank-note">Les points s'additionnent jour après jour. Moins tu poses de questions, plus tu marques, et un joueur peu connu rapporte jusqu'à deux fois plus qu'une star. Chaque indice retire 10 %.</p>`,
    today: () => `${podium(r.today, (x) => `${x.pts} pts`)}
      <table class="rank"><thead><tr><th>#</th><th>Joueur</th><th class="r">Points</th><th class="r">Essais</th></tr></thead><tbody>
      ${r.today.length ? r.today.map((x) => row(x, `<td class="r big">${x.pts}</td><td class="r">${x.n}</td>`)).join('') : empty(4)}</tbody></table>`,
    streaks: () => `${podium(r.streaks, (x) => `${x.streak} jour${x.streak > 1 ? 's' : ''}`)}
      <div class="rank-wrap"><table class="rank"><caption>Séries en cours</caption><thead><tr><th>#</th><th>Joueur</th><th class="r">Jours</th></tr></thead><tbody>
      ${r.streaks.length ? r.streaks.map((x) => row(x, `<td class="r big">${x.streak}</td>`)).join('') : empty(3)}</tbody></table>
      <table class="rank"><caption>Records</caption><thead><tr><th>#</th><th>Joueur</th><th class="r">Jours</th></tr></thead><tbody>
      ${r.records.length ? r.records.map((x) => row(x, `<td class="r">${x.best}</td>`)).join('') : empty(3)}</tbody></table></div>
      <p class="rank-note">Une série, c'est le nombre de jours d'affilée où tu as trouvé le joueur. Un jour sans, ou un abandon, et elle repart de zéro.</p>`,
  };
  const names = { points: 'Général', today: "Aujourd'hui", streaks: 'Séries' };
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">${r.players} joueur${r.players > 1 ? 's' : ''} classé${r.players > 1 ? 's' : ''}</div><h1>Classement</h1><p>${me.user ? `Tu as <b>${me.user.points} points</b> et une série de <b>${me.user.streak} jour${me.user.streak > 1 ? 's' : ''}</b>.` : `Seuls les joueurs avec un compte sont classés. <a href="/compte" data-link>Crée le tien</a>.`}</p></div></div>
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
      <div class="pagehead"><div><div class="kicker">Ton vestiaire</div><h1>${esc(m.user.username)}</h1><p><b>${m.user.points}</b> points · <b>${m.user.found}</b> joueur${m.user.found > 1 ? 's' : ''} trouvé${m.user.found > 1 ? 's' : ''} · série de <b>${m.user.streak}</b> jour${m.user.streak > 1 ? 's' : ''} (record ${m.user.best})</p></div></div>
      <p><a class="btn" href="/album" data-link>Mon album</a> <a class="btn" href="/classement" data-link>Classement</a> <button class="btn" id="logout">Se déconnecter</button></p>
      <details class="danger"><summary>Supprimer mon compte</summary>
        <form id="fd"><p>Ton compte, tes points, ta série et ton album seront effacés pour de bon.</p>
          <div class="field"><label for="dp">Mot de passe</label><input id="dp" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn">Supprimer définitivement</button><p class="msg"></p></form>
      </details>`;
    $('#logout').onclick = async () => { await api('logout', {}); go('/'); };
    $('#fd').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('delete-account', Object.fromEntries(new FormData(e.target))); go('/'); } catch (err) { $('#fd .msg').textContent = err.message; }
    };
    return;
  }
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">Ton vestiaire</div><h1>Compte</h1><p>Un pseudo et un mot de passe suffisent. Ta partie du jour te suit.</p></div></div>
    <div class="auth">
      <form id="fl"><h2>Connexion</h2>
        <div class="field"><label for="lu">Pseudo</label><input id="lu" name="username" autocomplete="username" required></div>
        <div class="field"><label for="lp">Mot de passe</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn solid">Se connecter</button><p class="msg"></p></form>
      <form id="fs"><h2>Nouveau compte</h2>
        <div class="field"><label for="su">Pseudo</label><input id="su" name="username" autocomplete="username" required minlength="3" maxlength="20"></div>
        <div class="field"><label for="sp">Mot de passe (6 caractères min.)</label><input id="sp" name="password" type="password" autocomplete="new-password" required minlength="6"></div>
        <button class="btn solid">Créer mon compte</button><p class="msg"></p></form>
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
function pageRules() {
  api('me').then((m) => renderWho(m.user, m));
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">Mode d'emploi</div><h1>Règles</h1></div></div>
    <div class="prose">
      <p>Chaque jour à minuit (heure de Paris), un footballeur est tiré au sort parmi 600 internationaux, légendes ou joueurs actuels, qui ont tous passé au moins trois saisons en Ligue 1, Premier League, Bundesliga, Liga ou Serie A. Le tirage est le même pour tout le monde, et un joueur ne revient pas avant que presque tous les autres soient passés.</p>
      <h2>Les points</h2>
      <p>Trouver le joueur rapporte des points&nbsp;: 100 si tu le trouves du premier coup, puis un peu moins à chaque essai (jamais moins de 10). Chaque indice demandé retire 10&nbsp;%. Enfin, la rareté multiplie le tout&nbsp;: une star comme Zidane compte ×1, un joueur méconnu jusqu'à ×2. Abandonner ne rapporte rien. Les points s'additionnent jour après jour dans le classement général.</p>
      <h2>La carte</h2>
      <p>Au départ, la carte du joueur mystère est vide&nbsp;: une silhouette et des points d'interrogation. Chaque chose que tu découvres s'y inscrit&nbsp;: nationalité, poste, année ou décennie de naissance, un club, ses championnats, s'il joue encore, s'il a eu le Ballon d'or. Le chiffre en haut à gauche, c'est ta température.</p>
      <h2>Deux façons de chercher</h2>
      <p><b>Propose un joueur.</b> Tu vois ce que ton joueur a en commun avec le mystère&nbsp;: même nationalité, même poste ou poste voisin, coéquipiers dans un club, clubs ou championnats communs. Une flèche te dit si le mystère est plus âgé ou plus jeune.</p>
      <p><b>Pose une question.</b> Tape un championnat, un club, un pays, un continent, un poste, une décennie de naissance, « Ballon d'or » ou « retraité ». Réponse oui ou non, rangée dans « Ce que tu sais ».</p>
      <h2>La température</h2>
      <p>Elle mesure tout ce que tu sais sur le mystère. Au départ, 600 joueurs sont possibles&nbsp;: tu es à 0°. Chaque oui, chaque non, chaque point commun avec un joueur proposé en élimine. Quand il n'en reste qu'une dizaine, tu es vers 65°&nbsp;; à 99°, il n'en reste qu'un, à toi de trouver son nom. 100°, c'est gagné.</p>
      <h2>Indices</h2>
      <p>Tous les 8 essais, tu peux révéler un indice&nbsp;: poste, génération, continent, nationalité, un club, puis ses initiales.</p>
      <h2>Ton album et ta série</h2>
      <p>Chaque joueur trouvé rejoint ton album, et sa page Wikipédia s'affiche aussitôt. Les jours ratés restent des cases vides, impossible de rejouer une date passée. La série compte les jours d'affilée où tu as trouvé. Un abandon la remet à zéro.</p>
      <p class="muted" style="font-size:14px">Les joueurs et leurs carrières viennent de Wikidata, mis à jour chaque jour. Les pages viennent de Wikipédia (CC BY-SA).</p>
    </div>`;
}

// ——— Pages : mentions légales et confidentialité ———
const todo = (v, what) => v ? esc(v) : `<mark>${what} à compléter</mark>`;
const contact = () => CFG.contact
  ? (CFG.contact.includes('@') ? `<a href="mailto:${esc(CFG.contact)}">${esc(CFG.contact)}</a>` : esc(CFG.contact))
  : todo('', 'Adresse e-mail de contact');
const HOST = 'Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis (render.com)';

function pageLegal() {
  api('me').then((m) => renderWho(m.user, m));
  app.innerHTML = `
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
  app.innerHTML = `
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
        <tr><td><code>theme</code> (stockage local)</td><td>Retenir le mode clair ou sombre</td><td>Jusqu’à ce que tu vides ton navigateur</td></tr>
      </table>
      <p>Ces trois-là sont nécessaires au fonctionnement du jeu&nbsp;: ils ne servent ni à la pub ni au suivi, et la loi ne demande pas de consentement pour eux.</p>
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
      <div class="pagehead"><div><div class="kicker">Entre potes</div><h1>Ligues</h1>
      <p>Crée une ligue, envoie le code à tes amis, et comparez vos points chaque jour.</p></div></div>
      <p><a class="btn solid" href="/compte?next=/ligues" data-link>Crée un compte pour commencer</a></p>`;
    return;
  }
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">Entre potes</div><h1>Mes ligues</h1>
    <p>Un classement rien qu'à vous, avec les points cumulés de chacun.</p></div></div>
    ${r.leagues.length ? `<div class="lglist">
      ${r.leagues.map((l) => `<a class="lg" href="/ligue/${l.code}" data-link><span class="nm"><b>${esc(l.name)}</b><span class="code">${l.code}</span></span><span class="meta">${l.members} joueur${l.members > 1 ? 's' : ''}${l.leader ? ` · en tête : ${esc(l.leader)}` : ''}</span><span class="pl">${l.rank}<sup>${l.rank === 1 ? 'er' : 'e'}</sup></span></a>`).join('')}
      </div>` : `<p class="muted">Tu n'es dans aucune ligue pour l'instant.</p>`}
    <div class="auth league-forms">
      <form id="lc"><h2>Créer une ligue</h2>
        <div class="field"><label for="ln">Nom</label><input id="ln" name="name" maxlength="40" required placeholder="Les potes du foot"></div>
        <button class="btn solid">Créer</button><p class="msg"></p></form>
      <form id="lj"><h2>Rejoindre</h2>
        <div class="field"><label for="lcode">Code reçu</label><input id="lcode" name="code" maxlength="6" required autocapitalize="characters" spellcheck="false" class="codein"></div>
        <button class="btn solid">Rejoindre</button><p class="msg"></p></form>
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
  const invite = shareBox(`Rejoins ma ligue « ${l.name} » sur FoOotix.com ⚽ Un joueur à deviner chaque jour, on compare nos points. Code : ${l.code}`, url, 'Inviter mes potes');
  const day = (x) => x.todayStatus === 'won' ? `<span class="ok">+${x.today}</span> <span class="muted">(${x.n})</span>`
    : x.todayStatus === 'gaveup' ? '<span class="muted">abandon</span>'
    : x.todayStatus === 'playing' && x.n ? `<span class="muted">en cours (${x.n})</span>` : '<span class="muted">–</span>';
  const head = `<div class="pagehead"><div><div class="kicker">Ligue · ${l.size} joueur${l.size > 1 ? 's' : ''}${l.owner ? ` · créée par ${esc(l.owner)}` : ''}</div><h1>${esc(l.name)}</h1>
    <p>Code <span class="code big">${l.code}</span></p></div></div>`;
  if (!l.member) {
    app.innerHTML = `${head}
      <p>On t'a invité dans cette ligue. ${l.user ? '' : 'Crée un compte (un pseudo et un mot de passe), puis rejoins-la en un clic.'}</p>
      <p>${l.user ? '<button class="btn solid" id="join">Rejoindre la ligue</button>' : `<a class="btn solid" href="/compte?next=/ligue/${l.code}" data-link>Créer un compte et rejoindre</a>`}</p><p class="msg" id="jm"></p>
      ${l.table.length ? `<table class="rank"><caption>En tête</caption><tbody>${l.table.map((x) => `<tr><td>${x.rank}</td><td>${esc(x.username)}</td><td class="r big">${x.total} pts</td></tr>`).join('')}</tbody></table>` : ''}`;
    const j = $('#join');
    if (j) j.onclick = async () => { try { await api('leagues/' + l.code + '/join', {}); route(); } catch (err) { $('#jm').textContent = err.message; } };
    return;
  }
  const fresh = new URLSearchParams(location.search).has('new');
  app.innerHTML = `${head}
    <div class="invite ${fresh ? 'fresh' : ''}"><div class="kicker">${fresh ? 'Ta ligue est prête, invite tes potes' : 'Inviter des potes'}</div>${invite}</div>
    <table class="rank"><thead><tr><th>#</th><th>Joueur</th><th class="r">Points</th><th class="r">N° ${l.number}</th><th class="r opt">Série</th></tr></thead><tbody>
    ${l.table.map((x) => `<tr class="${x.me ? 'me' : ''}"><td>${x.rank}</td><td>${esc(x.username)}${x.me ? ' <span class="muted">(toi)</span>' : ''}</td><td class="r big">${x.total}</td><td class="r">${day(x)}</td><td class="r opt">${x.streak}</td></tr>`).join('')}
    </tbody></table>
    <p class="rank-note">Les points sont ceux du classement général : chaque joueur trouvé rapporte, même avant d'avoir rejoint la ligue. Le chiffre entre parenthèses, c'est le nombre d'essais du jour.</p>
    <p><a class="btn" href="/ligues" data-link>Toutes mes ligues</a> <button class="btn" id="leave">Quitter la ligue</button></p>`;
  $('#leave').onclick = async () => {
    if (!confirm(`Quitter « ${l.name} » ?`)) return;
    await api('leagues/' + l.code + '/leave', {}); go('/ligues');
  };
}

route().then(() => setTimeout(() => Object.keys(PREFETCH).forEach(prefetch), 800));
