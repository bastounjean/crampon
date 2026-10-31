// Tests du cœur du jeu : une erreur ici casse la partie de tout le monde le même jour.
// Lancer avec : npm test
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/game');
const POOL = require('../src/data/pool.json');

G.setPool(POOL.ids, POOL.players, POOL.since);
const days = Array.from({ length: 60 }, (_, i) => G.dayFromIndex(i));

test('jour ↔ numéro : aller-retour sans décalage', () => {
  assert.strictEqual(G.dayIndex(G.LAUNCH), 0);
  for (let i = 0; i < 400; i += 7) assert.strictEqual(G.dayIndex(G.dayFromIndex(i)), i);
});

test('joueur du jour : toujours le même pour une date, et dans la liste', () => {
  const first = days.map((d) => G.playerOfDay(d).id);
  G.fixDraws({}); // repart de zéro : le tirage doit se refaire à l'identique
  assert.deepStrictEqual(days.map((d) => G.playerOfDay(d).id), first);
  for (const id of first) assert.ok(POOL.ids.includes(id), `${id} n'est pas dans la liste`);
});

test('joueur du jour : pas de doublon sur deux mois', () => {
  const ids = days.map((d) => G.playerOfDay(d).id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('tirages enregistrés : ils priment sur le calcul', () => {
  const d = days[3];
  const other = G.playerOfDay(days[10]).id;
  G.fixDraws({ [d]: other });
  assert.strictEqual(G.playerOfDay(d).id, other);
  G.fixDraws({});
});

test('comparaison : le bon joueur donne 100°, un autre moins', () => {
  const a = G.playerOfDay(days[0]);
  const b = G.playerOfDay(days[1]);
  assert.strictEqual(G.compare(a, a).temp, 100);
  const t = G.compare(a, b).temp;
  assert.ok(t >= 0 && t < 100, `température ${t}`);
});

test('recherche : un nom connu est retrouvé, un mot vide non', () => {
  const r = G.resolve({ q: 'Zidane' });
  assert.ok(r && r.type === 'player' && /Zidane/.test(r.player.name));
  assert.ok(!G.resolve({ q: '' }));
  assert.ok(G.suggest('mba').length > 0);
});

test('points : moins d\'essais et moins d\'indices rapportent plus', () => {
  const p = G.playerOfDay(days[0]);
  assert.ok(G.score(p, 1, 0).points > G.score(p, 5, 0).points);
  assert.ok(G.score(p, 5, 0).points > G.score(p, 5, 3).points);
  assert.ok(G.score(p, 200, 7).points > 0);
});

test('indices : débloqués au 5e essai puis tous les 6', () => {
  assert.strictEqual(G.hintAt(0), 5);
  assert.strictEqual(G.hintAt(1), 11);
});

test('indices : jamais deux fois le même, ni une info déjà trouvée', () => {
  for (const d of days.slice(0, 20)) {
    const p = G.playerOfDay(d);
    const given = [];
    for (let i = 0; i < G.MAX_HINTS; i++) {
      const h = G.nextHint(p, [], given);
      if (!h) break;
      assert.ok(!given.includes(h), `indice ${h} redonné pour ${p.name}`);
      given.push(h);
    }
    // poste déjà découvert par une question : l'indice « poste » ne doit pas tomber
    const pos = G.resolve({ q: { GB: 'gardien', DEF: 'défenseur', MIL: 'milieu', ATT: 'attaquant' }[p.pos] });
    if (pos && pos.type === 'clue') {
      const yes = G.askClue(p, pos.clue).yes;
      const h = G.nextHint(p, [{ type: 'clue', key: pos.clue.id, yes }], []);
      if (yes) assert.notStrictEqual(h, 'pos');
    }
  }
});

test('température : grimpe quand on trouve le joueur', () => {
  const p = G.playerOfDay(days[2]);
  assert.strictEqual(G.heat(p, [{ type: 'player', key: p.id }]), 100);
  assert.ok(G.heat(p, []) < 100);
});

test('saisies : postes abrégés, nationalités du foot et surnoms, en français et en anglais', () => {
  const r = (q) => { const x = G.resolve({ q }); return x && x.clue ? x.clue.id : x && x.player ? x.player.name : x && x.error; };
  for (const q of ['CM', 'CDM', 'cam', 'milieu défensif', 'box-to-box']) assert.strictEqual(r(q), 'pos:MIL', q);
  for (const q of ['CB', 'LB', 'right back', 'arrière gauche', 'libéro']) assert.strictEqual(r(q), 'pos:DEF', q);
  for (const q of ['ST', 'CF', 'RW', 'avant-centre', 'ailier']) assert.strictEqual(r(q), 'pos:ATT', q);
  for (const q of ['GK', 'GB', 'portier']) assert.strictEqual(r(q), 'pos:GB', q);
  assert.strictEqual(r('English'), 'nat:Q21');
  assert.strictEqual(r('Scottish'), 'nat:Q22');
  assert.strictEqual(r('Welsh'), 'nat:Q25');
  for (const q of ['UK', 'U.K.', 'British', 'Great Britain']) assert.strictEqual(r(q), 'nat:Q145', q);
  for (const q of ['USA', 'Holland', 'Korea']) assert.ok(/^nat:/.test(r(q)), q);
  assert.strictEqual(r('Three Lions'), 'sel:Q21');
  assert.strictEqual(r('England international'), 'sel:Q21');
  assert.strictEqual(r('born in the 90s'), 'dec:1990');
  assert.strictEqual(r('Spurs'), 'club:Q18741');
  assert.strictEqual(r('Wolves'), G.resolve({ q: 'Wolverhampton' }).clue.id);
  // un Anglais est britannique, même si sa fiche ne dit que « Angleterre »
  const uk = G.resolve({ q: 'UK' }).clue;
  const eng = G.PLAYERS.find((p) => p.cit.length === 1 && p.cit[0].code === 'Q21');
  assert.ok(uk.test(eng));
  assert.ok(!uk.test(G.PLAYERS.find((p) => p.cit.length === 1 && p.cit[0].code === 'Q142')));
  // les joueurs restent trouvables par leur nom
  for (const q of ['Messi', 'Kane', 'Rooney', 'Zidane']) assert.ok(G.resolve({ q }).player, q);
});
