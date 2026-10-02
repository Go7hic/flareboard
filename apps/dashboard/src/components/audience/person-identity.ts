import type { PersonSummary } from '../../lib/api';
import { shortId } from '../../lib/format';
import { t } from '../../lib/i18n';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type IdentityFields = Pick<PersonSummary, 'personId' | 'latestName' | 'latestEmail' | 'latestAlias'>;

/**
 * Identified = identify() gave the person a name, email, alias or their own id. Without one the
 * person key falls back to the session id (or the random persisted visitor id), both UUIDs.
 */
export function isIdentified(person: IdentityFields): boolean {
  return Boolean(person.latestName || person.latestEmail || person.latestAlias) || !UUID_RE.test(person.personId);
}

/** Title, secondary line and avatar label for a person row or sheet. */
export function personIdentity(person: IdentityFields) {
  const identified = isIdentified(person);
  const human = person.latestName || person.latestEmail || person.latestAlias || null;
  const title = human ?? (identified ? person.personId : t('audienceAnonymousVisitor'));
  let subtitle: string;
  if (person.latestName) subtitle = person.latestEmail || person.personId;
  else if (human) subtitle = person.personId;
  else subtitle = identified ? '' : shortId(person.personId, 13);
  return {
    identified,
    title,
    subtitle,
    /** The subtitle is an id (mono) rather than an email. */
    subtitleIsId: subtitle === person.personId || subtitle === shortId(person.personId, 13),
    avatarLabel: human,
  };
}
