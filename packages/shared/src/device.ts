/**
 * Device label stored with every event and shown as **Device** in the console. The tracker's
 * svDevice (survey display rules) must agree; apps/ingest/test-node/tracker-surveys.test.ts
 * checks it.
 */
export function deviceFromUserAgent(ua: string): 'mobile' | 'tablet' | 'desktop' {
  // Android tablets omit "Mobile"; iPads say "Mobile" but are tablets.
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (/mobile|iphone|ipod/i.test(ua)) return 'mobile';
  return 'desktop';
}
