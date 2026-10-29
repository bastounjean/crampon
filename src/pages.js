// Contenu écrit dans le HTML envoyé par le serveur, pour que Google (et AdSense) lise de vrais textes
// sans attendre le JavaScript : présentation du jeu, règles, archives des joueurs passés et leurs fiches.
const I18N = require('./i18n');
const { COUNTRIES, POSITIONS, LEAGUES } = require('./data/meta');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ADJ = Object.fromEntries(Object.values(COUNTRIES).map(([name, adj]) => [name, adj]));
const NOW_YEAR = new Date().getFullYear();

module.exports = function pages({ G, dayStats }) {
  const fmt = (day, en) => new Date(day + 'T12:00:00Z').toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const len = (c) => (c.to ?? NOW_YEAR) - (c.from ?? NOW_YEAR);
  const mainClub = (p) => [...p.clubs].filter((c) => c.league && !c.loan).sort((a, b) => len(b) - len(a))[0] || p.clubs[0];
  const and = (a, w) => a.length > 1 ? `${a.slice(0, -1).join(', ')} ${w} ${a[a.length - 1]}` : a[0];
  const span = (c, en) => c.to == null ? (c.from ? `${en ? 'since' : 'depuis'} ${c.from}` : '') : c.from === c.to ? `${c.from}` : `${c.from ?? '?'}–${c.to}`;

  // jours déjà passés (le joueur du jour reste secret)
  const past = () => {
    const out = [];
    for (let i = G.dayIndex(G.today()) - 1; i >= 0; i--) {
      const day = G.dayFromIndex(i);
      out.push({ day, number: i + 1, p: G.playerOfDay(day) });
    }
    return out;
  };

  function about(en) {
    const recent = past().slice(0, 6);
    return en ? `
<h2>What is FoOotix?</h2>
<p>FoOotix is a free football guessing game. Every day at midnight (Paris time), one footballer is drawn from more than a thousand internationals, legends and current players who all spent at least three seasons in the Premier League, LaLiga, Serie A, Bundesliga or Ligue 1. Everyone gets the same player, and the goal is to name him in as few tries as possible.</p>
<h2>How to find him</h2>
<p>Start by guessing any player: the game shows what he has in common with the mystery footballer (nationality, position, clubs, leagues, teammates, age). You can also ask direct questions such as “Serie A”, “Real Madrid”, “Africa”, “goalkeeper”, “born in the 1990s” or “Ballon d'Or”. Every answer fills in the mystery card and raises your temperature, from 0° to 100°.</p>
<h2>More than one player a day</h2>
<p>Each player you find joins your <a href="/album">album</a>. Every day you can also open a free pack of five cards in <a href="/collection">Pack Opening</a>, and a second one if you found the daily player. Challenge a friend or a stranger in a <a href="/duel">Duel</a>, and compare your points in the <a href="/classement">ranking</a>.</p>
${recent.length ? `<h2>Missed a day?</h2><p>Past players can still be caught up, with no points: ${recent.map((d) => `<a href="/jour/${d.day}">#${d.number} (${fmt(d.day, true)})</a>`).join(', ')}. The full list, with each player's profile, is in the <a href="/joueurs">archive</a>.</p>` : ''}
<p><a href="/regles">Read the full rules</a></p>` : `
<h2>FoOotix, c'est quoi&nbsp;?</h2>
<p>FoOotix est un jeu gratuit de devinette sur le football. Chaque jour à minuit (heure de Paris), un footballeur est tiré au sort parmi plus de mille internationaux, légendes et joueurs actuels, qui ont tous passé au moins trois saisons en Ligue 1, Premier League, Bundesliga, Liga ou Serie A. Tout le monde a le même joueur, et le but est de trouver son nom en un minimum d'essais.</p>
<h2>Comment le trouver</h2>
<p>Commence par proposer un joueur au hasard&nbsp;: le jeu te montre ce qu'il a en commun avec le mystère (nationalité, poste, clubs, championnats, coéquipiers, âge). Tu peux aussi poser des questions directes comme «&nbsp;Serie A&nbsp;», «&nbsp;Real Madrid&nbsp;», «&nbsp;Afrique&nbsp;», «&nbsp;gardien&nbsp;», «&nbsp;années 1990&nbsp;» ou «&nbsp;Ballon d'or&nbsp;». Chaque réponse remplit la carte du joueur mystère et fait monter ta température, de 0° à 100°.</p>
<h2>Plus qu'un joueur par jour</h2>
<p>Chaque joueur trouvé rejoint ton <a href="/album">album</a>. Tous les jours, tu peux aussi ouvrir un pack gratuit de cinq cartes dans <a href="/collection">Pack Opening</a>, et un deuxième si tu as trouvé le joueur du jour. Affronte un ami ou un inconnu dans un <a href="/duel">duel</a>, et compare tes points au <a href="/classement">classement</a>.</p>
${recent.length ? `<h2>Tu as raté un jour&nbsp;?</h2><p>Les joueurs passés peuvent encore être rattrapés, sans points&nbsp;: ${recent.map((d) => `<a href="/jour/${d.day}">n°&nbsp;${d.number} (${fmt(d.day)})</a>`).join(', ')}. La liste complète, avec la fiche de chaque joueur, est dans les <a href="/joueurs">archives</a>.</p>` : ''}
<p><a href="/regles">Lire les règles complètes</a></p>`;
  }

  // petits textes pour les onglets qui ne montrent que le jeu
  const blurbs = {
    '/album': ['Ton album rassemble tous les joueurs mystères que tu as trouvés, jour après jour, avec ta série et ton record. Les jours ratés restent des cases vides que tu peux encore rattraper.', 'Your album gathers every mystery player you found, day after day, with your streak and your record. Missed days stay as empty slots you can still catch up on.'],
    '/collection': ["Pack Opening : chaque jour, un pack gratuit de cinq cartes de footballeurs, de la carte bronze à la carte légende. Plus un joueur est célèbre, plus sa carte est rare. Trouve le joueur du jour pour gagner un deuxième pack.", 'Pack Opening: every day, a free pack of five footballer cards, from bronze to legend. The more famous the player, the rarer his card. Find the daily player to earn a second pack.'],
    '/classement': ["Le classement général additionne les points de chaque jour : plus tu trouves vite, et plus le joueur est méconnu, plus tu marques. Crée une ligue pour te mesurer à tes amis.", 'The overall ranking adds up the points of each day: the faster you find him, and the less known the player, the more you score. Create a league to compete with your friends.'],
    '/duel': ['Le duel : deux joueurs, le même footballeur mystère, sans chrono. Le premier qui trouve gagne, celui qui abandonne perd. Joue contre un inconnu, contre un ami avec un code, ou contre le robot.', 'Duel: two players, the same mystery footballer, no timer. The first to find him wins, whoever gives up loses. Play a stranger, a friend with a code, or the bot.'],
  };

  // ——— règles ———
  function rules(en) {
    return en ? `
<div class="pagehead"><div><div class="kicker">How it works</div><h1>Rules</h1></div></div>
<div class="prose">
  <p>Every day at midnight (Paris time), one footballer is drawn from more than a thousand internationals, legends and current players, who all spent at least three seasons in the Premier League, LaLiga, Serie A, Bundesliga or Ligue 1. The draw is the same for everyone, and a player doesn't come back until almost all the others have been drawn.</p>
  <h2>Points</h2>
  <p>Finding the player earns points: 100 if you get him on the first try, then a little less with each guess (never below 10). Each hint you ask for costs 10%. Rarity multiplies the total: a star like Zidane counts ×1, a little-known player up to ×2. Giving up earns nothing. Points add up day after day in the overall ranking.</p>
  <h2>The card</h2>
  <p>At first, the mystery player's card is empty: a silhouette and question marks. Everything you discover goes on it: nationality, position, year or decade of birth, a club, his leagues, whether he still plays, whether he won the Ballon d'Or. The number in the top left corner is your temperature.</p>
  <h2>Two ways to search</h2>
  <p><b>Guess a player.</b> You see what your player has in common with the mystery one: same nationality, same or nearby position, teammates at a club, shared clubs or leagues. An arrow tells you whether the mystery player is older or younger.</p>
  <p><b>Ask a question.</b> Type a league, a club, a country, a continent, a position, a birth decade, “Ballon d'Or” or “retired”. You get a yes or no, stored under “What you know”.</p>
  <h2>Temperature</h2>
  <p>It measures everything you know about the mystery player. At the start, every player is possible: you're at 0°. Every yes, every no, every common point with a guessed player rules some out. When about ten are left, you're around 65°; at 99°, only one is left, you just have to name him. 100° means you won.</p>
  <h2>Hints</h2>
  <p>Every 8 guesses, you can reveal a hint: position, generation, continent, nationality, a club, then his initials.</p>
  <h2>Your album and your streak</h2>
  <p>Every player you find joins your album, with his profile and his Wikipedia page. Missed days can be caught up later, with no points. Your streak counts the days in a row you found the player. Giving up resets it.</p>
  <h2>Pack Opening</h2>
  <p>Every day you can open a free pack of five cards. Each card has a rarity, bronze, silver, gold or legend, set by how famous the player is: about one card in a hundred is a legend. The fifth card is always silver or better. Finding the daily player unlocks a second pack.</p>
  <h2>Duel</h2>
  <p>In a duel, two players get the same mystery footballer, drawn outside the daily game, with no timer. The rules are the same: the first to find him wins, and whoever gives up loses. You can play a stranger, invite a friend with a five-letter code, or play the bot.</p>
  <p class="muted" style="font-size:14px">Players and their careers come from Wikidata, updated daily. Photos and articles come from Wikipedia (CC BY-SA). Past players are listed in the <a href="/joueurs">archive</a>.</p>
</div>` : `
<div class="pagehead"><div><div class="kicker">Mode d'emploi</div><h1>Règles</h1></div></div>
<div class="prose">
  <p>Chaque jour à minuit (heure de Paris), un footballeur est tiré au sort parmi plus de mille internationaux, légendes ou joueurs actuels, qui ont tous passé au moins trois saisons en Ligue 1, Premier League, Bundesliga, Liga ou Serie A. Le tirage est le même pour tout le monde, et un joueur ne revient pas avant que presque tous les autres soient passés.</p>
  <h2>Les points</h2>
  <p>Trouver le joueur rapporte des points&nbsp;: 100 si tu le trouves du premier coup, puis un peu moins à chaque essai (jamais moins de 10). Chaque indice demandé retire 10&nbsp;%. Enfin, la rareté multiplie le tout&nbsp;: une star comme Zidane compte ×1, un joueur méconnu jusqu'à ×2. Abandonner ne rapporte rien. Les points s'additionnent jour après jour dans le classement général.</p>
  <h2>La carte</h2>
  <p>Au départ, la carte du joueur mystère est vide&nbsp;: une silhouette et des points d'interrogation. Chaque chose que tu découvres s'y inscrit&nbsp;: nationalité, poste, année ou décennie de naissance, un club, ses championnats, s'il joue encore, s'il a eu le Ballon d'or. Le chiffre en haut à gauche, c'est ta température.</p>
  <h2>Deux façons de chercher</h2>
  <p><b>Propose un joueur.</b> Tu vois ce que ton joueur a en commun avec le mystère&nbsp;: même nationalité, même poste ou poste voisin, coéquipiers dans un club, clubs ou championnats communs. Une flèche te dit si le mystère est plus âgé ou plus jeune.</p>
  <p><b>Pose une question.</b> Tape un championnat, un club, un pays, un continent, un poste, une décennie de naissance, «&nbsp;Ballon d'or&nbsp;» ou «&nbsp;retraité&nbsp;». Réponse oui ou non, rangée dans «&nbsp;Ce que tu sais&nbsp;».</p>
  <h2>La température</h2>
  <p>Elle mesure tout ce que tu sais sur le mystère. Au départ, tous les joueurs sont possibles&nbsp;: tu es à 0°. Chaque oui, chaque non, chaque point commun avec un joueur proposé en élimine. Quand il n'en reste qu'une dizaine, tu es vers 65°&nbsp;; à 99°, il n'en reste qu'un, à toi de trouver son nom. 100°, c'est gagné.</p>
  <h2>Indices</h2>
  <p>Tous les 8 essais, tu peux révéler un indice&nbsp;: poste, génération, continent, nationalité, un club, puis ses initiales.</p>
  <h2>Ton album et ta série</h2>
  <p>Chaque joueur trouvé rejoint ton album, avec sa fiche et sa page Wikipédia. Les jours ratés peuvent être rattrapés plus tard, sans points. La série compte les jours d'affilée où tu as trouvé. Un abandon la remet à zéro.</p>
  <h2>Pack Opening</h2>
  <p>Chaque jour, tu peux ouvrir un pack gratuit de cinq cartes. Chaque carte a une rareté, bronze, argent, or ou légende, qui dépend de la célébrité du joueur&nbsp;: environ une carte sur cent est une légende. La cinquième carte est toujours argent ou mieux. Trouver le joueur du jour débloque un deuxième pack.</p>
  <h2>Le duel</h2>
  <p>En duel, deux joueurs ont le même footballeur mystère, tiré hors du jeu du jour, sans chrono. Les règles sont les mêmes : le premier qui trouve gagne, et celui qui abandonne perd. Tu peux affronter un inconnu, inviter un ami avec un code de cinq lettres, ou jouer contre le robot.</p>
  <p class="muted" style="font-size:14px">Les joueurs et leurs carrières viennent de Wikidata, mis à jour chaque jour. Les photos et les articles viennent de Wikipédia (CC BY-SA). Les joueurs passés sont listés dans les <a href="/joueurs">archives</a>.</p>
</div>`;
  }

  // ——— archives ———
  function archive(en) {
    const rows = past();
    const nat = (p) => esc(en ? I18N.country(p.nat[0].name) : p.nat[0].name);
    const pos = (p) => esc(en ? I18N.tr(POSITIONS[p.pos].name) : POSITIONS[p.pos].name);
    const club = (p) => esc(en ? I18N.place(mainClub(p).club) : mainClub(p).club);
    return `
<div class="pagehead"><div><div class="kicker">${en ? 'Archive' : 'Archives'}</div><h1>${en ? 'Past mystery players' : 'Les joueurs mystères passés'}</h1>
<p>${en ? `Every footballer drawn since FoOotix began, with his profile. Careful: this page gives away the answers. To play a missed day first, open it from the <a href="/album">album</a>.` : `Tous les footballeurs tirés depuis le lancement de FoOotix, avec leur fiche. Attention, cette page donne les réponses&nbsp;: pour jouer un jour raté avant, ouvre-le depuis l'<a href="/album">album</a>.`}</p></div></div>
<div class="prose">
${rows.length ? `<table class="arch"><tr><th>${en ? '#' : 'N°'}</th><th>Date</th><th>${en ? 'Player' : 'Joueur'}</th><th>${en ? 'Position' : 'Poste'}</th><th>${en ? 'Nationality' : 'Nationalité'}</th><th>${en ? 'Main club' : 'Club principal'}</th></tr>
${rows.map((d) => `<tr><td>${d.number}</td><td>${esc(fmt(d.day, en))}</td><td><a href="/joueur/${esc(d.p.id)}">${esc(d.p.name)}</a></td><td>${pos(d.p)}</td><td>${nat(d.p)}</td><td>${club(d.p)}</td></tr>`).join('\n')}
</table>` : `<p>${en ? 'No past player yet: the first one will appear here tomorrow.' : "Pas encore de joueur passé : le premier apparaîtra ici demain."}</p>`}
</div>`;
  }

  // ——— fiche d'un joueur passé, écrite à partir de nos données ———
  async function profile(id, en) {
    const p = G.BY_ID[id];
    const days = p ? past().filter((d) => d.p.id === p.id) : [];
    if (!days.length) return null;
    const last = days[0];
    const stats = await dayStats(last.day).catch(() => null);
    const c = G.card(p);
    const T = (s) => (en ? I18N.tr(s) : s);
    const nat = p.nat.map((n) => (en ? I18N.country(n.name) : n.name));
    const pos = T(POSITIONS[p.pos].name).toLowerCase();
    const born = p.born ? fmt(p.born, en) : null;
    const clubs = p.clubs.filter((x) => !x.loan);
    const loans = p.clubs.filter((x) => x.loan);
    const club = (x) => esc(en ? I18N.place(x.club) : x.club);
    const seasons = {};
    for (const x of p.clubs) if (x.league && x.from) {
      const y = (seasons[x.league] ||= new Set());
      for (let k = x.from; k < Math.max(x.from + 1, x.to ?? NOW_YEAR); k++) y.add(k);
    }
    const top = Object.entries(seasons).map(([k, y]) => [k, y.size]).sort((a, b) => b[1] - a[1]);
    const team = p.nt ? String(p.nt.team).replace(/ de football$/, '').replace(/ masculine?$/, '') : '';
    const teamFr = /^[ée]quipe/i.test(team) ? `l'${team}` : team;
    const teamEn = /^[ée]quipe d[e'u]/i.test(team) ? nat[0] : I18N.place(team);
    const lg = (k) => esc(LEAGUES[k].name);

    const s = [];
    if (en) {
      s.push(`<b>${esc(p.name)}</b> is ${/^[aeiou]/i.test(nat[0]) ? 'an' : 'a'} ${esc(nat.join(' / '))} ${esc(pos)}${born ? `, born on ${esc(born)}${p.place ? ` in ${esc(I18N.place(p.place))}` : ''}` : ''}. ${p.active ? 'He is still playing.' : 'He has retired.'}`);
      if (clubs.length) s.push(clubs.length === 1 ? `He spent his whole senior career at ${club(clubs[0])}${clubs[0].from ? ` (${span(clubs[0], en)})` : ''}.` : `He started out at ${club(clubs[0])}${clubs[0].from ? ` in ${clubs[0].from}` : ''}, then played for ${clubs.slice(1, -1).map((x) => `${club(x)} (${span(x, en)})`).join(', ') || ''}${clubs.length > 2 ? ' and ' : ''}${club(clubs[clubs.length - 1])}${clubs[clubs.length - 1].from ? ` (${span(clubs[clubs.length - 1], en)})` : ''}.`);
      if (loans.length) s.push(`He was also loaned to ${and(loans.map(club), 'and')}.`);
      if (top.length) s.push(`Most of his time in the big five leagues was spent in the ${lg(top[0][0])} (about ${top[0][1]} season${top[0][1] > 1 ? 's' : ''})${top.length > 1 ? `, and he also played in ${top.slice(1).map(([k]) => lg(k)).join(', ')}` : ''}.`);
      if (p.nt) s.push(`He played for ${esc(teamEn)}${p.nt.caps ? `, with ${p.nt.caps} caps${p.nt.goals ? ` and ${p.nt.goals} goal${p.nt.goals > 1 ? 's' : ''}` : ''}` : ''}.`);
      if (p.bo) s.push("He is one of the Ballon d'Or winners.");
    } else {
      const adj = (ADJ[p.nat[0].name] || '').toLowerCase();
      s.push(`<b>${esc(p.name)}</b> est un ${esc(pos)} ${adj ? esc(adj) : `(${esc(nat.join(' / '))})`}${born ? `, né le ${esc(born)}${p.place ? ` à ${esc(p.place)}` : ''}` : ''}. ${p.active ? 'Il joue toujours.' : 'Il a pris sa retraite.'}`);
      if (clubs.length) s.push(clubs.length === 1 ? `Il a fait toute sa carrière à ${club(clubs[0])}${clubs[0].from ? ` (${span(clubs[0])})` : ''}.` : `Il a débuté à ${club(clubs[0])}${clubs[0].from ? ` en ${clubs[0].from}` : ''}, puis ${clubs.length === 2 ? 'a rejoint' : 'a joué pour'} ${clubs.slice(1, -1).map((x) => `${club(x)} (${span(x)})`).join(', ')}${clubs.length > 2 ? ' et ' : ''}${club(clubs[clubs.length - 1])}${clubs[clubs.length - 1].from ? ` (${span(clubs[clubs.length - 1])})` : ''}.`);
      if (loans.length) s.push(`Il a aussi été prêté à ${and(loans.map(club), 'et')}.`);
      if (top.length) s.push(`Parmi les cinq grands championnats, c'est en ${lg(top[0][0])} qu'il a passé le plus de temps (environ ${top[0][1]} saison${top[0][1] > 1 ? 's' : ''})${top.length > 1 ? `, et il a aussi joué en ${top.slice(1).map(([k]) => lg(k)).join(', ')}` : ''}.`);
      if (p.nt) s.push(`En sélection, il a joué pour ${esc(teamFr)}${p.nt.caps ? ` : ${p.nt.caps} sélections${p.nt.goals ? ` et ${p.nt.goals} but${p.nt.goals > 1 ? 's' : ''}` : ''}` : ''}.`);
      if (p.bo) s.push("Il fait partie des lauréats du Ballon d'or.");
    }

    // les autres joueurs passés qu'il a croisés en club, pour circuler d'une fiche à l'autre
    const mates = [];
    const seen = new Set([p.id]);
    for (const d of past()) {
      if (seen.has(d.p.id)) continue;
      seen.add(d.p.id);
      const both = p.clubs.find((a) => d.p.clubs.some((b) => b.id === a.id && (a.from ?? 0) <= (b.to ?? NOW_YEAR) && (b.from ?? 0) <= (a.to ?? NOW_YEAR)));
      const same = !both && d.p.nat[0].name === p.nat[0].name;
      if (both || same) mates.push({ d, both });
    }

    const hints = [0, 1, 2, 3, 4, 5].map((k) => esc(T(G.hintText(p, k))));
    const when = fmt(last.day, en);
    const title = en ? `${p.name}: career and profile · FoOotix` : `${p.name} : carrière et fiche du joueur · FoOotix`;
    const desc = en
      ? `${p.name}, ${nat[0]} ${pos}${p.born ? ` born in ${p.born.slice(0, 4)}` : ''}: clubs, leagues and national team. Mystery player #${last.number} of FoOotix.`
      : `${p.name}, ${pos} ${(ADJ[p.nat[0].name] || nat[0]).toLowerCase()}${p.born ? ` né en ${p.born.slice(0, 4)}` : ''} : ses clubs, ses championnats, sa sélection. Joueur mystère n° ${last.number} de FoOotix.`;
    const html = `
<div class="pagehead"><div><div class="kicker">${en ? `Mystery player #${last.number} · ${esc(when)}` : `Joueur mystère n° ${last.number} · ${esc(when)}`}</div><h1>${esc(p.name)}</h1></div></div>
<div class="prose">
  <p>${s.join(' ')}</p>
  <h2>${en ? 'Club career' : 'Carrière en club'}</h2>
  <table><tr><th>${en ? 'Years' : 'Période'}</th><th>Club</th><th>${en ? 'League' : 'Championnat'}</th></tr>
  ${c.clubs.map((x) => `<tr><td>${esc(span(x, en))}</td><td>${club(x)}${x.loan ? (en ? ' (loan)' : ' (prêt)') : ''}</td><td>${esc(x.leagueName || '—')}</td></tr>`).join('\n  ')}</table>
  <h2>${en ? 'On FoOotix' : 'Sur FoOotix'}</h2>
  <p>${en ? `${esc(p.name)} was the mystery player of ${esc(when)}.` : `${esc(p.name)} a été le joueur mystère du ${esc(when)}.`}${stats && stats.found ? (en ? ` ${stats.found} player${stats.found > 1 ? 's' : ''} found him${stats.avg ? `, in ${stats.avg} tries on average` : ''}.` : ` ${stats.found} joueur${stats.found > 1 ? 's' : ''} l'${stats.found > 1 ? 'ont' : 'a'} trouvé${stats.avg ? `, en ${stats.avg} essais en moyenne` : ''}.`) : ''} ${en ? 'These were the hints, in order:' : "Voici les indices qu'on pouvait demander, dans l'ordre&nbsp;:"}</p>
  <ol>${hints.map((h) => `<li>${h}</li>`).join('')}</ol>
  ${mates.length ? `<h2>${en ? 'Other mystery players linked to him' : 'Autres joueurs mystères liés à lui'}</h2>
  <ul>${mates.slice(0, 8).map(({ d, both }) => `<li><a href="/joueur/${esc(d.p.id)}">${esc(d.p.name)}</a>, ${both ? (en ? `teammate at ${club(both)}` : `coéquipier à ${club(both)}`) : (en ? 'same nationality' : 'même nationalité')}</li>`).join('')}</ul>` : ''}
  <p><a href="https://${en ? 'en' : 'fr'}.wikipedia.org/wiki/${encodeURIComponent((p.title || p.name).replace(/ /g, '_'))}" rel="noopener">${en ? 'Read his Wikipedia article' : 'Lire son article sur Wikipédia'}</a> · <a href="/joueurs">${en ? 'All past players' : 'Tous les joueurs passés'}</a> · <a href="/">${en ? "Play today's game" : 'Jouer au joueur du jour'}</a></p>
</div>`;
    return { title, desc, main: html };
  }

  const TITLES = {
    '/regles': ['Règles du jeu · FoOotix', 'How to play · FoOotix', "Comment jouer à FoOotix : les points, la carte du joueur mystère, la température, les indices, le Pack Opening et le duel.", 'How to play FoOotix: points, the mystery card, temperature, hints, Pack Opening and duels.'],
    '/joueurs': ['Archives : les joueurs mystères passés · FoOotix', 'Archive: past mystery players · FoOotix', 'Tous les footballeurs déjà tirés sur FoOotix, jour par jour, avec leur poste, leur nationalité, leur club et leur fiche.', 'Every footballer already drawn on FoOotix, day by day, with position, nationality, club and profile.'],
    '/album': ['Mon album · FoOotix', 'My album · FoOotix'],
    '/collection': ['Pack Opening : un pack de cartes gratuit par jour · FoOotix', 'Pack Opening: a free card pack every day · FoOotix', blurbs['/collection'][0], blurbs['/collection'][1]],
    '/classement': ['Classement · FoOotix', 'Ranking · FoOotix', blurbs['/classement'][0], blurbs['/classement'][1]],
    '/duel': ['Duel : affronte un autre joueur · FoOotix', 'Duel: face another player · FoOotix', blurbs['/duel'][0], blurbs['/duel'][1]],
    '/mentions-legales': ['Mentions légales · FoOotix', 'Legal notice · FoOotix'],
    '/confidentialite': ['Confidentialité et cookies · FoOotix', 'Privacy and cookies · FoOotix'],
  };

  // ce que le serveur ajoute à la page : { title, desc, main (dans #app), about (sous #app) }
  return async function render(pathName, lang) {
    const en = lang === 'en';
    const t = TITLES[pathName];
    const out = t ? { title: t[en ? 1 : 0], desc: t[en ? 3 : 2] } : {};
    if (pathName === '/' || pathName.startsWith('/jour/')) out.about = about(en);
    else if (blurbs[pathName]) out.about = `<p>${blurbs[pathName][en ? 1 : 0]}</p><p><a href="/regles">${en ? 'Read the rules' : 'Lire les règles'}</a> · <a href="/">${en ? 'Play' : 'Jouer'}</a></p>`;
    if (pathName === '/regles') out.main = rules(en);
    if (pathName === '/joueurs') out.main = archive(en);
    const m = pathName.match(/^\/joueur\/([\w-]+)$/);
    if (m) {
      const r = await profile(m[1], en);
      if (!r) return null;
      Object.assign(out, r);
    }
    // liens internes : navigation sans recharger la page
    for (const k of ['main', 'about']) if (out[k]) out[k] = out[k].replace(/<a href="\//g, '<a data-link href="/');
    return out;
  };
};
