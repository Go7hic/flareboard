import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { t } from '../../lib/i18n';

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

function LongText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > PREVIEW_CHARS;
  return (
    <>
      <pre className="llm-content-pre">{long && !expanded ? `${text.slice(0, PREVIEW_CHARS)}…` : text}</pre>
      {long ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded((open) => !open)}>
          {expanded ? t('aiShowLess') : t('aiShowAll')}
        </Button>
      ) : null}
    </>
  );
}

/**
 * Prompt / response viewer: chat messages as a list, other JSON pretty-printed, plain text as
 * is; collapsible, with a raw view and a marker when the stored payload was cut at 32 KB.
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
  const [raw, setRaw] = useState(false);
  const body = useMemo(() => (value && truncated ? value.slice(0, value.indexOf(TRUNCATION_MARKER)) : value), [value, truncated]);
  const parsed = useMemo(() => (body ? parse(body) : { json: null, ok: false }), [body]);
  const chat = useMemo(() => (parsed.ok ? asChat(parsed.json) : null), [parsed]);

  return (
    <details className="llm-content" open={defaultOpen || undefined}>
      <summary className="llm-content-summary">
        <span className="llm-content-label">{label}</span>
        {truncated ? <span className="badge">{t('aiContentTruncated')}</span> : null}
        {value && parsed.ok ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={(event) => {
              event.preventDefault();
              setRaw((current) => !current);
            }}
          >
            {raw ? t('aiFormattedView') : t('aiRawView')}
          </Button>
        ) : null}
      </summary>
      <div className="llm-content-body">
        {!value ? (
          <p className="text-muted">{omitted ? t('aiContentOmitted') : t('aiContentEmpty')}</p>
        ) : raw || !parsed.ok ? (
          <LongText text={raw ? value : (body ?? '')} />
        ) : chat ? (
          <ol className="llm-chat">
            {chat.map((message, index) => (
              <li key={index} className="llm-chat-message">
                <span className="badge llm-chat-role">{message.role}</span>
                <LongText text={message.content} />
              </li>
            ))}
          </ol>
        ) : (
          <LongText text={typeof parsed.json === 'string' ? parsed.json : JSON.stringify(parsed.json, null, 2)} />
        )}
      </div>
    </details>
  );
}
