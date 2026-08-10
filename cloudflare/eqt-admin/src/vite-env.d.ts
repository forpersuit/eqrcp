/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_CF_ACCESS_TEAM_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
