// Version anglaise du site : le jeu est écrit en français, on traduit ce que le serveur renvoie
// au moment de l'envoyer (y compris les essais déjà enregistrés en base, qui restent en français).

// pays : nom français (tel que dans les fiches Wikidata ou meta.js) → [nom anglais, adjectif anglais]
const COUNTRY = {
  'France': ['France', 'French'], 'Angleterre': ['England', 'English'], 'Allemagne': ['Germany', 'German'],
  "Allemagne de l'Ouest": ['West Germany', 'West German'], "Allemagne de l'Ouest (RFA)": ['West Germany', 'West German'],
  'Espagne': ['Spain', 'Spanish'], 'Italie': ['Italy', 'Italian'], 'Pays-Bas': ['Netherlands', 'Dutch'], 'Royaume des Pays-Bas': ['Netherlands', 'Dutch'],
  'Portugal': ['Portugal', 'Portuguese'], 'Belgique': ['Belgium', 'Belgian'], 'pays de Galles': ['Wales', 'Welsh'], 'Pays de Galles': ['Wales', 'Welsh'],
  'Écosse': ['Scotland', 'Scottish'], 'Irlande du Nord': ['Northern Ireland', 'Northern Irish'], 'Irlande': ['Ireland', 'Irish'],
  'Royaume-Uni': ['United Kingdom', 'British'], 'Danemark': ['Denmark', 'Danish'], 'Suède': ['Sweden', 'Swedish'], 'Norvège': ['Norway', 'Norwegian'],
  'Finlande': ['Finland', 'Finnish'], 'Tchéquie': ['Czech Republic', 'Czech'], 'Tchécoslovaquie': ['Czechoslovakia', 'Czechoslovak'],
  'Slovaquie': ['Slovakia', 'Slovak'], 'Pologne': ['Poland', 'Polish'], 'Croatie': ['Croatia', 'Croatian'], 'Slovénie': ['Slovenia', 'Slovenian'],
  'Hongrie': ['Hungary', 'Hungarian'], 'Bulgarie': ['Bulgaria', 'Bulgarian'], 'Roumanie': ['Romania', 'Romanian'], 'Ukraine': ['Ukraine', 'Ukrainian'],
  'Géorgie': ['Georgia', 'Georgian'], 'Turquie': ['Turkey', 'Turkish'], 'Suisse': ['Switzerland', 'Swiss'], 'Autriche': ['Austria', 'Austrian'],
  'Grèce': ['Greece', 'Greek'], 'Monaco': ['Monaco', 'Monegasque'], 'Russie': ['Russia', 'Russian'], 'Serbie': ['Serbia', 'Serbian'],
  'Bosnie-Herzégovine': ['Bosnia and Herzegovina', 'Bosnian'], 'Yougoslavie': ['Yugoslavia', 'Yugoslav'],
  'Serbie-et-Monténégro': ['Serbia and Montenegro', 'Serbian'], 'république fédérative socialiste de Yougoslavie': ['Yugoslavia', 'Yugoslav'],
  'république fédérale de Yougoslavie': ['Yugoslavia', 'Yugoslav'], 'Catalogne': ['Catalonia', 'Catalan'], 'Euskal-Erria': ['Basque Country', 'Basque'],
  'Brésil': ['Brazil', 'Brazilian'], 'Argentine': ['Argentina', 'Argentine'], 'Uruguay': ['Uruguay', 'Uruguayan'], 'Colombie': ['Colombia', 'Colombian'],
  'Chili': ['Chile', 'Chilean'], 'Équateur': ['Ecuador', 'Ecuadorian'], 'Pérou': ['Peru', 'Peruvian'], 'Guyane': ['French Guiana', 'Guianese'],
  'Mexique': ['Mexico', 'Mexican'], 'États-Unis': ['United States', 'American'], 'Canada': ['Canada', 'Canadian'], 'Costa Rica': ['Costa Rica', 'Costa Rican'],
  "Côte d'Ivoire": ['Ivory Coast', 'Ivorian'], 'Cameroun': ['Cameroon', 'Cameroonian'], 'Égypte': ['Egypt', 'Egyptian'], 'Sénégal': ['Senegal', 'Senegalese'],
  'Algérie': ['Algeria', 'Algerian'], 'Maroc': ['Morocco', 'Moroccan'], 'Ghana': ['Ghana', 'Ghanaian'], 'Nigeria': ['Nigeria', 'Nigerian'],
  'Gabon': ['Gabon', 'Gabonese'], 'Liberia': ['Liberia', 'Liberian'], 'Togo': ['Togo', 'Togolese'],
  'Corée du Sud': ['South Korea', 'South Korean'], 'Japon': ['Japan', 'Japanese'], 'Arabie saoudite': ['Saudi Arabia', 'Saudi'], 'Qatar': ['Qatar', 'Qatari'],
  'Émirats arabes unis': ['United Arab Emirates', 'Emirati'], 'Chine': ['China', 'Chinese'], 'Inde': ['India', 'Indian'], 'Australie': ['Australia', 'Australian'],
};
const CONT = { Europe: 'Europe', Afrique: 'Africa', Asie: 'Asia', 'Amérique du Sud': 'South America', 'Amérique du Nord': 'North America', 'Océanie': 'Oceania' };
const CONT_ADJ = { Europe: ['european'], Afrique: ['african'], Asie: ['asian'], 'Amérique du Sud': ['south american'], 'Amérique du Nord': ['north american'], 'Océanie': ['oceanian'] };
const POS = {
  Gardien: 'Goalkeeper', 'Gardien de but': 'Goalkeeper', 'Défenseur': 'Defender', Milieu: 'Midfielder', 'Milieu de terrain': 'Midfielder', Attaquant: 'Forward',
  gardien: 'goalkeeper', 'défenseur': 'defender', milieu: 'midfielder', attaquant: 'forward',
};
const POS_SHORT = { GB: 'GK', DEF: 'DEF', MIL: 'MID', ATT: 'FWD' };
const POS_TERMS = { GB: ['goalkeeper', 'keeper', 'goalie', 'gk'], DEF: ['defender', 'defence', 'centre back', 'center back', 'full back'], MIL: ['midfielder', 'midfield'], ATT: ['forward', 'striker', 'attacker', 'winger'] };
const LEAGUE_TERMS = { L1: ['french league', 'france league'], PL: ['english league', 'epl'], BL: ['german league'], LL: ['spanish league', 'laliga'], SA: ['italian league'] };
const KIND = { Championnat: 'League', 'Nationalité': 'Nationality', 'Sélection': 'National team', Continent: 'Continent', Club: 'Club', Poste: 'Position', 'Génération': 'Generation', 'Palmarès': 'Honours', 'Carrière': 'Career' };

