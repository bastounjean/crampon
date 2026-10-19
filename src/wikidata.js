// Récupère les joueurs sur Wikidata (données libres derrière Wikipédia).
const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'Crampon/1.0 (jeu du joueur de foot du jour; https://github.com/bastounjean/crampon)';

const LEAGUE_Q = { Q13394: 'L1', Q9448: 'PL', Q82595: 'BL', Q324867: 'LL', Q15804: 'SA' };
const LEAGUE_VALUES = Object.keys(LEAGUE_Q).map((q) => 'wd:' + q).join(' ');
const CONTINENT_Q = { Q15: 'Afrique', Q46: 'Europe', Q48: 'Asie', Q18: 'Amérique du Sud', Q49: 'Amérique du Nord', Q538: 'Océanie', Q55643: 'Océanie' };
// nations du Royaume-Uni : pas de code ISO à deux lettres
const HOME_NATIONS = { Q21: 'gb-eng', Q22: 'gb-sct', Q25: 'gb-wls', Q26: 'gb-nir' };

const qid = (uri) => (uri || '').split('/').pop();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(query, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
        body: 'query=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) throw new Error(`Wikidata ${r.status} : ${(await r.text()).slice(0, 200)}`);
      const j = await r.json();
      return j.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(5000 * i);
    }
  }
}

// Les joueurs les plus connus passés par un club des 5 grands championnats,
// classés par nombre d'articles Wikipédia (toutes langues) qui leur sont consacrés.
async function fetchPoolIds(size = 600, { bornFrom, minLinks = 25 } = {}) {
  const rows = await sparql(`
SELECT ?p (MAX(?sl) AS ?links) WHERE {
  VALUES ?lg { ${LEAGUE_VALUES} }
  ?club p:P118/ps:P118 ?lg .
  ?p p:P54/ps:P54 ?club .
  ?p wikibase:sitelinks ?sl .
  FILTER(?sl >= ${+minLinks})
  ?p wdt:P21 wd:Q6581097 .${bornFrom ? `
  ?p wdt:P569 ?born . FILTER(YEAR(?born) >= ${+bornFrom})` : ''}
  ?fr schema:about ?p ; schema:isPartOf <https://fr.wikipedia.org/> .
} GROUP BY ?p ORDER BY DESC(?links) LIMIT ${Math.round(size * 1.25)}`);
  return rows.map((r) => ({ id: qid(r.p), links: +r.links }));
}

// image principale des pages Wikipédia (titre → URL d'une miniature)
async function pageImages(lang, titles) {
  const out = {};
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=120&pilicense=any&titles=${encodeURIComponent(chunk.join('|'))}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      const q = (await r.json()).query || {};
      const back = {};
      for (const m of [...(q.normalized || []), ...(q.redirects || [])]) back[m.to] = back[m.from] || m.from;
      for (const pg of q.pages || []) {
        const src = pg.thumbnail?.source;
        if (!src || !/\.(svg|png|gif)/i.test(src)) continue; // une photo de stade n'est pas un logo
        out[pg.title] = src;
        if (back[pg.title]) out[back[pg.title]] = src;
      }
    } catch (e) { /* on garde le logo Wikidata */ }
    await sleep(300);
  }
  return out;
}

const values = (ids) => ids.map((i) => 'wd:' + i).join(' ');

