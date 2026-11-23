import type { CSSProperties } from "react";
import { pathOf, type Drawing } from "./fit";

/** colour: ink + Daybreak blue. white / black / mono: one colour (mono = currentColor). */
export type BrandTone = "colour" | "white" | "black" | "mono";

const ONE_COLOUR: Record<Exclude<BrandTone, "colour">, string> = {
  white: "#FFFFFF",
  black: "#000000",
  mono: "currentColor",
};

/**
 * Renders a brand drawing as outlines — no font needed. Ink is currentColor, the
 * accent piece is var(--brand). `reveal` plays the one-time entrance: the ink piece
 * arrives from the left, the blue piece from the right, the letters follow (240ms,
 * cubic-bezier(.2,0,0,1), 30ms stagger; none under reduced motion).
 */
export function DrawingSvg({
  drawing,
  tone = "colour",
  className = "",
  title,
  reveal = false,
  style,
}: {
  drawing: Drawing;
  tone?: BrandTone;
  className?: string;
  title?: string;
  reveal?: boolean;
  style?: CSSProperties;
}) {
  const fillFor = (role: "ink" | "accent") =>
    tone === "colour" ? (role === "accent" ? "var(--brand)" : "currentColor") : ONE_COLOUR[tone];
  return (
    <svg
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={className}
      style={style}
    >
      {drawing.parts.map((part, index) => (
        <path
          key={index}
          d={pathOf(part.shape)}
          fill={fillFor(part.role)}
          className={reveal ? (index < 2 ? `brand-reveal brand-reveal-${part.role}` : "brand-reveal brand-reveal-letter") : undefined}
          style={reveal ? ({ ["--i" as string]: index } as CSSProperties) : undefined}
        />
      ))}
    </svg>
  );
}
