import type { Replayer as RrwebReplayer } from 'rrweb';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { SegmentTabs } from './SegmentTabs';
import { t } from '../lib/i18n';
import {
  activeItemIndex,
  buildTimeline,
  formatPlayerTime,
  inactivePeriods,
  PLAYER_SPEEDS,
  replayBounds,
  timelineMarkers,
  type AnalyticsEvent,
  type TimelineItem,
  type TimelineKind,
} from '../lib/replay-timeline';

type TimelineFilter = 'all' | TimelineKind;

const SEEK_STEP_MS = 5000;

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * rrweb replay with our own controls: play / pause, scrubber with inactive stretches and event
 * markers, speed, skip inactivity, keyboard shortcuts, and a timeline of console, network, page
 * and analytics entries that follows playback. `actions` renders extra buttons next to the
 * controls with the current playhead (e.g. copy link at this time).
 */
export function ReplayPlayer({
  events,
  analytics,
  initialOffsetMs = 0,
  autoPlay = false,
  actions,
}: {
  events: unknown[];
  analytics?: AnalyticsEvent[];
  initialOffsetMs?: number;
  autoPlay?: boolean;
  actions?: (currentMs: number) => ReactNode;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const replayerRef = useRef<RrwebReplayer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skipInactive, setSkipInactive] = useState(true);
  const [skipping, setSkipping] = useState(false);
  const [filter, setFilter] = useState<TimelineFilter>('all');

  const bounds = useMemo(() => replayBounds(events), [events]);
  const items = useMemo(() => buildTimeline(events, analytics ?? []), [events, analytics]);
  const markers = useMemo(() => timelineMarkers(items), [items]);
  const inactive = useMemo(() => inactivePeriods(events), [events]);
  const total = Math.max(bounds.totalMs, 1);

  // Settings read when the replayer is created; later changes go through setConfig below.
  const initial = useRef({ speed, skipInactive, initialOffsetMs, autoPlay });
  initial.current = { speed, skipInactive, initialOffsetMs, autoPlay };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || events.length < 2) return;
    let cancelled = false;
    let replayer: RrwebReplayer | null = null;
    let observer: ResizeObserver | null = null;
    let size = { width: 1024, height: 576 };

    const fit = () => {
      const wrapper = replayer?.wrapper;
      if (!wrapper || !stage.clientWidth || !stage.clientHeight) return;
      const scale = Math.min(stage.clientWidth / size.width, stage.clientHeight / size.height, 1);
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.transformOrigin = 'top left';
      wrapper.style.left = `${Math.max(0, (stage.clientWidth - size.width * scale) / 2)}px`;
      wrapper.style.top = `${Math.max(0, (stage.clientHeight - size.height * scale) / 2)}px`;
    };

    setFailed(false);
    (async () => {
      const [{ Replayer }] = await Promise.all([import('rrweb'), import('rrweb/dist/style.css')]);
      if (cancelled) return;
      stage.replaceChildren();
      const opts = initial.current;
      replayer = new Replayer(events as unknown as ConstructorParameters<typeof Replayer>[0], {
        root: stage,
        speed: opts.speed,
        skipInactive: opts.skipInactive,
        mouseTail: false,
        showWarning: false,
        triggerFocus: false,
      });
      replayer.on('resize', (dimension) => {
        const next = dimension as { width?: number; height?: number };
        if (next.width && next.height) size = { width: next.width, height: next.height };
        fit();
      });
      replayer.on('finish', () => setPlaying(false));
      replayer.on('skip-start', () => setSkipping(true));
      replayer.on('skip-end', () => setSkipping(false));
      observer = new ResizeObserver(fit);
      observer.observe(stage);
      replayerRef.current = replayer;
      const start = Math.min(Math.max(0, opts.initialOffsetMs), bounds.totalMs);
      if (opts.autoPlay) {
        replayer.play(start);
        setPlaying(true);
      } else {
        replayer.pause(start);
        setPlaying(false);
      }
      setCurrentMs(start);
      setReady(true);
      fit();
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      // Stop timers and remove the iframe; dropping the reference alone left them running.
      replayer?.pause();
      replayer?.destroy();
      replayerRef.current = null;
      setReady(false);
      setPlaying(false);
      setSkipping(false);
    };
  }, [events, bounds.totalMs]);

  useEffect(() => {
    replayerRef.current?.setConfig({ speed });
  }, [speed]);

  useEffect(() => {
    replayerRef.current?.setConfig({ skipInactive });
  }, [skipInactive]);

  // Follow the playhead while playing (10 updates per second is plenty for the UI).
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const replayer = replayerRef.current;
      if (replayer) setCurrentMs(Math.min(replayer.getCurrentTime(), bounds.totalMs));
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, bounds.totalMs]);

  const seek = useCallback(
    (ms: number) => {
      const replayer = replayerRef.current;
      if (!replayer) return;
      const at = Math.min(Math.max(0, ms), bounds.totalMs);
      if (playing) replayer.play(at);
      else replayer.pause(at);
      setCurrentMs(at);
    },
    [playing, bounds.totalMs],
  );

  const toggle = useCallback(() => {
    const replayer = replayerRef.current;
    if (!replayer) return;
    if (playing) {
      replayer.pause();
      setCurrentMs(Math.min(replayer.getCurrentTime(), bounds.totalMs));
      setPlaying(false);
    } else {
      replayer.play(currentMs >= bounds.totalMs ? 0 : currentMs);
      setPlaying(true);
    }
  }, [playing, currentMs, bounds.totalMs]);

  const changeSpeed = useCallback((direction: 1 | -1) => {
    setSpeed((value) => {
      const index = PLAYER_SPEEDS.indexOf(value as (typeof PLAYER_SPEEDS)[number]);
      const next = Math.min(Math.max((index === -1 ? 1 : index) + direction, 0), PLAYER_SPEEDS.length - 1);
      return PLAYER_SPEEDS[next]!;
    });
  }, []);

  // Keyboard: space / k play-pause, arrows ±5 s, shift+arrows jump between markers, < > speed,
  // s skip inactivity. Ignored while typing and with Ctrl / Cmd / Alt.
  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const target = event.target as HTMLElement | null;
      const key = event.key;
      if ((key === ' ' && target?.tagName !== 'BUTTON') || key === 'k' || key === 'K') {
        event.preventDefault();
        toggle();
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault();
        if (event.shiftKey) {
          const next =
            key === 'ArrowRight'
              ? markers.find((marker) => marker.offsetMs > currentMs + 250)
              : [...markers].reverse().find((marker) => marker.offsetMs < currentMs - 250);
          if (next) seek(next.offsetMs);
        } else {
          seek(currentMs + (key === 'ArrowRight' ? SEEK_STEP_MS : -SEEK_STEP_MS));
        }
      } else if (key === '>' || key === '.') {
        changeSpeed(1);
      } else if (key === '<' || key === ',') {
        changeSpeed(-1);
      } else if (key === 's' || key === 'S') {
        setSkipInactive((value) => !value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready, toggle, seek, changeSpeed, markers, currentMs]);

  const seekFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = scrubberRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    seek(((event.clientX - rect.left) / rect.width) * bounds.totalMs);
  };

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.kind === filter)),
    [items, filter],
  );
  const activeIndex = activeItemIndex(visible, currentMs);
  const activeId = activeIndex >= 0 ? visible[activeIndex]!.id : null;

  useEffect(() => {
    if (!playing || !activeId) return;
    listRef.current?.querySelector(`[data-item-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId, playing]);

  const counts = useMemo(() => {
    const out: Record<TimelineKind, number> = { console: 0, network: 0, page: 0, event: 0 };
    for (const item of items) out[item.kind]++;
    return out;
  }, [items]);

  const tabs = (['all', 'console', 'network', 'event', 'page'] as const)
    .filter((id) => id === 'all' || counts[id] > 0)
    .map((id) => ({ id, label: id === 'all' ? t('replayTimelineAll') : `${t(`replayTimeline_${id}`)} ${counts[id]}` }));

  const progress = Math.min(100, (currentMs / total) * 100);

  return (
    <div className="replay-player">
      <div className="replay-player-main">
        <div ref={stageRef} className="replay-stage" onClick={ready ? toggle : undefined} />
        {failed ? <p className="text-danger">{t('replayPlayerFailed')}</p> : null}
        <div className="replay-controls">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={toggle}
            disabled={!ready}
            aria-label={playing ? t('replayPause') : t('replayPlay')}
            title={`${playing ? t('replayPause') : t('replayPlay')} (Space)`}
          >
            {playing ? <Pause aria-hidden /> : currentMs >= bounds.totalMs && ready ? <RotateCcw aria-hidden /> : <Play aria-hidden />}
          </Button>
          <span className="replay-time">
            {formatPlayerTime(currentMs)} / {formatPlayerTime(bounds.totalMs)}
          </span>
          <div
            ref={scrubberRef}
            className="replay-scrubber"
            role="slider"
            tabIndex={0}
            aria-label={t('replayScrubber')}
            aria-valuemin={0}
            aria-valuemax={Math.round(bounds.totalMs / 1000)}
            aria-valuenow={Math.round(currentMs / 1000)}
            aria-valuetext={formatPlayerTime(currentMs)}
            onPointerDown={(event) => {
              if (!ready) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              seekFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event);
            }}
          >
            <div className="replay-scrubber-track">
              {inactive.map(([from, to]) => (
                <span
                  key={`${from}-${to}`}
                  className="replay-scrubber-inactive"
                  style={{ left: `${(from / total) * 100}%`, width: `${((to - from) / total) * 100}%` }}
                />
              ))}
              <span className="replay-scrubber-progress" style={{ width: `${progress}%` }} />
            </div>
            {markers.map((marker) => (
              <button
                key={marker.id}
                type="button"
                className={`replay-marker replay-marker--${marker.severity} replay-marker--${marker.kind}`}
                style={{ left: `${(marker.offsetMs / total) * 100}%` }}
                title={`${formatPlayerTime(marker.offsetMs)} ${marker.label}`}
                aria-label={`${formatPlayerTime(marker.offsetMs)} ${marker.label}`}
                tabIndex={-1}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => seek(marker.offsetMs)}
              />
            ))}
            <span className="replay-scrubber-thumb" style={{ left: `${progress}%` }} />
          </div>
          <select
            className="select replay-speed"
            value={String(speed)}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label={t('replaySpeed')}
            title={`${t('replaySpeed')} (< >)`}
          >
            {PLAYER_SPEEDS.map((value) => (
              <option key={value} value={String(value)}>
                {value}×
              </option>
            ))}
          </select>
          <label className="replay-skip" title={`${t('replaySkipInactivity')} (S)`}>
            <input type="checkbox" checked={skipInactive} onChange={(event) => setSkipInactive(event.target.checked)} />
            {t('replaySkipInactivity')}
          </label>
          {actions ? <div className="replay-actions">{actions(currentMs)}</div> : null}
        </div>
        <p className="replay-shortcuts field-hint">
          {skipping ? <strong>{t('replaySkipping')} · </strong> : null}
          {t('replayShortcutsHint')}
        </p>
      </div>
      <aside className="replay-timeline" aria-label={t('replayTimeline')}>
        <SegmentTabs tabs={tabs} value={filter} onChange={(id) => setFilter(id as TimelineFilter)} aria-label={t('replayTimeline')} />
        {visible.length ? (
          <ol ref={listRef} className="replay-timeline-list">
            {visible.map((item, index) => (
              <TimelineRow
                key={item.id}
                item={item}
                past={index <= activeIndex}
                active={item.id === activeId}
                onSeek={() => seek(item.offsetMs)}
              />
            ))}
          </ol>
        ) : (
          <p className="text-muted replay-timeline-empty">{t('replayTimelineEmpty')}</p>
        )}
      </aside>
    </div>
  );
}

function TimelineRow({
  item,
  past,
  active,
  onSeek,
}: {
  item: TimelineItem;
  past: boolean;
  active: boolean;
  onSeek: () => void;
}) {
  const className = [
    'replay-timeline-item',
    `replay-timeline-item--${item.severity}`,
    past ? 'is-past' : '',
    active ? 'is-active' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <li data-item-id={item.id} className={className}>
      <button type="button" onClick={onSeek}>
        <span className="replay-timeline-time">{formatPlayerTime(item.offsetMs)}</span>
        <span className="replay-timeline-kind">{t(`replayTimeline_${item.kind}`)}</span>
        <span className="replay-timeline-label">{item.label}</span>
        {item.detail ? <span className="replay-timeline-detail">{item.detail}</span> : null}
      </button>
    </li>
  );
}
