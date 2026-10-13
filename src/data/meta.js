// Championnats, pays et clubs.

const LEAGUES = {
  L1: { name: 'Ligue 1', long: 'Championnat de France', country: 'FRA' },
  PL: { name: 'Premier League', long: "Championnat d'Angleterre", country: 'ENG' },
  BL: { name: 'Bundesliga', long: "Championnat d'Allemagne", country: 'GER' },
  LL: { name: 'Liga', long: "Championnat d'Espagne", country: 'ESP' },
  SA: { name: 'Serie A', long: "Championnat d'Italie", country: 'ITA' },
};

// code: [nom, adjectif (gentilé), continent]
const COUNTRIES = {
  FRA: ['France', 'Français', 'Europe'], ENG: ['Angleterre', 'Anglais', 'Europe'], GER: ['Allemagne', 'Allemand', 'Europe'],
  RFA: ['Allemagne de l\'Ouest (RFA)', 'Allemand', 'Europe'], ESP: ['Espagne', 'Espagnol', 'Europe'], ITA: ['Italie', 'Italien', 'Europe'],
  NED: ['Pays-Bas', 'Néerlandais', 'Europe'], POR: ['Portugal', 'Portugais', 'Europe'], BEL: ['Belgique', 'Belge', 'Europe'],
  WAL: ['Pays de Galles', 'Gallois', 'Europe'], SCO: ['Écosse', 'Écossais', 'Europe'], NIR: ['Irlande du Nord', 'Nord-Irlandais', 'Europe'],
  DEN: ['Danemark', 'Danois', 'Europe'], SWE: ['Suède', 'Suédois', 'Europe'], NOR: ['Norvège', 'Norvégien', 'Europe'],
  CZE: ['Tchéquie', 'Tchèque', 'Europe'], POL: ['Pologne', 'Polonais', 'Europe'], CRO: ['Croatie', 'Croate', 'Europe'],
  SVN: ['Slovénie', 'Slovène', 'Europe'], HUN: ['Hongrie', 'Hongrois', 'Europe'], BUL: ['Bulgarie', 'Bulgare', 'Europe'],
  UKR: ['Ukraine', 'Ukrainien', 'Europe'], GEO: ['Géorgie', 'Géorgien', 'Europe'], TUR: ['Turquie', 'Turc', 'Europe'],
  SUI: ['Suisse', 'Suisse', 'Europe'], AUT: ['Autriche', 'Autrichien', 'Europe'], GRE: ['Grèce', 'Grec', 'Europe'],
  MCO: ['Monaco', 'Monégasque', 'Europe'], RUS: ['Russie', 'Russe', 'Europe'], BIH: ['Bosnie-Herzégovine', 'Bosnien', 'Europe'],
  BRA: ['Brésil', 'Brésilien', 'Amérique du Sud'], ARG: ['Argentine', 'Argentin', 'Amérique du Sud'], URU: ['Uruguay', 'Uruguayen', 'Amérique du Sud'],
  COL: ['Colombie', 'Colombien', 'Amérique du Sud'],
  MEX: ['Mexique', 'Mexicain', 'Amérique du Nord'], USA: ['États-Unis', 'Américain', 'Amérique du Nord'], CAN: ['Canada', 'Canadien', 'Amérique du Nord'],
  CIV: ["Côte d'Ivoire", 'Ivoirien', 'Afrique'], CMR: ['Cameroun', 'Camerounais', 'Afrique'], EGY: ['Égypte', 'Égyptien', 'Afrique'],
  SEN: ['Sénégal', 'Sénégalais', 'Afrique'], ALG: ['Algérie', 'Algérien', 'Afrique'], MAR: ['Maroc', 'Marocain', 'Afrique'],
  GHA: ['Ghana', 'Ghanéen', 'Afrique'], NGA: ['Nigeria', 'Nigérian', 'Afrique'], GAB: ['Gabon', 'Gabonais', 'Afrique'],
  LBR: ['Liberia', 'Libérien', 'Afrique'],
  KOR: ['Corée du Sud', 'Sud-Coréen', 'Asie'], JPN: ['Japon', 'Japonais', 'Asie'], KSA: ['Arabie saoudite', 'Saoudien', 'Asie'],
  QAT: ['Qatar', 'Qatarien', 'Asie'], UAE: ['Émirats arabes unis', 'Émirien', 'Asie'], CHN: ['Chine', 'Chinois', 'Asie'], IND: ['Inde', 'Indien', 'Asie'],
  AUS: ['Australie', 'Australien', 'Océanie'],
};

