import React from "react";
import { AbsoluteFill, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Pitch, Props, cond, fontCss } from "./Video";

// ── À modifier si besoin ──
export const ligue = {
  code: "RYVFCH",
  site: "foootix.com",
  pseudo: "@ton_pseudo",
};
export const dureesLigue = [2.8, 3.2, 3.4, 4.2, 2.8, 3.0];

const shadow = "0 8px 0 rgba(0,0,0,.35)";
const mono: React.CSSProperties = { fontFamily: "Plex", fontWeight: 600 };

const usePhase = (durees: number[]) => {
  const frame = useCurrentFrame();
  const starts = durees.reduce<number[]>((acc, d, i) => [...acc, (acc[i] ?? 0) + d], [0]);
  let phase = 0;
  for (let i = 0; i < durees.length; i++) if (frame >= starts[i]) phase = i;
  return { frame, starts, phase, local: frame - starts[phase] };
};

const Crown: React.FC<{ size?: number }> = ({ size = 120 }) => (
  <svg width={size} height={size * 0.7} viewBox="0 0 100 70">
    <path d="M5 60 L12 15 L32 38 L50 5 L68 38 L88 15 L95 60 Z" fill={C.amber} stroke={C.ink} strokeWidth="4" strokeLinejoin="round" />
    <rect x="5" y="58" width="90" height="10" fill={C.amber} stroke={C.ink} strokeWidth="4" />
  </svg>
);

// Carte « joueur du mois » avec TON pseudo
const MonthCard: React.FC<{ reveal: number }> = ({ reveal }) => {
  const W = 560, H = 760;
  return (
    <div style={{ position: "relative", width: W, height: H, filter: "drop-shadow(0 30px 40px rgba(0,0,0,.45))" }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <linearGradient id="gm" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={C.gold1} />
            <stop offset="1" stopColor={C.gold2} />
          </linearGradient>
        </defs>
        <path d={`M100 6 H${W - 100} L${W - 6} 76 V${H - 140} L${W / 2} ${H - 6} L6 ${H - 140} V76 Z`} fill="url(#gm)" stroke={C.goldEdge} strokeWidth="8" />
      </svg>
      <div style={{ position: "absolute", top: 40, left: 0, right: 0, display: "flex", justifyContent: "center", transform: `scale(${reveal}) rotate(${(1 - reveal) * -20}deg)` }}>
        <Crown size={150} />
      </div>
      <div style={{ position: "absolute", top: 160, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
        <svg width="260" height="250" viewBox="0 0 300 300">
          <circle cx="150" cy="105" r="72" fill="#4a3a1c" />
          <path d="M22 300 Q22 190 150 184 Q278 190 278 300 Z" fill="#4a3a1c" />
          <text x="150" y="128" textAnchor="middle" fontFamily="Archivo" fontWeight="900" fontSize="72" fill={C.gold1} style={{ fontStretch: "62%" }}>TOI</text>
        </svg>
      </div>
      <div style={{ position: "absolute", left: 50, right: 50, top: 430, borderTop: `3px solid ${C.ink}`, borderBottom: `3px solid ${C.ink}`, padding: "14px 0", textAlign: "center" }}>
        <div style={{ ...cond(70), fontSize: 58, color: C.ink, textTransform: "none" }}>{ligue.pseudo}</div>
      </div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 560, textAlign: "center", ...mono, fontSize: 30, letterSpacing: "0.12em", color: C.ink, lineHeight: 1.3 }}>
        JOUEUR TIKTOK
        <br />
        DU MOIS
      </div>
    </div>
  );
};

// Grille d'essais qui se raccourcit
const Tries: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const rows = [
    { n: 14, c: "#c4371d" },
    { n: 8, c: "#e0583a" },
    { n: 3, c: "#3fae6a" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 44, width: 980 }}>
      {rows.map((r, i) => {
        const s = spring({ frame: local - 8 - i * 16, fps, config: { damping: 13 } });
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 24, opacity: s, transform: `translateX(${(1 - s) * -80}px)` }}>
            <div style={{ ...mono, fontSize: 36, color: C.cream, width: 150, whiteSpace: "nowrap" }}>JOUR {i + 1}</div>
            <div style={{ display: "flex", gap: 6, width: 520 }}>
              {Array.from({ length: r.n }).map((_, k) => (
                <div key={k} style={{ width: 31, height: 44, background: k === r.n - 1 ? "#3fae6a" : r.c, border: `3px solid ${C.ink}` }} />
              ))}
            </div>
            <div style={{ ...cond(80), fontSize: 58, whiteSpace: "nowrap", color: i === 2 ? C.amber : C.cream }}>{r.n} ESSAIS</div>
          </div>
        );
      })}
    </div>
  );
};

