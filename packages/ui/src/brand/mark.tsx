import { BRAND } from "./name";

/**
 * Interim mark: a neutral monogram in a hairline square, until an identity is chosen.
 * Matches public/favicon.svg.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={BRAND.name} className={className}>
      <rect x="0.5" y="0.5" width="31" height="31" fill="none" stroke="currentColor" strokeOpacity="0.4" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="17"
        fontWeight="600"
        fill="currentColor"
      >
        {BRAND.name.charAt(0)}
      </text>
    </svg>
  );
}
