import type { ReactNode } from 'react';

/*
 * The legal documents describe what the code actually does. When data handling changes
 * (new fields, retention, subprocessors, cookies), update the matching section in BOTH
 * languages and bump both dates together. English is the binding version.
 */
export const UPDATED = { en: 'September 28, 2026', 'zh-CN': '2026 年 9 月 28 日' } as const;
export const CONTACT = 'support@flareboard.dev';

export function Mail() {
  return <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;
}

export function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