const BIG5 = {
  L1: ['Alès', 'Angers', 'Auxerre', 'Bastia', 'Bordeaux', 'Boulogne', 'Brest', 'Caen', 'Cannes', 'Dijon', 'Grenoble', 'Guingamp', 'Istres',
    'Le Havre', 'Le Mans', 'Lens', 'Lille', 'Lyon', 'Marseille', 'Martigues', 'Metz', 'Monaco', 'Montpellier', 'Nancy', 'Nantes', 'Nice',
    'Nîmes', 'PSG', 'Reims', 'Rennes', 'Saint-Étienne', 'Strasbourg', 'Toulouse', 'Tours', 'Valenciennes'],
  PL: ['Arsenal', 'Aston Villa', 'Birmingham', 'Blackburn', 'Bolton', 'Bournemouth', 'Chelsea', 'Chester', 'Derby County', 'Everton', 'Fleetwood Town',
    'Fulham', 'Halifax Town', 'Leeds', 'Leicester', 'Leyton Orient', 'Liverpool', 'Manchester City', 'Manchester United', 'Millwall', 'Newcastle',
    'Norwich', 'Nottingham Forest', 'Preston', 'Scunthorpe', 'Southampton', 'Stocksbridge Park Steels', 'Stoke City', 'Swansea', 'Tottenham',
    'West Bromwich', 'West Ham'],
  BL: ['1860 Munich', 'Bayern Munich', 'Bochum', 'Chemnitzer FC', 'Dortmund', 'Hambourg', 'Homburg', 'Kaiserslautern', 'Karlsruhe', 'Kickers Offenbach',
    'Leverkusen', 'Mönchengladbach', 'Nuremberg', 'Rot Weiss Ahlen', 'Schalke 04', 'Stuttgarter Kickers', 'TSV Nördlingen', 'VfB Stuttgart',
    'Werder Brême', 'Wolfsburg'],
  LL: ['Athletic Bilbao', 'Atlético Madrid', 'Barcelone', 'Celta Vigo', 'Deportivo La Corogne', 'Espanyol', 'Hércules', 'Las Palmas', 'Leganés',
    'Levante', 'Majorque', 'Málaga', 'Rayo Vallecano', 'Real Madrid', 'Real Sociedad', 'Salamanque', 'Saragosse', 'Séville', 'Sporting Gijón',
    'Valence', 'Valladolid', 'Villarreal'],
  SA: ['AC Milan', 'Atalanta', 'Bologne', 'Brescia', 'Cagliari', 'Côme', 'Cremonese', 'Fiorentina', 'Inter', 'Juventus', 'Lazio', 'Livourne',
    'Mantoue', 'Naples', 'Novara', 'Nuorese', 'Padoue', 'Palerme', 'Parme', 'Piacenza', 'Reggina', 'Roma', 'Salernitana', 'Sampdoria', 'Torres',
    'Udinese', 'Vicenza'],
};

