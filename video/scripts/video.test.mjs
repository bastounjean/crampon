// Tests de la découpe de la voix sur les silences (lancés avec « npm test » à la racine).
import { test } from "node:test";
import assert from "node:assert/strict";
import { choisirMorceaux, lireSilences } from "./video.mjs";

const sortie = `
  Duration: 00:00:20.00, start: 0.000000, bitrate: 128 kb/s
[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 0.3 | silence_duration: 0.3
[silencedetect @ 0x1] silence_start: 3.0
[silencedetect @ 0x1] silence_end: 3.7 | silence_duration: 0.7
[silencedetect @ 0x1] silence_start: 5.0
[silencedetect @ 0x1] silence_end: 5.3 | silence_duration: 0.3
[silencedetect @ 0x1] silence_start: 7.0
[silencedetect @ 0x1] silence_end: 7.8 | silence_duration: 0.8
[silencedetect @ 0x1] silence_start: 10.0
[silencedetect @ 0x1] silence_end: 10.6 | silence_duration: 0.6
[silencedetect @ 0x1] silence_start: 13.0
[silencedetect @ 0x1] silence_end: 13.9 | silence_duration: 0.9
[silencedetect @ 0x1] silence_start: 16.0
[silencedetect @ 0x1] silence_end: 16.7 | silence_duration: 0.7
[silencedetect @ 0x1] silence_start: 19.5
`;

test("lit les silences et la durée, y compris le silence final", () => {
  const { silences, duree } = lireSilences(sortie);
  assert.equal(duree, 20);
  assert.equal(silences.length, 8);
  assert.deepEqual(silences.at(-1), { debut: 19.5, fin: 20 });
});

test("coupe en 6 morceaux sur les 5 plus longues pauses", () => {
  const { silences, duree } = lireSilences(sortie);
  const m = choisirMorceaux(silences, duree);
  assert.equal(m.length, 6);
  // la petite pause à 5 s (respiration dans une phrase) n'est pas une coupe
  assert.ok(m[0].fin > 3 && m[0].fin < 3.7);
  assert.ok(m[1].debut > 3 && m[1].fin > 7 && m[1].fin < 7.8);
  assert.ok(m[0].debut >= 0.2 && m[5].fin <= 19.7);
});

test("renvoie null s'il n'y a pas assez de pauses", () => {
  assert.equal(choisirMorceaux([{ debut: 2, fin: 2.5 }], 10), null);
});
