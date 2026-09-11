/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to `"false"` to keep Query Devtools out of Playwright (click intercepts). */
  readonly VITE_QUERY_DEVTOOLS?: string;
}
