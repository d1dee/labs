/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_URL: string;
    readonly VITE_REFRESH_INTERVAL: string;
    readonly VITE_LOG_LEVEL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
