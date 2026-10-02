import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { Button } from '../ui/button';
import { CopyButton } from '../quality/CopyButton';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

/** Characters rendered before "Show all"; stored content is capped at 32 KB anyway. */
const PREVIEW_CHARS = 4000;
const TRUNCATION_MARKER = '\n…[truncated by Flareboard: ';

type ChatMessage = { role: string; content: string };

function partText(part: unknown): string {
  if (typeof part === 'string') return part;
  if (part && typeof part === 'object') {
    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.content === 'string') return record.content;
  }
  return JSON.stringify(part, null, 2);
}

/** OpenAI / Anthropic style `[{ role, content }]` (content a string or a list of parts). */
function asChat(value: unknown): ChatMessage[] | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : null;
  if (!list?.length) return null;
  const messages: ChatMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record.role !== 'string') return null;
    const content = Array.isArray(record.content)
      ? record.content.map(partText).join('\n')
      : record.content == null
        ? record.tool_calls
          ? JSON.stringify(record.tool_calls, null, 2)
          : ''
        : partText(record.content);
    messages.push({ role: record.role, content });
  }
  return messages;
}

function parse(value: string): { json: unknown; ok: boolean } {
  const trimmed = value.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[') && !trimmed.startsWith('"')) return { json: null, ok: false };
  try {
    return { json: JSON.parse(value), ok: true };
  } catch {
    return { json: null, ok: false };
  }
}

function LongText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  return (
    <>
      <pre className={cn('q-ai-pre', className)}>{long && !expanded ? `${text.slice(0, PREVIEW_CHARS)}…` : text}</pre>
      {long ? (
        <Button type="button" variant="ghost" size="sm" className="q-ai-more" onClick={() => setExpanded((open) => !open)}>
          {expanded ? t('aiShowLess') : t('aiShowAll')}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Prompt / response viewer: chat messages as a list (role, then text), other JSON pretty-printed,
 * plain text as is. A section of its card (no box of its own): a header row that collapses it,
 * with a raw/formatted toggle, copy, and a marker when the stored payload was cut at 32 KB.
 */
export function AiContentViewer({
  label,
  value,
  truncated = false,
  omitted = false,
  defaultOpen = true,
}: {
  label: string;
  value: string | null;
  truncated?: boolean;
  omitted?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [raw, setRaw] = useState(false);
  const body = useMemo(() => (value && truncated ? value.slice(0, value.indexOf(TRUNCATION_MARKER)) : value), [value, truncated]);
  const parsed = useMemo(() => (body ? parse(body) : { json: null, ok: false }), [body]);
  const chat = useMemo(() => (parsed.ok ? asChat(parsed.json) : null), [parsed]);

  return (
    <section className="q-ai-content">
      <div className="q-ai-content-head">
        <button type="button" className="q-ai-content-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
          <ChevronRight className={cn('q-stack-chevron', open && 'is-open')} size={14} strokeWidth={2} aria-hidden />
          <span className="q-detail-section-title">{label}</span>
        </button>
        {truncated ? (
          <StatusBadge tone="warning" dot={false}>
            {t('aiContentTruncated')}
          </StatusBadge>
        ) : null}
        {value ? (
          <span className="q-ai-content-actions">
            {parsed.ok ? (
              <div className="segmented" role="group" aria-label={label}>
                <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>
                  {t('aiFormattedView')}
                </button>
                <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>
                  {t('aiRawView')}
                </button>
              </div>
            ) : null}
            <CopyButton value={value} iconOnly size="xs" />
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="q-ai-content-body">
          {!value ? (
            <p className="q-muted-line">{omitted ? t('aiContentOmitted') : t('aiContentEmpty')}</p>
          ) : raw || !parsed.ok ? (
            <LongText text={raw ? value : (body ?? '')} />
          ) : chat ? (
            <ol className="q-ai-chat">
              {chat.map((message, index) => (
                <li key={index} className="q-ai-chat-message">
                  <span className="q-ai-chat-role">{message.role}</span>
                  <LongText text={message.content} className="is-plain" />
                </li>
              ))}
            </ol>
          ) : (
            <LongText text={typeof parsed.json === 'string' ? parsed.json : JSON.stringify(parsed.json, null, 2)} />
          )}
        </div>
      ) : null}
    </section>
  );
}
