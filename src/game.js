const crypto = require('crypto');
const RAW = require('./data/players');
const { LEAGUES, COUNTRIES, CLUBS, POSITIONS, HONOURS } = require('./data/meta');

const NOW_YEAR = new Date().getFullYear();
const LAUNCH = process.env.LAUNCH_DATE || '2026-10-13';
const SECRET = process.env.SECRET || 'change-moi-en-production';
const TZ = 'Europe/Paris';

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

// ——— Préparation des joueurs ———
function parseClubs(str) {
  return str.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
    const loan = s.startsWith('*');
    const m = s.replace(/^\*/, '').match(/^(.+?) (\d{4})(?:-(\d{4})?)?$/);
    if (!m) throw new Error('Club mal formé : ' + s);
    const [, club, a, b] = m;
    const open = /-$/.test(s);
    const from = +a;
    const to = open ? null : (b ? +b : from);
    if (!CLUBS[club]) throw new Error('Club inconnu : ' + club);
    return { club, from, to, loan, league: CLUBS[club].league, lower: !!CLUBS[club].lower, country: CLUBS[club].country };
  });
}

function parseHonours(str) {
  const out = {};
  for (const h of (str || '').split(';').map((x) => x.trim()).filter(Boolean)) {
    const [code, year] = h.split(' ');
    if (!HONOURS[code]) throw new Error('Titre inconnu : ' + h);
    (out[code] = out[code] || []).push(+year);
  }
  return out;
}

const PLAYERS = RAW.map((r) => {
  const clubs = parseClubs(r.clubs);
  const leagues = [...new Set(clubs.filter((c) => c.league).map((c) => c.league))];
  // championnat principal = celui où il a passé le plus d'années
  const yearsBy = {};
  for (const c of clubs) if (c.league) yearsBy[c.league] = (yearsBy[c.league] || 0) + ((c.to ?? NOW_YEAR) - c.from + 0.5);
  const mainLeague = Object.entries(yearsBy).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const born = +r.born.slice(0, 4);
  for (const n of r.nat) if (!COUNTRIES[n]) throw new Error('Pays inconnu : ' + n);
  const p = {
    ...r, clubs, leagues, mainLeague, bornYear: born,
    active: r.end == null && clubs.some((c) => c.to == null),
    honours: parseHonours(r.hon),
    continents: [...new Set(r.nat.map((n) => COUNTRIES[n][2]))],
  };
  p.keys = [r.name, r.full, ...(r.alias || [])].filter(Boolean).map(norm);
  return p;
});
const BY_ID = Object.fromEntries(PLAYERS.map((p) => [p.id, p]));
if (Object.keys(BY_ID).length !== PLAYERS.length) throw new Error('Identifiants en double');

// nom de famille → joueur, seulement quand il n'y a pas d'ambiguïté
const LAST = {};
for (const p of PLAYERS) {
  const parts = norm(p.name).split(' ');
  if (parts.length < 2) continue;
  const last = parts.slice(1).join(' ');
  LAST[last] = LAST[last] === undefined ? p.id : false;
}

// ——— Indices "mots-clés" ———
const CLUES = [];
const addClue = (id, label, kind, terms, test, temp) => CLUES.push({ id, label, kind, terms: [label, ...terms].map(norm), test, temp });

for (const [code, l] of Object.entries(LEAGUES))
  addClue('lg:' + code, l.name, 'Championnat', [l.long, code === 'L1' ? 'division 1' : '', code === 'LL' ? 'la liga' : ''].filter(Boolean),
    (p) => p.leagues.includes(code), 22);
const usedNat = new Set(PLAYERS.flatMap((p) => p.nat));
for (const code of Object.keys(COUNTRIES)) {
  if (code === 'RFA' || code === 'MCO') continue;
  const [name, adj] = COUNTRIES[code];
  if (!usedNat.has(code) && !['SUI', 'AUT', 'COL', 'USA', 'JPN'].includes(code)) continue;
  addClue('nat:' + code, name, 'Nationalité', [adj], (p) => p.nat.includes(code), 38);
}
for (const cont of ['Europe', 'Afrique', 'Amérique du Sud', 'Amérique du Nord', 'Asie'])
  addClue('cont:' + cont, cont, 'Continent', [cont === 'Afrique' ? 'africain' : cont === 'Europe' ? 'europeen' : cont === 'Asie' ? 'asiatique' : cont === 'Amérique du Sud' ? 'sud americain' : 'nord americain'],
    (p) => p.continents.includes(cont), 15);
