'use strict';

const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

async function api(path, body) {
  const r = await fetch('/api/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Erreur réseau');
  return j;
}

const fmtDate = (d, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { timeZone: 'UTC', ...opts });

// ——— Température ———
function heat(t) {
  const stops = [[0, [47, 93, 138]], [35, [120, 130, 120]], [60, [185, 130, 28]], [100, [196, 55, 29]]];
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
    ? `<span><b>${esc(user.username)}</b></span><span class="streak" title="Jours d'affilée avec le joueur trouvé">Série ${user.streak} · ${user.found} trouvé${user.found > 1 ? 's' : ''}</span><button class="linkbtn" id="logout">Déconnexion</button>`
    : `<a href="/compte" data-link>Se connecter</a>`;
  const lo = $('#logout');
  if (lo) lo.onclick = async () => { await api('logout', {}); go('/'); };
}
function renderEdition(st) {
  $('#edition').innerHTML = `<b>N° ${st.number}</b><br>${esc(fmtDate(st.day))}`;
}

// ——— Routeur ———
function go(path) { history.pushState({}, '', path); route(); }
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute('href')); }
});
window.addEventListener('popstate', route);

async function route() {
  const p = location.pathname;
  document.querySelectorAll('.mast-sub nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === p));
  window.scrollTo(0, 0);
  clearInterval(window.__tick);
  try {
    if (p === '/') return await pageGame();
    if (p === '/album') return await pageAlbum();
    if (p === '/classement') return await pageRank();
    if (p === '/compte') return pageAuth();
    if (p === '/regles') return pageRules();
    const m = p.match(/^\/joueur\/([\w-]+)$/);
    if (m) return await pagePlayer(m[1]);
    app.innerHTML = '<p>Page introuvable. <a href="/" data-link>Retour au jeu</a></p>';
  } catch (e) {
    app.innerHTML = `<p class="msg">${esc(e.message)}</p>`;
  }
}

// ——— Catalogue pour l'autocomplétion ———
let CAT = null;
async function catalog() {
  if (!CAT) CAT = await api('catalog');
  return CAT;
}
function suggest(q) {
  const n = norm(q);
  if (n.length < 2) return [];
  const score = (keys) => {
    let best = 0;
    for (const k of keys) {
      if (k === n) best = Math.max(best, 4);
      else if (k.startsWith(n)) best = Math.max(best, 3);
      else if (k.split(' ').some((w) => w.startsWith(n))) best = Math.max(best, 2);
      else if (n.length >= 3 && k.includes(n)) best = Math.max(best, 1);
    }
    return best;
  };
  const players = CAT.players.map((p) => ({ type: 'player', id: p.id, label: p.name, kind: p.sub, s: score(p.keys) })).filter((x) => x.s);
  const clues = CAT.clues.map((c) => ({ type: 'clue', id: c.id, label: c.label, kind: c.kind, s: score(c.terms) })).filter((x) => x.s);
  return [...players, ...clues].sort((a, b) => b.s - a.s || (a.type === 'player' ? -1 : 1) || a.label.localeCompare(b.label, 'fr')).slice(0, 9);
}

// ——— Page : jeu ———
let ST = null;
async function pageGame() {
  const [st] = await Promise.all([api('today'), catalog()]);
  ST = st;
  renderWho(st.user);
  renderEdition(st);
  app.innerHTML = `
    <div class="game">
      <div class="left">
        <div id="banner"></div>
        <div class="hero">
          <div id="fcard"></div>
          <div class="hero-txt">
            <div class="intro">
              <div class="kicker">Le joueur mystère n° ${st.number}</div>
              <h1>Qui se cache derrière le maillot&nbsp;?</h1>
              <p>Propose un joueur ou un indice&nbsp;: un championnat, un club, un pays, un poste, une génération. Chaque découverte remplit sa carte.</p>
            </div>
            <section class="gauge" id="gauge"></section>
          </div>
        </div>
        <div class="search" id="search">
          <form autocomplete="off">
            <input id="q" placeholder="Zidane, Ligue 1, Brésil, attaquant, années 90…" aria-label="Ta proposition" spellcheck="false">
            <button>Tenter</button>
          </form>
          <ul class="sugg" id="sugg" hidden></ul>
        </div>
        <div class="msg" id="msg"></div>
        <div id="reveal"></div>
        <details class="board-wrap" id="bw" open><summary id="bws" style="display:none"></summary><table class="board" id="board"></table></details>
        ${st.user ? '' : `<div class="nudge">Tu joues sans compte. <a href="/compte" data-link>Crée un compte</a> pour garder ta série et remplir ton album, ta partie du jour sera conservée.</div>`}
      </div>
      <aside>
        <section id="facts"></section>
        <section class="hints" id="hints"></section>
        <section class="daystats" id="daystats"></section>
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
  return c.logo ? `<img src="${esc(c.logo)}?width=64" alt="${esc(c.name)}" loading="lazy" onerror="this.outerHTML=this.nextElementSibling.innerHTML"><template>${mono}</template>` : mono;
}
function clubPath(path, over) {
  if (!path || !path.length) return '';
  const found = path.filter(Boolean).length;
  return `<div class="path">
    <div class="path-h"><span>Parcours</span><span>${found}/${path.length} club${path.length > 1 ? 's' : ''}</span></div>
    <ol>${path.map((c, i) => c
      ? `<li class="on${c.logo && /white|blanc|bianco|weiss|negativ|inverted/i.test(decodeURIComponent(c.logo)) ? ' dk' : ''}" title="${esc(c.name)}">${crest(c)}</li>`
      : `<li title="Club n°${i + 1}, pas encore trouvé"><span class="q">${i + 1}</span></li>`).join('')}</ol>
    ${found || over ? '' : '<p class="path-tip">Chaque club trouvé (« même club ») prend sa place ici, dans l\'ordre de sa carrière.</p>'}
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
  </div>${clubPath(c.path, found)}`;
}

function drawGame(lastN) {
  const st = ST;
  const over = st.status !== 'playing';
  $('#search').hidden = over;
  document.querySelector('.intro').hidden = over;

  // carte et jauge
  const best = st.guesses.reduce((m, g) => (g.temp > (m?.temp ?? -1) ? g : m), null);
  const t = best ? best.temp : 0;
  $('#fcard').innerHTML = fifaCard(st.card, best ? t : '?', st.status === 'won');
  $('#gauge').innerHTML = `<h3>Ta jauge</h3>
    <div class="big"><span class="deg" style="color:${heat(t)}">${t}°</span><span class="word">${best ? word(t) : 'À toi'}</span></div>
    <div class="scale"><i style="width:${t}%;background:${heat(t)}"></i></div>
    <div class="scale-legend"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    <div class="bestof">${best ? `Meilleur essai : ${esc(best.label)}` : 'Fais un premier essai pour la remplir.'}</div>`;

  // bannière de fin + page Wikipédia
  if (over) {
    const a = st.answer;
    const n = st.guesses.length;
    $('#banner').innerHTML = st.status === 'won'
      ? `<div class="won"><div><div class="kicker">Trouvé</div><h2>${esc(a.name)}</h2><p>En ${n} essai${n > 1 ? 's' : ''}${st.hints.length ? ` et ${st.hints.length} indice${st.hints.length > 1 ? 's' : ''}` : ''}. Tu es ${st.rank === 1 ? 'le premier' : 'le ' + st.rank + '<sup>e</sup>'} à le trouver aujourd'hui.</p><p class="muted">Prochain joueur dans <span class="countdown" id="cd"></span></p></div>
         <div class="actions"><button class="btn solid" id="share">Partager</button><a class="btn" href="/album" data-link>Mon album</a></div></div>`
      : `<div class="won lost"><div><div class="kicker">Abandon</div><h2>${esc(a.name)}</h2><p>C'était lui. Ce joueur ne rejoindra pas ton album.</p><p class="muted">Prochain joueur dans <span class="countdown" id="cd"></span></p></div>
         <div class="actions"><a class="btn" href="/album" data-link>Mon album</a></div></div>`;
    tick();
    const sh = $('#share');
    if (sh) sh.onclick = share;
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
  $('#board').innerHTML = st.guesses.length
    ? `<thead><tr><th>N°</th><th>Proposition</th><th style="text-align:right">Temp.</th><th class="bar"></th></tr></thead><tbody>
       ${last && !over ? row(last, 'last') + '<tr class="sep"><td colspan="4"></td></tr>' : ''}${rows.map((g) => row(g)).join('')}</tbody>`
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

async function share() {
  const st = ST;
  const sq = (t) => (t >= 85 ? '🟥' : t >= 60 ? '🟧' : t >= 35 ? '🟨' : '🟦');
  const line = st.guesses.slice(-12).map((g) => sq(g.temp)).join('');
  const txt = `Crampon n°${st.number} : trouvé en ${st.guesses.length} essai${st.guesses.length > 1 ? 's' : ''}${st.hints.length ? ` (${st.hints.length} indice${st.hints.length > 1 ? 's' : ''})` : ''}\n${line}\n${location.origin}`;
  try { await navigator.clipboard.writeText(txt); $('#share').textContent = 'Copié'; } catch { prompt('Copie ce texte :', txt); }
}

function bindSearch() {
  const input = $('#q'), list = $('#sugg'), msg = $('#msg');
  let items = [], sel = 0;
  const draw = () => {
    list.hidden = !items.length;
    list.innerHTML = items.map((it, i) => `<li class="${i === sel ? 'on' : ''}" data-i="${i}"><span>${esc(it.label)}</span><span class="k">${esc(it.kind)}</span></li>`).join('');
  };
  input.addEventListener('input', () => { items = suggest(input.value); sel = 0; draw(); msg.textContent = ''; });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { sel = (sel + 1) % items.length; draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = (sel - 1 + items.length) % items.length; draw(); e.preventDefault(); }
    if (e.key === 'Escape') { items = []; draw(); }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) { e.preventDefault(); submit(items[+li.dataset.i]); }
  });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 100));
  $('#search form').addEventListener('submit', (e) => {
    e.preventDefault();
    submit(items.length ? items[sel] : { q: input.value });
  });
  async function submit(it) {
    if (!it || (!it.id && !it.q?.trim())) return;
    try {
      const st = await api('guess', it.id ? { type: it.type, id: it.id } : { q: it.q });
      ST = st;
      input.value = ''; items = []; draw();
      msg.textContent = st.dup ? `Déjà proposé (essai n° ${st.dup}).` : '';
      if (st.status === 'won') renderWho(st.user);
      drawGame(st.dup || st.last);
      if (st.status === 'playing') input.focus();
    } catch (err) {
      msg.textContent = err.message;
    }
  }
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
    <div class="album">${a.days.map(slot).join('')}</div>`;
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
    <div class="face"><div><div class="nm">${esc(d.player.name)}</div><div class="sub">${esc(d.player.pos)} · ${esc(d.player.nat)}</div></div></div>
    <div class="bot">${bot}</div></a>`;
}

// ——— Page : classement ———
async function pageRank() {
  const [r, me] = await Promise.all([api('leaderboard'), api('me')]);
  renderWho(me.user, me);
  const tbl = (cap, rows, val) => `<table class="rank"><caption>${cap}</caption>${rows.length
    ? rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.username)}</td><td>${val(x)}</td></tr>`).join('')
    : '<tr><td></td><td class="muted">Personne pour l’instant</td><td></td></tr>'}</table>`;
  app.innerHTML = `
    <div class="pagehead"><div><div class="kicker">Les habitués</div><h1>Classement</h1><p>Seuls les joueurs avec un compte apparaissent ici.</p></div></div>
    <div class="cols">
      ${tbl('Plus longues séries en cours', r.streaks.filter((x) => x.streak > 0), (x) => `${x.streak} j`)}
      ${tbl('Joueurs trouvés', r.found, (x) => x.found)}
      ${tbl("Les plus rapides aujourd'hui", r.today, (x) => `${x.n} essai${x.n > 1 ? 's' : ''}`)}
    </div>`;
}

