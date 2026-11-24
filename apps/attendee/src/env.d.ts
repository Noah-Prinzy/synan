interface ImportMetaEnv {
  /**
   * Base URL of the real API, e.g. `http://127.0.0.1:5180` (no `/api/v1`). Unset (the default): the
   * app runs on the in-process mock. Read at build time; see src/data/backend.ts.
   */
  readonly VITE_API_URL?: string;
}
