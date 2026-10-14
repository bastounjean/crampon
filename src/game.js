const crypto = require('crypto');
const { LEAGUES, COUNTRIES, POSITIONS } = require('./data/meta');

const NOW_YEAR = new Date().getFullYear();
const LAUNCH = process.env.LAUNCH_DATE || '2026-10-13';
const SECRET = process.env.SECRET || 'change-moi-en-production';
const TZ = 'Europe/Paris';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

// gentilés connus, pour accepter « Brésilien » comme « Brésil »
const ADJ = {};
for (const [name, adj] of Object.values(COUNTRIES)) ADJ[norm(name)] = adj;

// ——— Joueurs ———
// IDS : la liste fixe des joueurs qui peuvent tomber (src/data/pool.json).
// Les fiches sont rafraîchies depuis Wikidata par le serveur.
let IDS = [];
let PLAYERS = [];
const BY_ID = {}; // toutes les fiches déjà vues, même si elles sortent de la liste
let CLUES = [], CLUE_BY_ID = {}, LAST = {}, CLUB_NAMES = {};

function prepare(raw) {
  const p = { ...raw };
  p.bornYear = +p.born.slice(0, 4);
  p.leagues = [...new Set(p.clubs.map((c) => c.league).filter(Boolean))];
  const yearsBy = {};
  for (const c of p.clubs) if (c.league && c.from) yearsBy[c.league] = (yearsBy[c.league] || 0) + ((c.to ?? NOW_YEAR) - c.from + 0.5);
  p.mainLeague = Object.entries(yearsBy).sort((a, b) => b[1] - a[1])[0]?.[0] || p.leagues[0] || null;
  p.continents = [...new Set(p.nat.map((n) => n.cont).filter(Boolean))];
  p.keys = [...new Set([p.name, ...(p.aliases || [])].map(norm).filter(Boolean))];
  p.sub = `${p.nat[0].name} · ${p.bornYear}`;
  return p;
}

function setPool(ids, players) {
  for (const raw of players) BY_ID[raw.id] = prepare(raw);
  IDS = [...ids].filter((id) => BY_ID[id]).sort();
  PLAYERS = IDS.map((id) => BY_ID[id]);
  LAST = {};
  for (const p of PLAYERS) {
    const parts = norm(p.name).split(' ');
    if (parts.length < 2) continue;
    const last = parts.slice(1).join(' ');
    LAST[last] = LAST[last] === undefined ? p.id : false;
  }
  buildClues();
  picks.length = 0;
}

// « Real Madrid CF » → « Real Madrid », « AS Monaco FC » → « Monaco »
const shortName = (n) => n.replace(/^(FC|AS|AC|SS|SSC|US|OGC|RC|SC|CF|CD|RCD|SV|VfB|VfL|TSG|1\. FC|Olympique|Stade|Club)\s+/i, '').replace(/\s+(FC|CF|AFC|SAD|AC|BC|Calcio|1846|1899|1900|1907|1909|04|05|96)$/i, '').trim();

const NICK = {
  'paris saint germain fc': ['psg', 'paris sg', 'paris'], 'olympique de marseille': ['om'], 'olympique lyonnais': ['ol', 'lyon'],
  'fc barcelone': ['barca', 'barcelona'], 'manchester united fc': ['man united', 'man utd', 'manchester united'], 'manchester city fc': ['man city', 'manchester city'],
  'tottenham hotspur fc': ['tottenham', 'spurs'], 'inter milan': ['inter'], 'ac milan': ['milan'], 'atletico de madrid': ['atletico', 'atletico madrid'],
  'borussia dortmund': ['dortmund', 'bvb'], 'fc bayern munich': ['bayern'], 'bayern munich': ['bayern'], 'losc lille': ['lille'], 'girondins de bordeaux': ['bordeaux'],
  'fc internazionale milano': ['inter', 'inter milan'], 'club atletico de madrid': ['atletico', 'atletico madrid', 'atletico de madrid'],
  'bv 09 borussia dortmund': ['dortmund', 'bvb'], 'societa sportiva calcio napoli': ['naples', 'napoli'], 'societa sportiva lazio': ['lazio'],
  'as rome': ['roma'], 'olympique de marseille': ['om', 'marseille'], 'juventus fc': ['juve'],
  'as saint etienne': ['saint etienne', 'asse'], 'stade rennais fc': ['rennes'], 'ogc nice': ['nice'], 'rc lens': ['lens'], 'fc nantes': ['nantes'],
};