for (const club of Object.keys(CLUBS).sort())
  addClue('club:' + club, club, 'Club', [], (p) => p.clubs.some((c) => c.club === club), 45);
for (const [code, pos] of Object.entries(POSITIONS))
  addClue('pos:' + code, pos.clue, 'Poste', [pos.name, code === 'GB' ? 'goal' : code === 'ATT' ? 'buteur' : code === 'DEF' ? 'defense' : 'milieu'],
    (p) => p.pos === code, 18);
for (let d = 1920; d <= 2000; d += 10) {
  const short = String(d).slice(2);
  addClue('dec:' + d, `Né dans les années ${d}`, 'Génération', [`annees ${short}`, `annees ${d}`, `${d}s`, `ne en ${d}`],
    (p) => Math.floor(p.bornYear / 10) * 10 === d, 28);
}
addClue('hon:CM', 'Champion du monde', 'Palmarès', ['coupe du monde', 'vainqueur coupe du monde'], (p) => !!p.honours.CM, 25);
addClue('hon:LDC', 'Vainqueur de la Ligue des champions', 'Palmarès', ['ligue des champions', 'ldc', 'c1', 'champions league'], (p) => !!p.honours.LDC, 20);
addClue('hon:BO', "Ballon d'or", 'Palmarès', ['ballon d or', 'ballon dor'], (p) => !!p.honours.BO, 30);
addClue('hon:CONT', 'Champion continental', 'Palmarès', ['euro', 'copa america', 'can', 'championnat d europe', 'coupe d afrique'],
  (p) => !!(p.honours.EURO || p.honours.COPA || p.honours.CAN), 20);
addClue('act:1', 'Toujours en activité', 'Carrière', ['en activite', 'actif', 'joue encore'], (p) => p.active, 12);
addClue('act:0', 'Retraité', 'Carrière', ['retraite', 'a la retraite', 'legende'], (p) => !p.active, 12);
const CLUE_BY_ID = Object.fromEntries(CLUES.map((c) => [c.id, c]));

// ——— Résolution d'une saisie ———
function resolve({ type, id, q }) {
  if (type === 'player' && BY_ID[id]) return { type: 'player', player: BY_ID[id] };
  if (type === 'clue' && CLUE_BY_ID[id]) return { type: 'clue', clue: CLUE_BY_ID[id] };
  const n = norm(q || '');
  if (!n) return null;
  let p = PLAYERS.find((x) => norm(x.name) === n) || PLAYERS.find((x) => x.keys.includes(n));
  if (!p && LAST[n]) p = BY_ID[LAST[n]];
  if (p) return { type: 'player', player: p };
  const c = CLUES.find((x) => x.terms.includes(n));
  if (c) return { type: 'clue', clue: c };
  return null;
}

// ——— Proximité entre deux joueurs ———
const overlap = (a, b) => {
  const ae = a.to ?? NOW_YEAR, be = b.to ?? NOW_YEAR;
  return Math.min(a.from === ae ? ae + 0.5 : ae, b.from === be ? be + 0.5 : be) > Math.max(a.from, b.from);
};
const ADJ = { GB: ['DEF'], DEF: ['GB', 'MIL'], MIL: ['DEF', 'ATT'], ATT: ['MIL'] };

