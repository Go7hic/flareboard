import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatNumber, formatPercent } from '../../lib/format';
import { t } from '../../lib/i18n';
import { BreakdownList, type BreakdownItem } from '../BreakdownList';
import { EmptyState } from '../EmptyState';
import { SectionCard } from '../SectionCard';
import { Skeleton } from '../ui/skeleton';

export type DimensionRow = { name: string; value: number };

/** Rows whose name is a placeholder for "no value" ("(none)", "(direct)") are untagged traffic. */
export function splitUntagged(rows: DimensionRow[], untagged: readonly string[]) {
  const tagged = rows.filter((row) => !untagged.includes(row.name));
  const untaggedTotal = rows.filter((row) => untagged.includes(row.name)).reduce((sum, row) => sum + row.value, 0);
  return { tagged, untaggedTotal };
}

/**
 * One dimension of a report (UTM source, referrer, paid ads…) as a ranked BreakdownList card:
 * value + share of the card's total, the top rows first, "View all" for the rest. Placeholder
 * rows ("(none)") are pulled out into the footer so real values are what the bars compare.
 */
export function DimensionCard({
  title,
  rows,
  valueLabel,
  untagged = [],
  untaggedLabel,
  formatName,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  loading = false,
  maxRows = 8,
  className,
  color,
  mono = false,
}: {
  title: string;
  rows: DimensionRow[];
  /** Header of the value column ("Pageviews", "Conversions"). */
  valueLabel: string;
  /** Names that mean "no value"; shown as a footer total instead of a bar. */
  untagged?: readonly string[];
  /** Footer label for the untagged total ("Untagged"). */
  untaggedLabel?: string;
  formatName?: (name: string) => string;
  emptyTitle: string;
  emptyDescription?: ReactNode;
  emptyIcon?: ReactNode;
  loading?: boolean;
  maxRows?: number;
  className?: string;
  /** CSS color for the share bars (defaults to series slot 1). */
  color?: string;
  mono?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const { tagged, untaggedTotal } = splitUntagged(rows, untagged);
  const total = tagged.reduce((sum, row) => sum + row.value, 0);
  const max = tagged.reduce((top, row) => Math.max(top, row.value), 0) || 1;
  const visible = expanded ? tagged : tagged.slice(0, maxRows);

  const items: BreakdownItem[] = visible.map((row) => {
    const label = formatName ? formatName(row.name) : row.name;
    return {
      id: row.name,
      label,
      title: label,
      mono,
      share: row.value / max,
      values: [formatNumber(row.value), total > 0 ? formatPercent((row.value / total) * 100) : '-'],
    };
  });

  const footerParts: ReactNode[] = [];
  if (!loading && untaggedTotal > 0 && untaggedLabel) {
    footerParts.push(
      <span key="untagged" className="audience-card-note">
        {untaggedLabel} <span className="num">{formatNumber(untaggedTotal)}</span>
      </span>,
    );
  }
  if (!loading && tagged.length > maxRows) {
    footerParts.push(
      <button key="more" type="button" className="card-footer-link" onClick={() => setExpanded((open) => !open)}>
        {expanded ? t('audienceShowLess') : t('audienceViewAllCount').replace('{count}', formatNumber(tagged.length))}
        {expanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
      </button>,
    );
  }

  return (
    <SectionCard
      className={className ? `audience-dimension-card ${className}` : 'audience-dimension-card'}
      title={title}
      footer={footerParts.length ? <>{footerParts}</> : undefined}
    >
      {loading ? (
        <div className="audience-breakdown-skeleton" aria-hidden>
          {[0.9, 0.7, 0.55, 0.4, 0.3].map((width, index) => (
            <Skeleton key={index} className="h-[34px]" style={{ width: `${width * 100}%` }} />
          ))}
        </div>
      ) : tagged.length ? (
        <BreakdownList items={items} columns={[{ label: valueLabel }, { label: '%' }]} color={color} />
      ) : (
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} className="audience-card-empty" />
      )}
    </SectionCard>
  );
}
