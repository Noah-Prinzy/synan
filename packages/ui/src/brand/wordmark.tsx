import { DrawingSvg, type BrandTone } from "./drawing";
import { lockupDrawing, stackedDrawing } from "./fit";
import { BRAND } from "./name";

const HORIZONTAL = lockupDrawing(false);
const HORIZONTAL_SMALL = lockupDrawing(true);
const STACKED = stackedDrawing();

/**
 * The Synan logotype: "[S]ynan" — the mark stands in for the S, and "ynan" is drawn
 * from the mark's own construction. Outlines only, so it never waits for a font.
 *
 * Sized by font-size: the horizontal lockup is 1.1em tall (cap height ≈ 0.83em), the
 * stacked one 2.6em. `small` uses the wider seam for nav-cell sizes (≤ ~24px tall).
 */
export function Wordmark({
  variant = "horizontal",
  tone = "colour",
  small = false,
  reveal = false,
  className = "",
}: {
  variant?: "horizontal" | "stacked";
  tone?: BrandTone;
  small?: boolean;
  /** One-time entrance; use only on the attendee home's first load. */
  reveal?: boolean;
  className?: string;
}) {
  const drawing = variant === "stacked" ? STACKED : small ? HORIZONTAL_SMALL : HORIZONTAL;
  const height = variant === "stacked" ? 2.6 : 1.1;
  return (
    <DrawingSvg
      drawing={drawing}
      tone={tone}
      reveal={reveal}
      title={BRAND.name}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ height: `${height}em`, width: `${(height * drawing.width) / drawing.height}em` }}
    />
  );
}
