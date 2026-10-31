#!/usr/bin/env node
// Fabrique une vidéo TikTok en une commande.
//
//   npm run joueur                 → rend « Le joueur d'hier » avec les voix déjà dans public/
//   npm run joueur -- voix.mp3     → découpe voix.mp3 sur les silences, puis rend
//   npm run joueur:en -- voice.mp3 → pareil, version anglaise (voix et textes en anglais)
//   npm run ligue                  → rend la vidéo « Ligue TikTok »
//   npm run ligue -- voix.mp3      → pareil, avec découpe de la voix
//
// La voix ElevenLabs est un seul MP3, avec une pause entre chaque phrase.
// Le script repère les 5 plus longues pauses et coupe en 6 morceaux
// (un par séquence) : public/voix-1.mp3 … voix-6.mp3 (ou ligue-voix-N.mp3).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ICI, "public");
const SORTIE = path.join(ICI, "out");
const NB_SEQUENCES = 6;

const MODELES = {
  joueur: { composition: "JoueurDHier", prefixe: "voix-" },
  "joueur-en": { composition: "JoueurDHierEN", prefixe: "en-voix-", suffixe: "-en" },
  ligue: { composition: "LigueTiktok", prefixe: "ligue-voix-" },
};

const stop = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

// Lance « npx remotion … » (Remotion fournit ffmpeg, rien d'autre à installer).
const remotion = (args, { garder = false } = {}) => {
  const r = spawnSync("npx", ["remotion", ...args], {
    cwd: ICI,
    encoding: "utf8",
    stdio: garder ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) {
    if (garder) process.stderr.write(r.stderr || "");
    stop(`La commande « remotion ${args[0]} » a échoué.`);
  }
  return r;
};

// Repère les silences : [{ debut, fin }] en secondes, plus la durée totale.
export const lireSilences = (sortieFfmpeg) => {
  const silences = [];
  let debut = null;
  for (const ligne of sortieFfmpeg.split("\n")) {
    const a = ligne.match(/silence_start: (-?[\d.]+)/);
    if (a) debut = Math.max(0, parseFloat(a[1]));
    const b = ligne.match(/silence_end: ([\d.]+)/);
    if (b && debut !== null) {
      silences.push({ debut, fin: parseFloat(b[1]) });
      debut = null;
    }
  }
  const d = sortieFfmpeg.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const duree = d ? +d[1] * 3600 + +d[2] * 60 + parseFloat(d[3]) : null;
  // un silence qui va jusqu'à la fin du fichier n'a pas de « silence_end »
  if (debut !== null && duree) silences.push({ debut, fin: duree });
  return { silences, duree };
};

// Choisit les coupes : on garde les N-1 plus longues pauses au milieu du fichier.
export const choisirMorceaux = (silences, duree, n = NB_SEQUENCES) => {
  const bord = 0.05;
  const tete = silences.find((s) => s.debut <= bord);
  const queue = silences.find((s) => duree - s.fin <= bord && s !== tete);
  const milieu = silences.filter((s) => s !== tete && s !== queue);
  if (milieu.length < n - 1) return null;
  const pauses = [...milieu]
    .sort((x, y) => y.fin - y.debut - (x.fin - x.debut))
    .slice(0, n - 1)
    .sort((x, y) => x.debut - y.debut);
  const morceaux = [];
  let depart = tete ? Math.max(0, tete.fin - 0.05) : 0;
  for (const p of pauses) {
    morceaux.push({ debut: depart, fin: Math.min(p.fin, p.debut + 0.15) });
    depart = Math.max(p.debut, p.fin - 0.05);
  }
  morceaux.push({ debut: depart, fin: queue ? Math.min(duree, queue.debut + 0.15) : duree });
  return morceaux;
};

const decouperVoix = (fichier, prefixe) => {
  if (!existsSync(fichier)) stop(`Fichier introuvable : ${fichier}`);
  // On essaie des réglages de plus en plus tolérants jusqu'à trouver 5 pauses.
  const essais = [
    { bruit: -40, pause: 0.45 },
    { bruit: -35, pause: 0.35 },
    { bruit: -30, pause: 0.3 },
    { bruit: -28, pause: 0.22 },
  ];
  let morceaux = null;
  let trouve = 0;
  for (const e of essais) {
    const r = remotion(
      ["ffmpeg", "-hide_banner", "-i", fichier, "-af", `silencedetect=noise=${e.bruit}dB:d=${e.pause}`, "-f", "null", "-"],
      { garder: true },
    );
    const { silences, duree } = lireSilences(r.stderr);
    if (!duree) stop("Impossible de lire la durée du MP3.");
    trouve = silences.length;
    morceaux = choisirMorceaux(silences, duree);
    if (morceaux) break;
  }
  if (!morceaux) {
    stop(
      `Je ne trouve pas assez de pauses dans la voix (il en faut ${NB_SEQUENCES - 1}, j'en vois ${trouve}).\n` +
        "  Refais la voix sur ElevenLabs avec un vrai blanc (environ une demi-seconde) entre chaque phrase.",
    );
  }
  console.log(`\nVoix découpée en ${NB_SEQUENCES} morceaux :`);
  morceaux.forEach((m, i) => {
    const cible = path.join(PUBLIC, `${prefixe}${i + 1}.mp3`);
    remotion(
      ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", fichier, "-ss", m.debut.toFixed(3), "-to", m.fin.toFixed(3), "-c:a", "libmp3lame", "-q:a", "2", cible],
      { garder: true },
    );
    console.log(`  ${prefixe}${i + 1}.mp3  ${m.debut.toFixed(2)} s → ${m.fin.toFixed(2)} s  (${(m.fin - m.debut).toFixed(2)} s)`);
  });
};

const nomFichier = (modele) => {
  if (modele === "ligue") return "ligue-tiktok.mp4";
  const src = readFileSync(path.join(ICI, "src", "joueur.ts"), "utf8");
  const nom = (src.match(/nom:\s*"([^"]+)"/) || [])[1] || "joueur";
  const slug = nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `joueur-${slug}${MODELES[modele].suffixe ?? ""}.mp4`;
};

const principal = () => {
  // Les options en « --… » sont passées telles quelles à « remotion render »
  // (ex. --browser-executable=/chemin/chromium).
  const args = process.argv.slice(2);
  const options = args.filter((a) => a.startsWith("--"));
  const [modele, voix] = args.filter((a) => !a.startsWith("--"));
  const choix = MODELES[modele];
  if (!choix) stop("Usage : npm run joueur [-- voix.mp3], npm run joueur:en [-- voice.mp3] ou npm run ligue [-- voix.mp3]");
  if (voix) decouperVoix(path.resolve(process.env.INIT_CWD || process.cwd(), voix), choix.prefixe);
  mkdirSync(SORTIE, { recursive: true });
  const cible = path.join(SORTIE, nomFichier(modele));
  console.log(`\nRendu de la vidéo « ${choix.composition} »…\n`);
  remotion(["render", choix.composition, cible, ...options]);
  console.log(`\n✔ Vidéo prête : ${path.relative(process.cwd(), cible)}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
