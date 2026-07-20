import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export type PageVariant = 'default' | 'narrow' | 'bleed';

/**
 * Outer page frame. Every authenticated app route should wrap content in Page
 * so padding, max-width, and vertical rhythm stay consistent.
 *
 * Variants:
 * - default: standard analytics / settings gutter
 * - narrow: auth-adjacent or focused forms (`.page-narrow`)
 * - bleed: tighter header→body gap (Realtime). Not full-bleed media; name is historical.
 */
export function Page({
  children,
  className,
  variant = 'default',
}: {
  children: ReactNode;
  className?: string;
  variant?: PageVariant;
}) {
  return (
    <div
      className={cn(
        'page',
        variant === 'narrow' && 'page-narrow',
        variant === 'bleed' && 'page-bleed',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Main content stack under the page header / toolbar. */
export function PageBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('page-body', className)}>{children}</div>;
}
