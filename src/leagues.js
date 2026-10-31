// Règles des ligues, sans base de données (testées dans test/leagues.test.js).
// Une ligue compte les points à partir de sa création. La ligue TikTok, elle, repart de zéro le 1er de chaque mois :
// le premier à la fin du mois devient « Joueur TikTok du mois » et s'affiche dans le Classement.
const G = require('./game');

const TIKTOK_CODE = String(process.env.TIKTOK_LEAGUE || 'RYVFCH').toUpperCase();
// premier mois du concours : les points d'avant ne comptent pas, même si la ligue existait déjà
const TIKTOK_FROM = /^\d{4}-\d{2}-\d{2}$/.test(process.env.TIKTOK_FROM || '') ? process.env.TIKTOK_FROM : '2026-11-01';
const MAX_MEMBERS = 200;

const isMonthly = (l) => !!l && String(l.code).toUpperCase() === TIKTOK_CODE;
const maxMembers = (l) => (isMonthly(l) ? Infinity : MAX_MEMBERS);
const monthOf = (day) => day.slice(0, 7);
const lastDay = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
function prevMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
const later = (...days) => days.filter(Boolean).sort().pop();

// jours comptés dans le classement d'une ligue : { from, to } (bornes comprises)
function period(l, today, month) {
  const created = G.dayOfDate(l.created_at);
  if (!isMonthly(l)) return { from: created, to: today };
  const m = month || monthOf(today);
  const to = m === monthOf(today) ? today : lastDay(m);
  return { from: later(created, TIKTOK_FROM, m + '-01'), to, month: m };
}

module.exports = { TIKTOK_CODE, TIKTOK_FROM, MAX_MEMBERS, isMonthly, maxMembers, monthOf, lastDay, prevMonth, period };
