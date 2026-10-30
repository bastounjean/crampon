// Image d'aperçu d'un résultat partagé (1200 × 630, PNG) : le numéro du jour, le score et la grille de couleurs.
// Dessinée à la main avec une petite police en pixels, sans aucune bibliothèque : juste zlib pour le PNG.
const zlib = require('zlib');

const W = 1200, H = 630;
const COLORS = {
  bg: [29, 82, 54], ink: [243, 239, 230], soft: [168, 196, 178], gold: [232, 197, 71],
  // mêmes cases que le texte partagé : 🟦 🟨 🟧 🟥 ✅
  marks: [[111, 159, 214], [232, 197, 71], [230, 140, 50], [216, 70, 50], [120, 200, 120]],
};

// police 5 × 7 : les 7 rangées séparées par « / », « # » = pixel allumé
const FONT = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#', B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.###./#...#/#..../#..../#..../#...#/.###.', D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####', F: '#####/#..../#..../####./#..../#..../#....',
  G: '.###./#...#/#..../#.###/#...#/#...#/.####', H: '#...#/#...#/#...#/#####/#...#/#...#/#...#',
  I: '.###./..#../..#../..#../..#../..#../.###.', J: '..###/...#./...#./...#./...#./#..#./.##..',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#', L: '#..../#..../#..../#..../#..../#..../#####',
  M: '#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#', N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.', P: '####./#...#/#...#/####./#..../#..../#....',
  Q: '.###./#...#/#...#/#...#/#.#.#/#..#./.##.#', R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.', T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.', V: '#...#/#...#/#...#/#...#/#...#/.#.#./..#..',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.', X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..', Z: '#####/....#/...#./..#../.#.../#..../#####',
  0: '.###./#...#/#..##/#.#.#/##..#/#...#/.###.', 1: '..#../.##../..#../..#../..#../..#../.###.',
  2: '.###./#...#/....#/...#./..#../.#.../#####', 3: '#####/...#./..#../...#./....#/#...#/.###.',
  4: '...#./..##./.#.#./#..#./#####/...#./...#.', 5: '#####/#..../####./....#/....#/#...#/.###.',
  6: '..##./.#.../#..../####./#...#/#...#/.###.', 7: '#####/....#/...#./..#../.#.../.#.../.#...',
  8: '.###./#...#/#...#/.###./#...#/#...#/.###.', 9: '.###./#...#/#...#/.####/....#/...#./.##..',
  ' ': '...../...../...../...../...../...../.....', '#': '.#.#./.#.#./#####/.#.#./#####/.#.#./.#.#.',
  '?': '.###./#...#/....#/...#./..#../...../..#..', '.': '...../...../...../...../...../...../..#..',
  '+': '...../..#../..#../#####/..#../..#../.....', ',': '...../...../...../...../...../..#../.#...',
  '!': '..#../..#../..#../..#../..#../...../..#..',
};

function canvas() {
  const px = Buffer.alloc(W * H * 3);
  const rect = (x, y, w, h, [r, g, b]) => {
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) {
      const o = (j * W + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b;
    }
  };
  const text = (s, x, y, size, color) => {
    for (const ch of String(s).toUpperCase()) {
      const g = (FONT[ch] || FONT['?']).replace(/\//g, '');
      for (let k = 0; k < 35; k++) if (g[k] === '#') rect(x + (k % 5) * size, y + Math.floor(k / 5) * size, size, size, color);
      x += 6 * size;
    }
  };
  const width = (s, size) => String(s).length * 6 * size - size;
  return { px, rect, text, width };
}

function png(px) {
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RVB
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Résultat partagé, lu dans l'adresse : « 18-w4-1-0123 » = jour n° 18, trouvé (w) ou abandon (g) en 4 essais,
// 1 indice, puis la couleur de chaque essai (0 à 4, les 18 derniers au plus). « -en » à la fin pour l'anglais.
const CODE = /^(\d{1,5})-([wg])(\d{1,3})-(\d)-([0-4]{0,18})(-en)?$/;
function parse(code) {
  const m = CODE.exec(String(code || ''));
  if (!m) return null;
  return { number: +m[1], won: m[2] === 'w', n: +m[3], hints: +m[4], marks: [...m[5]].map(Number), en: !!m[6] };
}

// les phrases, communes à l'image et au titre de l'aperçu
function words(r) {
  const s = (n) => (n > 1 ? 's' : '');
  if (r.en) return {
    title: `${r.won ? `Found in ${r.n} ${r.n > 1 ? 'tries' : 'try'}` : `Gave up after ${r.n} ${r.n > 1 ? 'tries' : 'try'}`} · FoOotix #${r.number}`,
    desc: 'One mystery footballer a day. Can you find him in fewer tries?',
    big: r.won ? `Found in ${r.n}` : 'Gave up',
    sub: r.won ? `${r.n > 1 ? 'tries' : 'try'}${r.hints ? ` with ${r.hints} hint${s(r.hints)}` : ', no hint'}` : `after ${r.n} ${r.n > 1 ? 'tries' : 'try'}`,
    you: 'And you?',
  };
  return {
    title: `${r.won ? `Trouvé en ${r.n} essai${s(r.n)}` : `Abandon après ${r.n} essai${s(r.n)}`} · FoOotix n° ${r.number}`,
    desc: 'Un footballeur mystère par jour. Et toi, tu le trouves en combien ?',
    big: r.won ? `Trouvé en ${r.n}` : 'Abandon',
    sub: r.won ? `essai${s(r.n)} ${r.hints ? `avec ${r.hints} indice${s(r.hints)}` : 'sans indice'}` : `après ${r.n} essai${s(r.n)}`,
    you: 'Et toi ?',
  };
}

function render(r) {
  const c = canvas();
  const w = words(r);
  const ascii = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  c.rect(0, 0, W, H, COLORS.bg);
  c.rect(0, H - 14, W, 14, COLORS.gold);
  c.text(`FoOotix #${r.number}`, 70, 60, 7, COLORS.ink);
  // le score en très gros : « TROUVE EN 4 » tient toujours sur la largeur
  const big = ascii(w.big);
  const size = Math.min(16, Math.floor((W - 140) / (big.length * 6)));
  c.text(big, 70, 150, size, r.won ? COLORS.gold : COLORS.soft);
  c.text(ascii(w.sub), 70, 150 + size * 7 + 24, 5, COLORS.ink);
  // la grille, 6 cases par rangée comme dans le texte partagé
  const sq = 46, gap = 12, gy = 360;
  r.marks.forEach((m, i) => c.rect(70 + (i % 6) * (sq + gap), gy + Math.floor(i / 6) * (sq + gap), sq, sq, COLORS.marks[m]));
  const you = ascii(w.you);
  c.text(you, W - 70 - c.width(you, 10), 380, 10, COLORS.ink);
  c.text('foootix.com', W - 70 - c.width('foootix.com', 6), 480, 6, COLORS.gold);
  return png(c.px);
}

module.exports = { parse, words, render };
