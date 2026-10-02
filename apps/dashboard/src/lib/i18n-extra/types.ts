export type ExtraLocale = 'en-US' | 'zh-CN' | 'ja-JP' | 'de-DE' | 'fr-FR';

/** Strings added during the console v2 redesign, per locale (en-US is the fallback). */
export type ExtraMessages = Record<ExtraLocale, Record<string, string>>;
