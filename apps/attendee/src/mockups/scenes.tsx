/**
 * DEVELOPMENT ONLY — placeholder event pictures, drawn locally (no downloaded or hot-linked
 * image, nothing from the reference videos). Each scene is two SVG layers on one 1600×1000
 * canvas, so the stage directions can set the event name between the sky and the building,
 * the way a cut-out photograph would allow. Marked "Placeholder image" in a corner.
 *
 * `Cover` is the no-photo version: what an event without a picture looks like, on purpose.
 */
import { useId, type ReactNode } from "react";
import { dayNum, monthShort, type MockEvent } from "./data";

export type SceneKind = "dusk" | "hall" | "gallery" | "courtyard" | "theatre";

export const SCENE_FOR: Record<string, SceneKind> = {
  "nexus-summit-2026": "dusk",
  "security-operations-forum": "hall",
  "design-week-kampala": "gallery",
  "founders-night": "courtyard",
  "civic-tech-assembly": "theatre",
};

export const sceneFor = (slug: string): SceneKind => SCENE_FOR[slug] ?? "dusk";

const VB = "0 0 1600 1000";

/* ------------------------------------------------------------------ dusk: a pavilion at dusk */

/** Leafy edges: turbulence displaces a soft shape, then a little softening for depth of field. */
function Foliage({ id, soft = 2.5, scale = 46 }: { id: string; soft?: number; scale?: number }) {
  return (
    <filter id={id} x="-30%" y="-30%" width="160%" height="160%">
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="7" result="n" />
      <feDisplacementMap in="SourceGraphic" in2="n" scale={scale} xChannelSelector="R" yChannelSelector="G" result="d" />
      <feGaussianBlur in="d" stdDeviation={soft} />
    </filter>
  );
}

