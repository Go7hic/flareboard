// Stand-in for the API worker in ingest tests: hosts the real EventStore behind the
// `SITE_STORE` binding (script_name "flareboard-api"). Bundled by vitest.config.ts.
export { EventStore } from '../../../api/src/store/event-store';

export default {
  fetch() {
    return new Response('site store test worker');
  },
};
