# FoOotix

Un footballeur mystère par jour, tiré au sort parmi les légendes et joueurs actuels passés par la Ligue 1, la Premier League, la Bundesliga, la Liga ou la Serie A.

## Lancer en local

Il faut Node 22.13 ou plus récent (la base SQLite est intégrée à Node, rien d'autre à installer).

```
npm install
npm start
```

Puis ouvrir http://localhost:3000.

## Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `SECRET` | Graine du tirage au sort. **À changer en production**, sinon n'importe qui peut prédire les joueurs à venir depuis le code. | `change-moi-en-production` |
| `LAUNCH_DATE` | Date du joueur n° 1 (AAAA-MM-JJ). | `2026-10-13` |
| `DB_PATH` | Fichier SQLite (comptes, parties). | `./data/crampon.db` |
| `PORT` | Port HTTP. | `3000` |
| `NODE_ENV` | Mettre `production` en ligne (cookies sécurisés). | |

## Mettre en ligne (Render, gratuit pour commencer)

1. Mettre ce dossier dans un dépôt GitHub.
2. Sur render.com : New → Web Service → choisir le dépôt.
3. Build command : `npm install` · Start command : `npm start`.
4. Variables : `NODE_ENV=production`, `SECRET=<une longue phrase aléatoire>`, `DB_PATH=/var/data/crampon.db`.
5. Ajouter un disque persistant monté sur `/var/data` (sinon les comptes sont effacés à chaque redéploiement ; le disque demande l'offre payante à ~7 $/mois).

Railway ou Fly.io marchent aussi pareil (un volume pour le fichier SQLite). Un petit VPS avec `node server.js` derrière Caddy ou Nginx fait aussi l'affaire.

## Les joueurs

La liste des 600 joueurs qui peuvent tomber est dans `src/data/pool.json`. Elle est construite depuis Wikidata : les joueurs passés par un club des 5 grands championnats, internationaux A, avec au moins 3 saisons dans ces championnats, classés par notoriété (nombre d'articles Wikipédia dans le monde).

Au démarrage puis chaque jour, le serveur retélécharge les fiches de ces joueurs sur Wikidata (clubs, sélection, poste…). La liste elle-même reste fixe pour que le tirage du jour ne change jamais en cours de journée.

Pour reconstruire la liste (par exemple avec une autre taille) : onglet *Actions* du dépôt sur GitHub → *Liste des joueurs* → *Run workflow*. Attention : changer la liste change l'ordre des tirages à venir.

Au reveal, la page Wikipédia du joueur est chargée directement depuis fr.wikipedia.org dans le navigateur.

## Structure

- `server.js` : API (partie du jour, essais, indices, comptes, album, classement)
- `src/game.js` : tirage du jour, calcul de la température, carte, indices
- `src/wikidata.js` : récupération des joueurs sur Wikidata
- `scripts/build-pool.js` : construction de la liste des 600 joueurs
- `public/` : le site (HTML, CSS, JS sans framework)

## Publicité et mentions légales

Tout se règle dans l'onglet Environment de Render, rien ne s'active tant que c'est vide :

| Variable | Exemple | Effet |
|---|---|---|
| `ADSENSE_CLIENT` | `ca-pub-1234567890123456` | charge AdSense (et son bandeau cookies), sert `/ads.txt`, affiche « Gérer mes cookies » |
| `ADSENSE_SLOT` | `1234567890` | bloc pub dans la colonne du jeu, sous l'album et sous le classement |
| `SITE_OWNER` | `Baptiste Dupont` | éditeur dans les mentions légales |
| `SITE_ADDRESS` | `12 rue …, 75000 Paris` | adresse de l'éditeur |
| `SITE_CONTACT` | `contact@footix.fr` | contact affiché sur les pages légales |
| `ADS_PREVIEW` | `1` | cadres gris à la place des pubs, pour voir la mise en page |

Le consentement aux cookies passe par le message RGPD de Google (AdSense → Confidentialité et messages), certifié IAB TCF.

## Base de données

Sans rien configurer, le site utilise un fichier SQLite local, effacé à chaque déploiement sur Render.
Pour garder comptes, points et ligues : créer une base gratuite sur neon.tech (même région que le service Render),
puis mettre sa chaîne de connexion dans la variable `DATABASE_URL` sur Render. Les tables se créent toutes seules au démarrage.
