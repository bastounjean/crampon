const crypto = require('crypto');
const { LEAGUES, COUNTRIES, POSITIONS } = require('./data/meta');
const I18N = require('./i18n');
const ALIAS = require('./data/aliases');

const NOW_YEAR = new Date().getFullYear();
const LAUNCH = process.env.LAUNCH_DATE || '2026-10-13';
const SECRET = process.env.SECRET || 'change-moi-en-production';
if (!process.env.SECRET && process.env.NODE_ENV === 'production') console.warn('ATTENTION : SECRET non défini, les joueurs à venir sont prévisibles depuis le code.');
const TZ = 'Europe/Paris';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[ʼ'’`.\-]/g, ' ').replace(/[^a-z0-9ıİşğøæœß ]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/ø/g, 'o').replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g');

// gentilés connus, pour accepter « Brésilien » comme « Brésil »
const ADJ = {};
for (const [name, adj] of Object.values(COUNTRIES)) ADJ[norm(name)] = adj;
const byNorm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [norm(k), v]));
const NAT_ALIAS = byNorm(ALIAS.COUNTRIES), TEAM_ALIAS = byNorm(ALIAS.TEAMS), CLUB_ALIAS = byNorm(ALIAS.CLUBS);
// Royaume-Uni : un Anglais, un Écossais, un Gallois ou un Nord-Irlandais est britannique, même si sa fiche ne le dit pas
const UK = 'Q145', HOME_NATIONS = new Set(['Q21', 'Q22', 'Q25', 'Q26']);

// ——— Joueurs ———
// IDS : la liste fixe des joueurs qui peuvent tomber (src/data/pool.json).
// Les fiches sont rafraîchies depuis Wikidata par le serveur.
let IDS = [];
let PLAYERS = [];
let EXTRA = []; // joueurs qu'on peut proposer mais qui ne tombent jamais (src/data/extra.json)
let SINCE = {}; // joueurs ajoutés après coup : ils ne peuvent tomber qu'à partir de cette date
let FIXED = {}; // tirages déjà faits (enregistrés en base) : ils ne changent plus, même si les fiches évoluent
// Joueurs décédés : ils ne tombent plus comme joueur du jour ni en duel à partir de cette date.
// La date de décès vient de Wikidata (champ died) ; cette liste couvre ceux qu'on connaît déjà.
const NO_DEAD_FROM = '2026-10-30';
const DECEASED = new Set(['Q17163', 'Q4457', 'Q482931', 'Q43744', 'Q164546', 'Q164521', 'Q171583', 'Q178628', 'Q192131', 'Q189587', 'Q192749', 'Q213879',
  'Q276026', 'Q216140', 'Q191492', 'Q220700', 'Q123118', 'Q233565', 'Q366783', 'Q17515', 'Q19518278', 'Q276399', 'Q159045', 'Q295307']);
const isDead = (p) => !!p && (DECEASED.has(p.id) || !!p.died);
const BY_ID = {}; // toutes les fiches déjà vues, même si elles sortent de la liste
let CLUES = [], CLUE_BY_ID = {}, LAST = {}, CLUB_NAMES = {};

// pays sans code ISO dans Wikidata (le drapeau resterait vide)
const ISO = { Q55: 'nl', Q713750: 'de', Q33946: 'cz' };
const withIso = (list) => (list || []).map((n) => (n.iso || !ISO[n.code] ? n : { ...n, iso: ISO[n.code] }));
function prepare(raw) {
  const p = { ...raw };
  p.nat = withIso(p.nat);
  if (p.cit) p.cit = withIso(p.cit);
  p.bornYear = +p.born.slice(0, 4);
  p.leagues = [...new Set(p.clubs.map((c) => c.league).filter(Boolean))];
  const yearsBy = {};
  for (const c of p.clubs) if (c.league && c.from) yearsBy[c.league] = (yearsBy[c.league] || 0) + ((c.to ?? NOW_YEAR) - c.from + 0.5);
  p.mainLeague = Object.entries(yearsBy).sort((a, b) => b[1] - a[1])[0]?.[0] || p.leagues[0] || null;
  p.continents = [...new Set(p.nat.map((n) => n.cont).filter(Boolean))];
  // nat : nationalité sportive (la sélection). cit : nationalités au sens de l'état civil (Wikidata P27).
  p.cit = p.cit && p.cit.length ? p.cit : p.nat;
  p.keys = [...new Set([p.name, ...(p.aliases || [])].map(norm).filter(Boolean))];
  p.sub = `${p.nat[0].name} · ${p.bornYear}`;
  return p;
}

