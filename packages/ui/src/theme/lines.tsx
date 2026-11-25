/**
 * "Lines" (D-37 candidate): a few long, fine contours, like the lines of a sound or of a venue
 * plan seen from far away, drifting past one another over a minute or more. Six lines in three
 * layers: a contour of three, a pair, and one in the accent that fades in and out. Curves only,
 * nothing straight, nothing aligned to the layout, large scale, ink at 9–13% (accent at 20–26%).
 * The drawing is fixed; only the layers move (backgrounds.css).
 */
import "./backgrounds.css";
import { usePauseWhenHidden } from "./living";

const W = 1600;
const H = 1000;

/** A long wave across the view: a sum of two slow sines on a gentle slope. */
function wave(y0: number, slope: number, a1: number, f1: number, p1: number, a2: number, f2: number, p2: number): string {
  const pts: string[] = [];
  for (let x = -100; x <= W + 100; x += 25) {
    const t = x / W;
    const y = y0 + slope * t * H + a1 * Math.sin(t * Math.PI * 2 * f1 + p1) + a2 * Math.sin(t * Math.PI * 2 * f2 + p2);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

const CONTOUR = [0, 1, 2].map((i) => wave(250 + i * 30, 0.28, 90 - i * 8, 0.8, 0.6 + i * 0.12, 26, 2.1, 1.4));
const PAIR = [0, 1].map((i) => wave(760 + i * 44, -0.34, 70, 0.65, 2.4 + i * 0.2, 18, 1.7, 0.3));
const ACCENT = [wave(540, 0.08, 110, 0.55, 4.1, 20, 1.9, 2.2)];

function Layer({ paths }: { paths: string[] }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d) => (
        <path key={d.slice(0, 24)} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export default function LinesBackground() {
  usePauseWhenHidden();
  return (
    <div className="living-bg living-bg-lines" aria-hidden="true">
      <Layer paths={CONTOUR} />
      <Layer paths={PAIR} />
      <Layer paths={ACCENT} />
    </div>
  );
}
