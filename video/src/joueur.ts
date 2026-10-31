// ─────────────────────────────────────────────────────────────
// LE SEUL FICHIER À MODIFIER CHAQUE JOUR
// Images et voix vont dans le dossier public/.
// Voix : public/voix-1.mp3 … voix-6.mp3 (une par séquence).
// Si une voix manque, la séquence garde sa durée par défaut.
// ─────────────────────────────────────────────────────────────

export const joueur = {
  nom: "Gerard Deulofeu",
  photo: "deulofeu.png",
  drapeau: ["#AA151B", "#F1BF00", "#F1BF00", "#AA151B"], // bandes du drapeau (Espagne)
  poste: "MIL",

  // Séquence 1 : l'accroche (les logos tombent un par un)
  accroche: {
    clubs: [
      { logo: "barca.png", nom: "Barça" },
      { logo: "sevilla.png", nom: "Séville" },
      { logo: "everton.png", nom: "Everton" },
    ],
    texte: "Qui c'est ?",
  },

  // Séquences 2 à 4 : du plus dur au plus facile
  indices: [
    { titre: "Indice 1", texte: "Espagnol\nné en 1994", fiche: { NAT: "Espagne", "NÉ": "1994" } },
    { titre: "Indice 2", texte: "Formé à\nla Masia", fiche: { "FORMÉ": "Barça" } },
    { titre: "Dernier indice", texte: "Watford\n+ Udinese", fiche: { CLUBS: "Watford, Udinese" } },
  ],

  // Séquence 6 : l'appel à l'action
  cta: {
    texte: "Celui d'aujourd'hui\nest encore pire",
    site: "foootix.com",
    sousTitre: "Lien en bio",
  },
};

// Durées par défaut (secondes) si la voix n'est pas là
export const dureesParDefaut = [2.2, 2.4, 2.4, 3.6, 2.0, 2.6];
