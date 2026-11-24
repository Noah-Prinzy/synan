/**
 * The desk's large text field: 48px tall at every width, 15px type, so a clerk can hit it with
 * a thumb and read it at arm's length. Same border, focus (the brand hairline) and error
 * treatment as the shared controls; label, hint and error come from a surrounding Field.
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn, useField } from "@synan/ui/components";

export interface DeskInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  invalid?: boolean;
  /** An icon at the left edge (search). */
  lead?: ReactNode;
  /** A control at the right edge (clear). */
  trail?: ReactNode;
}

export const DeskInput = forwardRef<HTMLInputElement, DeskInputProps>(function DeskInput(
  { invalid, lead, trail, className, id, ...props },
  ref,
) {
  const field = useField();
  const bad = invalid ?? field?.invalid ?? false;
  return (
    <span className="relative block min-w-0">
      {lead ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground">
          {lead}
        </span>
      ) : null}
      <input
        ref={ref}
        id={id ?? field?.id}
        aria-invalid={bad || undefined}
        aria-describedby={props["aria-describedby"] ?? field?.describedBy}
        {...props}
        className={cn(
          "h-12 w-full min-w-0 border bg-transparent px-3 text-15 text-foreground placeholder:text-muted-foreground",
          "transition-[border-color] duration-120 ease-standard outline-none focus-visible:border-brand disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
          "[&::-webkit-search-cancel-button]:appearance-none",
          bad ? "border-destructive" : "border-border hover:border-foreground/30",
          lead ? "pl-10" : undefined,
          trail ? "pr-12" : undefined,
          className,
        )}
      />
      {trail ? <span className="absolute inset-y-0 right-0 flex items-center">{trail}</span> : null}
    </span>
  );
});
