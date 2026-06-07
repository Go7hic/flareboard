import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { resolveCorsOrigin } from './lib/cors';
import { jwtAuth, type ApiVariables } from './middleware/auth';
import * as billing from './routes/billing';
import { getAuth } from './routes/auth';
import * as admin from './routes/admin';
import * as boards from './routes/boards';
import * as config from './routes/config';
import * as dashboardOverview from './routes/dashboard-overview';
import * as eventData from './routes/event-data';
import * as events from './routes/events';
import * as sessionData from './routes/session-data';
import * as sessions from './routes/sessions';
import * as links from './routes/links';
import * as me from './routes/me';
import * as pixels from './routes/pixels';
import * as realtime from './routes/realtime';
import * as replays from './routes/replays';
import * as reports from './routes/reports';
import * as revenue from './routes/revenue';
import * as segments from './routes/segments';
import * as share from './routes/share';
import * as stats from './routes/stats';
import * as tracking from './routes/tracking';
import * as teams from './routes/teams';
import * as websites from './routes/websites';
import * as heatmaps from './routes/heatmaps';
import * as cohorts from './routes/cohorts';
import * as emailReports from './routes/email-reports';
import * as dataImport from './routes/import';
import { runScheduledEmailReports } from './lib/email-reports';
import { json } from './lib/response';

const app = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

