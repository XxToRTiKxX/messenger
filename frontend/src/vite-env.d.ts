/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_ENDPOINT?: string;
  readonly VITE_WS_BOOTSTRAP_PSK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