// ——— Indices « mots-clés » ———
function buildClues() {
  CLUES = [];
  const add = (id, label, kind, terms, test, temp) => CLUES.push({ id, label, kind, terms: [...new Set([label, ...terms].map(norm))], test, temp });

  for (const [code, l] of Object.entries(LEAGUES))
    add('lg:' + code, l.name, 'Championnat', [l.long, code === 'L1' ? 'division 1' : '', code === 'LL' ? 'la liga' : ''].filter(Boolean), (p) => p.leagues.includes(code), 22);

  const nats = {};
  for (const p of PLAYERS) for (const n of p.nat) nats[n.code] = n;
  for (const n of Object.values(nats)) {
    const adj = ADJ[norm(n.name)];
    add('nat:' + n.code, n.name, 'Nationalité', adj ? [adj] : [], (p) => p.nat.some((x) => x.code === n.code), 38);
  }
  const contAdj = { Europe: 'europeen', Afrique: 'africain', Asie: 'asiatique', 'Amérique du Sud': 'sud americain', 'Amérique du Nord': 'nord americain', 'Océanie': 'oceanien' };
  for (const [cont, adj] of Object.entries(contAdj))
    if (PLAYERS.some((p) => p.continents.includes(cont))) add('cont:' + cont, cont, 'Continent', [adj], (p) => p.continents.includes(cont), 15);

  CLUB_NAMES = {};
  for (const p of PLAYERS) for (const c of p.clubs) CLUB_NAMES[c.id] = c.club;
  for (const [id, name] of Object.entries(CLUB_NAMES).sort((a, b) => a[1].localeCompare(b[1], 'fr')))
    add('club:' + id, name, 'Club', [shortName(name), name.replace(/^Olympique (de )?/i, ''), ...(NICK[norm(name)] || [])], (p) => p.clubs.some((c) => c.id === id), 45);

  for (const [code, pos] of Object.entries(POSITIONS))
    add('pos:' + code, pos.clue, 'Poste', [pos.name, code === 'GB' ? 'goal' : code === 'ATT' ? 'buteur' : code === 'DEF' ? 'defense' : 'milieu'], (p) => p.pos === code, 18);
  for (let d = 1920; d <= 2000; d += 10) {
    const short = String(d).slice(2);
    add('dec:' + d, `Né dans les années ${d}`, 'Génération', [`annees ${short}`, `annees ${d}`, `${d}s`, `ne en ${d}`], (p) => Math.floor(p.bornYear / 10) * 10 === d, 28);
  }
  add('hon:BO', "Ballon d'or", 'Palmarès', ['ballon d or', 'ballon dor', 'vainqueur du ballon d or'], (p) => p.bo, 30);
  add('act:1', 'Toujours en activité', 'Carrière', ['en activite', 'actif', 'joue encore'], (p) => p.active, 12);
  add('act:0', 'Retraité', 'Carrière', ['retraite', 'a la retraite', 'legende'], (p) => !p.active, 12);
  CLUE_BY_ID = Object.fromEntries(CLUES.map((c) => [c.id, c]));
  buildIndex();
}

