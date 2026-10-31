import React from "react";
import { CalculateMetadataFunction, Composition, staticFile } from "remotion";
import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { JoueurDHier, Props } from "./Video";
import { dureesParDefaut } from "./joueur";
import { LigueTiktok, dureesLigue } from "./Ligue";

export const FPS = 30;

// Cale chaque séquence sur la durée de sa voix (voix-N.mp3), sinon durée par défaut.
const makeMeta = (prefix: string, defaults: number[]): CalculateMetadataFunction<Props> => async () => {
  const durees: number[] = [];
  const voix: boolean[] = [];
  for (let i = 0; i < defaults.length; i++) {
    const src = staticFile(`${prefix}${i + 1}.mp3`);
    let d = defaults[i];
    let ok = false;
    try {
      const res = await fetch(src, { method: "HEAD" });
      if (res.ok) {
        const s = await getAudioDurationInSeconds(src);
        d = Math.max(s + 0.05, 1.2);
        ok = true;
      }
    } catch {
      ok = false;
    }
    durees.push(Math.round(d * FPS));
    voix.push(ok);
  }
  return {
    durationInFrames: durees.reduce((a, b) => a + b, 0),
    props: { durees, voix },
  };
};

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="LigueTiktok"
    component={LigueTiktok}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={570}
    defaultProps={{ durees: dureesLigue.map((d) => Math.round(d * FPS)), voix: dureesLigue.map(() => false) }}
    calculateMetadata={makeMeta("ligue-voix-", dureesLigue)}
  />
  <Composition
    id="JoueurDHier"
    component={JoueurDHier}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={450}
    defaultProps={{ durees: dureesParDefaut.map((d) => Math.round(d * FPS)), voix: dureesParDefaut.map(() => false) }}
    calculateMetadata={makeMeta("voix-", dureesParDefaut)}
  />
  </>
);