// noms de clubs et de villes à la française → nom courant en anglais
const WORDS = [
  ['Étoile rouge', 'Red Star'], ['Earthquakes de San José', 'San Jose Earthquakes'], ['Fenerbahçe Istanbul', 'Fenerbahçe'], ['TSV Munich 1860', 'TSV 1860 Munich'],
  ['centre de formation du ', 'Youth academy, '], ['Football Club Tokyo', 'FC Tokyo'], ['Football Club Séoul', 'FC Seoul'], ['AS Rome', 'AS Roma'],
  ['16e arrondissement de Marseille', 'Marseille'], ['Standard de Liège', 'Standard Liège'],
  ['Barcelone', 'Barcelona'], ['Brême', 'Bremen'], ['Naples', 'Napoli'], ['Hambourg', 'Hamburg'], ['Parme', 'Parma'], ['Bâle', 'Basel'], ['Saragosse', 'Zaragoza'],
  ['Bologne', 'Bologna'], ['Majorque', 'Mallorca'], ['Cologne', 'Köln'], ['Côme', 'Como'], ['Athènes', 'Athens'], ['Moscou', 'Moscow'], ['Francfort', 'Frankfurt'],
  ['Venise', 'Venezia'], ['Livourne', 'Livorno'], ['Bruges', 'Brugge'], ['Zénith', 'Zenit'], ['Saint-Pétersbourg', 'Saint Petersburg'], ['Vérone', 'Verona'],
  ['Mayence', 'Mainz'], ['Saint-Trond', 'Sint-Truiden'], ['Vienne', 'Vienna'], ['Messine', 'Messina'], ['Bergame', 'Bergamo'], ['Hanovre', 'Hannover'],
  ['Plaisance', 'Piacenza'], ['Bucarest', 'Bucharest'], ['Brunswick', 'Braunschweig'], ['Sienne', 'Siena'], ['Varsovie', 'Warsaw'], ['Lucerne', 'Luzern'],
  ['Nimègue', 'Nijmegen'], ['Fribourg', 'Freiburg'], ['Valence', 'Valencia'], ['Pérouse', 'Perugia'], ['Trévise', 'Treviso'], ['Varèse', 'Varese'],
  ['Bénévent', 'Benevento'], ['Modène', 'Modena'], ['Londres', 'London'], ['Lisbonne', 'Lisbon'], ['Séville', 'Seville'], ['Gênes', 'Genoa'],
  ['Carrare', 'Carrara'], ['Turin', 'Turin'], ['Le Caire', 'Cairo'], ['Alger', 'Algiers'], ['Anvers', 'Antwerp'], ['Bruxelles', 'Brussels'], ['Genève', 'Geneva'],
  ['Copenhague', 'Copenhagen'], ['Édimbourg', 'Edinburgh'], ['Salamanque', 'Salamanca'], ['Palerme', 'Palermo'], ['Padoue', 'Padova'], ['Mantoue', 'Mantova'],
];
const wordsRe = new RegExp(WORDS.map(([a]) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length).join('|'), 'g');
const WORD_MAP = Object.fromEntries(WORDS);
const place = (s) => s.replace(wordsRe, (m) => WORD_MAP[m]);
const country = (s) => (COUNTRY[s] ? COUNTRY[s][0] : s);