async function fetchDetails(ids) {
  const V = values(ids);
  const base = await sparql(`
SELECT ?p ?label ?enlabel ?title ?birth ?placeLabel ?img ?sl WHERE {
  VALUES ?p { ${V} }
  OPTIONAL { ?p rdfs:label ?label FILTER(lang(?label) = "fr") }
  OPTIONAL { ?p rdfs:label ?enlabel FILTER(lang(?enlabel) = "en") }
  OPTIONAL { ?fr schema:about ?p ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?title }
  OPTIONAL { ?p wdt:P569 ?birth }
  OPTIONAL { ?p wdt:P19 ?place . ?place rdfs:label ?placeLabel FILTER(lang(?placeLabel) = "fr") }
  OPTIONAL { ?p wdt:P18 ?img }
  OPTIONAL { ?p wikibase:sitelinks ?sl }
}`);
  const attrs = await sparql(`
SELECT ?p ?kind ?v ?vLabel ?iso ?cont WHERE {
  VALUES ?p { ${V} }
  { ?p wdt:P1532 ?v . BIND("sport" AS ?kind) OPTIONAL { ?v wdt:P297 ?iso } OPTIONAL { ?v wdt:P30 ?cont } }
  UNION { ?p wdt:P27 ?v . BIND("cit" AS ?kind) OPTIONAL { ?v wdt:P297 ?iso } OPTIONAL { ?v wdt:P30 ?cont } }
  UNION { ?p wdt:P413 ?v . BIND("pos" AS ?kind) }
  UNION { ?p wdt:P166 wd:Q166177 . BIND(wd:Q166177 AS ?v) BIND("bo" AS ?kind) }
  UNION { ?p skos:altLabel ?alias FILTER(lang(?alias) = "fr") BIND(?alias AS ?v) BIND("alias" AS ?kind) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}`);
  const teams = await sparql(`
SELECT ?p ?st ?team ?teamLabel ?start ?end ?caps ?goals ?howLabel ?lg ?cc ?ccLabel ?nt WHERE {
  VALUES ?p { ${V} }
  ?p p:P54 ?st . ?st ps:P54 ?team .
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P1350 ?caps }
  OPTIONAL { ?st pq:P1351 ?goals }
  OPTIONAL { ?st pq:P1642 ?how }
  OPTIONAL { VALUES ?lg { ${LEAGUE_VALUES} } ?team p:P118/ps:P118 ?lg }
  OPTIONAL { ?team wdt:P17 ?cc }
  OPTIONAL { ?team wdt:P31 wd:Q6979593 . BIND(1 AS ?nt) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
}`);
  // logo et couleur des clubs (fichiers Wikimedia Commons)
  const teamIds = [...new Set(teams.map((r) => qid(r.team)))];
  const logos = [];
  for (let i = 0; i < teamIds.length; i += 300) {
    logos.push(...await sparql(`
SELECT ?team (GROUP_CONCAT(DISTINCT ?logo; separator="|") AS ?logos) (SAMPLE(?hex) AS ?hex) (SAMPLE(?enTitle) AS ?enTitle) (SAMPLE(?frTitle) AS ?frTitle) WHERE {
  VALUES ?team { ${values(teamIds.slice(i, i + 300))} }
  OPTIONAL { ?team wdt:P154 ?logo }
  OPTIONAL { ?team wdt:P6364 ?col . ?col wdt:P465 ?hex }
  OPTIONAL { ?en schema:about ?team ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?enTitle }
  OPTIONAL { ?fr schema:about ?team ; schema:isPartOf <https://fr.wikipedia.org/> ; schema:name ?frTitle }
} GROUP BY ?team`));
  }
  // le logo affiché dans l'encadré de la page Wikipédia du club : c'est le logo actuel,
  // y compris quand il n'est pas libre (Wikipédia anglais l'héberge alors lui-même)
  for (const lang of ['en', 'fr']) {
    const key = lang + 'Title';
    const todo = logos.filter((r) => !r.wp && r[key]);
    const img = await pageImages(lang, todo.map((r) => r[key]));
    for (const r of todo) if (img[r[key]]) r.wp = img[r[key]];
  }
  return { base, attrs, teams, logos };
}

const year = (d) => (d ? +d.slice(0, 4) : null);
const YOUTH = /(espoirs|moins de|\bU-?\d{2}\b|-\d{2} ans|^équipe olympique|olympic team|\bB$|\bII$|\bC$|réserve|reserves?$|castilla|jeunes|juniors?$|junior team|youth|amateur)/i;

function posCode(label) {
  const l = (label || '').toLowerCase();
  if (/gardien|goalkeeper/.test(l)) return 'GB';
  if (/défen|arrière|latéral|libéro|stoppeur|back|defender|sweeper/.test(l)) return 'DEF';
  if (/milieu|meneur|relayeur|récupérateur|midfield|playmaker/.test(l)) return 'MIL';
  if (/attaqu|avant|ailier|buteur|forward|striker|winger|neuf/.test(l)) return 'ATT';
  return null;
}

