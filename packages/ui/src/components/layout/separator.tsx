import { cn } from "../../lib/cn";

export function Separator({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        // Separation is space (D-37): the separator is an empty band, never a rule.
        orientation === "horizontal" ? "h-6 w-full" : "h-full w-6",
        className,
      )}
    />
  );
}