function compare(target, guess) {
  if (target.id === guess.id) return { temp: 100, tags: [{ t: 'Trouvé !', ok: true }] };
  let s = 0;
  const tags = [];
  const sameNat = target.nat.filter((n) => guess.nat.includes(n));
  if (sameNat.length) { s += 20; tags.push({ t: `Même nationalité (${COUNTRIES[sameNat[0]][0]})`, ok: true }); }
  else if (target.continents.some((c) => guess.continents.includes(c))) { s += 5; tags.push({ t: 'Même continent', ok: true }); }

  if (target.pos === guess.pos) { s += 10; tags.push({ t: 'Même poste', ok: true }); }
  else if (ADJ[target.pos].includes(guess.pos)) { s += 4; tags.push({ t: 'Poste voisin', half: true }); }

  const d = target.bornYear - guess.bornYear;
  s += Math.max(0, 14 - Math.abs(d) * 1.4);
  tags.push(d === 0 ? { t: 'Né la même année', ok: true } : { t: d < 0 ? 'Le mystère est plus âgé' : 'Le mystère est plus jeune', dir: d < 0 ? 'up' : 'down', half: Math.abs(d) <= 3 });

  const tClubs = new Set(target.clubs.map((c) => c.club));
  const shared = [...new Set(guess.clubs.map((c) => c.club).filter((c) => tClubs.has(c)))];
  let mates = null;
  for (const gc of guess.clubs) for (const tc of target.clubs) if (gc.club === tc.club && overlap(gc, tc)) mates = mates || gc.club;
  s += Math.min(26, shared.length * 11);
  if (mates) { s += 10; tags.push({ t: `Coéquipiers à ${mates}`, ok: true }); }
  for (const c of shared.filter((c) => c !== mates).slice(0, 2)) tags.push({ t: `Passé par ${c}`, ok: true });

  const sharedL = target.leagues.filter((l) => guess.leagues.includes(l));
  s += Math.min(14, sharedL.length * 5);
  if (sharedL.length) tags.push({ t: sharedL.map((l) => LEAGUES[l].name).join(', '), ok: true });
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
function rng(seedHex) {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cycles = {};
function cycleOrder(c) {
  if (cycles[c]) return cycles[c];
  const r = rng(crypto.createHmac('sha256', SECRET).update('cycle:' + c).digest('hex'));
  const ids = PLAYERS.map((p) => p.id).sort();
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
  return (cycles[c] = ids);
}
// Tirage aléatoire mais fixe pour une date : chaque joueur sort une fois avant qu'un autre ne revienne.
function playerOfDay(day) {
  const i = dayIndex(day);
  const n = PLAYERS.length;
  const c = Math.floor(i / n);
  return BY_ID[cycleOrder(c)[((i % n) + n) % n]];
}

// ——— Indices débloqués au fil des essais ———
const HINT_EVERY = 8;
function hintText(p, k) {
  const big = p.clubs.filter((c) => c.league && !c.loan).sort((a, b) => ((b.to ?? NOW_YEAR) - b.from) - ((a.to ?? NOW_YEAR) - a.from))[0] || p.clubs[0];
  const initials = p.name.split(/\s+/).map((w) => w[0].toUpperCase() + '.').join(' ');
  return [
    `Poste : ${POSITIONS[p.pos].name.toLowerCase()}`,
    `Né dans les années ${Math.floor(p.bornYear / 10) * 10}`,
    `Continent : ${p.continents[0]}`,
    `Nationalité : ${COUNTRIES[p.nat[0]][0]}`,
    `A joué à ${big.club}`,
    `Initiales : ${initials}`,
  ][k];
}
const MAX_HINTS = 6;

// ——— Fiche complète ———
function card(p) {
  return {
    id: p.id, name: p.name, full: p.full || null, born: p.born, place: p.place, wiki: p.wiki || p.name,
    nat: p.nat.map((n) => COUNTRIES[n][0]),
    pos: POSITIONS[p.pos].name, active: p.active, end: p.end || null,
    clubs: p.clubs.map((c) => ({ ...c, leagueName: c.league ? LEAGUES[c.league].name : null, countryName: COUNTRIES[c.country]?.[0] || c.country })),
    nt: p.nt ? { team: COUNTRIES[p.nt[0]][0], from: p.nt[1], to: p.nt[2], caps: p.nt[3] ?? null, goals: p.nt[4] ?? null } : null,
    honours: Object.entries(p.honours).map(([k, years]) => ({ code: k, name: HONOURS[k], years })),
    mainLeague: p.mainLeague ? LEAGUES[p.mainLeague].name : null,
  };
}

function catalog() {
  return {
    players: PLAYERS.map((p) => ({ id: p.id, name: p.name, keys: p.keys })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    clues: CLUES.map((c) => ({ id: c.id, label: c.label, kind: c.kind, terms: c.terms })),
  };
}

module.exports = {
  PLAYERS, BY_ID, CLUES, CLUE_BY_ID, LAUNCH, HINT_EVERY, MAX_HINTS,
  resolve, compare, askClue, today, dayIndex, dayFromIndex, playerOfDay, hintText, card, catalog, norm,
};
