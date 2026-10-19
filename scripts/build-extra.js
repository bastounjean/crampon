// Construit la liste des joueurs qu'on peut proposer sans qu'ils tombent comme joueur du jour
// (src/data/extra.json) : les joueurs récents passés par les 5 grands championnats.
// Usage : node scripts/build-extra.js [taille]
const fs = require('fs');
const path = require('path');
const { fetchPoolIds, fetchPlayers } = require('../src/wikidata');

(async () => {
  const size = +process.argv[2] || 4000;
  const pool = require('../src/data/pool.json');
  const have = new Set(pool.ids);
  const bornFrom = new Date().getFullYear() - 38;
  console.log(`Recherche des joueurs nés depuis ${bornFrom}…`);
  const ids = (await fetchPoolIds(size, { bornFrom, minLinks: 6 })).filter((x) => !have.has(x.id));
  console.log(`${ids.length} candidats hors liste du jour, récupération des fiches…`);
  const players = await fetchPlayers(ids.map((x) => x.id), { log: console.log, facts: false });
  // une fiche allégée : de quoi comparer avec le joueur mystère
  const kept = players.sort((a, b) => b.links - a.links).slice(0, size)
    .map(({ id, name, title, born, img, links, aliases, nat, pos, clubs, nt, active }) => ({ id, name, title, born, img, links, aliases, nat, pos, clubs, nt, active }));
  const file = path.join(__dirname, '..', 'src', 'data', 'extra.json');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), players: kept }));
  console.log(`${kept.length} joueurs enregistrés, dont ${kept.filter((p) => p.active).length} en activité.`);
  console.log('Exemples :', kept.slice(0, 60).map((p) => p.name).join(', '));
  const paixao = kept.find((p) => /paix/i.test(p.name));
  console.log('Paixão :', paixao ? JSON.stringify(paixao).slice(0, 300) : 'absent');
})().catch((e) => { console.error(e); process.exit(1); });