// ——— Résolution d'une saisie (texte libre, sans liste de suggestions) ———
// Les villes renvoient vers leur club : « Marseille » → Olympique de Marseille.
const GENERIC = new Set('fc cf ac as ss ssc us ogc rc sc cd rcd sv vfb vfl tsg afc sad club football futbol fussball calcio de du des la le les l d el del di olympique stade real sporting united city athletic atletico racing borussia hotspur wanderers rovers albion county town inter internazionale deportivo sociedad union associazione sportiva societa associacao sport clube esporte spor kulubu sk ks fk nk gnk hnk cska psv afc ajax bv'.split(' '));
const CITY_ADJ = { lyonnais: 'lyon', rennais: 'rennes', brestois: 'brest', lavallois: 'laval', niortais: 'niort', bastiais: 'bastia', ajaccien: 'ajaccio', nancy: 'nancy', lorient: 'lorient', munchen: 'munich', torino: 'turin', napoli: 'naples', roma: 'rome', firenze: 'florence', genova: 'genes', milano: 'milan', sevilla: 'seville', barcelona: 'barcelone', lisboa: 'lisbonne', koln: 'cologne', '1 fc koln': 'cologne' };
const CITY_EXTRA = { 'juventus fc': ['turin'], 'arsenal fc': ['londres', 'london'], 'chelsea fc': ['londres', 'london'], 'tottenham hotspur fc': ['londres', 'london'], 'west ham united fc': ['londres', 'london'], 'fulham fc': ['londres', 'london'], 'crystal palace fc': ['londres', 'london'], 'queens park rangers fc': ['londres', 'london'], 'everton fc': ['liverpool'], 'paris saint germain fc': ['paris'], 'fc internazionale milano': ['milan'], 'inter milan': ['milan'] };
let CITY = {}, FUZZY = [], CLUB_FANS = {};

function buildIndex() {
  CLUB_FANS = {};
  for (const p of PLAYERS) for (const id of new Set(p.clubs.map((c) => c.id))) CLUB_FANS[id] = (CLUB_FANS[id] || 0) + 1;
  CITY = {};
  const addCity = (t, id) => { if (t.length >= 4 && !GENERIC.has(t)) (CITY[t] = CITY[t] || new Set()).add(id); };
  for (const [id, name] of Object.entries(CLUB_NAMES)) {
    const n = norm(name);
    const words = n.split(' ').filter((w) => !GENERIC.has(w) && !/^\d+$/.test(w));
    words.forEach((w) => addCity(CITY_ADJ[w] || w, id));
    if (words.length > 1) addCity(words.join(' '), id); // « saint etienne », « bayer leverkusen »
    for (const c of CITY_EXTRA[n] || []) addCity(c, id);
  }
  FUZZY = [];
  for (const p of PLAYERS) for (const k of p.keys) FUZZY.push([k, 'p:' + p.id]);
  for (const [last, id] of Object.entries(LAST)) if (id) FUZZY.push([last, 'p:' + id]);
  for (const c of CLUES) for (const t of c.terms) FUZZY.push([t, 'c:' + c.id]);
  for (const t of Object.keys(CITY)) FUZZY.push([t, 'v:' + t]);
}

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1); // lettres inversées
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    var prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

// plusieurs clubs pour un même mot : on prend le plus connu s'il l'est nettement
function pickClub(ids, word) {
  ids = [...new Set(ids)].sort((a, b) => (CLUB_FANS[b] || 0) - (CLUB_FANS[a] || 0));
  if (!ids.length) return null;
  if (ids.length === 1 || (CLUB_FANS[ids[0]] || 0) >= 2 * (CLUB_FANS[ids[1]] || 0))
    return { type: 'clue', clue: CLUE_BY_ID['club:' + ids[0]] };
  const names = ids.slice(0, 4).map((id) => shortName(CLUB_NAMES[id]));
  return { error: `Plusieurs clubs possibles pour « ${word} » : ${names.join(', ')}${ids.length > 4 ? ', etc' : ''}. Précise lequel.` };
}

