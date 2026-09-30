import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { DEMO_DOCS_WEBSITE_ID, PUBLIC_DEMO_WEBSITE_ID } from '@flareboard/shared';
import type { Env } from '../src/env';
import { isClosedDemoWebsite, resolveWebsiteRef } from '../src/lib/project-keys';

const base = env as unknown as Env;
const hosted = { ...base, HOSTED_MODE: 'true' } as Env;

describe('demo websites take no ingest traffic on hosted installs', () => {
  it('refuses the demo website ids on hosted installs', async () => {
    for (const id of [PUBLIC_DEMO_WEBSITE_ID, DEMO_DOCS_WEBSITE_ID]) {
      expect(isClosedDemoWebsite(hosted, id)).toBe(true);
      expect(await resolveWebsiteRef(hosted, id)).toBeNull();
    }
  });

  it('keeps other websites, self-hosted installs and DEMO_INGEST=on open', async () => {
    expect(await resolveWebsiteRef(hosted, '00000000-0000-0000-0000-0000000000aa')).toEqual({
      websiteId: '00000000-0000-0000-0000-0000000000aa',
    });
    expect(await resolveWebsiteRef({ ...base, HOSTED_MODE: 'false' } as Env, PUBLIC_DEMO_WEBSITE_ID)).toEqual({
      websiteId: PUBLIC_DEMO_WEBSITE_ID,
    });
    expect(isClosedDemoWebsite({ ...hosted, DEMO_INGEST: 'on' } as Env, PUBLIC_DEMO_WEBSITE_ID)).toBe(false);
  });
});