// phrases fabriquées par le jeu (essais, indices, questions)
const PATTERNS = [
  [/^Trouvé !$/, () => 'Got it!'],
  [/^Même nationalité \((.+)\)$/, (m) => `Same nationality (${country(m[1])})`],
  [/^Même sélection \((.+)\)$/, (m) => `Same national team (${country(m[1])})`],
  [/^Même continent$/, () => 'Same continent'],
  [/^Même poste$/, () => 'Same position'],
  [/^Poste voisin$/, () => 'Nearby position'],
  [/^Né la même année$/, () => 'Born the same year'],
  [/^Le mystère est plus âgé$/, () => 'Mystery player is older'],
  [/^Le mystère est plus jeune$/, () => 'Mystery player is younger'],
  [/^Coéquipiers à (.+)$/, (m) => `Teammates at ${place(m[1])}`],
  [/^Passé par (.+)$/, (m) => `Played for ${place(m[1])}`],
  [/^Poste : (.+)$/, (m) => `Position: ${(POS[m[1]] || m[1]).toLowerCase()}`],
  [/^Né dans les années (\d+)$/, (m) => `Born in the ${m[1]}s`],
  [/^Continent : (.+)$/, (m) => `Continent: ${CONT[m[1]] || (m[1] === 'inconnu' ? 'unknown' : m[1])}`],
  [/^Nationalité : (.+)$/, (m) => `Nationality: ${country(m[1])}`],
  [/^Sélection : (.+)$/, (m) => `National team: ${country(m[1])}`],
  [/^A joué à (.+)$/, (m) => `Played for ${place(m[1])}`],
  [/^Initiales : (.+)$/, (m) => `Initials: ${m[1]}`],
  [/^Anecdote : il a connu (\d+) clubs, dont (.+) en dernier\.$/, (m) => `Fun fact: he played for ${m[1]} clubs, the last one being ${place(m[2])}.`],
  [/^Anecdote : (.+)$/, (m) => `Fun fact: ${m[1]}`],
  [/^Ballon d'or$/, () => "Ballon d'Or"],
  [/^équipe (?:de |d'|du |des )(.+?) (?:de football|olympique de football)$/i, (m) => `${country(m[1].charAt(0).toUpperCase() + m[1].slice(1))} national team`],
  [/^Toujours en activité$/, () => 'Still playing'],
  [/^Retraité$/, () => 'Retired'],
  [/^Actif$/, () => 'Active'],
  // messages d'erreur
  [/^Je ne trouve rien pour « (.*) »\..*$/, (m) => `Nothing found for “${m[1]}”. Try a player, a club, a city, a country, a position, a generation…`],
  [/^Plusieurs clubs possibles pour « (.*) » : (.*)\. Précise lequel\.$/, (m) => `Several clubs match “${m[1]}”: ${place(m[2])}. Which one?`],
  [/^Plusieurs joueurs s'appellent « (.*) »\. Ajoute le prénom\.$/, (m) => `Several players are called “${m[1]}”. Add the first name.`],
  [/^« (.*) » ressemble à plusieurs choses\. Précise un peu\.$/, (m) => `“${m[1]}” could mean several things. Be a bit more precise.`],
  [/^La partie du jour est terminée\.$/, () => "Today's game is over."],
  [/^Partie terminée\.$/, () => 'Game over.'],
  [/^Pas encore d'indice disponible\.$/, () => 'No hint available yet.'],
  [/^Tu as déjà trouvé tout ce que les indices pourraient te dire\.$/, () => 'You already know everything the hints could tell you.'],
  [/^Fiche pas encore débloquée\.$/, () => 'This player is not unlocked yet.'],
  [/^Petit souci de serveur, réessaie dans un instant\.$/, () => 'Small server hiccup, try again in a moment.'],
  [/^Trop de requêtes, attends une minute\.$/, () => 'Too many requests, wait a minute.'],
  [/^Trop de tentatives, réessaie dans quelques minutes\.$/, () => 'Too many attempts, try again in a few minutes.'],
  [/^Pseudo : 3 à 20 caractères.*$/, () => 'Username: 3 to 20 characters, letters, digits, dot, dash or underscore.'],
  [/^Mot de passe : 6 caractères minimum\.$/, () => 'Password: at least 6 characters.'],
  [/^Ce pseudo est déjà pris\.$/, () => 'This username is already taken.'],
  [/^Pseudo ou mot de passe incorrect\.$/, () => 'Wrong username or password.'],
  [/^Mot de passe incorrect\.$/, () => 'Wrong password.'],
  [/^Crée un compte pour jouer en ligue\.$/, () => 'Create an account to play in a league.'],
  [/^Donne un nom à ta ligue.*$/, () => 'Give your league a name (at least 2 characters).'],
  [/^Aucune ligue avec ce code.*$/, () => 'No league with this code. Check the letters.'],
  [/^Ligue introuvable\.$/, () => 'League not found.'],
  [/^Tu as déjà créé (\d+) ligues\.$/, (m) => `You have already created ${m[1]} leagues.`],
  [/^Tu es déjà dans (\d+) ligues\.$/, (m) => `You are already in ${m[1]} leagues.`],
  [/^Cette ligue est complète \((\d+) joueurs\)\.$/, (m) => `This league is full (${m[1]} players).`],
  [/^Tu n’es pas connecté\.$/, () => 'You are not logged in.'],
];

const KEEP = new Set(['username', 'owner', 'leader', 'code', 'id', 'key', 'img', 'logo', 'photo', 'iso', 'day', 'title', 'name', 'color', 'url', 'fact']);
const cache = new Map();
function tr(s) {
  if (cache.has(s)) return cache.get(s);
  let out = s;
  if (COUNTRY[s]) out = COUNTRY[s][0];
  else if (CONT[s]) out = CONT[s];
  else if (POS[s]) out = POS[s];
  else if (KIND[s]) out = KIND[s];
  else {
    const p = PATTERNS.find(([re]) => re.test(s));
    if (p) out = p[1](s.match(p[0]));
    else out = place(s);
  }
  if (cache.size < 20000) cache.set(s, out);
  return out;
}

// parcourt une réponse JSON et traduit les textes (sauf pseudos, noms de joueurs, codes…)
function deep(v, key) {
  if (typeof v === 'string') return KEEP.has(key) ? v : tr(v);
  if (Array.isArray(v)) return v.map((x) => deep(x, key));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = deep(x, k);
    // noms de clubs, de pays (champ « name ») : traduits seulement quand ce n'est pas un joueur ou une ligue entre potes
    if (typeof v.name === 'string' && (v.iso !== undefined || v.logo !== undefined || v.from !== undefined)) o.name = tr(v.name);
    if (key === 'nat' && typeof v.name === 'string') o.name = country(v.name);
    if (typeof v.pos === 'string' && POS_SHORT[v.pos] && key !== 'player') o.pos = POS_SHORT[v.pos];
    return o;
  }
  return v;
}

// mots anglais acceptés dans la recherche, en plus des mots français
function extraTerms(clueId, label) {
  const [kind, v] = clueId.split(/:(.+)/);
  if (kind === 'nat') { const c = COUNTRY[label]; return c ? c : []; }
  if (kind === 'sel') { const c = COUNTRY[label.replace(/^Sélection : /, '')]; return c ? [`${c[0]} national team`, `plays for ${c[0]}`, ...c.slice(1).map((a) => `${a} international`)] : []; }
  if (kind === 'cont') return [CONT[v], ...(CONT_ADJ[v] || [])].filter(Boolean);
  if (kind === 'pos') return POS_TERMS[v] || [];
  if (kind === 'lg') return LEAGUE_TERMS[v] || [];
  if (kind === 'dec') { const s = String(v).slice(2); return [`born in the ${v}s`, `${s}s`, `the ${s}s`, `the ${v}s`, `born in ${v}s`]; }
  if (kind === 'act') return v === '1' ? ['active', 'still playing', 'still active'] : ['retired', 'legend'];
  if (kind === 'club') { const en = place(label); return en !== label ? [en] : []; }
  return [];
}

const pick = (req) => {
  const c = req.cookies && req.cookies.lang;
  if (c === 'fr' || c === 'en') return c;
  const al = String(req.get('accept-language') || '').toLowerCase();
  return !al || /^fr\b|^fr-/.test(al.trim()) ? 'fr' : 'en';
};

module.exports = { tr, deep, extraTerms, pick, place, country, POS_SHORT };
