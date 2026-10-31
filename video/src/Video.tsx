import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { joueur } from "./joueur";

export type Props = { durees: number[]; voix: boolean[] };

export const C = {
  pitchA: "#1f5a3b",
  pitchB: "#174a30",
  cream: "#f3efe6",
  ink: "#15140f",
  gold1: "#ead48a",
  gold2: "#c9a24e",
  goldEdge: "#7a5c22",
  red: "#e0583a",
  amber: "#f1bf00",
};

export const fontCss = `
@font-face { font-family: 'Archivo'; src: url('${staticFile("archivo.woff2")}') format('woff2'); font-weight: 400 900; font-stretch: 62% 125%; }
@font-face { font-family: 'Plex'; src: url('${staticFile("plexmono.woff2")}') format('woff2'); font-weight: 600; }
`;

export const cond = (stretch = 62): React.CSSProperties => ({
  fontFamily: "Archivo",
  fontWeight: 900,
  fontStretch: `${stretch}%`,
  textTransform: "uppercase",
  lineHeight: 0.92,
  letterSpacing: "-0.01em",
});

// Phases : 0 accroche, 1-3 indices, 4 révélation, 5 appel à l'action
const usePhase = (durees: number[]) => {
  const frame = useCurrentFrame();
  const starts = durees.reduce<number[]>((acc, d, i) => [...acc, (acc[i] ?? 0) + d], [0]);
  let phase = 0;
  for (let i = 0; i < durees.length; i++) if (frame >= starts[i]) phase = i;
  return { frame, starts, phase, local: frame - starts[phase] };
};

export const Pitch: React.FC = () => (
  <AbsoluteFill style={{ background: `repeating-linear-gradient(180deg, ${C.pitchA} 0 160px, ${C.pitchB} 160px 320px)` }}>
    <svg width="1080" height="1920" style={{ position: "absolute", opacity: 0.18 }}>
      <g fill="none" stroke="#fff" strokeWidth="5">
        <rect x="40" y="40" width="1000" height="1840" />
        <line x1="40" y1="960" x2="1040" y2="960" />
        <circle cx="540" cy="960" r="170" />
        <rect x="270" y="40" width="540" height="260" />
        <rect x="270" y="1620" width="540" height="260" />
      </g>
    </svg>
    <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 40%, rgba(0,0,0,.45) 100%)" }} />
  </AbsoluteFill>
);

const Flag: React.FC<{ show: number }> = ({ show }) => (
  <div style={{ width: 84, height: 56, display: "flex", flexDirection: "column", border: `3px solid ${C.ink}`, opacity: show, transform: `scale(${0.6 + 0.4 * show})` }}>
    {joueur.drapeau.map((c, i) => (
      <div key={i} style={{ flex: 1, background: c }} />
    ))}
  </div>
);