// ——— Page : compte ———
function pageAuth() {
  api('me').then((m) => renderWho(m.user, m));
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
      try { await api(path, Object.fromEntries(new FormData(f))); go('/'); } catch (err) { $('.msg', f).textContent = err.message; }
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
      <h2>La carte</h2>
      <p>Au départ, la carte du joueur mystère est vide&nbsp;: une silhouette et des points d'interrogation. Chaque chose que tu découvres s'y inscrit&nbsp;: nationalité, poste, année ou décennie de naissance, un club, ses championnats, s'il joue encore, s'il a eu le Ballon d'or. Le chiffre en haut à gauche, c'est ta meilleure température.</p>
      <h2>Deux façons de chercher</h2>
      <p><b>Propose un joueur.</b> Tu obtiens une température entre 0 et 100°, et ce que ton joueur a en commun avec le mystère&nbsp;: même nationalité, même poste ou poste voisin, coéquipiers dans un club, clubs ou championnats communs. Une flèche te dit si le mystère est plus âgé ou plus jeune.</p>
      <p><b>Pose une question.</b> Tape un championnat, un club, un pays, un continent, un poste, une décennie de naissance, « Ballon d'or » ou « retraité ». Réponse oui ou non, rangée dans « Ce que tu sais ».</p>
      <table>
        <tr><th>Un oui sur…</th><th>vaut</th></tr>
        <tr><td>un club</td><td>45°</td></tr><tr><td>une nationalité</td><td>38°</td></tr>
        <tr><td>le Ballon d'or</td><td>30°</td></tr><tr><td>une décennie de naissance</td><td>28°</td></tr>
        <tr><td>un championnat</td><td>22°</td></tr><tr><td>un poste</td><td>18°</td></tr>
      </table>
      <h2>Indices</h2>
      <p>Tous les 8 essais, tu peux révéler un indice&nbsp;: poste, génération, continent, nationalité, un club, puis ses initiales.</p>
      <h2>Ton album et ta série</h2>
      <p>Chaque joueur trouvé rejoint ton album, et sa page Wikipédia s'affiche aussitôt. Les jours ratés restent des cases vides, impossible de rejouer une date passée. La série compte les jours d'affilée où tu as trouvé. Un abandon la remet à zéro.</p>
      <p class="muted" style="font-size:14px">Les joueurs et leurs carrières viennent de Wikidata, mis à jour chaque jour. Les pages viennent de Wikipédia (CC BY-SA).</p>
    </div>`;
}

route();