function setPool(ids, players, since = {}, extra = null) {
  for (const raw of players) BY_ID[raw.id] = prepare(raw);
  SINCE = since;
  IDS = [...ids].filter((id) => BY_ID[id]).sort();
  PLAYERS = IDS.map((id) => BY_ID[id]);
  if (extra) {
    const inPool = new Set(IDS);
    EXTRA = extra.filter((raw) => !inPool.has(raw.id)).map((raw) => (BY_ID[raw.id] = prepare(raw)));
  }
  // nom de famille seul : les joueurs qui peuvent tomber passent d'abord (« Mbappé » = Kylian)
  // plusieurs joueurs du même nom : on prend le plus connu s'il l'est nettement (« Saliba » = William)
  const lastNames = (list) => {
    const by = {};
    for (const p of list) {
      const parts = norm(p.name).split(' ');
      if (parts.length < 2) continue;
      (by[parts.slice(1).join(' ')] ||= []).push(p);
    }
    const out = {};
    for (const [last, ps] of Object.entries(by)) {
      ps.sort((a, b) => (b.links || 0) - (a.links || 0));
      out[last] = ps.length === 1 || (ps[0].links || 0) >= 1.8 * (ps[1].links || 0) ? ps[0].id : false;
    }
    return out;
  };
  LAST = { ...lastNames(EXTRA), ...lastNames(PLAYERS) };
  buildClues();
  picks.length = 0;
  DECK = null;
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

  const nats = {}, sels = {};
  for (const p of PLAYERS) { for (const n of p.cit) nats[n.code] = n; for (const n of p.nat) sels[n.code] = n; }
  if (!nats[UK] && Object.keys(nats).some((c) => HOME_NATIONS.has(c))) nats[UK] = { code: UK, name: 'Royaume-Uni' };
  for (const n of Object.values(nats)) {
    const adj = ADJ[norm(n.name)];
    const terms = [...(adj ? [adj] : []), 'nationalite ' + n.name, ...(NAT_ALIAS[norm(n.name)] || [])];
    const test = n.code === UK ? (p) => p.cit.some((x) => x.code === UK || HOME_NATIONS.has(x.code)) : (p) => p.cit.some((x) => x.code === n.code);
    add('nat:' + n.code, n.name, 'Nationalité', terms, test, 34);
  }
  // la sélection : l'équipe nationale pour laquelle il joue (« équipe de France », « sélection Brésil »)
  for (const n of Object.values(sels)) {
    const adj = ADJ[norm(n.name)];
    const terms = ['selection ' + n.name, 'selectionne ' + n.name, 'equipe de ' + n.name, 'equipe du ' + n.name, 'equipe d ' + n.name, 'equipe des ' + n.name, 'joue pour ' + n.name];
    if (adj) terms.push('international ' + adj, 'selection ' + adj, 'equipe ' + adj);
    terms.push(...(TEAM_ALIAS[norm(n.name)] || []));
    add('sel:' + n.code, 'Sélection : ' + n.name, 'Sélection', terms, (p) => p.nat.some((x) => x.code === n.code), 38);
  }
  const contAdj = { Europe: 'europeen', Afrique: 'africain', Asie: 'asiatique', 'Amérique du Sud': 'sud americain', 'Amérique du Nord': 'nord americain', 'Océanie': 'oceanien' };
  for (const [cont, adj] of Object.entries(contAdj))
    if (PLAYERS.some((p) => p.continents.includes(cont))) add('cont:' + cont, cont, 'Continent', [adj], (p) => p.continents.includes(cont), 15);

  CLUB_NAMES = {};
  for (const p of PLAYERS) for (const c of p.clubs) CLUB_NAMES[c.id] = c.club;
  for (const [id, name] of Object.entries(CLUB_NAMES).sort((a, b) => a[1].localeCompare(b[1], 'fr')))
    add('club:' + id, name, 'Club', [shortName(name), name.replace(/^Olympique (de )?/i, ''), ...(NICK[norm(name)] || []), ...(CLUB_ALIAS[norm(name)] || [])], (p) => p.clubs.some((c) => c.id === id), 45);

  for (const [code, pos] of Object.entries(POSITIONS))
    add('pos:' + code, pos.clue, 'Poste', [pos.name, code === 'GB' ? 'goal' : code === 'ATT' ? 'buteur' : code === 'DEF' ? 'defense' : 'milieu', ...ALIAS.POSITIONS[code]], (p) => p.pos === code, 18);
  for (let d = 1920; d <= 2000; d += 10) {
    const short = String(d).slice(2);
    add('dec:' + d, `Né dans les années ${d}`, 'Génération', [`annees ${short}`, `annees ${d}`, `${d}s`, `ne en ${d}`, `ne dans les annees ${short}`, `ne dans les annees ${d}`], (p) => Math.floor(p.bornYear / 10) * 10 === d, 28);
  }
  add('hon:BO', "Ballon d'or", 'Palmarès', ['ballon d or', 'ballon dor', 'vainqueur du ballon d or'], (p) => p.bo, 30);
  add('act:1', 'Toujours en activité', 'Carrière', ['en activite', 'actif', 'joue encore'], (p) => p.active, 12);
  add('act:0', 'Retraité', 'Carrière', ['retraite', 'a la retraite', 'legende'], (p) => !p.active, 12);
  // mots anglais acceptés aussi (version anglaise du site)
  for (const c of CLUES) c.terms = [...new Set([...c.terms, ...I18N.extraTerms(c.id, c.label).map(norm)])].filter(Boolean);
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
  // un surnom qui est aussi un indice (« attaquant » ajouté par erreur sur Wikidata) ne désigne pas le joueur
  const clueTerms = new Set(CLUES.flatMap((c) => c.terms));
  for (const p of [...PLAYERS, ...EXTRA]) p.keys = p.keys.filter((k) => k === norm(p.name) || !clueTerms.has(k));
  FUZZY = [];
  const seen = new Set(PLAYERS.flatMap((p) => p.keys));
  for (const p of PLAYERS) for (const k of p.keys) FUZZY.push([k, 'p:' + p.id]);
  for (const p of EXTRA) for (const k of p.keys) if (!seen.has(k)) FUZZY.push([k, 'p:' + p.id]);
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
  const p = PLAYERS.find((x) => x.keys.includes(n)) || EXTRA.find((x) => x.keys.includes(n)) || (LAST[n] ? BY_ID[LAST[n]] : null);
  if (p) return { type: 'player', player: p };
  if (LAST[n] === false) return { error: `Plusieurs joueurs s'appellent « ${n} ». Ajoute le prénom.` };
  const cs = CLUES.filter((x) => x.terms.includes(n));
  const clubs = [...cs.filter((c) => c.kind === 'Club').map((c) => c.id.slice(5)), ...(CITY[n] || [])];
  const other = cs.find((c) => c.kind !== 'Club');
  if (other) return { type: 'clue', clue: other };
  return pickClub(clubs, n);
}