function build({ base, attrs, teams, logos = [] }, links = {}) {
  const P = {};
  const LOGO = {};
  // plusieurs logos possibles : on évite les versions blanches ou monochromes, illisibles sur fond clair
  const pickLogo = (all) => {
    const l = (all || '').split('|').filter(Boolean);
    const bad = (f) => /white|blanc|bianco|weiss|negativ|inverted|pictogram|monochrome|black|wordmark/i.test(decodeURIComponent(f));
    const f = l.find((x) => !bad(x)) || l[0];
    return f ? f.replace(/^http:/, 'https:') : null;
  };
  for (const r of logos) LOGO[qid(r.team)] = { logo: r.wp || pickLogo(r.logos), color: /^[0-9a-f]{6}$/i.test(r.hex || '') ? '#' + r.hex : null };
  for (const r of base) {
    const id = qid(r.p);
    const p = P[id] || (P[id] = { id, aliases: new Set() });
    p.name = p.name || r.label || r.enlabel;
    if (r.enlabel && r.enlabel !== p.name) p.aliases.add(r.enlabel);
    p.title = p.title || r.title;
    p.born = p.born || (r.birth ? r.birth.slice(0, 10) : null);
    p.place = p.place || r.placeLabel || null;
    p.img = p.img || r.img || null;
    p.links = Math.max(p.links || 0, +r.sl || links[id] || 0);
  }
  for (const p of Object.values(P)) { p.sport = {}; p.cit = {}; p.posList = []; p.bo = false; }
  for (const r of attrs) {
    const p = P[qid(r.p)];
    if (!p) continue;
    if (r.kind === 'bo') p.bo = true;
    else if (r.kind === 'alias') p.aliases.add(r.v);
    else if (r.kind === 'pos') { const c = posCode(r.vLabel); if (c && !p.posList.includes(c)) p.posList.push(c); }
    else {
      const id = qid(r.v);
      const bag = p[r.kind];
      const c = bag[id] || (bag[id] = { code: id, name: r.vLabel, iso: HOME_NATIONS[id] || (r.iso ? r.iso.toLowerCase() : null), conts: new Set() });
      if (r.cont && CONTINENT_Q[qid(r.cont)]) c.conts.add(CONTINENT_Q[qid(r.cont)]);
    }
  }
  const stints = {};
  for (const r of teams) {
    const p = P[qid(r.p)];
    if (!p) continue;
    const s = stints[r.st] || (stints[r.st] = {
      pid: p.id, team: qid(r.team), label: r.teamLabel, from: year(r.start), to: year(r.end),
      caps: r.caps ? +r.caps : null, goals: r.goals ? +r.goals : null,
      loan: /prêt|loan/i.test(r.howLabel || ''), league: null, country: null, nt: !!r.nt,
    });
    if (r.lg) s.league = LEAGUE_Q[qid(r.lg)];
    if (r.cc && !s.country) s.country = { code: qid(r.cc), name: r.ccLabel };
  }
  const isNT = (s) => s.nt || (/^(équipe d|selección|seleção|national)/i.test(s.label || '') && /football|soccer|futbol|fútbol|fussball/i.test(s.label || ''));
  for (const s of Object.values(stints)) {
    const p = P[s.pid];
    if (isNT(s)) {
      if (YOUTH.test(s.label) || /A'|\bB\b|féminine|women/i.test(s.label)) continue;
      if (!p.nt || (s.caps || 0) > (p.nt.caps || 0)) p.nt = { team: s.label, from: s.from, to: s.to, caps: s.caps, goals: s.goals };
      continue;
    }
    if (/^équipe d/i.test(s.label || '') || YOUTH.test(s.label || '') || /^Q\d+$/.test(s.label || '')) continue;
    (p.clubs = p.clubs || []).push({ id: s.team, club: s.label, from: s.from, to: s.to, loan: s.loan, league: s.league, country: s.country?.name || null, logo: LOGO[s.team]?.logo || null, color: LOGO[s.team]?.color || null });
  }

  const out = [];
  for (const p of Object.values(P)) {
    const natBag = Object.keys(p.sport).length ? p.sport : p.cit;
    const nat = Object.values(natBag).map((c) => {
      const conts = [...c.conts];
      const cont = conts.includes('Afrique') ? 'Afrique' : conts.includes('Europe') ? 'Europe' : conts[0] || null;
      return { code: c.code, name: c.name, iso: c.iso, cont };
    });
    const clubs = (p.clubs || []).sort((a, b) => (a.from ?? 9999) - (b.from ?? 9999));
    // fin de passage manquante : on prend le début du passage suivant (hors prêts)
    for (let i = 0; i < clubs.length; i++) {
      if (clubs[i].to == null && !clubs[i].loan) {
        const next = clubs.slice(i + 1).find((c) => !c.loan && c.from != null);
        if (next) clubs[i].to = next.from;
      }
    }
    if (!p.name || !p.born || !nat.length || !p.posList.length || !clubs.some((c) => c.league)) continue;
    const by = +p.born.slice(0, 4);
    const lastOpen = clubs.length && clubs[clubs.length - 1].to == null;
    out.push({
      id: p.id, name: p.name, title: p.title || p.name, born: p.born, place: p.place, img: p.img, links: p.links,
      aliases: [...p.aliases].filter((a) => a && a !== p.name && a.length < 40).slice(0, 6),
      nat, pos: p.posList[0], bo: p.bo,
      clubs, nt: p.nt || null,
      active: !!lastOpen && by >= 1984,
    });
  }
  return out;
}

async function fetchPlayers(ids, { batch = 60, log = () => {}, facts = true } = {}) {
  const all = [];
  for (let i = 0; i < ids.length; i += batch) {
    const chunk = ids.slice(i, i + batch);
    all.push(...build(await fetchDetails(chunk)));
    log(`  ${Math.min(i + batch, ids.length)}/${ids.length}`);
    await sleep(800);
  }
  if (facts) await addFacts(all, log);
  return all;
}

// ——— Anecdote : une phrase de l'introduction Wikipédia, nom du joueur masqué ———
const strip = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const STRONG = /(illustr|inscri|expuls|carton rouge|anecdote|insolite|unique|surprise|record|premier joueur|premier footballeur|seul joueur|plus jeune|plus vieux|meilleur buteur|meilleur passeur|surnomm|légende|légendaire|considéré|célèbre|connu pour|réputé|historique|élu|ballon d'or|soulier d'or|coupe du monde|ligue des champions|euro|triplé|doublé|capitaine|emblématique|icône|carrière|remport|vainqueur|champion|finale)/gi;

function pickFact(p, text) {
  if (!text) return null;
  const words = [...new Set([p.name, ...(p.aliases || []), p.title || ''].join(' ').split(/[\s,()'’-]+/).filter((w) => w.length >= 3))]
    .sort((a, b) => b.length - a.length);
  const sents = text.replace(/\s+/g, ' ').replace(/\([^()]*\)/g, '').replace(/\s+([,.])/g, '$1')
    .split(/(?<=[.!?])\s+(?=[A-ZÉÈÀÂ«])/).map((x) => x.trim()).filter(Boolean);
  let best = null, bestScore = -1;
  sents.forEach((sent, i) => {
    if (i === 0) return; // la première phrase donne poste et nationalité : déjà dans les autres indices
    if (sent.length < 50 || sent.length > 280) return;
    let masked = sent;
    for (const w of words) masked = masked.replace(new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'), '…');
    masked = masked.replace(/…(\s*…)+/g, '…');
    // reste-t-il un morceau du nom (accents ou non) ?
    if (words.some((w) => w.length >= 4 && strip(masked).includes(strip(w)))) return;
    const score = (sent.match(STRONG) || []).length * 3 + (/\d/.test(sent) ? 1 : 0) - i * 0.2;
    if (score > bestScore) { best = masked; bestScore = score; }
  });
  return best;
}

async function addFacts(players, log = () => {}) {
  const byTitle = {};
  for (const p of players) if (p.title) byTitle[p.title] = p;
  const titles = Object.keys(byTitle);
  let n = 0;
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const url = `https://fr.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=extracts&exintro=1&explaintext=1&exlimit=20&titles=${encodeURIComponent(chunk.join('|'))}`;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) continue;
      const q = (await r.json()).query || {};
      const back = {};
      for (const m of [...(q.normalized || []), ...(q.redirects || [])]) back[m.to] = back[m.from] || m.from;
      for (const pg of q.pages || []) {
        const p = byTitle[pg.title] || byTitle[back[pg.title]];
        if (!p) continue;
        const f = pickFact(p, pg.extract);
        if (f) { p.fact = f; n++; }
      }
    } catch (e) { /* pas d'anecdote pour ce lot */ }
    await sleep(300);
  }
  log(`  anecdotes : ${n}/${players.length}`);
}

module.exports = { fetchPoolIds, fetchPlayers, posCode, pickFact };
