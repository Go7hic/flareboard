import { formatDurationSeconds } from './format';
import { t } from './i18n';

/**
 * Readable labels for the tracker's built-in events ($autocapture, $pageleave). Their element
 * details arrive as event properties ($el_tag, $el_text, …; see apps/ingest/src/tracker/script.ts).
 */

export const AUTOCAPTURE_EVENT = '$autocapture';
export const PAGELEAVE_EVENT = '$pageleave';

type PropertyList = Array<{ key: string; value: string | number | null | undefined }>;
type PropertyInput = PropertyList | Record<string, string | number | null | undefined> | null | undefined;

function lookup(props: PropertyInput) {
  if (!props) return () => undefined;
  if (Array.isArray(props)) {
    return (key: string) => {
      const value = props.find((p) => p.key === key)?.value;
      return value == null || value === '' ? undefined : String(value);
    };
  }
  return (key: string) => {
    const value = props[key];
    return value == null || value === '' ? undefined : String(value);
  };
}

/** "Autocapture" / "Page leave" for the built-in events, otherwise the event name itself. */
export function eventDisplayName(name: string | null | undefined): string {
  if (name === AUTOCAPTURE_EVENT) return t('autocaptureEventName');
  if (name === PAGELEAVE_EVENT) return t('pageleaveEventName');
  return name ?? '';
}

function elementNoun(tag: string | undefined, type: string | undefined, role: 'click' | 'other') {
  const tg = (tag ?? '').toLowerCase();
  const ty = (type ?? '').toLowerCase();
  if (tg === 'a') return t('autocaptureElLink');
  if (tg === 'button' || (tg === 'input' && (ty === 'submit' || ty === 'button'))) return t('autocaptureElButton');
  if (tg === 'form') return t('autocaptureElForm');
  if (tg === 'select') return t('autocaptureElSelect');
  if (tg === 'textarea') return t('autocaptureElTextarea');
  if (tg === 'input' && ty === 'checkbox') return t('autocaptureElCheckbox');
  if (tg === 'input' && ty === 'radio') return t('autocaptureElRadio');
  if (tg === 'input') return t('autocaptureElField');
  // [role=button] on a div or span.
  return role === 'click' ? t('autocaptureElButton') : t('autocaptureElElement');
}

function truncate(value: string, max = 60) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** "Clicked button 'Sign up'", "Submitted form 'signup'", "Changed field 'email'". */
export function describeAutocapture(props: PropertyInput): string {
  const get = lookup(props);
  const kind = get('$event_type');
  const role = kind === 'click' ? 'click' : 'other';
  const noun = elementNoun(get('$el_tag'), get('$el_type'), role);
  const label = get('$el_text') ?? get('$el_name') ?? get('$el_id');
  const target = label
    ? t('autocaptureTargetLabeled').replace('{element}', noun).replace('{label}', truncate(label))
    : noun;
  const template =
    kind === 'submit' ? 'autocaptureSubmitted' : kind === 'change' ? 'autocaptureChanged' : 'autocaptureClicked';
  return t(template).replace('{target}', target);
}

/** "Left after 1m 12s, scrolled 80%". */
export function describePageleave(props: PropertyInput): string {
  const get = lookup(props);
  const seconds = Number(get('$time_on_page'));
  const depth = Number(get('$max_scroll_depth'));
  return t('pageleaveSummary')
    .replace('{duration}', formatDurationSeconds(Number.isFinite(seconds) ? seconds : 0))
    .replace('{depth}', String(Number.isFinite(depth) ? Math.round(depth) : 0));
}

/** A one-line description for built-in events, or null for other events. */
export function describeBuiltinEvent(name: string | null | undefined, props: PropertyInput): string | null {
  if (name === AUTOCAPTURE_EVENT) return describeAutocapture(props);
  if (name === PAGELEAVE_EVENT) return describePageleave(props);
  return null;
}
