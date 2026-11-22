export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 34" role="img" aria-label="Connexia" className={className}>
      <path fill="currentColor" d="M6 7H11L27 27H23Z" />
      <path fill="var(--brand)" d="M26 2H32L8 31H2Z" />
    </svg>
  );
}
