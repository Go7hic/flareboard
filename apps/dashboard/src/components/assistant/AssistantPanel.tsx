import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, History, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AiAssistantMessage, AiAssistantStatus } from '@flareboard/shared/ai';
import { ApiError } from '../../lib/api';
import {
  applyStreamEvent,
  askAssistant,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  type LiveAnswer,
} from '../../lib/assistant';
import { formatDate } from '../../lib/formatDate';
import { t } from '../../lib/i18n';
import { useWebsitePermissions } from '../../lib/useWebsitePermissions';
import { deleteTitle, useConfirm } from '../ConfirmDialog';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { AssistantBlocks, AssistantMessageView } from './AssistantMessageView';
import '../../styles/assistant.css';

/** Matches AI_QUESTION_MAX_CHARS in @flareboard/shared/ai (not imported: it would bundle zod). */
const QUESTION_MAX_CHARS = 4000;

const SUGGESTIONS = ['assistantSuggestion1', 'assistantSuggestion2', 'assistantSuggestion3'];

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const code = error.data?.code;
    if (code === 'assistant_daily_limit') return t('assistantDailyLimit');
    if (code === 'assistant_rate_limited') return t('assistantRateLimited');
    return error.message;
  }
  return t('assistantStatusError');
}

/**
 * "Ask Flareboard": a side panel that answers questions about one website. Answers stream in;
 * charts and tables come from the same tools the MCP server exposes.
 */
export function AssistantPanel({
  websiteId,
  status,
  onClose,
}: {
  websiteId: string;
  status: AiAssistantStatus;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { canEdit } = useWebsitePermissions(websiteId, 'analytics');
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);
  const [live, setLive] = useState<LiveAnswer | null>(null);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const conversations = useQuery({
    queryKey: ['assistant-conversations', websiteId],
    queryFn: () => fetchConversations(websiteId),
    enabled: view === 'history',
  });

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"][data-open]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, live]);

  const sending = live !== null;
  const usageLeft = status.usage ? Math.max(status.usage.limit - status.usage.used, 0) : null;

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setError(null);
    setQuestion('');
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: 'user', text: message, createdAt: Date.now() }]);
    setLive({ blocks: [] });
    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;
    try {
      await askAssistant(
        websiteId,
        { message, conversationId },
        (event) => {
          if (event.type === 'conversation') {
            setConversationId(event.conversation.id);
          } else if (event.type === 'done') {
            finished = true;
            setMessages((current) => [...current, event.message]);
            setLive(null);
          } else if (event.type === 'error') {
            setError(event.message);
          } else {
            setLive((current) => applyStreamEvent(current ?? { blocks: [] }, event));
          }
        },
        controller.signal,
      );
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught));
      // Refused before streaming: take the question back so it can be edited.
      if (caught instanceof ApiError) {
        setMessages((current) => current.slice(0, -1));
        setQuestion(message);
      }
    } finally {
      if (!finished) setLive(null);
      abortRef.current = null;
      queryClient.invalidateQueries({ queryKey: ['assistant-status', websiteId] });
      queryClient.invalidateQueries({ queryKey: ['assistant-conversations', websiteId] });
    }
  }

  function startNew() {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setLive(null);
    setError(null);
    setView('chat');
    inputRef.current?.focus();
  }

  async function open(id: string) {
    setError(null);
    try {
      const detail = await fetchConversation(websiteId, id);
      setConversationId(id);
      setMessages(detail.messages);
      setView('chat');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function remove(id: string, title: string) {
    confirm({
      title: deleteTitle(title),
      onConfirm: async () => {
        try {
          await deleteConversation(websiteId, id);
          if (id === conversationId) startNew();
          queryClient.invalidateQueries({ queryKey: ['assistant-conversations', websiteId] });
        } catch (caught) {
          setError(errorMessage(caught));
        }
      },
    });
  }

  return (
    <aside className="assistant-panel" aria-label={t('assistantTitle')}>
      <header className="assistant-header">
        <div className="assistant-header-title">
          <Sparkles size={16} strokeWidth={2} aria-hidden />
          <span>{t('assistantTitle')}</span>
        </div>
        <div className="assistant-header-actions">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setView(view === 'history' ? 'chat' : 'history')}
            aria-label={t('assistantHistory')}
            title={t('assistantHistory')}
            aria-pressed={view === 'history'}
          >
            <History aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={startNew} aria-label={t('assistantNew')} title={t('assistantNew')}>
            <Plus aria-hidden />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('close')} title={t('close')}>
            <X aria-hidden />
          </Button>
        </div>
      </header>

      {view === 'history' ? (
        <div className="assistant-body">
          {conversations.isLoading ? <p className="assistant-muted">{t('loading')}</p> : null}
          {conversations.data && !conversations.data.length ? (
            <p className="assistant-muted">{t('assistantHistoryEmpty')}</p>
          ) : null}
          <ul className="assistant-history">
            {(conversations.data ?? []).map((conversation) => (
              <li key={conversation.id} className={conversation.id === conversationId ? 'is-active' : undefined}>
                <button type="button" className="assistant-history-open" onClick={() => open(conversation.id)}>
                  <span className="assistant-history-title">{conversation.title}</span>
                  <span className="assistant-muted">{formatDate(conversation.updatedAt)}</span>
                </button>
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  onClick={() => remove(conversation.id, conversation.title)}
                  aria-label={t('delete')}
                  title={t('delete')}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <p className="assistant-muted assistant-footnote">{t('assistantHistoryRetention')}</p>
        </div>
      ) : (
        <div className="assistant-body" ref={scrollRef}>
          {!messages.length && !live ? (
            <div className="assistant-intro">
              <p>{t('assistantIntro')}</p>
              <div className="assistant-suggestions">
                {SUGGESTIONS.map((key) => (
                  <button key={key} type="button" className="assistant-suggestion" onClick={() => send(t(key))}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((message) => (
            <AssistantMessageView key={message.id} websiteId={websiteId} message={message} canSave={canEdit} />
          ))}
          {live ? (
            <div className="assistant-message is-assistant" aria-live="polite">
              <AssistantBlocks websiteId={websiteId} blocks={live.blocks} canSave={false} />
              {!live.blocks.length ? <p className="assistant-muted assistant-thinking">{t('assistantThinking')}</p> : null}
            </div>
          ) : null}
          {error ? (
            <p className="text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(question);
        }}
      >
        <div className="assistant-input">
          <Textarea
            ref={inputRef}
            value={question}
            maxLength={QUESTION_MAX_CHARS}
            rows={2}
            placeholder={t('assistantPlaceholder')}
            aria-label={t('assistantPlaceholder')}
            disabled={usageLeft === 0}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(question);
              }
            }}
          />
          <Button
            type="submit"
            variant="primary"
            size="icon-sm"
            disabled={!question.trim() || sending || usageLeft === 0}
            aria-label={t('assistantSend')}
            title={t('assistantSend')}
          >
            <ArrowUp aria-hidden />
          </Button>
        </div>
        <p className="assistant-muted assistant-footnote">
          {usageLeft !== null ? `${t('assistantUsageLeft').replace('{count}', String(usageLeft))} · ` : null}
          {t('assistantDisclaimer')}{' '}
          <Link className="assistant-link" to="/privacy#assistant">
            {t('assistantPrivacyLink')}
          </Link>
        </p>
      </form>
    </aside>
  );
}