// suggestions sous la barre de recherche, à partir de 3 lettres
function suggest(q) {
  const n = norm(q || '').trim();
  if (n.length < 3) return [];
  const score = (keys) => {
    let best = 0;
    for (const k of keys) {
      if (k === n) return 4;
      if (k.startsWith(n)) best = Math.max(best, 3);
      else if (best < 2 && k.split(' ').some((w) => w.startsWith(n))) best = 2;
      else if (best < 1 && k.includes(n)) best = 1;
    }
    return best;
  };
  const out = [];
  for (const p of [...PLAYERS, ...EXTRA]) { const s = score(p.keys); if (s) out.push({ type: 'player', id: p.id, name: p.name, kind: p.sub, s, w: p.links || 0 }); }
  for (const c of CLUES) { const s = score(c.terms); if (s) out.push({ type: 'clue', id: c.id, label: c.label, kind: c.kind, s, w: 1e6 }); }
  return out.sort((a, b) => b.s - a.s || b.w - a.w).slice(0, 8).map(({ s, w, ...x }) => x);
}

function resolve({ q, id }) {
  // suggestion choisie dans la liste : on sait exactement de quoi il s'agit
  if (id && CLUE_BY_ID[id]) return { type: 'clue', clue: CLUE_BY_ID[id] };
  if (id && BY_ID[id] && (PLAYERS.includes(BY_ID[id]) || EXTRA.includes(BY_ID[id]))) return { type: 'player', player: BY_ID[id] };
  const n = norm(q || '').replace(/^(a |au |en |le |la |l |les |joue a |a joue a |a joue au |passe par |played for |plays for |played at |played in |the )+/, '').trim();
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
  const sameCit = target.cit.filter((n) => guess.cit.some((g) => g.code === n.code));
  if (sameNat.length) { s += 20; tags.push({ t: `Même sélection (${sameNat[0].name})`, ok: true, reveal: { nat: sameNat[0].code } }); }
  if (sameCit.length && !(sameNat.length && sameCit.every((c) => c.code === sameNat[0].code))) {
    const c = sameCit.find((x) => !sameNat.length || x.code !== sameNat[0].code) || sameCit[0];
    s += sameNat.length ? 4 : 12; tags.push({ t: `Même nationalité (${c.name})`, ok: true, reveal: { cit: c.code } });
  }
  if (sameNat.length) { /* continent déjà dévoilé par la sélection */ }
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

// ——— Température : plus tu en sais, moins il reste de joueurs possibles ———
// Chaque oui/non, et chaque point commun trouvé avec un joueur proposé, élimine des joueurs de la liste. La température suit le nombre de candidats restants, en échelle log :
// 600 → 0°, ~80 → 30°, ~10 → 65°, 1 seul → 99°. Elle monte donc à chaque essai utile, jusqu'à 100.
// Pour un joueur proposé, on ne garde que ce qu'il dévoile sur la carte (nationalité, poste, clubs…),
// pas tout ce qu'un joueur très attentif pourrait déduire : sinon un seul essai suffit à tout trancher.
const fits = (p, r) => (!r.nat || p.nat.some((n) => n.code === r.nat))
  && (!r.cit || p.cit.some((n) => n.code === r.cit))
  && (!r.cont || p.continents.includes(r.cont))
  && (!r.pos || p.pos === r.pos)
  && (!r.year || p.bornYear === r.year)
  && (!r.club || p.clubs.some((c) => c.id === r.club))
  && (!r.leagues || r.leagues.every((l) => p.leagues.includes(l)));
function candidates(target, guesses) {
  const checks = guesses.map((g) => {
    if (g.type === 'clue') { const c = CLUE_BY_ID[g.key]; return c ? (p) => c.test(p) === g.yes : () => true; }
    const gp = BY_ID[g.key];
    if (!gp) return () => true;
    const rev = compare(target, gp).tags.filter((t) => t.reveal).map((t) => t.reveal);
    return (p) => p.id !== gp.id && rev.every((r) => fits(p, r));
  });
  return PLAYERS.filter((p) => p.id === target.id || checks.every((c) => c(p)));
}
function heat(target, guesses) {
  if (guesses.some((g) => g.key === target.id)) return 100;
  const left = Math.max(1, candidates(target, guesses).length);
  // au carré : écarter quelques joueurs ne réchauffe presque pas, il faut vraiment resserrer l'étau
  const k = 1 - Math.log(left) / Math.log(PLAYERS.length);
  return Math.min(99, Math.round(99 * k * k));
}

// ——— Joueur du jour ———
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
function today() {
  return DAY_FMT.format(new Date());
}
function dayIndex(day) {
  return Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(LAUNCH + 'T00:00:00Z')) / 86400000);
}
function dayFromIndex(i) {
  return new Date(Date.parse(LAUNCH + 'T00:00:00Z') + i * 86400000).toISOString().slice(0, 10);
}
const drawScore = (day, id) => crypto.createHmac('sha256', SECRET).update(day + ':' + id).digest().readUInt32BE(0);
// Tirage au sort fixe pour chaque date : le joueur qui obtient le plus petit « ticket »
// parmi ceux qui ne sont pas tombés récemment. Aucun joueur ne revient avant d'avoir vu passer presque tous les autres.
const picks = [];
function playerOfDay(day) {
  const target = Math.max(0, dayIndex(day));
  while (picks.length <= target) {
    const i = picks.length;
    const d = dayFromIndex(i);
    // un joueur ajouté plus tard ne change pas les tirages des jours d'avant
    if (FIXED[d] && BY_ID[FIXED[d]]) { picks.push(FIXED[d]); continue; }
    const ids = IDS.filter((id) => (!SINCE[id] || SINCE[id] <= d) && !(d >= NO_DEAD_FROM && isDead(BY_ID[id])));
    const windowSize = Math.max(1, Math.floor(ids.length * 0.9));
    const recent = new Set(picks.slice(Math.max(0, i - windowSize)));
    let best = null, bestScore = Infinity;
    for (const id of ids) {
      if (recent.has(id)) continue;
      const s = drawScore(d, id);
      if (s < bestScore) { bestScore = s; best = id; }
    }
    picks.push(best);
  }
  return BY_ID[picks[target]];
}
// tirages enregistrés en base (jour → identifiant)
function fixDraws(map) {
  FIXED = { ...map };
  picks.length = 0;
}

