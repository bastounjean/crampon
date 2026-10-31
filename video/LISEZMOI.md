# Vidéos TikTok FoOotix (@foootixfr)

Ce dossier fabrique les vidéos TikTok avec **Remotion** (un outil qui transforme du code en vidéo).
Il est séparé du site : rien ici n'est mis en ligne sur foootix.com.

Deux modèles de vidéo (format vertical 1080 × 1920) :

- **« Le joueur d'hier »** : la vidéo de chaque jour (publiée à 7 h) sur le joueur de la veille.
- **« Ligue TikTok »** : la pub pour la ligue du mois (code `RYVFCH`).

## Une seule fois : installer

Il faut Node 22 (déjà utilisé par le site). Dans ce dossier `video/` :

```
npm install
```

Remotion télécharge lui-même ce qu'il lui faut (un navigateur pour dessiner les images, et ffmpeg pour assembler la vidéo).

## Chaque jour : la vidéo du joueur d'hier

1. **Changer le joueur** : modifier `src/joueur.ts`, c'est le seul fichier à toucher.
   On y met le nom, la photo, les couleurs du drapeau, le poste, les 3 logos de clubs de l'accroche,
   les 3 indices (du plus dur au plus facile) et le texte de fin.
2. **Mettre les images** dans `public/` : la photo du joueur et les logos des clubs
   (avec les mêmes noms de fichiers que dans `joueur.ts`).
3. **La voix** : enregistrer le texte sur ElevenLabs (voix « Simon ») en **un seul MP3**,
   avec une petite pause (environ une demi-seconde) entre chaque phrase. Il faut 6 phrases, une par séquence.
4. **Fabriquer la vidéo** :

   ```
   npm run joueur -- chemin/vers/la-voix.mp3
   ```

   La commande découpe la voix sur les 5 pauses, range les morceaux dans `public/voix-1.mp3` … `voix-6.mp3`,
   cale la durée de chaque séquence sur sa phrase, puis sort la vidéo dans
   `out/joueur-<nom-du-joueur>.mp4`.

   Sans fichier (`npm run joueur`), elle réutilise les voix déjà présentes dans `public/`.

## La vidéo de la ligue TikTok

Le code de la ligue et le pseudo affiché se changent en haut de `src/Ligue.tsx`. Puis :

```
npm run ligue -- chemin/vers/la-voix.mp3
```

Les morceaux vont dans `public/ligue-voix-1.mp3` … `ligue-voix-6.mp3` et la vidéo sort dans `out/ligue-tiktok.mp4`.

## Les 6 séquences du joueur d'hier

1. Accroche : les logos tombent + « Qui c'est ? »
2. Indice 1
3. Indice 2
4. Dernier indice + compte à rebours
5. Révélation du joueur
6. « Celui d'aujourd'hui est encore pire » + foootix.com

## Autres commandes utiles

- `npm run studio` : ouvre un aperçu dans le navigateur pour regarder la vidéo image par image avant de la rendre.
- `npm run verifier` : vérifie qu'il n'y a pas de faute dans le code (par exemple après avoir modifié `joueur.ts`).
- Si Remotion n'arrive pas à télécharger son navigateur, on peut lui en donner un :
  `npm run joueur -- voix.mp3 --browser-executable=/chemin/vers/chrome`.

## Si la découpe de la voix échoue

Le message « Je ne trouve pas assez de pauses » veut dire que les blancs entre les phrases sont trop courts.
Refaire la voix avec des pauses un peu plus longues. La commande affiche le début et la fin de chaque morceau :
si une phrase est coupée en deux, c'est qu'une respiration au milieu d'une phrase était plus longue qu'une vraie pause.

## Ce qu'il y a dans le dossier

- `src/joueur.ts` : le joueur du jour (à modifier chaque jour).
- `src/Video.tsx` : le dessin de la vidéo « joueur d'hier ».
- `src/Ligue.tsx` : le dessin de la vidéo « ligue TikTok ».
- `src/Root.tsx` : déclare les deux vidéos et cale leurs durées sur les voix.
- `scripts/video.mjs` : la commande `npm run joueur` / `npm run ligue` (découpe + rendu).
- `public/` : images, polices, bruitages (pop, whoosh, tic-tac, ding) et voix.
- `out/` : les vidéos fabriquées (pas enregistrées dans le dépôt).
