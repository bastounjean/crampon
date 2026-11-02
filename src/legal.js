// Mentions légales et confidentialité, écrites par le serveur : Google (et AdSense) les lit sans JavaScript.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = function legal(CFG, en) {
  const L = (fr, eng) => (en ? eng : fr);
  const todo = (v, what) => v ? esc(v) : `<mark>${what} ${L('à compléter', 'to be filled in')}</mark>`;
  const contact = () => CFG.contact
    ? (CFG.contact.includes('@') ? `<a href="mailto:${esc(CFG.contact)}">${esc(CFG.contact)}</a>` : esc(CFG.contact))
    : todo('', L('Adresse e-mail de contact', 'Contact email address'));
  const HOST = `Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, ${L('États-Unis', 'USA')} (render.com)`;

  function pageLegal() {
    return en ? `
      <div class="pagehead"><div><div class="kicker">Who's behind FoOotix</div><h1>Legal notice</h1></div></div>
      <div class="prose">
        <h2>Publisher</h2>
        <p>${todo(CFG.owner, 'Publisher name')}<br>${todo(CFG.address, 'Postal address')}<br>Contact: ${contact()}</p>
        <p>Publication director: ${todo(CFG.owner, 'Name')}.</p>
        <h2>Host</h2>
        <p>${HOST}.</p>
        <h2>Content</h2>
        <p>Player profiles (clubs, dates, positions, nationalities) come from <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>, under the CC0 licence. Summaries and anecdotes come from <a href="https://en.wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>, under the <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a> licence, and may be reused under the same terms. Photos come from Wikimedia Commons; the author and licence of each one are listed on its Commons page.</p>
        <p>Club names and crests are trademarks of their owners. They are only used to identify the clubs where the players played. FoOotix is not affiliated with any club or league, nor with FIFA, UEFA or any football federation.</p>
        <p>Spotted a mistake, or a crest or photo that should be removed? Write to ${contact()}, we'll fix it quickly.</p>
      </div>` : `
      <div class="pagehead"><div><div class="kicker">Qui est derrière FoOotix</div><h1>Mentions légales</h1></div></div>
      <div class="prose">
        <h2>Éditeur</h2>
        <p>${todo(CFG.owner, 'Nom de l’éditeur')}<br>${todo(CFG.address, 'Adresse postale')}<br>Contact&nbsp;: ${contact()}</p>
        <p>Directeur de la publication&nbsp;: ${todo(CFG.owner, 'Nom')}.</p>
        <h2>Hébergeur</h2>
        <p>${HOST}.</p>
        <h2>Contenus</h2>
        <p>Les fiches des joueurs (clubs, dates, postes, nationalités) viennent de <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a>, sous licence CC0. Les résumés et anecdotes viennent de <a href="https://fr.wikipedia.org" target="_blank" rel="noopener">Wikipédia</a>, sous licence <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr" target="_blank" rel="noopener">CC BY-SA 4.0</a>, et peuvent être réutilisés aux mêmes conditions. Les photos viennent de Wikimedia Commons&nbsp;; l’auteur et la licence de chacune sont indiqués sur sa page Commons.</p>
        <p>Les noms et logos des clubs sont des marques appartenant à leurs propriétaires. Ils servent uniquement à identifier les clubs où les joueurs ont évolué. FoOotix n’est lié à aucun club, aucune ligue, ni à la FIFA, l’UEFA ou la FFF.</p>
        <p>Une erreur, un logo ou une photo à retirer&nbsp;? Écris à ${contact()}, on corrige rapidement.</p>
      </div>`;
  }

  function pagePrivacy() {
    const ads = !!CFG.ads;
    return en ? `
      <div class="pagehead"><div><div class="kicker">Your data</div><h1>Privacy and cookies</h1><p>What FoOotix keeps about you, why, and how to erase it.</p></div></div>
      <div class="prose">
        <h2>Data controller</h2>
        <p>${todo(CFG.owner, 'Publisher name')}, reachable at ${contact()}.</p>
        <h2>What the site stores</h2>
        <table>
          <tr><th>Data</th><th>Why</th><th>How long</th></tr>
          <tr><td>Username and password (hashed, unreadable even to us)</td><td>Your account</td><td>Until you delete it</td></tr>
          <tr><td>Your games: guesses, hints, result, points</td><td>Game, album, streak, ranking</td><td>As long as the account exists</td></tr>
          <tr><td>IP address</td><td>Limit login attempts</td><td>10 minutes, in memory</td></tr>
          <tr><td>Pages viewed, site you came from, mobile or computer</td><td>Count visits, with no third-party tool and no IP address</td><td>Daily totals, with nothing that identifies you</td></tr>
        </table>
        <p>No email address, no name, nothing is sold. Your username and points appear in the public ranking.</p>
        <h2>Site cookies</h2>
        <table>
          <tr><th>Name</th><th>Purpose</th><th>Duration</th></tr>
          <tr><td><code>aid</code></td><td>Find your game of the day if you play without an account</td><td>13 months</td></tr>
          <tr><td><code>sid</code></td><td>Keep you logged in</td><td>13 months, or until you log out</td></tr>
          <tr><td><code>lang</code></td><td>Remember the language you chose</td><td>1 year</td></tr>
          <tr><td><code>theme</code> (local storage)</td><td>Remember light or dark mode</td><td>Until you clear your browser</td></tr>
        </table>
        <p>These are needed for the game to work: they are not used for ads or tracking, and the law does not require consent for them.</p>
        <h2>Advertising</h2>
        ${ads ? `<p>FoOotix is funded by Google AdSense ads. Google and its partners may set cookies to show ads, personalise them and measure their performance. They are only set with your consent, asked on your first visit. If you refuse, you still see ads, but not personalised ones.</p>
        <p>You can change your mind at any time: <a href="#" id="cookies2">manage cookies</a>. Learn more: <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">how Google uses data from partner sites</a>.</p>`
        : `<p>There are no ads on FoOotix for now. If they come, this page will be updated and your consent will be asked before any advertising cookie.</p>`}
        <h2>Fonts and images</h2>
        <p>Fonts come from Google Fonts, flags from flagcdn.com, photos and crests from Wikimedia. These services see your IP address when your browser loads their files, without cookies.</p>
        <h2>Hosting</h2>
        <p>The site is hosted by ${HOST}. Accounts and games are stored with Neon, Inc. (neon.tech), in a data centre in the same region. Data may therefore be processed in the United States, under the safeguards provided by the GDPR for such transfers.</p>
        <h2>Your rights</h2>
        <p>You can access, correct or erase your data, or object to its use. The easiest way: delete your account from the <a href="/compte">Account</a> page, everything is erased at once. For anything else, write to ${contact()}. If you think your rights are not respected, you can complain to the <a href="https://www.cnil.fr/en/complaints" target="_blank" rel="noopener">CNIL</a> (the French data protection authority).</p>
      </div>` : `
      <div class="pagehead"><div><div class="kicker">Tes données</div><h1>Confidentialité et cookies</h1><p>Ce que FoOotix garde sur toi, pourquoi, et comment l’effacer.</p></div></div>
      <div class="prose">
        <h2>Responsable</h2>
        <p>${todo(CFG.owner, 'Nom de l’éditeur')}, joignable à ${contact()}.</p>
        <h2>Ce que le site enregistre</h2>
        <table>
          <tr><th>Donnée</th><th>Pourquoi</th><th>Durée</th></tr>
          <tr><td>Pseudo et mot de passe (chiffré, illisible même pour nous)</td><td>Ton compte</td><td>Jusqu’à ce que tu le supprimes</td></tr>
          <tr><td>Tes parties&nbsp;: propositions, indices, résultat, points</td><td>Jeu, album, série, classement</td><td>Tant que le compte existe</td></tr>
          <tr><td>Adresse IP</td><td>Limiter les tentatives de connexion</td><td>10 minutes, en mémoire</td></tr>
          <tr><td>Pages vues, site d’où tu arrives, mobile ou ordinateur</td><td>Compter les visites, sans outil extérieur ni adresse IP</td><td>Chiffres par jour, sans rien qui t’identifie</td></tr>
        </table>
        <p>Pas d’adresse e-mail, pas de nom, rien n’est revendu. Ton pseudo et tes points apparaissent dans le classement public.</p>
        <h2>Cookies du site</h2>
        <table>
          <tr><th>Nom</th><th>Rôle</th><th>Durée</th></tr>
          <tr><td><code>aid</code></td><td>Retrouver ta partie du jour si tu joues sans compte</td><td>13 mois</td></tr>
          <tr><td><code>sid</code></td><td>Te garder connecté</td><td>13 mois, ou jusqu’à la déconnexion</td></tr>
          <tr><td><code>lang</code></td><td>Retenir la langue choisie</td><td>1 an</td></tr>
          <tr><td><code>theme</code> (stockage local)</td><td>Retenir le mode clair ou sombre</td><td>Jusqu’à ce que tu vides ton navigateur</td></tr>
        </table>
        <p>Ces cookies sont nécessaires au fonctionnement du jeu&nbsp;: ils ne servent ni à la pub ni au suivi, et la loi ne demande pas de consentement pour eux.</p>
        <h2>Publicité</h2>
        ${ads ? `<p>FoOotix est financé par la publicité de Google AdSense. Google et ses partenaires peuvent déposer des cookies pour afficher des annonces, les personnaliser et mesurer leur efficacité. Ils ne sont déposés qu’avec ton accord, demandé à ta première visite. Si tu refuses, tu vois quand même des annonces, mais non personnalisées.</p>
        <p>Tu peux changer d’avis à tout moment&nbsp;: <a href="#" id="cookies2">gérer mes cookies</a>. Pour en savoir plus&nbsp;: <a href="https://policies.google.com/technologies/partner-sites?hl=fr" target="_blank" rel="noopener">comment Google utilise les données des sites partenaires</a>.</p>`
        : `<p>Il n’y a pas de publicité sur FoOotix pour l’instant. Si elle arrive, cette page sera mise à jour et ton accord sera demandé avant tout cookie publicitaire.</p>`}
        <h2>Polices et images</h2>
        <p>Les polices viennent de Google Fonts, les drapeaux de flagcdn.com, les photos et logos de Wikimedia. Ces services voient ton adresse IP quand ton navigateur charge leurs fichiers, sans cookie.</p>
        <h2>Hébergement</h2>
        <p>Le site est hébergé par ${HOST}. Les comptes et les parties sont stockés chez Neon, Inc. (neon.tech), dans un centre de données de la même région. Les données peuvent donc être traitées aux États-Unis, dans le cadre des garanties prévues par le RGPD pour ces transferts.</p>
        <h2>Tes droits</h2>
        <p>Tu peux consulter, corriger ou effacer tes données, ou t’opposer à leur utilisation. Le plus simple&nbsp;: supprimer ton compte depuis la page <a href="/compte">Compte</a>, tout est effacé d’un coup. Pour le reste, écris à ${contact()}. Si tu estimes que tes droits ne sont pas respectés, tu peux saisir la <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noopener">CNIL</a>.</p>
      </div>`;
  }
  return { '/mentions-legales': pageLegal, '/confidentialite': pagePrivacy };
};