function exact(n) {
  const p = PLAYERS.find((x) => x.keys.includes(n)) || (LAST[n] ? BY_ID[LAST[n]] : null);
  if (p) return { type: 'player', player: p };
  if (LAST[n] === false) return { error: `Plusieurs joueurs s'appellent « ${n} ». Ajoute le prénom.` };
  const cs = CLUES.filter((x) => x.terms.includes(n));
  const clubs = [...cs.filter((c) => c.kind === 'Club').map((c) => c.id.slice(5)), ...(CITY[n] || [])];
  const other = cs.find((c) => c.kind !== 'Club');
  if (other) return { type: 'clue', clue: other };
  return pickClub(clubs, n);
}

function resolve({ q }) {
  const n = norm(q || '').replace(/^(a |au |en |le |la |l |les |joue a |a joue a |a joue au |passe par )+/, '').trim();
  if (!n) return null;
  const hit = exact(n);
  if (hit) return hit;
  // fautes de frappe : une lettre de travers jusqu'à 7 lettres, deux au-delà
  const max = n.length < 4 ? 0 : n.length < 8 ? 1 : 2;
  if (!max) return null;
  let best = max + 1, terms = new Set();
  for (const [t] of FUZZY) {
    const d = lev(n, t, Math.min(max, best));
    if (d < best) { best = d; terms = new Set([t]); } else if (d === best) terms.add(t);
  }
  if (best > max) return null;
  const outs = [...terms].map(exact).filter(Boolean);
  const keyOf = (r) => r.error || (r.player ? 'p' + r.player.id : 'c' + r.clue.id);
  if (new Set(outs.map(keyOf)).size !== 1) return { error: `« ${q.trim()} » ressemble à plusieurs choses. Précise un peu.` };
  return outs[0];
}

// ——— Proximité entre deux joueurs ———
const overlap = (a, b) => {
  if (!a.from || !b.from) return false;
  const ae = a.to ?? NOW_YEAR, be = b.to ?? NOW_YEAR;
  return Math.min(a.from === ae ? ae + 0.5 : ae, b.from === be ? be + 0.5 : be) > Math.max(a.from, b.from);
};
const NEAR = { GB: ['DEF'], DEF: ['GB', 'MIL'], MIL: ['DEF', 'ATT'], ATT: ['MIL'] };

// Chaque tag peut porter `reveal` : ce qu'il dévoile sur la carte du joueur mystère.
function compare(target, guess) {
  if (target.id === guess.id) return { temp: 100, tags: [{ t: 'Trouvé !', ok: true }] };
  let s = 0;
  const tags = [];
  const sameNat = target.nat.filter((n) => guess.nat.some((g) => g.code === n.code));
  if (sameNat.length) { s += 20; tags.push({ t: `Même nationalité (${sameNat[0].name})`, ok: true, reveal: { nat: sameNat[0].code } }); }
  else if (target.continents.some((c) => guess.continents.includes(c))) {
    const c = target.continents.find((x) => guess.continents.includes(x));
    s += 5; tags.push({ t: 'Même continent', ok: true, reveal: { cont: c } });
  }

  if (target.pos === guess.pos) { s += 10; tags.push({ t: 'Même poste', ok: true, reveal: { pos: target.pos } }); }
  else if (NEAR[target.pos].includes(guess.pos)) { s += 4; tags.push({ t: 'Poste voisin', half: true }); }

  const d = target.bornYear - guess.bornYear;
  s += Math.max(0, 14 - Math.abs(d) * 1.4);
  tags.push(d === 0
    ? { t: 'Né la même année', ok: true, reveal: { year: target.bornYear } }
    : { t: d < 0 ? 'Le mystère est plus âgé' : 'Le mystère est plus jeune', dir: d < 0 ? 'up' : 'down', half: Math.abs(d) <= 3 });

  const tClubs = new Set(target.clubs.map((c) => c.id));
  const shared = [...new Set(guess.clubs.map((c) => c.id).filter((c) => tClubs.has(c)))];
  let mates = null;
  for (const gc of guess.clubs) for (const tc of target.clubs) if (gc.id === tc.id && overlap(gc, tc)) mates = mates || gc.id;
  s += Math.min(26, shared.length * 11);
  if (mates) { s += 10; tags.push({ t: `Coéquipiers à ${CLUB_NAMES[mates] || BY_ID[target.id].clubs.find((c) => c.id === mates).club}`, ok: true, reveal: { club: mates } }); }
  for (const c of shared.filter((c) => c !== mates).slice(0, 2)) tags.push({ t: `Passé par ${target.clubs.find((x) => x.id === c).club}`, ok: true, reveal: { club: c } });

  const sharedL = target.leagues.filter((l) => guess.leagues.includes(l));
  s += Math.min(14, sharedL.length * 5);
  if (sharedL.length) tags.push({ t: sharedL.map((l) => LEAGUES[l].name).join(', '), ok: true, reveal: { leagues: sharedL } });
  if (target.active === guess.active) s += 3;

  return { temp: Math.min(99, Math.round(s)), tags };
}