// Le code, lettre par lettre
const CodeTiles: React.FC<{ local: number; big?: boolean }> = ({ local, big }) => {
  const { fps } = useVideoConfig();
  const size = big ? 148 : 140;
  return (
    <div style={{ display: "flex", gap: 14 }}>
      {ligue.code.split("").map((ch, i) => {
        const s = big ? 1 : spring({ frame: local - 10 - i * 5, fps, config: { damping: 11, stiffness: 200 } });
        return (
          <div key={i} style={{ width: size, height: size * 1.2, background: C.cream, border: `6px solid ${C.ink}`, display: "flex", alignItems: "center", justifyContent: "center", transform: `rotateX(${(1 - s) * 90}deg)`, boxShadow: "0 10px 0 rgba(0,0,0,.35)" }}>
            <div style={{ ...mono, fontSize: size * 0.72, color: C.ink }}>{ch}</div>
          </div>
        );
      })}
    </div>
  );
};

// Classement de la ligue, ton pseudo monte à la 1re place
const Board: React.FC<{ local: number }> = ({ local }) => {
  const { fps } = useVideoConfig();
  const climb = spring({ frame: local - 12, fps, config: { damping: 15 } });
  const others = ["@lucas_92", "@ines.foot", "@maxou", "@ballon_dor_2030"];
  const rowH = 118;
  const myPos = interpolate(climb, [0, 1], [4, 0]);
  return (
    <div style={{ position: "relative", width: 900, height: rowH * 5, background: "rgba(0,0,0,.35)", border: `5px solid ${C.cream}` }}>
      {others.map((p, i) => {
        const slot = i + (i >= Math.round(myPos) ? 1 : 0);
        return (
          <div key={p} style={{ position: "absolute", left: 0, right: 0, top: slot * rowH, height: rowH, display: "flex", alignItems: "center", gap: 30, padding: "0 36px", borderBottom: "2px solid rgba(255,255,255,.15)" }}>
            <div style={{ ...mono, fontSize: 44, color: C.cream, width: 60 }}>{slot + 1}</div>
            <div style={{ ...cond(85), fontSize: 52, color: C.cream, textTransform: "none", flex: 1 }}>{p}</div>
            <div style={{ ...mono, fontSize: 38, color: "rgba(243,239,230,.7)" }}>{1320 - slot * 140} pts</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: -14, right: -14, top: myPos * rowH - 6, height: rowH + 12, display: "flex", alignItems: "center", gap: 30, padding: "0 50px", background: C.amber, border: `5px solid ${C.ink}`, boxShadow: "0 12px 0 rgba(0,0,0,.35)" }}>
        <div style={{ ...mono, fontSize: 48, color: C.ink, width: 60 }}>{Math.round(myPos) + 1}</div>
        <div style={{ ...cond(85), fontSize: 60, color: C.ink, textTransform: "none", flex: 1 }}>{ligue.pseudo}</div>
        <div style={{ opacity: climb > 0.9 ? 1 : 0 }}>
          <Crown size={90} />
        </div>
      </div>
    </div>
  );
};

const Head: React.FC<{ top?: number; children: React.ReactNode; size?: number; color?: string; pop: number }> = ({ top = 150, children, size = 130, color = C.cream, pop }) => (
  <div style={{ position: "absolute", top, left: 40, right: 40, textAlign: "center", ...cond(), fontSize: size, color, textShadow: shadow, whiteSpace: "pre-line", transform: `translateY(${(1 - pop) * 50}px)`, opacity: Math.min(1, pop * 1.5) }}>
    {children}
  </div>
);

export const LigueTiktok: React.FC<Props> = ({ durees, voix }) => {
  const { fps } = useVideoConfig();
  const { frame, starts, phase, local } = usePhase(durees);
  const pop = spring({ frame: local, fps, config: { damping: 12, stiffness: 180 } });
  const center: React.CSSProperties = { position: "absolute", left: 0, right: 0, display: "flex", justifyContent: "center" };

  // accroche : « EH ATTENDS » visible dès la 1re image, qui tremble
  const shake = phase === 0 && local < 14 ? Math.sin(local * 2.2) * (14 - local) * 1.6 : 0;
  const q = phase === 0 ? spring({ frame: local - 14, fps, config: { damping: 12 } }) : 0;
  const cardIn = phase === 0 ? spring({ frame: local - 26, fps, config: { damping: 12 } }) : 0;

  return (
    <AbsoluteFill>
      <style>{fontCss}</style>
      <Pitch />

      {phase === 0 && (
        <>
          <div style={{ position: "absolute", top: 120, left: 40, right: 40, textAlign: "center", ...cond(), fontSize: 150, color: C.amber, textShadow: shadow, whiteSpace: "nowrap", transform: `translateX(${shake}px) scale(${interpolate(local, [0, 6], [1.1, 1], { extrapolateRight: "clamp" })}) rotate(-3deg)` }}>
            EH ATTENDS…
          </div>
          <div style={{ position: "absolute", top: 320, left: 40, right: 40, textAlign: "center", ...cond(), fontSize: 92, color: C.cream, textShadow: shadow, opacity: q, transform: `translateY(${(1 - q) * 40}px)` }}>
            Tu savais que tu pouvais être
            <br />
            <span style={{ color: C.amber }}>joueur du mois ?</span>
          </div>
          <div style={{ ...center, top: 620, transform: `scale(${0.85 * cardIn}) rotateY(${(1 - cardIn) * 120}deg)` }}>
            <MonthCard reveal={spring({ frame: local - 40, fps, config: { damping: 9 } })} />
          </div>
        </>
      )}

      {phase === 1 && (
        <>
          <Head pop={pop} size={118}>{"Devine le joueur\n"}<span style={{ color: C.amber }}>tous les jours</span></Head>
          <div style={{ ...center, top: 620 }}>
            <Tries local={local} />
          </div>
          <div style={{ ...center, top: 1180, ...cond(80), fontSize: 64, color: C.cream, opacity: spring({ frame: local - 50, fps }) }}>
            MOINS D'ESSAIS = PLUS DE POINTS
          </div>
        </>
      )}

      {phase === 2 && (
        <>
          <Head pop={pop} size={120}>{"Rejoins la\n"}<span style={{ color: C.amber }}>ligue TikTok</span></Head>
          <div style={{ ...center, top: 640, perspective: 1200 }}>
            <CodeTiles local={local} />
          </div>
          <div style={{ ...center, top: 900, ...mono, fontSize: 40, letterSpacing: "0.08em", color: C.cream, opacity: spring({ frame: local - 45, fps }) }}>
            MES LIGUES → REJOINDRE → CODE
          </div>
        </>
      )}

      {phase === 3 && (
        <>
          <Head pop={pop} size={104}>{"Fin du mois :\nle n°1 a son pseudo\n"}<span style={{ color: C.amber }}>sur le site</span></Head>
          <div style={{ ...center, top: 640 }}>
            <Board local={local} />
          </div>
          <div style={{ ...center, top: 1300, opacity: spring({ frame: local - 50, fps }) }}>
            <div style={{ ...mono, fontSize: 40, letterSpacing: "0.1em", color: C.ink, background: C.amber, padding: "12px 28px" }}>★ JOUEUR TIKTOK DU MOIS ★</div>
          </div>
        </>
      )}

      {phase === 4 && (
        <>
          <Head pop={pop} size={124} top={260}>{"Chaque jour\nsans jouer…"}</Head>
          <div style={{ ...center, top: 700, ...cond(), fontSize: 150, color: C.red, textShadow: shadow, transform: `scale(${spring({ frame: local - 14, fps, config: { damping: 8 } })}) rotate(-4deg)` }}>
            −200 PTS
          </div>
          <div style={{ ...center, top: 900, ...cond(80), fontSize: 66, color: C.cream, opacity: spring({ frame: local - 26, fps }) }}>
            JUSQU'À 200 POINTS PAR JOUR
          </div>
        </>
      )}

      {phase === 5 && (
        <>
          <Head pop={pop} size={100} top={170}>{"Code de la\n"}<span style={{ color: C.amber }}>ligue TikTok</span></Head>
          <div style={{ ...center, top: 520, transform: `scale(${(0.9 + 0.1 * pop) * (1 + 0.025 * Math.sin(frame / 4))})` }}>
            <CodeTiles local={local} big />
          </div>
          <div style={{ ...center, top: 820, flexDirection: "column", alignItems: "center", gap: 18, opacity: spring({ frame: local - 12, fps }) }}>
            <div style={{ ...cond(85), fontSize: 104, color: C.cream, background: C.ink, padding: "16px 44px 20px", border: `6px solid ${C.amber}`, textTransform: "none" }}>{ligue.site}</div>
            <div style={{ ...mono, fontSize: 44, letterSpacing: "0.12em", color: C.amber }}>LIEN EN BIO</div>
          </div>
        </>
      )}

      {/* sons */}
      {durees.map((d, i) => (
        <Sequence key={`v${i}`} from={starts[i]} durationInFrames={d}>
          {voix[i] && <Audio src={staticFile(`ligue-voix-${i + 1}.mp3`)} />}
        </Sequence>
      ))}
      {[1, 2, 3, 4, 5].map((i) => (
        <Sequence key={`w${i}`} from={starts[i]} durationInFrames={12}>
          <Audio src={staticFile("whoosh.mp3")} volume={0.35} />
        </Sequence>
      ))}
      {ligue.code.split("").map((_, i) => (
        <Sequence key={`c${i}`} from={starts[2] + 10 + i * 5} durationInFrames={4}>
          <Audio src={staticFile("tick.mp3")} volume={0.45} />
        </Sequence>
      ))}
      <Sequence from={starts[3] + 24} durationInFrames={27}>
        <Audio src={staticFile("ding.mp3")} volume={0.5} />
      </Sequence>
      <Sequence from={starts[4] + 14} durationInFrames={10}>
        <Audio src={staticFile("pop.mp3")} volume={0.6} />
      </Sequence>
    </AbsoluteFill>
  );
};
