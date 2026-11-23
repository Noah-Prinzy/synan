import { useWordmarkOverride } from "./context";
import { BRAND } from "./name";

/**
 * Interim wordmark: the product name as live text in the UI face, until the owner
 * picks an identity on the brand board. Legible at 16px in a nav cell. Inherits its
 * size from the parent.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  const Override = useWordmarkOverride();
  if (Override) return <Override className={className} />;
  return (
    <span className={`inline-block font-sans leading-none font-semibold tracking-[-0.01em] ${className}`}>
      {BRAND.name}
    </span>
  );
}
