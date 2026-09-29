import type { ResolvedStackFrame } from '../lib/api';
import { t } from '../lib/i18n';

function frameLocation(frame: ResolvedStackFrame) {
  if (frame.resolved && frame.source) {
    return `${frame.source}:${frame.sourceLine ?? '?'}:${frame.sourceColumn ?? '?'}`;
  }
  const position = frame.line != null ? `:${frame.line}${frame.column != null ? `:${frame.column}` : ''}` : '';
  return `${frame.file}${position}`;
}

/**
 * Stack frames, innermost first. In-app frames are emphasized; resolved frames show the original
 * source location and, when the source map embeds sources, the lines around the failing one.
 */
export function ErrorStackTrace({ frames }: { frames: ResolvedStackFrame[] }) {
  return (
    <ol className="error-stack">
      {frames.map((frame, index) => (
        <li
          key={`${index}:${frame.raw}`}
          className={frame.inApp ? 'error-stack-frame' : 'error-stack-frame error-stack-frame-library'}
        >
          <div className="error-stack-frame-head">
            <span className="mono error-stack-function">{frame.functionName || '<anonymous>'}</span>
            <span className="mono text-muted error-stack-location">{frameLocation(frame)}</span>
            {!frame.inApp ? <span className="badge error-stack-badge">{t('errorIssueFrameLibrary')}</span> : null}
          </div>
          {frame.resolved ? (
            <div className="mono text-muted error-stack-generated">
              {frame.file}:{frame.line ?? '?'}:{frame.column ?? '?'}
            </div>
          ) : null}
          {frame.context ? (
            <pre className="error-stack-context">
              {frame.context.lines.map((text, offset) => {
                const lineNumber = frame.context!.startLine + offset;
                const current = lineNumber === frame.sourceLine;
                return (
                  <code key={lineNumber} className={current ? 'error-stack-context-line is-current' : 'error-stack-context-line'}>
                    <span className="error-stack-context-number" aria-hidden>
                      {lineNumber}
                    </span>
                    {text || ' '}
                  </code>
                );
              })}
            </pre>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
