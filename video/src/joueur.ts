// ─────────────────────────────────────────────────────────────
// LE SEUL FICHIER À MODIFIER CHAQUE JOUR
// Images et voix vont dans le dossier public/.
// Voix française : public/voix-1.mp3 … voix-6.mp3 (une par séquence).
// Voix anglaise : public/en-voix-1.mp3 … en-voix-6.mp3.
// Si une voix manque, la séquence garde sa durée par défaut.
// ─────────────────────────────────────────────────────────────

// Ce qui ne dépend pas de la langue
const commun = {
  nom: "Gerard Deulofeu",
  photo: "deulofeu.png",
  drapeau: ["#AA151B", "#F1BF00", "#F1BF00", "#AA151B"], // bandes du drapeau (Espagne)
  logos: ["barca.png", "sevilla.png", "everton.png"], // les 3 logos de l'accroche
  site: "foootix.com",
};

// Version française (compte @foootixfr)
const fr = {
  ...commun,
  poste: "MIL",
  accroche: {
    clubs: ["Barça", "Séville", "Everton"], // noms sous les logos, dans le même ordre
    texte: "Qui c'est ?",
  },
  // Séquences 2 à 4 : du plus dur au plus facile.
  // fiche : ce qui s'affiche sur la carte (NAT, NÉ, FORMÉ, CLUBS).
  indices: [
    { titre: "Indice 1", texte: "Espagnol\nné en 1994", fiche: { nat: "Espagne", ne: "1994" } },
    { titre: "Indice 2", texte: "Formé à\nla Masia", fiche: { forme: "Barça" } },
    { titre: "Dernier indice", texte: "Watford\n+ Udinese", fiche: { clubs: "Watford, Udinese" } },
  ],
  cta: {
    texte: "Celui d'aujourd'hui\nest encore pire",
    sousTitre: "Lien en bio",
  },
};

// Version anglaise (compte anglais)
const en: typeof fr = {
  ...commun,
  poste: "MID",
  accroche: {
    clubs: ["Barça", "Sevilla", "Everton"],
    texte: "Who is it?",
  },
  indices: [
    { titre: "Hint 1", texte: "Spanish\nborn in 1994", fiche: { nat: "Spain", ne: "1994" } },
    { titre: "Hint 2", texte: "Came through\nLa Masia", fiche: { forme: "Barça" } },
    { titre: "Last hint", texte: "Watford\n+ Udinese", fiche: { clubs: "Watford, Udinese" } },
  ],
  cta: {
    texte: "Today's one\nis even harder",
    sousTitre: "Link in bio",
  },
};

export const joueurs = { fr, en };
export type Langue = keyof typeof joueurs;
export type Joueur = typeof fr;

// Durées par défaut (secondes) si la voix n'est pas là
export const dureesParDefaut = [2.2, 2.4, 2.4, 3.6, 2.0, 2.6];
