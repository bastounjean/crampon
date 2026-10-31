// Autres façons de dire la même chose, en français et en anglais.
// Les mots sont comparés après normalisation (minuscules, sans accents, tirets et points → espaces) :
// « C.M. », « cm » et « CM » reviennent au même.

// Postes : le jeu n'en connaît que quatre, donc chaque poste précis renvoie à sa ligne.
// Pas de lettres seules ni de numéros nus (« 9 », « 10 ») : trop facile à taper par erreur.
const POSITIONS = {
  GB: ['gb', 'gk', 'gardien', 'portier', 'dernier rempart', 'goal keeper', 'keeper', 'goalie', 'shot stopper'],
  DEF: [
    'def', 'df', 'dc', 'dg', 'dd', 'cb', 'lb', 'rb', 'lcb', 'rcb', 'wb', 'lwb', 'rwb', 'fb', 'sw',
    'defenseur central', 'defenseur lateral', 'lateral', 'lateral gauche', 'lateral droit', 'arriere', 'arriere gauche', 'arriere droit', 'arriere central',
    'libero', 'stoppeur', 'piston', 'defensive',
    'centre back', 'center back', 'centre half', 'center half', 'left back', 'right back', 'wing back', 'sweeper', 'defenders',
  ],
  MIL: [
    'mil', 'mid', 'mf', 'cm', 'cdm', 'cam', 'dm', 'am', 'lm', 'rm', 'dmf', 'amf', 'cmf', 'mdc', 'mc', 'moc', 'mo', 'mg', 'md',
    'milieu defensif', 'milieu offensif', 'milieu central', 'milieu axial', 'milieu relayeur', 'milieu gauche', 'milieu droit', 'relayeur', 'sentinelle',
    'meneur', 'meneur de jeu', 'numero 10', 'numero 6', 'numero 8', 'n 10', 'regista',
    'central midfielder', 'centre midfielder', 'center midfielder', 'defensive midfielder', 'attacking midfielder', 'holding midfielder',
    'left midfielder', 'right midfielder', 'wide midfielder', 'box to box', 'playmaker', 'number 10', 'number 8', 'number 6', 'midfielders',
  ],
  ATT: [
    'att', 'fw', 'fwd', 'st', 'cf', 'lw', 'rw', 'lf', 'rf', 'bu',
    'ailier', 'ailier gauche', 'ailier droit', 'avant centre', 'attaquant de pointe', 'pointe', 'neuf', 'numero 9', 'faux 9', 'faux neuf',
    'centre forward', 'center forward', 'second striker', 'number 9', 'false 9', 'false nine', 'attack', 'attacking',
    'left winger', 'right winger', 'wide forward', 'inside forward', 'poacher', 'target man', 'forwards', 'strikers',
  ],
};

// Nationalités : clé = nom du pays tel qu'il apparaît dans les fiches (même normalisé).
const COUNTRIES = {
  'Royaume-Uni': ['uk', 'u k', 'great britain', 'britain', 'brit', 'brits', 'grande bretagne', 'britannique', 'ru'],
  'Angleterre': ['eng', 'anglaise', 'englishman'],
  'Écosse': ['scot', 'scots', 'scotsman', 'ecossaise'],
  'pays de Galles': ['galles', 'galloise', 'welshman'],
  'Irlande du Nord': ['n ireland', 'ni', 'nord irlandaise'],
  'Irlande': ['republic of ireland', 'eire', 'irlandaise'],
  'Pays-Bas': ['holland', 'hollande', 'hollandais', 'the netherlands', 'neerlandaise'],
  'Royaume des Pays-Bas': ['holland', 'hollande', 'hollandais', 'the netherlands'],
  'États-Unis': ['usa', 'us', 'u s', 'u s a', 'america', 'united states of america', 'etats unis d amerique', 'americaine', 'yankee'],
  'Tchéquie': ['czechia', 'czech republic', 'republique tcheque'],
  'Turquie': ['turkiye'],
  'Corée du Sud': ['korea', 'korean', 'republic of korea', 'coree', 'coreen', 'sud coreen'],
  'Arabie saoudite': ['saudi', 'ksa', 'saoudien'],
  'Émirats arabes unis': ['uae', 'emirati', 'emirien', 'emirats'],
  "Côte d'Ivoire": ['cote divoire', 'ivoirien', 'ivorian'],
  'Bosnie-Herzégovine': ['bosnia', 'bosnie'],
  'Australie': ['aussie'],
  'Allemagne': ['deutschland'],
  'Espagne': ['espana'],
  'Italie': ['italia'],
  'Brésil': ['brasil'],
};

// Surnoms des sélections
const TEAMS = {
  'Angleterre': ['three lions'], 'France': ['les bleus', 'bleus'], 'Italie': ['azzurri', 'squadra azzurra'], 'Pays-Bas': ['oranje'],
  'Brésil': ['selecao'], 'Allemagne': ['die mannschaft', 'mannschaft'], 'Argentine': ['albiceleste'], 'Australie': ['socceroos'],
  'Nigeria': ['super eagles'], 'Sénégal': ['lions de la teranga'], 'Algérie': ['fennecs', 'les verts'], 'Maroc': ['lions de l atlas', 'atlas lions'],
  'Égypte': ['pharaons', 'pharaohs'], 'Japon': ['samurai blue'], 'Belgique': ['diables rouges'], "Côte d'Ivoire": ['les elephants'],
  'Cameroun': ['lions indomptables', 'indomitable lions'], 'Uruguay': ['la celeste'], 'Croatie': ['vatreni'], 'Mexique': ['el tri'], 'États-Unis': ['usmnt'],
};

// Surnoms de clubs (clé = nom du club normalisé)
const CLUBS = {
  'tottenham hotspur': ['tottenham', 'spurs'], 'arsenal fc': ['gunners', 'the gunners'], 'west ham united fc': ['hammers', 'the hammers'],
  'everton fc': ['toffees', 'the toffees'], 'leicester city fc': ['foxes', 'the foxes'], 'newcastle united fc': ['magpies', 'the magpies', 'toon'],
  'wolverhampton wanderers fc': ['wolves'], 'wolverhampton wanderers f c': ['wolves'], 'manchester united fc': ['man u', 'red devils'], 'borussia monchengladbach': ['gladbach'],
  'vfl borussia monchengladbach': ['gladbach'], 'club atletico de madrid': ['atleti'], 'atletico de madrid': ['atleti'],
};

module.exports = { POSITIONS, COUNTRIES, TEAMS, CLUBS };