function Dusk({ id, layer }: { id: string; layer: "back" | "front" }) {
  if (layer === "back") {
    return (
      <>
        <defs>
          <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#070c1f" />
            <stop offset="0.34" stopColor="#17244d" />
            <stop offset="0.55" stopColor="#3b4677" />
            <stop offset="0.66" stopColor="#7d6c86" />
            <stop offset="0.73" stopColor="#d1946d" />
            <stop offset="0.78" stopColor="#f2bd86" />
          </linearGradient>
          <radialGradient id={`${id}sun`} cx="0.66" cy="0.76" r="0.55">
            <stop offset="0" stopColor="#ffc98c" stopOpacity="0.6" />
            <stop offset="0.5" stopColor="#ff9f6b" stopOpacity="0.12" />
            <stop offset="1" stopColor="#ff9f6b" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}b8`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <filter id={`${id}b22`} x="-30%" y="-100%" width="160%" height="300%">
            <feGaussianBlur stdDeviation="22" />
          </filter>
          <Foliage id={`${id}far`} soft={6} scale={30} />
        </defs>
        <rect width="1600" height="1000" fill={`url(#${id}sky)`} />
        <rect width="1600" height="1000" fill={`url(#${id}sun)`} />
        {/* thin evening cloud */}
        <g filter={`url(#${id}b22)`} opacity="0.55">
          <ellipse cx="380" cy="520" rx="420" ry="26" fill="#5d5a86" />
          <ellipse cx="1180" cy="470" rx="360" ry="20" fill="#6c6390" />
          <ellipse cx="900" cy="600" rx="520" ry="22" fill="#b98579" />
          <ellipse cx="260" cy="640" rx="300" ry="18" fill="#c48a72" />
        </g>
        {[
          [180, 90], [420, 60], [690, 120], [1010, 70], [1290, 110], [1480, 50], [880, 40], [260, 200], [1390, 210], [560, 170], [1120, 180],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.5 : 1} fill="#dfe6ff" opacity={i % 2 ? 0.4 : 0.65} />
        ))}
        {/* far hills and tree line, out of focus */}
        <path d="M0 728 C 200 696, 340 708, 520 722 S 860 694, 1040 712 S 1380 694, 1600 720 L1600 820 L0 820 Z" fill="#2b2639" filter={`url(#${id}b8)`} />
        <g filter={`url(#${id}far)`} opacity="0.9">
          <ellipse cx="80" cy="720" rx="140" ry="60" fill="#151622" />
          <ellipse cx="1540" cy="716" rx="150" ry="62" fill="#151622" />
        </g>
      </>
    );
  }
  const mullions = Array.from({ length: 13 }, (_, i) => 300 + i * (1000 / 12));
  const upper = Array.from({ length: 9 }, (_, i) => 410 + i * (780 / 8));
  return (
    <>
      <defs>
        <linearGradient id={`${id}room`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe7bf" />
          <stop offset="0.18" stopColor="#ffd39a" />
          <stop offset="0.6" stopColor="#e69a5a" />
          <stop offset="0.85" stopColor="#9a5a2e" />
          <stop offset="1" stopColor="#6b3d20" />
        </linearGradient>
        <linearGradient id={`${id}depth`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a1f10" stopOpacity="0.55" />
          <stop offset="0.25" stopColor="#3a1f10" stopOpacity="0" />
          <stop offset="0.75" stopColor="#3a1f10" stopOpacity="0" />
          <stop offset="1" stopColor="#3a1f10" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id={`${id}sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}slab`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9d2c6" />
          <stop offset="0.6" stopColor="#c8bba7" />
          <stop offset="1" stopColor="#f0c48d" />
        </linearGradient>
        <linearGradient id={`${id}ground`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a372a" />
          <stop offset="0.4" stopColor="#241a14" />
          <stop offset="1" stopColor="#0b0908" />
        </linearGradient>
        <linearGradient id={`${id}pool`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2a46" />
          <stop offset="1" stopColor="#0a1020" />
        </linearGradient>
        <radialGradient id={`${id}uplight`} cx="0.5" cy="1" r="0.7">
          <stop offset="0" stopColor="#ffcf8a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffcf8a" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}b1`} x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id={`${id}b4`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id={`${id}b14`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id={`${id}b40`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
        <Foliage id={`${id}leaf`} soft={3} />
        <Foliage id={`${id}leafnear`} soft={7} scale={60} />
      </defs>

      {/* bloom: the glass lights the dusk around it */}
      <rect x="260" y="420" width="1080" height="400" fill="#ffb36b" opacity="0.32" filter={`url(#${id}b40)`} />

      <g filter={`url(#${id}b1)`}>
        {/* upper storey */}
        <rect x="410" y="452" width="780" height="112" fill={`url(#${id}room)`} />
        <rect x="410" y="452" width="780" height="112" fill={`url(#${id}depth)`} />
        <rect x="470" y="500" width="220" height="40" fill="#fff4dc" opacity="0.4" filter={`url(#${id}b14)`} />
        <rect x="900" y="490" width="240" height="50" fill="#fff4dc" opacity="0.35" filter={`url(#${id}b14)`} />
        {upper.map((x) => (
          <rect key={x} x={x - 2} y="452" width="4" height="112" fill="#2a1f17" opacity="0.85" />
        ))}
        <rect x="410" y="452" width="780" height="112" fill={`url(#${id}sheen)`} />
        <rect x="380" y="428" width="840" height="26" fill={`url(#${id}slab)`} />
        <rect x="380" y="428" width="840" height="2" fill="#f4eee4" opacity="0.7" />

        {/* main slab, cantilevered, its underside lit by the room */}
        <rect x="240" y="562" width="1120" height="42" fill={`url(#${id}slab)`} />
        <rect x="240" y="562" width="1120" height="2" fill="#f6f0e6" opacity="0.8" />

        {/* ground floor: ceiling glow, a back wall, people, furniture */}
        <rect x="300" y="604" width="1000" height="196" fill={`url(#${id}room)`} />
        <rect x="300" y="604" width="1000" height="196" fill={`url(#${id}depth)`} />
        <rect x="300" y="606" width="1000" height="26" fill="#fff3d9" opacity="0.55" filter={`url(#${id}b14)`} />
        {Array.from({ length: 16 }, (_, i) => (
          <circle key={i} cx={322 + i * 63} cy={616} r="2.6" fill="#fff9ec" />
        ))}
        <rect x="340" y="690" width="920" height="70" fill="#c27a41" opacity="0.35" filter={`url(#${id}b14)`} />
        {[
          [370, 0.85], [420, 0.95], [575, 1], [612, 0.9], [668, 1.02], [880, 0.95], [935, 1], [978, 0.88], [1120, 0.96], [1168, 1.04], [1215, 0.9],
        ].map(([x, s], i) => (
          <g key={i} transform={`translate(${x} 790) scale(${s})`} opacity="0.7" filter={`url(#${id}b4)`}>
            <circle cx="0" cy="-112" r="10.5" fill="#3e2617" />
            <path d="M-15 0 L-14 -96 Q0 -106 14 -96 L15 0 Z" fill="#3e2617" />
          </g>
        ))}
        <rect x="720" y="756" width="160" height="34" rx="4" fill="#4a2c18" opacity="0.6" filter={`url(#${id}b4)`} />
        {mullions.map((x) => (
          <rect key={x} x={x - 2.5} y="604" width="5" height="196" fill="#22180f" opacity="0.9" />
        ))}
        <rect x="300" y="604" width="1000" height="196" fill={`url(#${id}sheen)`} />
      </g>

      {/* plaza, a warm spill, the pool with the building's reflection */}
      <rect x="0" y="800" width="1600" height="200" fill={`url(#${id}ground)`} />
      <ellipse cx="800" cy="812" rx="640" ry="46" fill="#f3ae68" opacity="0.42" filter={`url(#${id}b14)`} />
      <rect x="360" y="848" width="880" height="70" fill={`url(#${id}pool)`} />
      <g opacity="0.55" filter={`url(#${id}b4)`}>
        <rect x="420" y="852" width="760" height="30" fill="#f2a862" />
        <rect x="480" y="884" width="640" height="14" fill="#d9874a" opacity="0.6" />
      </g>
      {[858, 870, 882, 896, 908].map((y, i) => (
        <rect key={y} x={400 + i * 12} y={y} width={800 - i * 24} height="1.2" fill="#ffe0b0" opacity={0.35 - i * 0.05} />
      ))}
      <rect x="360" y="846" width="880" height="3" fill="#d6c6ae" opacity="0.7" />

      {/* trees: leafy edges, lit from below */}
      <g filter={`url(#${id}leaf)`}>
        <ellipse cx="110" cy="600" rx="170" ry="230" fill="#0a110e" />
        <ellipse cx="250" cy="700" rx="110" ry="130" fill="#0e1712" />
        <ellipse cx="1490" cy="580" rx="180" ry="250" fill="#09100d" />
        <ellipse cx="1360" cy="710" rx="100" ry="120" fill="#0f1813" />
      </g>
      <ellipse cx="170" cy="770" rx="160" ry="150" fill={`url(#${id}uplight)`} filter={`url(#${id}b14)`} opacity="0.5" />
      <ellipse cx="1420" cy="770" rx="160" ry="150" fill={`url(#${id}uplight)`} filter={`url(#${id}b14)`} opacity="0.5" />
      <rect x="104" y="740" width="12" height="90" fill="#080a09" />
      <rect x="1486" y="740" width="14" height="90" fill="#080a09" />

      {/* out-of-focus foreground planting */}
      <g filter={`url(#${id}leafnear)`}>
        <ellipse cx="160" cy="1010" rx="320" ry="70" fill="#050605" />
        <ellipse cx="1460" cy="1016" rx="340" ry="74" fill="#050605" />
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ hall: a ballroom, warm light */

function Hall({ id, layer }: { id: string; layer: "back" | "front" }) {
  const vx = 800;
  const vy = 470;
  if (layer === "back") {
    return (
      <>
        <defs>
          <linearGradient id={`${id}wall`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#120d0a" />
            <stop offset="0.45" stopColor="#3b291c" />
            <stop offset="0.62" stopColor="#5a3d27" />
            <stop offset="1" stopColor="#1a120d" />
          </linearGradient>
          <radialGradient id={`${id}wash`} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffd59a" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffd59a" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}b20`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="20" />
          </filter>
        </defs>
        <rect width="1600" height="1000" fill={`url(#${id}wall)`} />
        {/* side walls receding */}
        <path d={`M0 0 L${vx - 330} ${vy - 200} L${vx - 330} ${vy + 140} L0 1000 Z`} fill="#24180f" opacity="0.8" />
        <path d={`M1600 0 L${vx + 330} ${vy - 200} L${vx + 330} ${vy + 140} L1600 1000 Z`} fill="#24180f" opacity="0.8" />
        {/* wall sconces */}
        {[0.25, 0.5, 0.75].map((t, i) => (
          <g key={i}>
            <ellipse cx={t * (vx - 330)} cy={420 + t * 30} rx={30 - t * 16} ry={60 - t * 30} fill="#ffcc88" opacity="0.5" filter={`url(#${id}b20)`} />
            <ellipse cx={1600 - t * (vx - 330)} cy={420 + t * 30} rx={30 - t * 16} ry={60 - t * 30} fill="#ffcc88" opacity="0.5" filter={`url(#${id}b20)`} />
          </g>
        ))}
        {/* stage wash and screen */}
        <ellipse cx={vx} cy={vy} rx="420" ry="220" fill={`url(#${id}wash)`} />
        <rect x={vx - 230} y={vy - 170} width="460" height="250" rx="4" fill="#dfe7f2" opacity="0.92" />
        <rect x={vx - 230} y={vy - 170} width="460" height="250" fill="#a9c2ea" opacity="0.25" filter={`url(#${id}b20)`} />
        <rect x={vx - 180} y={vy - 120} width="210" height="16" rx="3" fill="#7c8fb0" opacity="0.6" />
        <rect x={vx - 180} y={vy - 90} width="300" height="10" rx="3" fill="#97a7c3" opacity="0.5" />
        <rect x={vx - 180} y={vy - 70} width="260" height="10" rx="3" fill="#97a7c3" opacity="0.5" />
        <rect x={vx - 300} y={vy + 90} width="600" height="40" fill="#2c1d13" />
        <rect x={vx - 300} y={vy + 90} width="600" height="6" fill="#ffcf91" opacity="0.5" />
      </>
    );
  }
  const rows = [0, 1, 2, 3, 4, 5];
  return (
    <>
      <defs>
        <filter id={`${id}b6`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter id={`${id}b18`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <linearGradient id={`${id}floor`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2619" />
          <stop offset="1" stopColor="#120c08" />
        </linearGradient>
      </defs>
      {/* floor */}
      <path d={`M0 1000 L${vx - 330} ${vy + 140} L${vx + 330} ${vy + 140} L1600 1000 Z`} fill={`url(#${id}floor)`} />
      <ellipse cx={vx} cy={vy + 220} rx="300" ry="60" fill="#ffcf91" opacity="0.18" filter={`url(#${id}b18)`} />
      {/* chairs: rows of soft backs in perspective */}
      {rows.map((r) => {
        const t = (r + 1) / 7;
        const y = vy + 160 + t * t * 520;
        const width = 600 + t * 1700;
        const n = 10 + r * 2;
        const size = 10 + t * 50;
        return (
          <g key={r} opacity={0.95}>
            {Array.from({ length: n }, (_, i) => {
              const x = vx - width / 2 + (i + 0.5) * (width / n);
              if (Math.abs(x - vx) < 40 + t * 120) return null; // the aisle
              return <rect key={i} x={x - size / 2} y={y - size * 1.1} width={size} height={size * 1.1} rx={size * 0.25} fill="#1a110b" />;
            })}
            <rect x={vx - width / 2} y={y - size * 1.1} width={width} height={2 + t * 3} fill="#c58a52" opacity={0.25} />
          </g>
        );
      })}
      {/* pendant lights, in perspective */}
      {[0, 1, 2, 3, 4].map((r) => {
        const t = (r + 1) / 6;
        const y = vy - 230 - t * t * 260;
        const spread = 260 + t * 1100;
        const radius = 4 + t * t * 22;
        return [-1, -0.33, 0.33, 1].map((k, i) => {
          const x = vx + k * spread * 0.5;
          return (
            <g key={`${r}-${i}`}>
              <line x1={x} y1={0} x2={x} y2={y - radius} stroke="#3c2a1d" strokeWidth={1 + t * 1.5} />
              <circle cx={x} cy={y} r={radius * 3} fill="#ffc777" opacity="0.28" filter={`url(#${id}b18)`} />
              <circle cx={x} cy={y} r={radius} fill="#ffe6b8" filter={radius > 12 ? `url(#${id}b6)` : undefined} />
            </g>
          );
        });
      })}
    </>
  );
}

/* ------------------------------------------------------------------ gallery: daylight */

function Gallery({ id, layer }: { id: string; layer: "back" | "front" }) {
  if (layer === "back") {
    return (
      <>
        <defs>
          <linearGradient id={`${id}wall`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#d9cfbf" />
            <stop offset="0.5" stopColor="#ece4d6" />
            <stop offset="1" stopColor="#d3c8b6" />
          </linearGradient>
          <linearGradient id={`${id}floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9aa94" />
            <stop offset="1" stopColor="#8e7f6a" />
          </linearGradient>
          <filter id={`${id}b24`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="24" />
          </filter>
          <filter id={`${id}b4`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <rect width="1600" height="1000" fill={`url(#${id}wall)`} />
        {/* skylight band */}
        <rect x="0" y="0" width="1600" height="90" fill="#f7f3ea" />
        <rect x="0" y="86" width="1600" height="8" fill="#b8ac9a" opacity="0.5" />
        {/* light shafts */}
        {[260, 720, 1180].map((x, i) => (
          <path key={i} d={`M${x} 90 L${x + 160} 90 L${x + 420} 760 L${x + 120} 760 Z`} fill="#fffaf0" opacity="0.45" filter={`url(#${id}b24)`} />
        ))}
        {/* artworks */}
        <g filter={`url(#${id}b4)`}>
          <rect x="170" y="300" width="250" height="320" fill="#efe9de" />
          <rect x="190" y="320" width="210" height="280" fill="#b5593b" />
          <circle cx="295" cy="430" r="62" fill="#e1a35b" />
          <rect x="560" y="250" width="420" height="300" fill="#efe9de" />
          <rect x="580" y="270" width="380" height="260" fill="#2e2f2c" />
          <path d="M580 470 Q 700 380 800 440 T 960 400 L960 530 L580 530 Z" fill="#7d8f6a" />
          <rect x="1120" y="320" width="250" height="250" fill="#efe9de" />
          <rect x="1140" y="340" width="210" height="210" fill="#c9962e" />
          <rect x="1180" y="380" width="60" height="130" fill="#2b2b2b" />
        </g>
        {/* floor */}
        <path d="M0 760 L1600 760 L1600 1000 L0 1000 Z" fill={`url(#${id}floor)`} />
        <rect x="0" y="758" width="1600" height="6" fill="#a8977f" />
        {[260, 720, 1180].map((x, i) => (
          <path key={i} d={`M${x + 120} 760 L${x + 420} 760 L${x + 620} 1000 L${x + 200} 1000 Z`} fill="#fff6e6" opacity="0.28" filter={`url(#${id}b24)`} />
        ))}
      </>
    );
  }
  return (
    <>
      <defs>
        <filter id={`${id}b2`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter id={`${id}b12`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>
      {/* plinth with a sculpture */}
      <ellipse cx="1310" cy="905" rx="120" ry="20" fill="#5b4e3e" opacity="0.4" filter={`url(#${id}b12)`} />
      <rect x="1240" y="700" width="140" height="200" fill="#f1ece3" />
      <rect x="1240" y="700" width="40" height="200" fill="#d8d0c2" />
      <path d="M1290 700 C 1270 620, 1340 600, 1320 540 C 1360 580, 1350 660, 1330 700 Z" fill="#3a3632" />
      {/* bench */}
      <ellipse cx="640" cy="905" rx="300" ry="26" fill="#4a3d2e" opacity="0.45" filter={`url(#${id}b12)`} />
      <rect x="380" y="820" width="520" height="34" rx="6" fill="#5a4330" />
      <rect x="410" y="852" width="20" height="50" fill="#3e2e20" />
      <rect x="850" y="852" width="20" height="50" fill="#3e2e20" />
      {/* two visitors */}
      <g filter={`url(#${id}b2)`} opacity="0.92">
        <g transform="translate(540 820)">
          <circle cx="0" cy="-170" r="20" fill="#3b302a" />
          <path d="M-30 0 L-26 -140 Q0 -156 26 -140 L30 0 Z" fill="#6b4a36" />
        </g>
        <g transform="translate(1010 905) scale(1.25)">
          <circle cx="0" cy="-190" r="21" fill="#2e2622" />
          <path d="M-34 0 L-30 -160 Q0 -176 30 -160 L34 0 Z" fill="#2f3a3f" />
        </g>
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ courtyard: string lights at night */

function Courtyard({ id, layer }: { id: string; layer: "back" | "front" }) {
  if (layer === "back") {
    return (
      <>
        <defs>
          <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#070912" />
            <stop offset="0.6" stopColor="#151a33" />
            <stop offset="1" stopColor="#2a2233" />
          </linearGradient>
          <filter id={`${id}b10`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id={`${id}b40`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="40" />
          </filter>
          <Foliage id={`${id}leaf`} soft={8} scale={50} />
        </defs>
        <rect width="1600" height="1000" fill={`url(#${id}sky)`} />
        {/* canopies */}
        <g filter={`url(#${id}leaf)`}>
          <ellipse cx="160" cy="360" rx="280" ry="300" fill="#0b120e" />
          <ellipse cx="1460" cy="320" rx="300" ry="320" fill="#0a100d" />
          <ellipse cx="820" cy="560" rx="520" ry="120" fill="#141210" />
        </g>
        {/* bar glow at the back */}
        <rect x="560" y="560" width="480" height="140" fill="#ffb466" opacity="0.55" filter={`url(#${id}b40)`} />
        <rect x="600" y="590" width="400" height="90" fill="#3a2516" />
        <rect x="600" y="590" width="400" height="10" fill="#ffd8a0" opacity="0.8" />
        {Array.from({ length: 9 }, (_, i) => (
          <rect key={i} x={620 + i * 44} y={612} width="20" height="40" rx="3" fill="#ffcf8e" opacity="0.55" />
        ))}
        <rect x="0" y="700" width="1600" height="300" fill="#16110e" />
      </>
    );
  }
  const strands = [
    { y0: 140, sag: 120, n: 22 },
    { y0: 260, sag: 90, n: 18 },
    { y0: 360, sag: 60, n: 16 },
  ];
  return (
    <>
      <defs>
        <filter id={`${id}b3`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={`${id}b14`} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>
      {strands.map((s, k) => {
        const pts = Array.from({ length: s.n }, (_, i) => {
          const t = i / (s.n - 1);
          return [t * 1600, s.y0 + Math.sin(t * Math.PI) * s.sag] as const;
        });
        const r = 9 - k * 2.5;
        return (
          <g key={k}>
            <path d={`M0 ${s.y0} Q 800 ${s.y0 + s.sag * 2} 1600 ${s.y0}`} fill="none" stroke="#2a2420" strokeWidth={2 - k * 0.4} />
            {pts.map(([x, y], i) => (
              <g key={i}>
                <circle cx={x} cy={y + 8} r={r * 3.2} fill="#ffc46e" opacity="0.32" filter={`url(#${id}b14)`} />
                <circle cx={x} cy={y + 8} r={r} fill="#fff0c8" filter={k === 0 ? `url(#${id}b3)` : undefined} />
              </g>
            ))}
          </g>
        );
      })}
      {/* people at standing tables */}
      <g opacity="0.96">
        {[
          [180, 1.25], [300, 1.1], [520, 0.95], [610, 1], [980, 0.92], [1060, 1], [1290, 1.15], [1420, 1.3],
        ].map(([x, s], i) => (
          <g key={i} transform={`translate(${x} 1000) scale(${s})`}>
            <circle cx="0" cy="-262" r="26" fill="#0b0908" />
            <path d="M-44 0 L-40 -220 Q0 -240 40 -220 L44 0 Z" fill="#0b0908" />
          </g>
        ))}
        {[400, 820, 1180].map((x, i) => (
          <g key={i}>
            <ellipse cx={x} cy={772} rx="70" ry="10" fill="#ffcf8a" opacity="0.4" filter={`url(#${id}b14)`} />
            <rect x={x - 70} y={770} width="140" height="10" rx="4" fill="#1a1411" />
            <rect x={x - 6} y={780} width="12" height="220" fill="#100c0a" />
            <circle cx={x} cy={760} r="5" fill="#ffd9a0" />
          </g>
        ))}
      </g>
    </>
  );
}

/* ------------------------------------------------------------------ theatre: stage and seats */

function Theatre({ id, layer }: { id: string; layer: "back" | "front" }) {
  if (layer === "back") {
    return (
      <>
        <defs>
          <linearGradient id={`${id}curtain`} x1="0" y1="0" x2="1" y2="0">
            {Array.from({ length: 13 }, (_, i) => (
              <stop key={i} offset={i / 12} stopColor={i % 2 ? "#5a1e1b" : "#3a1110"} />
            ))}
          </linearGradient>
          <radialGradient id={`${id}pool`} cx="0.5" cy="0.55" r="0.45">
            <stop offset="0" stopColor="#ffd7a1" stopOpacity="0.75" />
            <stop offset="1" stopColor="#ffd7a1" stopOpacity="0" />
          </radialGradient>
          <filter id={`${id}b26`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="26" />
          </filter>
        </defs>
        <rect width="1600" height="1000" fill="#0b0707" />
        <rect x="260" y="140" width="1080" height="500" fill={`url(#${id}curtain)`} />
        <rect x="260" y="140" width="1080" height="500" fill={`url(#${id}pool)`} />
        <rect x="200" y="110" width="1200" height="40" fill="#1c0f0c" />
        <rect x="200" y="140" width="80" height="520" fill="#130a08" />
        <rect x="1320" y="140" width="80" height="520" fill="#130a08" />
        <rect x="260" y="610" width="1080" height="40" fill="#2a1712" />
        <rect x="260" y="610" width="1080" height="5" fill="#ffcf96" opacity="0.6" />
        {/* lectern */}
        <rect x="760" y="520" width="80" height="92" fill="#1b100c" />
        <rect x="760" y="520" width="80" height="6" fill="#ffd9a6" opacity="0.6" />
        {[560, 1040].map((x, i) => (
          <path key={i} d={`M${x} 0 L${x + 60} 0 L${x + 250 * (i ? -1 : 1) + 60} 620 L${x - 40 + 250 * (i ? -1 : 1)} 620 Z`} fill="#fff1d8" opacity="0.18" filter={`url(#${id}b26)`} />
        ))}
      </>
    );
  }
  return (
    <>
      <defs>
        <filter id={`${id}b3`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {[0, 1, 2, 3, 4].map((r) => {
        const t = (r + 1) / 5;
        const y = 680 + t * t * 300;
        const h = 18 + t * 60;
        return (
          <g key={r}>
            <path d={`M-40 ${y} Q 800 ${y - 50 - t * 40} 1640 ${y} L1640 ${y + h} Q 800 ${y + h - 50 - t * 40} -40 ${y + h} Z`} fill={r % 2 ? "#170c0b" : "#1e100e"} filter={r === 4 ? `url(#${id}b3)` : undefined} />
            <path d={`M-40 ${y} Q 800 ${y - 50 - t * 40} 1640 ${y}`} fill="none" stroke="#c4724b" strokeOpacity={0.18 + t * 0.12} strokeWidth={1 + t * 2} />
          </g>
        );
      })}
    </>
  );
}

const DRAW: Record<SceneKind, (props: { id: string; layer: "back" | "front" }) => ReactNode> = {
  dusk: Dusk,
  hall: Hall,
  gallery: Gallery,
  courtyard: Courtyard,
  theatre: Theatre,
};

/** A short alt text for each scene. */
export const SCENE_ALT: Record<SceneKind, string> = {
  dusk: "Placeholder image: a glass pavilion lit warm at dusk",
  hall: "Placeholder image: a ballroom under warm pendant lights",
  gallery: "Placeholder image: a daylit gallery with paintings and a bench",
  courtyard: "Placeholder image: a courtyard under string lights at night",
  theatre: "Placeholder image: a theatre stage with a red curtain",
};

/**
 * A placeholder photograph. `children` are set between the back and front layers (the stage
 * directions' layered title). `tag` shows the discreet "Placeholder image" mark.
 */
export function Scene({
  kind,
  children,
  tag = true,
  className = "",
  focus = "50% 50%",
}: {
  kind: SceneKind;
  children?: ReactNode;
  tag?: boolean;
  className?: string;
  /** Where the slice crop centres (for narrow frames). */
  focus?: string;
}) {
  const id = useId().replace(/:/g, "");
  const Draw = DRAW[kind];
  const align = focus === "50% 50%" ? "xMidYMid" : focus;
  return (
    <div className={`dx-scene ${className}`} role="img" aria-label={SCENE_ALT[kind]}>
      <svg className="dx-scene-layer" viewBox={VB} preserveAspectRatio={`${align} slice`} aria-hidden="true">
        <Draw id={`${id}b`} layer="back" />
      </svg>
      {children ? <div className="dx-scene-mid">{children}</div> : null}
      <svg className="dx-scene-layer" viewBox={VB} preserveAspectRatio={`${align} slice`} aria-hidden="true">
        <Draw id={`${id}f`} layer="front" />
      </svg>
      <div className="dx-scene-grain" aria-hidden="true" />
      {tag ? <span className="dx-placeholder-tag">Placeholder image</span> : null}
    </div>
  );
}

/**
 * The no-photo cover: the event without a picture, on purpose. A quiet ground, one soft light
 * in Daybreak, a still field of points, and the date set large. Reads as designed, not missing.
 */
export function Cover({ event, children, className = "", big = false }: { event: MockEvent; children?: ReactNode; className?: string; big?: boolean }) {
  return (
    <div className={`dx-cover ${big ? "is-big" : ""} ${className}`} role="img" aria-label={`${event.title}: no picture yet`}>
      <div className="dx-cover-light" aria-hidden="true" />
      <div className="dx-cover-dots" aria-hidden="true" />
      {children ? <div className="dx-scene-mid">{children}</div> : null}
      <div className="dx-cover-date" aria-hidden="true">
        <span className="dx-mono">{dayNum(event.starts_at)}</span>
        <span>{monthShort(event.starts_at)}</span>
      </div>
    </div>
  );
}

/** Picture or cover, by the photo switch. */
export function EventPicture({
  event,
  photo,
  children,
  className = "",
  tag = true,
  big = false,
}: {
  event: MockEvent;
  photo: boolean;
  children?: ReactNode;
  className?: string;
  tag?: boolean;
  big?: boolean;
}) {
  return photo ? (
    <Scene kind={sceneFor(event.slug)} tag={tag} className={className}>
      {children}
    </Scene>
  ) : (
    <Cover event={event} className={className} big={big}>
      {children}
    </Cover>
  );
}
