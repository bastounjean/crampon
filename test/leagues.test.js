// Règles des ligues : période comptée, remise à zéro mensuelle de la ligue TikTok, limite de joueurs.
const test = require('node:test');
const assert = require('node:assert');
const LG = require('../src/leagues');

const normal = { code: 'ABCDEF', created_at: '2026-10-12T22:30:00.000Z' }; // 13 octobre à Paris
const tiktok = { code: LG.TIKTOK_CODE, created_at: '2026-10-31T09:00:00.000Z' };

test('une ligue compte les points depuis sa création (jour de Paris)', () => {
  assert.deepStrictEqual(LG.period(normal, '2026-11-20'), { from: '2026-10-13', to: '2026-11-20' });
});

test('ligue TikTok : rien ne compte avant le début du concours', () => {
  const p = LG.period(tiktok, '2026-10-31');
  assert.ok(p.from > '2026-10-31');
  assert.strictEqual(p.from, LG.TIKTOK_FROM);
});

test('ligue TikTok : les points repartent de zéro chaque mois', () => {
  assert.deepStrictEqual(LG.period(tiktok, '2026-12-05'), { from: '2026-12-01', to: '2026-12-05', month: '2026-12' });
  assert.deepStrictEqual(LG.period(tiktok, '2026-12-05', '2026-11'), { from: '2026-11-01', to: '2026-11-30', month: '2026-11' });
  assert.deepStrictEqual(LG.period(tiktok, '2027-03-01', '2027-02'), { from: '2027-02-01', to: '2027-02-28', month: '2027-02' });
});

test('mois précédent et dernier jour', () => {
  assert.strictEqual(LG.prevMonth('2027-01'), '2026-12');
  assert.strictEqual(LG.prevMonth('2026-11'), '2026-10');
  assert.strictEqual(LG.lastDay('2028-02'), '2028-02-29');
});

test('limite de joueurs : 200, sauf la ligue TikTok', () => {
  assert.strictEqual(LG.maxMembers(normal), 200);
  assert.strictEqual(LG.maxMembers(tiktok), Infinity);
  assert.ok(LG.isMonthly({ code: 'ryvfch' }));
});
