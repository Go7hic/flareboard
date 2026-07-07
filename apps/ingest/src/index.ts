import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { handleBatch, handleHeartbeat, handleRecorder, handleScript, handleSend } from './routes/collect';
import { handleEvaluate as handleFeatureFlagEvaluate } from './routes/feature-flags';
import { handleTrackerConfig } from './routes/tracker-config';
import { handleLinkRedirect, handleLinkRedirectApi, handlePixelGif } from './routes/public';
import { handleActiveUsers } from './routes/active';
import { handleRecord } from './routes/record';
import { handleSurveyResponse } from './routes/surveys';
import { json } from './lib/response';

export { RateLimiter } from '@flareboard/rate-limiter';

const app = new Hono<{ Bindings: Env }>();

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization', 'x-flareboard-cache'],
    maxAge: 86400,
  }),
);

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

app.get('/', (c) => json({ name: 'flareboard-ingest', version: '0.0.1' }));

app.post('/api/send', (c) => handleSend(c));
app.post('/api/batch', (c) => handleBatch(c));
app.post('/api/record', (c) => handleRecord(c));
app.post('/api/surveys/response', (c) => handleSurveyResponse(c));
app.post('/api/feature-flags/evaluate', (c) => handleFeatureFlagEvaluate(c));
app.get('/api/heartbeat', (c) => handleHeartbeat(c));
app.get('/api/tracker-config', (c) => handleTrackerConfig(c));
app.get('/api/websites/:websiteId/active', (c) => handleActiveUsers(c));
app.get('/script.js', (c) => handleScript(c));
app.get('/recorder.js', (c) => handleRecorder(c));
app.get('/l/:slug', (c) => handleLinkRedirect(c));
app.get('/:slug', (c) => handleLinkRedirect(c));
app.get('/api/links/:slug/redirect', (c) => handleLinkRedirectApi(c));
app.get('/p/:slug.gif', (c) => handlePixelGif(c));

export default app;
