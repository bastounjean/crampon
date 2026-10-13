# Crampon

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

## Ajouter des joueurs

Tout est dans `src/data/players.js` (un joueur = une ligne `P(...)`) et les clubs dans `src/data/meta.js`. Le serveur refuse de démarrer si un club ou un pays est inconnu, ce qui évite les fautes de frappe. Ajouter des joueurs change l'ordre du tirage : à faire de préférence avant le lancement public.

## Structure

- `server.js` : API (partie du jour, essais, indices, comptes, album, classement)
- `src/game.js` : tirage du jour, calcul de la température, indices
- `public/` : le site (HTML, CSS, JS sans framework)
