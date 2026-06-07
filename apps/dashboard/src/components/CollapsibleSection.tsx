import type { ReactNode } from 'react';

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="collapsible-section section-gap" open={defaultOpen || undefined}>
      <summary className="collapsible-section-summary">
        <span className="collapsible-section-title">{title}</span>
        {summary ? <span className="collapsible-section-hint">{summary}</span> : null}
        <span className="collapsible-section-chevron" aria-hidden />
      </summary>
      <div className="collapsible-section-body">{children}</div>
    </details>
  );
}
