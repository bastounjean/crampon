// Ajoute à la liste (src/data/pool.json) les joueurs en activité les plus connus qui n'y sont pas encore.
// Les joueurs déjà tombés ne changent pas : les nouveaux ne peuvent tomber qu'à partir de demain.
// Usage : node scripts/add-active.js [nombre]
const fs = require('fs');
const path = require('path');
const { fetchPoolIds, fetchPlayers } = require('../src/wikidata');

const file = path.join(__dirname, '..', 'src', 'data', 'pool.json');

(async () => {
  const count = +process.argv[2] || 200;
  const pool = JSON.parse(fs.readFileSync(file, 'utf8'));
  const have = new Set(pool.ids);
  console.log(`${pool.ids.length} joueurs dans la liste, dont ${pool.players.filter((p) => p.active).length} en activité.`);

  const bornFrom = new Date().getFullYear() - 36;
  console.log(`Recherche des joueurs nés depuis ${bornFrom}…`);
  const ids = (await fetchPoolIds(count * 4, { bornFrom })).filter((x) => !have.has(x.id));
  console.log(`${ids.length} candidats hors liste, récupération des fiches…`);
  const players = await fetchPlayers(ids.map((x) => x.id), { log: console.log });

  // mêmes règles que build-pool.js : 3 saisons dans les 5 grands championnats et international A
  const big5Years = (p) => p.clubs.filter((c) => c.league).reduce((n, c) => n + Math.max(1, (c.to ?? new Date().getFullYear()) - (c.from ?? (c.to ?? 2000) - 1)), 0);
  const kept = players.filter((p) => p.active && big5Years(p) >= 3 && p.nt)
    .sort((a, b) => b.links - a.links).slice(0, count);

  // demain, heure de Paris : le joueur du jour en cours ne bouge pas
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
  const from = fmt.format(new Date(Date.now() + 24 * 3600 * 1000));

  pool.since = pool.since || {};
  for (const p of kept) pool.since[p.id] = from;
  pool.ids = [...pool.ids, ...kept.map((p) => p.id)].sort();
  pool.players = [...pool.players, ...kept];
  fs.writeFileSync(file, JSON.stringify(pool));

  console.log(`${kept.length} joueurs ajoutés, tirables à partir du ${from}.`);
  console.log(`Liste : ${pool.ids.length} joueurs, dont ${pool.players.filter((p) => p.active).length} en activité.`);
  console.log('Ajoutés :', kept.map((p) => p.name).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
