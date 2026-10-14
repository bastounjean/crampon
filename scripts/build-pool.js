// Construit la liste des joueurs (src/data/pool.json) depuis Wikidata.
// Usage : node scripts/build-pool.js [taille]
const fs = require('fs');
const path = require('path');
const { fetchPoolIds, fetchPlayers } = require('../src/wikidata');

(async () => {
  const size = +process.argv[2] || 600;
  console.log('Recherche des joueurs les plus connus…');
  const ids = await fetchPoolIds(Math.round(size * 1.4));
  console.log(`${ids.length} candidats, récupération des fiches…`);
  const players = await fetchPlayers(ids.map((x) => x.id), { log: console.log });
  // au moins 3 saisons dans un club des 5 grands championnats
  const big5Years = (p) => p.clubs.filter((c) => c.league).reduce((n, c) => n + Math.max(1, (c.to ?? new Date().getFullYear()) - (c.from ?? (c.to ?? 2000) - 1)), 0);
  const eligible = players.filter((p) => big5Years(p) >= 3);
  console.log(`${eligible.length} avec au moins 3 saisons dans les 5 grands championnats.`);
  players.length = 0; players.push(...eligible);
  players.sort((a, b) => b.links - a.links);
  const kept = players.slice(0, size);
  const file = path.join(__dirname, '..', 'src', 'data', 'pool.json');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), ids: kept.map((p) => p.id).sort(), players: kept }));
  const by = (f) => Object.entries(kept.reduce((m, p) => ((m[f(p)] = (m[f(p)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  console.log(`${kept.length} joueurs gardés sur ${players.length} valides.`);
  console.log('Postes :', JSON.stringify(by((p) => p.pos)));
  console.log('Décennies :', JSON.stringify(by((p) => p.born.slice(0, 3) + '0')));
  console.log('Pays :', JSON.stringify(by((p) => p.nat[0].name).slice(0, 25)));
  console.log('Championnats :', JSON.stringify(by((p) => [...new Set(p.clubs.map((c) => c.league).filter(Boolean))].join('+')).slice(0, 12)));
  console.log('Exemples :', kept.slice(0, 40).map((p) => p.name).join(', '));
  console.log('Fin de liste :', kept.slice(-25).map((p) => p.name).join(', '));
  const z = kept.find((p) => p.id === 'Q1835');
  console.log('Zidane :', JSON.stringify(z));
  console.log('Sans sélection :', kept.filter((p) => !p.nt).length, kept.filter((p) => !p.nt).slice(0, 15).map((p) => p.name).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
