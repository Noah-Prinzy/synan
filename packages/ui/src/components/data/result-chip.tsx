import type { GateTone, ScanResult } from "@synan/contracts/enums";
import { SCAN_RESULT_COPY } from "@synan/contracts/copy";
import { cn } from "../../lib/cn";

/**
 * A scan result as a chip: glyph + label + signal colour (docs/05 §1.9).
 * Copy and tone come from `@synan/contracts/copy` (docs/02 §7) — never retyped here.
 *
 * Lives on `@synan/ui/data`. Its copy module is Zod-free, so it costs a few hundred
 * bytes wherever it is used.
 */

const toneText: Record<GateTone, string> = {
  green: "text-success",
  amber: "text-warning",
  red: "text-destructive",
  none: "text-muted-foreground",
};

const toneGlyph: Record<GateTone, string> = {
  green: "✓",
  amber: "!",
  red: "✕",
  none: "·",
};

export function resultLabel(result: ScanResult): string {
  return SCAN_RESULT_COPY[result].label;
}

export interface ResultChipProps {
  result: ScanResult;
  className?: string;
}

export function ResultChip({ result, className }: ResultChipProps) {
  const { tone, label } = SCAN_RESULT_COPY[result];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-11 uppercase tracking-[0.12em]",
        toneText[tone],
        className,
      )}
    >
      <span aria-hidden="true">{toneGlyph[tone]}</span>
      {label}
    </span>
  );
}
