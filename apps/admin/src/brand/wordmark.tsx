export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 170 30"
      role="img"
      aria-label="Connexia"
      className={className}
    >
      <g fill="currentColor">
        <path d="M18.23 8.04A10.4 10.4 0 1 0 18.23 21.96L14.89 18.95A5.9 5.9 0 1 1 14.89 11.05Z" />
        <path
          fillRule="evenodd"
          d="M33.6 4.6A11.6 10.4 0 1 0 33.6 25.4A11.6 10.4 0 1 0 33.6 4.6ZM33.6 9.1A7.1 5.9 0 1 1 33.6 20.9A7.1 5.9 0 1 1 33.6 9.1Z"
        />
        <path d="M48 5H52.5L67 25H62.5ZM48 5H52V25H48ZM63 5H67V25H63Z" />
        <path d="M71 5H75.5L90.5 25H86ZM71 5H75V25H71ZM86.5 5H90.5V25H86.5Z" />
        <path d="M95 5H111.5V9H99.2V13.2H109.5V17.2H99.2V21H111.5V25H95Z" />
        <path d="M141 5H145V25H141Z" />
        <path
          fillRule="evenodd"
          d="M156.5 5H161.5L169.5 25H166L164 21H153.5L152.5 25H148ZM159.5 11.5L156.8 16H162Z"
        />
      </g>
      <path fill="currentColor" d="M115 5H120L136 25H132Z" />
      <path fill="var(--brand)" d="M135 0H141L117 29H111Z" />
    </svg>
  );
}
