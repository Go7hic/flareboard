import type { ReactNode } from 'react';

export type ReportSectionSkeletonPlacement = 'none' | 'below-title' | 'replace-children';

/**
 * Panel section with optional loading UI.
 * Use skeletonPlacement="none" when children include static controls (forms);
 * show {@link SectionDataSkeleton} only around async data.
 */
export function ReportSection({
  id,
  title,
  loading = false,
  skeletonPlacement = 'replace-children',
  variant = 'panel',
  children,
}: {
  id?: string;
  title: string;
  loading?: boolean;
  skeletonPlacement?: ReportSectionSkeletonPlacement;
  variant?: 'panel' | 'flat';
  children: ReactNode;
}) {
  const showBelowTitle = loading && skeletonPlacement === 'below-title';
  const replaceChildren = loading && skeletonPlacement === 'replace-children';

  return (
    <section
      id={id}
      className={variant === 'flat' ? 'report-block section-gap' : 'panel section-gap'}
      tabIndex={id ? -1 : undefined}
    >
      <h2 className="section-title">{title}</h2>
      {showBelowTitle ? <div className="skeleton skeleton-inline" aria-hidden /> : null}
      {replaceChildren ? <SectionDataSkeleton busy /> : children}
    </section>
  );
}

/** Standard block skeleton for list/table/chart areas below controls. */
export function SectionDataSkeleton({ busy = false, className = 'section-gap' }: { busy?: boolean; className?: string }) {
  return (
    <div
      className={['skeleton', 'skeleton-block', className].filter(Boolean).join(' ')}
      aria-hidden={busy ? undefined : true}
      aria-busy={busy || undefined}
    />
  );
}
