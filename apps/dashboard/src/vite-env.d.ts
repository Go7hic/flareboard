/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_INGEST_URL: string;
  /** Optional: your Flareboard website UUID for dogfooding; leave unset in public/self-hosted builds */
  readonly VITE_TRACKING_WEBSITE_ID?: string;
  /** Optional MapLibre style URL (defaults to CARTO Voyager) */
  readonly VITE_MAP_STYLE_URL?: string;
  /** Set to "true" to force legacy globe.gl fallback instead of MapLibre */
  readonly VITE_DISABLE_MAPLIBRE_GLOBE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  flareboard?: {
    track: (event: string, data?: Record<string, unknown>) => void;
  };
}
