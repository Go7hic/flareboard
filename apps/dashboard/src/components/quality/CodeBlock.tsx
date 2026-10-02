import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { CopyButton } from './CopyButton';

/**
 * Mono code on a subtle fill (no border: it sits inside a card), with an optional copy button in
 * the top-right corner and an optional caption above it.
 */
export function CodeBlock({
  code,
  copy = true,
  caption,
  maxHeight,
  wrap = false,
  className,
}: {
  code: string;
  copy?: boolean;
  caption?: ReactNode;
  /** Scroll inside the block past this height (CSS length). */
  maxHeight?: string;
  /** Wrap long lines instead of scrolling sideways (JSON, messages). */
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('q-code', className)}>
      {caption ? <div className="q-code-caption">{caption}</div> : null}
      <div className="q-code-frame">
        <pre className={cn('q-code-pre', wrap && 'is-wrapped')} style={maxHeight ? { maxHeight } : undefined}>
          {code}
        </pre>
        {copy ? <CopyButton value={code} iconOnly size="xs" className="q-code-copy" /> : null}
      </div>
    </div>
  );
}
