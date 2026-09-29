import { Fragment, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AiAssistantBlock, AiAssistantMessage, AiToolDisplay } from '@flareboard/shared/ai';
import type { InsightResult } from '@flareboard/shared/insight-query';
import { api } from '../../lib/api';
import type { LiveToolBlock } from '../../lib/assistant';
import { formatNumber } from '../../lib/format';
import { t } from '../../lib/i18n';
import { InsightResultView } from '../InsightResultView';
import { Button } from '../ui/button';
import { SaveInsightDialog } from './SaveInsightDialog';


const TABLE_PREVIEW_ROWS = 20;

// ---------------------------------------------------------------------------------------------
// Text: paragraphs, bullet / numbered lists, **bold** and `code`. Built as React nodes (no HTML).
// ---------------------------------------------------------------------------------------------

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    out.push(
      token.startsWith('**') ? <strong key={match.index}>{token.slice(2, -2)}</strong> : <code key={match.index}>{token.slice(1, -1)}</code>,
    );
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function FormattedText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((line) => line.trim());
        if (lines.length && lines.every((line) => BULLET.test(line))) {
          const ordered = /^\s*\d/.test(lines[0]!);
          const items = lines.map((line, j) => <li key={j}>{inline(line.replace(BULLET, '').replace(/^#+\s*/, ''))}</li>);
          return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
        }
        return (
          <p key={i}>
            {lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 ? <br /> : null}
                {inline(line.replace(/^#+\s*/, ''))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Tool results
// ---------------------------------------------------------------------------------------------

function insightTypeLabel(type: string) {
  return t(`insightType${type.charAt(0).toUpperCase()}${type.slice(1)}`);
}

export function toolLabel(name: string) {
  const key = `assistantTool_${name}`;
  const label = t(key);
  return label === key ? name : label;
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'number') return formatNumber(value, { maximumFractionDigits: 2 });
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ResultTable({ display }: { display: Extract<AiToolDisplay, { kind: 'table' }> }) {
  const [all, setAll] = useState(false);
  if (!display.rows.length) return <p className="assistant-muted">{t('assistantNoRows')}</p>;
  const rows = all ? display.rows : display.rows.slice(0, TABLE_PREVIEW_ROWS);
  return (
    <div className="assistant-result">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {display.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {display.columns.map((column) => (
                  <td key={column} className={typeof row[column] === 'number' ? 'num' : undefined}>
                    {cellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {display.rows.length > rows.length ? (
        <Button variant="ghost" size="sm" onClick={() => setAll(true)}>
          {t('assistantShowAllRows')} ({display.rows.length})
        </Button>
      ) : null}
      {display.truncated ? <p className="assistant-muted">{t('assistantRowsTruncated')}</p> : null}
    </div>
  );
}

function InsightDisplay({
  websiteId,
  display,
  canSave,
}: {
  websiteId: string;
  display: Extract<AiToolDisplay, { kind: 'insight' }>;
  canSave: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  // Large results are not stored with the conversation: run the query again.
  const rerun = useQuery({
    queryKey: ['assistant-insight', websiteId, display.insightType, display.query, display.startAt, display.endAt],
    enabled: !display.result,
    staleTime: 5 * 60_000,
    queryFn: () =>
      api<{ data: InsightResult }>(
        `/api/insights/preview?websiteId=${encodeURIComponent(websiteId)}&startAt=${display.startAt}&endAt=${display.endAt}`,
        { method: 'POST', body: JSON.stringify({ type: display.insightType, query: display.query }) },
      ).then((body) => body.data),
  });
  const result = display.result ?? rerun.data;

  return (
    <div className="assistant-result">
      <div className="assistant-result-head">
        <span className="assistant-result-title">
          {insightTypeLabel(display.insightType)} · {new Date(display.startAt).toLocaleDateString()} –{' '}
          {new Date(display.endAt).toLocaleDateString()}
        </span>
        {savedId ? (
          <Link className="assistant-link" to="/insights">
            {t('assistantInsightSaved')}
          </Link>
        ) : canSave ? (
          <Button variant="outline" size="xs" onClick={() => setSaving(true)}>
            {t('assistantSaveInsight')}
          </Button>
        ) : null}
      </div>
      {result ? (
        <InsightResultView result={result} />
      ) : rerun.isError ? (
        <p className="assistant-muted">{t('assistantInsightUnavailable')}</p>
      ) : (
        <p className="assistant-muted">{t('loading')}</p>
      )}
      {saving ? (
        <SaveInsightDialog
          websiteId={websiteId}
          display={display}
          onClose={() => setSaving(false)}
          onSaved={(id) => {
            setSaving(false);
            setSavedId(id);
          }}
        />
      ) : null}
    </div>
  );
}

function ToolBlock({ websiteId, block, canSave }: { websiteId: string; block: LiveToolBlock; canSave: boolean }) {
  const label = toolLabel(block.name);
  return (
    <div className="assistant-tool">
      <div className={`assistant-tool-line${block.ok || block.pending ? '' : ' is-error'}`}>
        {block.pending ? (
          <LoaderCircle className="assistant-spin" size={14} strokeWidth={2} aria-hidden />
        ) : block.ok ? (
          <Check size={14} strokeWidth={2} aria-hidden />
        ) : (
          <CircleAlert size={14} strokeWidth={2} aria-hidden />
        )}
        <span>{block.pending ? `${label}…` : label}</span>
        {!block.ok && !block.pending && block.error ? <span className="assistant-tool-error">{block.error}</span> : null}
      </div>
      {block.display?.kind === 'insight' ? (
        <InsightDisplay websiteId={websiteId} display={block.display} canSave={canSave} />
      ) : block.display?.kind === 'table' ? (
        <ResultTable display={block.display} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------------------------

export function AssistantBlocks({
  websiteId,
  blocks,
  canSave,
}: {
  websiteId: string;
  blocks: Array<AiAssistantBlock | LiveToolBlock>;
  canSave: boolean;
}) {
  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'text' ? (
          <div key={i} className="assistant-text">
            <FormattedText text={block.text} />
          </div>
        ) : (
          <ToolBlock key={block.id || i} websiteId={websiteId} block={block} canSave={canSave} />
        ),
      )}
    </>
  );
}

const STATUS_NOTES: Record<string, string> = {
  refused: 'assistantStatusRefused',
  truncated: 'assistantStatusTruncated',
  error: 'assistantStatusError',
};

export function AssistantMessageView({
  websiteId,
  message,
  canSave,
}: {
  websiteId: string;
  message: AiAssistantMessage;
  canSave: boolean;
}) {
  if (message.role === 'user') {
    return (
      <div className="assistant-message is-user">
        <div className="assistant-bubble">{message.text}</div>
      </div>
    );
  }
  const note = STATUS_NOTES[message.status];
  return (
    <div className="assistant-message is-assistant">
      <AssistantBlocks websiteId={websiteId} blocks={message.blocks} canSave={canSave} />
      {note ? <p className="assistant-muted">{t(note)}</p> : null}
    </div>
  );
}
