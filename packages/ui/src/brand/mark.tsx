import { DrawingSvg, type BrandTone } from "./drawing";
import { markDrawing } from "./fit";
import { BRAND } from "./name";

const FULL = markDrawing(false);
const SMALL = markDrawing(true);

/**
 * The Synan mark ("Fit"): a square cut by one S-shaped seam into two pieces that only
 * make sense together. Pass `size` (px) so the simplified drawing — a wider seam — is
 * used at 24px and below; without it the full drawing is used.
 */
export function Mark({
  size,
  className = "",
  tone = "colour",
  title = BRAND.name,
}: {
  size?: number;
  className?: string;
  tone?: BrandTone;
  /** Empty string hides it from assistive tech (when the name is said next to it). */
  title?: string;
}) {
  const drawing = size !== undefined && size <= 24 ? SMALL : FULL;
  return (
    <DrawingSvg
      drawing={drawing}
      tone={tone}
      title={title || undefined}
      className={className}
      style={size !== undefined ? { width: size, height: size } : undefined}
    />
  );
}