// La carte du jeu, façon site
const Card: React.FC<{ phase: number; local: number; aujourdhui?: boolean }> = ({ phase, local, aujourdhui }) => {
  const { fps } = useVideoConfig();
  const reveal = phase >= 4 && !aujourdhui ? spring({ frame: local, fps, config: { damping: 14 } }) : 0;
  const rows: [string, string, number][] = [
    ["NAT", joueur.indices[0].fiche.NAT ?? "", 1],
    ["NÉ", joueur.indices[0].fiche["NÉ"] ?? "", 1],
    ["FORMÉ", joueur.indices[1].fiche["FORMÉ"] ?? "", 2],
    ["CLUBS", joueur.indices[2].fiche.CLUBS ?? "", 3],
  ];
  const shown = (p: number) => {
    if (aujourdhui) return 0;
    if (phase > p) return 1;
    if (phase === p) return spring({ frame: local - 6, fps, config: { damping: 12 } });
    return 0;
  };
  const W = 600;
  const H = 820;
  return (
    <div style={{ position: "relative", width: W, height: H, filter: "drop-shadow(0 30px 40px rgba(0,0,0,.45))" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.gold1} />
            <stop offset="1" stopColor={C.gold2} />
          </linearGradient>
        </defs>
        <path d={`M110 6 H${W - 110} L${W - 6} 80 V${H - 150} L${W / 2} ${H - 6} L6 ${H - 150} V80 Z`} fill="url(#g)" stroke={C.goldEdge} strokeWidth="8" />
      </svg>
      {/* coin haut gauche */}
      <div style={{ position: "absolute", left: 62, top: 70, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{ ...cond(), fontSize: 84, color: C.ink }}>?</div>
        <div style={{ ...cond(85), fontSize: 36, color: C.ink, opacity: shown(1) }}>{joueur.poste}</div>
        <Flag show={shown(1)} />
      </div>
      {/* photo */}
      <div style={{ position: "absolute", left: 200, top: 52, width: 290, height: 330, overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <svg width="280" height="320" viewBox="0 0 300 340">
            <circle cx="150" cy="115" r="78" fill="#4a3a1c" />
            <path d="M18 340 Q18 215 150 208 Q282 215 282 340 Z" fill="#4a3a1c" />
          </svg>
        </div>
        {!aujourdhui && reveal > 0.001 && (
          <Img
            src={staticFile(joueur.photo)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: Math.min(1, reveal * 1.3), filter: `blur(${(1 - reveal) * 14}px)` }}
          />
        )}
      </div>
      {/* nom */}
      <div style={{ position: "absolute", left: 60, right: 60, top: 398, borderTop: `3px solid ${C.ink}`, borderBottom: `3px solid ${C.ink}`, height: 92, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {reveal > 0.01 ? (
          <div style={{ ...cond(70), fontSize: 64, color: C.ink, transform: `scale(${interpolate(reveal, [0, 1], [2.2, 1])})`, opacity: Math.min(1, reveal * 1.5), whiteSpace: "nowrap" }}>{joueur.nom}</div>
        ) : (
          <div style={{ fontFamily: "Plex", fontSize: 40, letterSpacing: "0.4em", color: "#6b5420" }}>• • • • • •</div>
        )}
      </div>
      {/* fiche */}
      <div style={{ position: "absolute", left: 80, right: 70, top: 508, display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map(([k, v, p]) => {
          const s = shown(p);
          return (
            <div key={k} style={{ display: "flex", gap: 22, alignItems: "baseline", fontSize: 33 }}>
              <div style={{ ...cond(85), width: 130, color: C.ink }}>{k}</div>
              <div style={{ fontFamily: "Archivo", fontWeight: 700, fontStretch: "85%", color: s > 0.05 ? C.ink : "#8a6a28", position: "relative" }}>
                <span style={{ opacity: 1 - s, position: "absolute" }}>?</span>
                <span style={{ opacity: s, display: "inline-block", transform: `translateY(${(1 - s) * 20}px)` }}>{v}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// La jauge de chaleur du site : monte à chaque indice
const Heat: React.FC<{ phase: number; local: number }> = ({ phase, local }) => {
  const steps = [8, 38, 64, 88, 100, 100];
  const prev = phase === 0 ? 0 : steps[phase - 1];
  const v = interpolate(local, [0, 14], [prev, steps[phase]], { extrapolateRight: "clamp" });
  const label = v >= 100 ? "TROUVÉ" : v >= 80 ? "BRÛLANT" : v >= 55 ? "CHAUD" : v >= 30 ? "TIÈDE" : "FROID";
  const col = v >= 100 ? "#3fae6a" : C.red;
  return (
    <div style={{ width: 760, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 22 }}>
        <div style={{ fontFamily: "Plex", fontWeight: 600, fontSize: 76, color: col }}>{Math.round(v)}°</div>
        <div style={{ ...cond(80), fontSize: 46, color: C.cream }}>{label}</div>
      </div>
      <div style={{ height: 34, border: `4px solid ${C.cream}`, background: "rgba(0,0,0,.25)" }}>
        <div style={{ width: `${v}%`, height: "100%", background: col }} />
      </div>
    </div>
  );
};

// Gros titre du haut, change à chaque séquence
const Headline: React.FC<{ phase: number; local: number }> = ({ phase, local }) => {
  const { fps } = useVideoConfig();
  const pop = spring({ frame: local, fps, config: { damping: 11, stiffness: 180 } });
  const box: React.CSSProperties = { position: "absolute", top: 120, left: 40, right: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 18 };

  if (phase === 0) {
    const q = interpolate(local, [0, 8], [1.35, 1], { extrapolateRight: "clamp" });
    return (
      <div style={box}>
        <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
          {joueur.accroche.clubs.map((c, i) => {
            // le premier logo est déjà visible à la toute première image
            const s = interpolate(local, [i * 3, i * 3 + 6], [0.55, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return (
              <div key={c.nom} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, transform: `translateY(${(1 - s) * -90}px) scale(${s})`, opacity: local >= i * 3 ? 1 : 0 }}>
                <Img src={staticFile(c.logo)} style={{ width: 190, height: 190, objectFit: "contain" }} />
                <div style={{ ...cond(75), fontSize: 50, color: C.cream }}>{c.nom}</div>
              </div>
            );
          })}
        </div>
        <div style={{ ...cond(), fontSize: 140, color: C.amber, transform: `scale(${q}) rotate(${(q - 1) * 12}deg)`, textShadow: "0 8px 0 rgba(0,0,0,.35)" }}>{joueur.accroche.texte}</div>
      </div>
    );
  }
  if (phase >= 1 && phase <= 3) {
    const ind = joueur.indices[phase - 1];
    return (
      <div style={box}>
        <div style={{ fontFamily: "Plex", fontWeight: 600, fontSize: 44, letterSpacing: "0.2em", color: C.ink, background: C.amber, padding: "8px 26px", transform: `scale(${pop})` }}>
          {ind.titre.toUpperCase()}
        </div>
        <div style={{ ...cond(), fontSize: 168, color: C.cream, textAlign: "center", whiteSpace: "pre-line", transform: `translateY(${(1 - pop) * 60}px)`, opacity: pop, textShadow: "0 8px 0 rgba(0,0,0,.35)" }}>
          {ind.texte}
        </div>
      </div>
    );
  }
  if (phase === 4) {
    return (
      <div style={box}>
        <div style={{ fontFamily: "Plex", fontWeight: 600, fontSize: 44, letterSpacing: "0.2em", color: C.cream }}>C'ÉTAIT…</div>
        <div style={{ ...cond(), fontSize: 176, color: C.amber, textAlign: "center", transform: `scale(${interpolate(pop, [0, 1], [1.8, 1])})`, opacity: pop, textShadow: "0 8px 0 rgba(0,0,0,.35)" }}>
          {joueur.nom.split(" ").map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ ...cond(), fontSize: 120, color: C.cream, textAlign: "center", whiteSpace: "pre-line", transform: `translateY(${(1 - pop) * 60}px)`, opacity: pop, textShadow: "0 8px 0 rgba(0,0,0,.35)" }}>
        {joueur.cta.texte}
      </div>
    </div>
  );
};

// Compte à rebours pendant le dernier indice
const Countdown: React.FC<{ local: number; total: number }> = ({ local, total }) => {
  const { fps } = useVideoConfig();
  const left = Math.max(0, Math.ceil((total - local) / fps));
  const frac = 1 - local / total;
  const R = 70;
  return (
    <div style={{ position: "absolute", right: 40, top: 1180, width: 180, height: 180 }}>
      <svg width="180" height="180">
        <circle cx="90" cy="90" r={R} fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.25)" strokeWidth="12" />
        <circle cx="90" cy="90" r={R} fill="none" stroke={C.amber} strokeWidth="12" strokeDasharray={2 * Math.PI * R} strokeDashoffset={2 * Math.PI * R * (1 - frac)} transform="rotate(-90 90 90)" strokeLinecap="round" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Plex", fontWeight: 600, fontSize: 80, color: C.cream }}>{left}</div>
    </div>
  );
};

export const JoueurDHier: React.FC<Props> = ({ durees, voix }) => {
  const { fps } = useVideoConfig();
  const { frame, starts, phase, local } = usePhase(durees);

  // Dernière séquence : la carte se retourne et devient celle d'aujourd'hui
  const flip = phase === 5 ? interpolate(local, [0, 12], [0, 180], { extrapolateRight: "clamp" }) : 0;
  const showToday = flip > 90;
  const breathe = 1 + 0.015 * Math.sin(frame / 9);
  const cardScale = interpolate(frame, [0, 12], [1.12, 1], { extrapolateRight: "clamp" }) * breathe;
  const flash = phase === 4 ? interpolate(local, [0, 2, 10], [0, 0.9, 0], { extrapolateRight: "clamp" }) : 0;
  const shake = phase === 4 && local < 8 ? Math.sin(local * 3) * (8 - local) * 2 : 0;
  const ctaPop = phase === 5 ? spring({ frame: local - 10, fps, config: { damping: 10 } }) : 0;
  const pulse = 1 + 0.04 * Math.sin(frame / 4);

  return (
    <AbsoluteFill style={{ fontFamily: "Archivo" }}>
      <style>{fontCss}</style>
      <Pitch />

      <Headline phase={phase} local={local} />

      {/* carte */}
      <div style={{ position: "absolute", top: phase === 5 ? 560 : 600, left: 0, right: 0, display: "flex", justifyContent: "center", perspective: 1600, transform: `translateX(${shake}px)` }}>
        <div style={{ transform: `scale(${cardScale * (phase === 5 ? 0.78 : 0.95)}) rotateY(${flip}deg)`, transformOrigin: "50% 0%" }}>
          <div style={{ transform: showToday ? "rotateY(180deg)" : undefined }}>
            <Card phase={phase} local={local} aujourdhui={showToday} />
          </div>
        </div>
      </div>

      {/* jauge (cachée sur l'appel final) */}
      {phase < 5 && (
        <div style={{ position: "absolute", top: 1430, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <Heat phase={phase} local={local} />
        </div>
      )}

      {phase === 3 && <Countdown local={local} total={durees[3]} />}

      {/* appel à l'action */}
      {phase === 5 && (
        <div style={{ position: "absolute", top: 1250, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 18, transform: `scale(${ctaPop})` }}>
          <div style={{ ...cond(85), fontSize: 110, color: C.cream, background: C.ink, padding: "18px 44px 22px", border: `6px solid ${C.amber}`, textTransform: "none", transform: `scale(${pulse})` }}>
            {joueur.cta.site}
          </div>
          <div style={{ fontFamily: "Plex", fontWeight: 600, fontSize: 44, letterSpacing: "0.12em", color: C.amber }}>{joueur.cta.sousTitre.toUpperCase()}</div>
        </div>
      )}

      <AbsoluteFill style={{ background: "#fff", opacity: flash, pointerEvents: "none" }} />

      {/* sons */}
      {durees.map((d, i) => (
        <Sequence key={`v${i}`} from={starts[i]} durationInFrames={d}>
          {voix[i] && <Audio src={staticFile(`voix-${i + 1}.mp3`)} />}
        </Sequence>
      ))}
      {joueur.accroche.clubs.map((_, i) => (
        <Sequence key={`p${i}`} from={i * 3} durationInFrames={10}>
          <Audio src={staticFile("pop.mp3")} volume={0.5} />
        </Sequence>
      ))}
      {[1, 2, 3, 5].map((i) => (
        <Sequence key={`w${i}`} from={starts[i]} durationInFrames={12}>
          <Audio src={staticFile("whoosh.mp3")} volume={0.35} />
        </Sequence>
      ))}
      {Array.from({ length: Math.floor(durees[3] / fps) }).map((_, k) => (
        <Sequence key={`t${k}`} from={starts[3] + k * fps} durationInFrames={3}>
          <Audio src={staticFile("tick.mp3")} volume={0.35} />
        </Sequence>
      ))}
      <Sequence from={starts[4]} durationInFrames={27}>
        <Audio src={staticFile("ding.mp3")} volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  );
};