// ——— Indices débloqués au fil des essais ———
const HINT_EVERY = 6;
const FIRST_HINT = 5;
// essais nécessaires pour débloquer l'indice n° h+1 (le premier arrive vite, pour ne pas laisser les nouveaux bloqués)
const hintAt = (h) => FIRST_HINT + h * HINT_EVERY;
const MAX_HINTS = 7;
function bestClub(p) {
  const len = (c) => ((c.to ?? NOW_YEAR) - (c.from ?? NOW_YEAR));
  return [...p.clubs].filter((c) => c.league && !c.loan).sort((a, b) => len(b) - len(a))[0] || p.clubs[0];
}
const initials = (p) => p.name.split(/\s+/).map((w) => w[0].toUpperCase() + '.').join(' ');
// Un indice = un type ('pos', 'dec', 'cont', 'nat', 'club:Q…', 'ini', 'fact'). Ancien format : un simple nombre d'indices.
const HINT_ORDER = ['pos', 'dec', 'cont', 'nat', 'club', 'ini', 'fact'];
const hintList = (hints) => (Array.isArray(hints) ? hints : HINT_ORDER.slice(0, hints || 0));
function hintText(p, h) {
  const [kind, v] = String(typeof h === 'number' ? HINT_ORDER[h] : h).split(/:(.+)/);
  if (kind === 'pos') return `Poste : ${POSITIONS[p.pos].name.toLowerCase()}`;
  if (kind === 'dec') return `Né dans les années ${Math.floor(p.bornYear / 10) * 10}`;
  if (kind === 'cont') return `Continent : ${p.continents[0] || 'inconnu'}`;
  if (kind === 'nat') return `Sélection : ${p.nat[0].name}`;
  if (kind === 'club') return `A joué à ${(p.clubs.find((c) => c.id === v) || bestClub(p)).club}`;
  if (kind === 'ini') return `Initiales : ${initials(p)}`;
  return p.fact ? `Anecdote : ${p.fact}` : `Anecdote : il a connu ${new Set(p.clubs.map((c) => c.id)).size} clubs, dont ${p.clubs[p.clubs.length - 1].club} en dernier.`;
}
// L'indice suivant : le premier type pas encore donné qui apprend vraiment quelque chose.
// Ce que le joueur a déjà découvert (poste, génération, sélection, club…) n'est jamais redonné.
function nextHint(target, guesses, hints) {
  const given = hintList(hints);
  const k = known(target, guesses, given);
  const kinds = given.map((h) => h.split(':')[0]);
  const useful = {
    pos: !k.pos,
    dec: !k.decade && !k.year,
    cont: !k.cont && !k.nat,
    nat: !k.nat,
    ini: true,
    fact: true,
  };
  // club : le club principal s'il est encore inconnu, sinon un autre des grands championnats, sinon n'importe lequel
  const len = (c) => ((c.to ?? NOW_YEAR) - (c.from ?? NOW_YEAR));
  const unknownClub = [bestClub(target), ...[...target.clubs].sort((a, b) => (!!b.league - !!a.league) || len(b) - len(a))]
    .find((c) => c && !k.clubs.includes(c.id));
  for (const kind of HINT_ORDER) {
    if (kinds.includes(kind)) continue;
    if (kind === 'club') { if (unknownClub) return 'club:' + unknownClub.id; continue; }
    if (useful[kind]) return kind;
  }
  // le reste est déjà connu : un autre club pas encore trouvé, sinon plus rien à apprendre
  return unknownClub ? 'club:' + unknownClub.id : null;
}

