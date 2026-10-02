import type { QueryKey } from '@tanstack/react-query';

/**
 * `placeholderData` that keeps the previous result while filters change (no skeleton flash),
 * but not across websites: switching sites must not show the last site's rows. The website id
 * is the second element of every audience query key.
 */
export function keepPreviousForWebsite(websiteId: string | undefined) {
  return <T,>(previous: T | undefined, previousQuery?: { queryKey: QueryKey }): T | undefined =>
    previousQuery?.queryKey[1] === websiteId ? previous : undefined;
}