app.use('*', (c, next) => {
  return cors({
    origin: (origin) => resolveCorsOrigin(c.env, origin),
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next);
});

app.get('/', (c) => json({ name: 'flareboard-api', version: '0.0.1' }));
app.get('/api/heartbeat', (c) => json({ ok: true, service: 'flareboard-api', environment: c.env.ENVIRONMENT }));

app.get('/api/config', config.handleConfig);

app.route('/api/auth', getAuth());

app.post('/api/billing/webhook', billing.handleStripeWebhook);
app.get('/api/billing/plans', billing.handleListPlans);
app.use('/api/billing/*', jwtAuth);
app.get('/api/billing/subscription', billing.handleGetSubscription);
app.post('/api/billing/checkout', billing.handleCheckout);
app.post('/api/billing/portal', billing.handlePortal);

app.get('/api/share/:slug', share.handlePublicGet);

app.use('/api/me', jwtAuth);
app.get('/api/me', me.handleMe);
app.patch('/api/me', me.handleUpdateProfile);
app.patch('/api/me/password', me.handleUpdatePassword);

app.use('/api/dashboard', jwtAuth);
app.get('/api/dashboard', dashboardOverview.handleDashboard);

app.use('/api/teams/*', jwtAuth);
app.use('/api/teams', jwtAuth);
app.get('/api/teams', teams.handleList);
app.post('/api/teams', teams.handleCreate);
app.post('/api/teams/join', teams.handleJoin);
app.get('/api/teams/:teamId', teams.handleGet);
app.patch('/api/teams/:teamId', teams.handleUpdate);
app.delete('/api/teams/:teamId', teams.handleDelete);
app.get('/api/teams/:teamId/users', teams.handleListUsers);
app.patch('/api/teams/:teamId/users/:userId', teams.handleUpdateUser);
app.delete('/api/teams/:teamId/users/:userId', teams.handleDeleteUser);
app.post('/api/teams/:teamId/websites', teams.handleCreateWebsite);

app.use('/api/share', jwtAuth);
app.get('/api/share', share.handleList);
app.post('/api/share', share.handleCreate);
app.patch('/api/share/:shareId', share.handleUpdate);
app.delete('/api/share/:shareId', share.handleDelete);

app.use('/api/boards/*', jwtAuth);
app.use('/api/boards', jwtAuth);
app.get('/api/boards', boards.handleList);
app.post('/api/boards', boards.handleCreate);
app.get('/api/boards/:boardId', boards.handleGet);
app.patch('/api/boards/:boardId', boards.handleUpdate);
app.delete('/api/boards/:boardId', boards.handleDelete);
app.post('/api/boards/:boardId/share', boards.handleShareCreate);

app.use('/api/websites/*', jwtAuth);
app.use('/api/websites', jwtAuth);

app.get('/api/websites', websites.handleList);
app.post('/api/websites', websites.handleCreate);
app.get('/api/websites/:websiteId', websites.handleGet);
app.patch('/api/websites/:websiteId', websites.handleUpdate);
app.delete('/api/websites/:websiteId', websites.handleDelete);

app.get('/api/websites/:websiteId/realtime/stream', realtime.handleStream);
app.get('/api/websites/:websiteId/tracking-status', tracking.handleTrackingStatus);
app.get('/api/websites/:websiteId/stats', stats.handleStats);
app.get('/api/websites/:websiteId/stats/compare', stats.handleCompare);
app.get('/api/websites/:websiteId/stats/overview', stats.handleOverview);
app.get('/api/websites/:websiteId/pageviews', stats.handlePageviews);
app.get('/api/websites/:websiteId/metrics', stats.handleMetrics);
app.get('/api/websites/:websiteId/export', sessions.handleExport);
app.get('/api/websites/:websiteId/heatmap', heatmaps.handleGet);
app.get('/api/websites/:websiteId/heatmap/paths', heatmaps.handleGetPaths);
app.get('/api/websites/:websiteId/cohorts', cohorts.handleList);
app.post('/api/websites/:websiteId/cohorts', cohorts.handleCreate);
app.get('/api/websites/:websiteId/cohorts/:cohortId', cohorts.handleGet);
app.patch('/api/websites/:websiteId/cohorts/:cohortId', cohorts.handleUpdate);
app.delete('/api/websites/:websiteId/cohorts/:cohortId', cohorts.handleDelete);
app.get('/api/websites/:websiteId/email-report', emailReports.handleGet);
app.patch('/api/websites/:websiteId/email-report', emailReports.handleUpdate);
app.post('/api/websites/:websiteId/import', dataImport.handleImport);

app.get('/api/websites/:websiteId/sessions', sessions.handleList);
app.get('/api/websites/:websiteId/sessions/stats', sessions.handleStats);
app.get('/api/websites/:websiteId/sessions/weekly', sessions.handleWeekly);
app.get('/api/websites/:websiteId/sessions/:sessionId', sessions.handleGet);
app.get('/api/websites/:websiteId/sessions/:sessionId/activity', sessions.handleActivity);
app.get('/api/websites/:websiteId/sessions/:sessionId/properties', sessions.handleProperties);
app.get('/api/websites/:websiteId/sessions/:sessionId/replays', sessions.handleSessionReplays);

app.get('/api/websites/:websiteId/events', events.handleEvents);
app.get('/api/websites/:websiteId/events/series', events.handleEventSeries);
app.get('/api/websites/:websiteId/events/stats', events.handleEventStats);

app.get('/api/websites/:websiteId/event-data/properties', eventData.handleProperties);
app.get('/api/websites/:websiteId/event-data/values', eventData.handleValues);
app.get('/api/websites/:websiteId/event-data/stats', eventData.handleStats);
app.get('/api/websites/:websiteId/event-data/fields', eventData.handleFields);

app.get('/api/websites/:websiteId/session-data/properties', sessionData.handleProperties);
app.get('/api/websites/:websiteId/session-data/values', sessionData.handleValues);
app.get('/api/websites/:websiteId/session-data/stats', sessionData.handleStats);

app.use('/api/realtime/*', jwtAuth);
app.get('/api/realtime/:websiteId', realtime.handleGet);

app.get('/api/websites/:websiteId/segments', segments.handleList);
app.post('/api/websites/:websiteId/segments', segments.handleCreate);
app.get('/api/websites/:websiteId/segments/:segmentId', segments.handleGet);
app.patch('/api/websites/:websiteId/segments/:segmentId', segments.handleUpdate);
app.delete('/api/websites/:websiteId/segments/:segmentId', segments.handleDelete);

app.get('/api/websites/:websiteId/revenue/sessions', revenue.handleSessions);

app.get('/api/websites/:websiteId/replays', replays.handleList);
app.get('/api/websites/:websiteId/replays/saved', replays.handleSavedList);
app.post('/api/websites/:websiteId/replays/saved', replays.handleSavedCreate);
app.patch('/api/websites/:websiteId/replays/saved/:savedReplayId', replays.handleSavedUpdate);
app.delete('/api/websites/:websiteId/replays/saved/:savedReplayId', replays.handleSavedDelete);
app.get('/api/websites/:websiteId/replays/:replayId', replays.handleGet);

app.use('/api/links/*', jwtAuth);
app.use('/api/links', jwtAuth);
app.get('/api/links', links.handleList);
app.post('/api/links', links.handleCreate);
app.get('/api/links/:linkId/stats', links.handleStats);
app.get('/api/links/:linkId', links.handleGet);
app.patch('/api/links/:linkId', links.handleUpdate);
app.delete('/api/links/:linkId', links.handleDelete);

app.use('/api/pixels/*', jwtAuth);
app.use('/api/pixels', jwtAuth);
app.get('/api/pixels', pixels.handleList);
app.post('/api/pixels', pixels.handleCreate);
app.get('/api/pixels/:pixelId', pixels.handleGet);
app.patch('/api/pixels/:pixelId', pixels.handleUpdate);
app.delete('/api/pixels/:pixelId', pixels.handleDelete);

app.use('/api/reports/*', jwtAuth);
app.use('/api/reports', jwtAuth);
app.get('/api/reports', reports.handleList);
app.post('/api/reports', reports.handleCreate);
app.get('/api/reports/utm', reports.handleUtm);
app.get('/api/reports/goal', reports.handleGoal);
app.get('/api/reports/revenue', reports.handleRevenue);
app.get('/api/reports/funnel', reports.handleFunnel);
app.get('/api/reports/retention', reports.handleRetention);
app.get('/api/reports/journey', reports.handleJourney);
app.get('/api/reports/attribution', reports.handleAttribution);
app.get('/api/reports/breakdown', reports.handleBreakdown);
app.get('/api/reports/performance', reports.handlePerformance);
app.get('/api/reports/cohort', cohorts.handleReport);
app.get('/api/reports/:reportId', reports.handleGet);
app.patch('/api/reports/:reportId', reports.handleUpdate);
app.delete('/api/reports/:reportId', reports.handleDelete);

app.use('/api/admin/*', jwtAuth);
app.get('/api/admin/audit', admin.handleAuditLog);
app.get('/api/admin/export', admin.handleExport);
app.get('/api/admin/users', admin.handleListUsers);
app.post('/api/admin/users', admin.handleCreateUser);
app.patch('/api/admin/users/:userId', admin.handleUpdateUser);
app.delete('/api/admin/users/:userId', admin.handleDeleteUser);
app.get('/api/admin/teams', admin.handleListTeams);
app.post('/api/admin/teams', admin.handleCreateTeam);
app.get('/api/admin/websites', admin.handleListWebsites);
app.post('/api/admin/websites', admin.handleCreateWebsite);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledEmailReports(env, event.cron));
  },
};