// Ce que le joueur sait du mystère, d'après ses essais et ses indices
function known(target, guesses, hints = []) {
  const k = { clubs: [], leagues: [] };
  const addClub = (id) => { if (id && !k.clubs.includes(id)) k.clubs.push(id); };
  const addLeague = (l) => { if (l && !k.leagues.includes(l)) k.leagues.push(l); };
  for (const g of guesses) {
    if (g.type === 'clue' && g.yes) {
      const [kind, v] = g.key.split(/:(.+)/);
      if (kind === 'nat') k.cit = v;
      if (kind === 'sel') k.nat = v;
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
      if (r.cit) k.cit = r.cit;
      if (r.cont) k.cont = r.cont;
      if (r.pos) k.pos = r.pos;
      if (r.year) k.year = r.year;
      if (r.club) addClub(r.club);
      if (r.leagues) r.leagues.forEach(addLeague);
    }
  }
  for (const h of hintList(hints)) {
    const [kind, v] = h.split(/:(.+)/);
    if (kind === 'pos') k.pos = target.pos;
    if (kind === 'dec') k.decade = Math.floor(target.bornYear / 10) * 10;
    if (kind === 'cont') k.cont = target.continents[0];
    if (kind === 'nat') k.nat = target.nat[0].code;
    if (kind === 'club') addClub(v || bestClub(target).id);
    if (kind === 'ini') k.initials = true;
  }
  return k;
}

