import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ResolvedStackFrame } from '../lib/api';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { StatusBadge } from './StatusBadge';

function frameLocation(frame: ResolvedStackFrame) {
  if (frame.resolved && frame.source) {
    return `${frame.source}:${frame.sourceLine ?? '?'}:${frame.sourceColumn ?? '?'}`;
  }
  const position = frame.line != null ? `:${frame.line}${frame.column != null ? `:${frame.column}` : ''}` : '';
  return `${frame.file}${position}`;
}

/**
 * Stack frames, innermost first, as hairline rows inside their card. In-app frames read at full
 * strength, library frames are dimmed. Frames with source context expand to show the lines around
 * the failing one; the first of them starts open.
 */
export function ErrorStackTrace({ frames }: { frames: ResolvedStackFrame[] }) {
  const firstWithContext = frames.findIndex((frame) => frame.context);
  const [open, setOpen] = useState<Set<number>>(() => new Set(firstWithContext >= 0 ? [firstWithContext] : []));

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <ol className="q-stack">
      {frames.map((frame, index) => {
        const expandable = Boolean(frame.context);
        const expanded = expandable && open.has(index);
        const head = (
          <>
            {expandable ? (
              <ChevronRight className={cn('q-stack-chevron', expanded && 'is-open')} size={14} strokeWidth={2} aria-hidden />
            ) : (
              <span className="q-stack-chevron" aria-hidden />
            )}
            <span className="q-stack-fn">{frame.functionName || '<anonymous>'}</span>
            <span className="q-stack-loc" title={frameLocation(frame)}>
              {frameLocation(frame)}
            </span>
            {!frame.inApp ? (
              <StatusBadge dot={false} className="q-stack-badge">
                {t('errorIssueFrameLibrary')}
              </StatusBadge>
            ) : null}
          </>
        );
        return (
          <li key={`${index}:${frame.raw}`} className={cn('q-stack-frame', !frame.inApp && 'is-library')}>
            {expandable ? (
              <button
                type="button"
                className="q-stack-head"
                aria-expanded={expanded}
                onClick={() => toggle(index)}
              >
                {head}
              </button>
            ) : (
              <div className="q-stack-head">{head}</div>
            )}
            {frame.resolved ? (
              <div className="q-stack-generated">
                {frame.file}:{frame.line ?? '?'}:{frame.column ?? '?'}
              </div>
            ) : null}
            {expanded && frame.context ? (
              <pre className="q-stack-context">
                {frame.context.lines.map((text, offset) => {
                  const lineNumber = frame.context!.startLine + offset;
                  const current = lineNumber === frame.sourceLine;
                  return (
                    <code key={lineNumber} className={cn('q-stack-line', current && 'is-current')}>
                      <span className="q-stack-line-no" aria-hidden>
                        {lineNumber}
                      </span>
                      {text || ' '}
                    </code>
                  );
                })}
              </pre>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