function askClue(target, clue) {
  const yes = clue.test(target);
  return { yes, temp: yes ? clue.temp : Math.round(clue.temp / 10) };
}

// ——— Joueur du jour ———
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dayIndex(day) {
  return Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(LAUNCH + 'T00:00:00Z')) / 86400000);
}
function dayFromIndex(i) {
  return new Date(Date.parse(LAUNCH + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
}
const score = (day, id) => crypto.createHmac('sha256', SECRET).update(day + ':' + id).digest().readUInt32BE(0);
// Tirage au sort fixe pour chaque date : le joueur qui obtient le plus petit « ticket »
// parmi ceux qui ne sont pas tombés récemment. Aucun joueur ne revient avant d'avoir vu passer presque tous les autres.
const picks = [];
function playerOfDay(day) {
  const target = Math.max(0, dayIndex(day));
  const windowSize = Math.max(1, Math.floor(IDS.length * 0.9));
  while (picks.length <= target) {
    const i = picks.length;
    const d = dayFromIndex(i);
    const recent = new Set(picks.slice(Math.max(0, i - windowSize)));
    let best = null, bestScore = Infinity;
    for (const id of IDS) {
      if (recent.has(id)) continue;
      const s = score(d, id);
      if (s < bestScore) { bestScore = s; best = id; }
    }
    picks.push(best);
  }
  return BY_ID[picks[target]];
}

// ——— Indices débloqués au fil des essais ———
const HINT_EVERY = 8;
const MAX_HINTS = 7;
function bestClub(p) {
  const len = (c) => ((c.to ?? NOW_YEAR) - (c.from ?? NOW_YEAR));
  return [...p.clubs].filter((c) => c.league && !c.loan).sort((a, b) => len(b) - len(a))[0] || p.clubs[0];
}
const initials = (p) => p.name.split(/\s+/).map((w) => w[0].toUpperCase() + '.').join(' ');
function hintText(p, k) {
  return [
    `Poste : ${POSITIONS[p.pos].name.toLowerCase()}`,
    `Né dans les années ${Math.floor(p.bornYear / 10) * 10}`,
    `Continent : ${p.continents[0] || 'inconnu'}`,
    `Nationalité : ${p.nat[0].name}`,
    `A joué à ${bestClub(p).club}`,
    `Initiales : ${initials(p)}`,
    p.fact ? `Anecdote : ${p.fact}` : `Anecdote : il a connu ${new Set(p.clubs.map((c) => c.id)).size} clubs, dont ${p.clubs[p.clubs.length - 1].club} en dernier.`,
  ][k];
}

// ——— La carte du joueur mystère, remplie avec ce que le joueur a découvert ———
function revealCard(target, guesses, hints, over) {
  const k = { clubs: [], leagues: [] };
  const addClub = (id) => { if (id && !k.clubs.includes(id)) k.clubs.push(id); };
  const addLeague = (l) => { if (l && !k.leagues.includes(l)) k.leagues.push(l); };
  for (const g of guesses) {
    if (g.type === 'clue' && g.yes) {
      const [kind, v] = g.key.split(/:(.+)/);
      if (kind === 'nat') k.nat = v;
      if (kind === 'cont') k.cont = v;
      if (kind === 'club') addClub(v);
      if (kind === 'lg') addLeague(v);
      if (kind === 'pos') k.pos = v;
      if (kind === 'dec') k.decade = +v;
      if (kind === 'act') k.active = true;
      if (kind === 'hon') k.bo = true;
    }
    if (g.type === 'clue' && !g.yes && g.key === 'hon:BO') k.bo = false;
    if (g.type === 'clue' && !g.yes && g.key.startsWith('act:')) k.active = true;
    for (const t of g.tags || []) {
      const r = t.reveal;
      if (!r) continue;
      if (r.nat) k.nat = r.nat;
      if (r.cont) k.cont = r.cont;
      if (r.pos) k.pos = r.pos;
      if (r.year) k.year = r.year;
      if (r.club) addClub(r.club);
      if (r.leagues) r.leagues.forEach(addLeague);
    }
  }
  if (hints > 0) k.pos = target.pos;
  if (hints > 1) k.decade = Math.floor(target.bornYear / 10) * 10;
  if (hints > 2) k.cont = target.continents[0];
  if (hints > 3) k.nat = target.nat[0].code;
  if (hints > 4) addClub(bestClub(target).id);
  if (over) {
    k.nat = target.nat[0].code; k.pos = target.pos; k.year = target.bornYear; k.active = true; k.bo = target.bo;
    addClub(bestClub(target).id); target.leagues.forEach(addLeague);
  }
  const nat = k.nat && target.nat.find((n) => n.code === k.nat);
  // parcours : chaque club dans l'ordre de la carrière, dévoilé quand il est trouvé
  const path = [];
  for (const c of target.clubs) {
    if (path.some((x) => x.id === c.id)) continue;
    path.push({ id: c.id, club: c.club, logo: c.logo || null, color: c.color || null });
  }
  const club = k.clubs.length ? target.clubs.find((c) => c.id === k.clubs[k.clubs.length - 1]) : null;
  return {
    name: over ? target.name : hints > 5 ? initials(target) : null,
    photo: over && target.img ? target.img.replace(/^http:/, 'https:') + '?width=400' : null,
    pos: k.pos ? POSITIONS[k.pos].short : null,
    nat: nat ? { name: nat.name, iso: nat.iso } : null,
    cont: k.cont || (nat ? nat.cont : null),
    club: club ? club.club : null,
    clubs: k.clubs.length,
    path: path.map((c) => (over || k.clubs.includes(c.id) ? { name: c.club, logo: c.logo, color: c.color } : null)),
    leagues: k.leagues.map((l) => LEAGUES[l].short),
    born: k.year || (k.decade ? `${String(k.decade).slice(0, 3)}x` : null),
    status: k.active ? (target.active ? 'Actif' : 'Retraité') : null,
    bo: k.bo === undefined ? null : k.bo,
  };
}

// ——— Fiche complète (secours si Wikipédia ne répond pas) ———
function card(p) {
  return {
    id: p.id, name: p.name, title: p.title, born: p.born, place: p.place, img: p.img,
    nat: p.nat.map((n) => n.name), iso: p.nat[0].iso,
    pos: POSITIONS[p.pos].name, active: p.active, bo: p.bo,
    clubs: p.clubs.map((c) => ({ ...c, leagueName: c.league ? LEAGUES[c.league].name : null })),
    nt: p.nt,
    mainLeague: p.mainLeague ? LEAGUES[p.mainLeague].name : null,
  };
}

function catalog() {
  return {
    players: PLAYERS.map((p) => ({ id: p.id, name: p.name, keys: p.keys, sub: p.sub })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    clues: CLUES.map((c) => ({ id: c.id, label: c.label, kind: c.kind, terms: c.terms })),
  };
}

module.exports = {
  get PLAYERS() { return PLAYERS; }, BY_ID, LAUNCH, HINT_EVERY, MAX_HINTS,
  setPool, resolve, compare, askClue, today, dayIndex, dayFromIndex, playerOfDay, hintText, revealCard, card, catalog, norm,
};