// ——— Points du jour ———
// Moins d'essais = plus de points ; un joueur peu connu rapporte jusqu'à deux fois plus.
function rarity(p) {
  const sorted = [...PLAYERS].sort((a, b) => (b.links || 0) - (a.links || 0));
  const i = Math.max(0, sorted.findIndex((x) => x.id === p.id));
  const pct = sorted.length > 1 ? i / (sorted.length - 1) : 0;
  return { mult: Math.round((1 + pct) * 100) / 100, stars: Math.min(5, 1 + Math.floor(pct * 5)) };
}
function score(p, guesses, hints) {
  const base = Math.max(10, Math.round(100 * 0.93 ** (guesses - 1)));
  const help = Math.max(0.3, 1 - 0.1 * hints);
  const r = rarity(p);
  return { points: Math.round(base * help * r.mult), base, help, mult: r.mult, stars: r.stars, guesses, hints };
}

// ——— La carte du joueur mystère, remplie avec ce que le joueur a découvert ———
function revealCard(target, guesses, hints, over) {
  const k = known(target, guesses, hints);
  const addClub = (id) => { if (id && !k.clubs.includes(id)) k.clubs.push(id); };
  const addLeague = (l) => { if (l && !k.leagues.includes(l)) k.leagues.push(l); };
  if (over) {
    k.nat = target.nat[0].code; k.cit = target.cit[0].code; k.pos = target.pos; k.year = target.bornYear; k.active = true; k.bo = target.bo;
    addClub(bestClub(target).id); target.leagues.forEach(addLeague);
  }
  const nat = k.nat && target.nat.find((n) => n.code === k.nat);
  // nationalités : toutes une fois la partie finie, sinon celle qui a été trouvée
  const cit = over ? target.cit : k.cit ? target.cit.filter((n) => n.code === k.cit) : [];
  // parcours : chaque club dans l'ordre de la carrière, dévoilé quand il est trouvé
  const path = [];
  for (const c of target.clubs) {
    if (path.some((x) => x.id === c.id)) continue;
    path.push({ id: c.id, club: c.club, logo: c.logo || null, color: c.color || null });
  }
  const club = k.clubs.length ? target.clubs.find((c) => c.id === k.clubs[k.clubs.length - 1]) : null;
  return {
    name: over ? target.name : k.initials ? initials(target) : null,
    photo: over && target.img ? target.img.replace(/^http:/, 'https:') + '?width=400' : null,
    pos: k.pos ? POSITIONS[k.pos].short : null,
    nat: nat ? { name: nat.name, iso: nat.iso } : null,
    cit: cit.length ? cit.map((n) => n.name).join(' / ') : null,
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

// ——— Collection : un pack par jour, 5 cartes. Plus un joueur est connu, plus sa carte est rare ———
// Notoriété = nombre de pages Wikipédia. Le haut du classement donne les cartes légende (1 %), or (6 %),
// argent (23 %), le reste est en bronze. Chaque carte tire d'abord sa rareté, puis un joueur de cette rareté.
const TIERS = [
  { id: 'legend', share: 0.01, weight: 1 },
  { id: 'gold', share: 0.06, weight: 6 },
  { id: 'silver', share: 0.23, weight: 23 },
  { id: 'bronze', share: 0.70, weight: 70 },
];
let DECK = null;
function deck() {
  if (DECK) return DECK;
  const list = [...PLAYERS, ...EXTRA].sort((a, b) => (b.links || 0) - (a.links || 0) || (a.id < b.id ? -1 : 1));
  const tierOf = {}, rating = {}, byTier = {};
  let from = 0;
  TIERS.forEach((t, k) => {
    const to = k === TIERS.length - 1 ? list.length : from + Math.round(list.length * t.share);
    byTier[t.id] = list.slice(from, to).map((p) => p.id);
    from = to;
  });
  list.forEach((p, i) => {
    rating[p.id] = Math.round(97 - 34 * (i / Math.max(1, list.length - 1)) ** 0.55);
  });
  for (const [t, ids] of Object.entries(byTier)) for (const id of ids) tierOf[id] = t;
  DECK = { tierOf, rating, byTier, size: list.length };
  return DECK;
}
// carte de collection : mêmes infos que la carte du jeu une fois le joueur trouvé
function collectCard(p) {
  const d = deck();
  const clubs = p.clubs.filter((c) => !c.loan);
  const last = clubs[clubs.length - 1] || p.clubs[p.clubs.length - 1];
  return {
    id: p.id, name: p.name,
    photo: p.img ? p.img.replace(/^http:/, 'https:') + '?width=400' : null,
    pos: POSITIONS[p.pos] ? POSITIONS[p.pos].short : null,
    nat: { name: p.nat[0].name, iso: p.nat[0].iso },
    cit: (p.cit || p.nat).map((n) => n.name).join(' / '),
    cont: p.nat[0].cont || p.continents[0] || null,
    club: last ? last.club : null,
    leagues: p.leagues.map((l) => LEAGUES[l].short),
    born: p.bornYear,
    status: p.active ? 'Actif' : 'Retraité',
    bo: !!p.bo,
    tier: d.tierOf[p.id] || 'bronze', rating: d.rating[p.id] || 60,
  };
}
// rand(n) → entier de 0 à n-1. La 5e carte est au moins argent ; les cartes sortent de la moins rare à la plus rare.
function drawPack(rand, size = 5) {
  const d = deck();
  const roll = (tiers) => {
    const total = tiers.reduce((n, t) => n + t.weight, 0);
    let r = rand(total);
    for (const t of tiers) if ((r -= t.weight) < 0) return t.id;
    return tiers[tiers.length - 1].id;
  };
  const got = new Set();
  const out = [];
  for (let k = 0; k < size; k++) {
    const tier = roll(k === size - 1 ? TIERS.filter((t) => t.id !== 'bronze') : TIERS);
    let id;
    do id = d.byTier[tier][rand(d.byTier[tier].length)]; while (got.has(id));
    got.add(id);
    out.push(id);
  }
  const order = TIERS.map((t) => t.id).reverse();
  return out.sort((a, b) => order.indexOf(d.tierOf[a]) - order.indexOf(d.tierOf[b]) || d.rating[a] - d.rating[b]);
}
// joueur à deviner en duel : un des 400 plus connus parmi ceux qui peuvent tomber (fiches complètes)
function duelPick(rand) {
  const top = PLAYERS.filter((p) => !isDead(p)).sort((a, b) => (b.links || 0) - (a.links || 0)).slice(0, 400);
  return top[rand(top.length)];
}
function deckTotals() {
  const d = deck();
  return Object.fromEntries(TIERS.map((t) => [t.id, d.byTier[t.id].length]));
}

function catalog() {
  return {
    players: [...PLAYERS, ...EXTRA].map((p) => ({ id: p.id, name: p.name, keys: p.keys, sub: p.sub })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    clues: CLUES.map((c) => ({ id: c.id, label: c.label, kind: c.kind, terms: c.terms })),
  };
}

module.exports = {
  get PLAYERS() { return PLAYERS; }, BY_ID, LAUNCH, HINT_EVERY, MAX_HINTS, hintAt,
  setPool, fixDraws, nextHint, hintList, isDead, resolve, score, rarity, compare, askClue, heat, candidates, today, dayIndex, dayFromIndex, playerOfDay, hintText, revealCard, card, catalog, norm, suggest,
  collectCard, drawPack, deckTotals, duelPick,
};
