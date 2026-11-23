import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <article className={cn("border border-border bg-card/40", className)}>{children}</article>;
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-b border-border px-5 py-3", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("font-serif text-xl font-normal leading-snug", className)}>{children}</h3>
  );
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm text-muted-foreground", className)}>{children}</p>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-t border-border px-5 py-3", className)}>{children}</div>;
}