// Clubs hors des 5 grands championnats : club → pays
const OTHER = {
  NED: ['Ajax', 'Den Bosch', 'Feyenoord', 'Groningue', 'Haarlem', 'Heerenveen', 'PSV Eindhoven'],
  POR: ['Benfica', 'Estoril', 'FC Porto', 'Sporting CP'],
  BEL: ['Anderlecht', 'Beveren', 'Charleroi', 'Club Bruges', 'Genk'],
  SCO: ['Celtic', 'Hibernian'],
  SUI: ['FC Bâle', 'Servette'], AUT: ['Red Bull Salzbourg'],
  TUR: ['Antalyaspor', 'Fenerbahçe', 'Galatasaray', 'İstanbul Başakşehir'],
  GRE: ['AEK Athènes', 'Olympiakos', 'Panathinaïkos'],
  RUS: ['Anji Makhatchkala', 'Lokomotiv Moscou', 'Rubin Kazan'],
  UKR: ['Dynamo Kiev', 'Metalurh Donetsk'],
  DEN: ['Brøndby', 'Hvidovre'], SWE: ['Malmö FF'], NOR: ['Bryne', 'Molde'],
  CZE: ['Chmel Blšany', 'Dukla Prague', 'Sparta Prague'], POL: ['Lech Poznań', 'Znicz Pruszków'],
  CRO: ['Dinamo Zagreb', 'Inter Zaprešić'], BIH: ['Zrinjski Mostar'], SVN: ['Olimpija Ljubljana'],
  HUN: ['Budapest Honvéd'], BUL: ['CSKA Sofia'], GEO: ['Dinamo Batoumi', 'Dinamo Tbilissi', 'Rustavi'],
  BRA: ['Atlético Mineiro', 'Botafogo', 'Botafogo-SP', 'Corinthians', 'Cruzeiro', 'Flamengo', 'Fluminense', 'Grêmio', 'Internacional', 'Juventude',
    'Mogi Mirim', 'Palmeiras', 'Ponte Preta', 'Santa Cruz', 'Santos', 'São Paulo', 'Sport Recife', 'União São João', 'Vasco da Gama'],
  ARG: ['Argentinos Juniors', 'Banfield', 'Boca Juniors', 'Huracán', 'Independiente', 'Instituto', "Newell's Old Boys", 'Platense', 'Racing Club',
    'River Plate', 'Rosario Central', 'Talleres'],
  URU: ['Danubio', 'Nacional', 'Peñarol'], COL: ['Millonarios'],
  MEX: ['Atlético Celaya', 'Club América', 'Dorados de Sinaloa', 'Monterrey', 'Querétaro', 'UNAM Pumas'],
  USA: ['Chicago Fire', 'DC United', 'Fort Lauderdale Strikers', 'Inter Miami', 'LA Galaxy', 'Los Angeles Aztecs', 'Los Angeles FC', 'MetroStars',
    'New York City FC', 'New York Cosmos', 'New York Red Bulls', 'Orlando City', 'Phoenix Rising', 'San Jose Earthquakes', 'Washington Diplomats'],
  CAN: ['Impact de Montréal', 'Vancouver Whitecaps'],
  KSA: ['Al-Ahli', 'Al-Hilal', 'Al-Ittihad', 'Al-Nassr', 'Al-Qadsiah', 'Neom'],
  QAT: ['Al-Ahli Doha', 'Al-Arabi', 'Al-Gharafa', 'Al-Rayyan', 'Al-Sadd'],
  UAE: ['Al-Ahli Dubaï', 'Al-Jazira', 'Baniyas', 'Emirates Club'],
  JPN: ['Cerezo Osaka', 'Kashima Antlers', 'Kashiwa Reysol', 'Nagoya Grampus', 'Sagan Tosu', 'Vissel Kobe'],
  CHN: ['Shanghai Shenhua'], IND: ['Chennaiyin', 'Delhi Dynamos', 'Mumbai City'], AUS: ['Sydney FC'],
  EGY: ['Al Mokawloon'], MAR: ['USM Casablanca'], CMR: ['Tonnerre Yaoundé'],
};

const CLUBS = {};
for (const [lg, list] of Object.entries(BIG5)) for (const c of list) CLUBS[c] = { league: lg, country: lg === 'L1' && c === 'Monaco' ? 'MCO' : LEAGUES[lg].country };
for (const [cc, list] of Object.entries(OTHER)) for (const c of list) CLUBS[c] = { league: null, country: cc };
CLUBS['Swansea'].country = 'WAL';

// Clubs du pays mais joués en division inférieure pendant les passages listés :
// ils ne comptent pas comme "a joué en Ligue 1 / Serie A…".
const LOWER = ['Alès', 'Angers', 'Boulogne', 'Brest', 'Dijon', 'Grenoble', 'Istres', 'Le Mans', 'Martigues', 'Tours', 'Valenciennes',
  'Birmingham', 'Bournemouth', 'Chester', 'Derby County', 'Fleetwood Town', 'Fulham', 'Halifax Town', 'Leyton Orient', 'Millwall', 'Preston',
  'Scunthorpe', 'Stocksbridge Park Steels', 'Chemnitzer FC', 'Homburg', 'Kickers Offenbach', 'Rot Weiss Ahlen', 'Stuttgarter Kickers',
  'TSV Nördlingen', 'Leganés', 'Livourne', 'Novara', 'Nuorese', 'Padoue', 'Torres', 'Vicenza'];
for (const c of LOWER) { CLUBS[c].league = null; CLUBS[c].lower = true; }

const POSITIONS = {
  GB: { name: 'Gardien', clue: 'Gardien de but' },
  DEF: { name: 'Défenseur', clue: 'Défenseur' },
  MIL: { name: 'Milieu', clue: 'Milieu de terrain' },
  ATT: { name: 'Attaquant', clue: 'Attaquant' },
};

const HONOURS = {
  CM: 'Coupe du monde', EURO: "Championnat d'Europe", COPA: 'Copa América', CAN: "Coupe d'Afrique des nations",
  LDC: 'Ligue des champions', BO: "Ballon d'or",
};

module.exports = { LEAGUES, COUNTRIES, CLUBS, POSITIONS, HONOURS };
