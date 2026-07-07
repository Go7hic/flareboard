import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { resolveCorsOrigin } from './lib/cors';
import { jwtAuth, type ApiVariables } from './middleware/auth';
import * as actions from './routes/actions';
import * as annotations from './routes/annotations';
import * as billing from './routes/billing';
import * as aiObservability from './routes/ai-observability';
import { getAuth } from './routes/auth';
import * as admin from './routes/admin';
import * as boards from './routes/boards';
import * as config from './routes/config';
import * as dashboardOverview from './routes/dashboard-overview';
import * as eventData from './routes/event-data';
import * as errors from './routes/errors';
import * as experiments from './routes/experiments';
import * as featureFlags from './routes/feature-flags';
import * as groups from './routes/groups';
import * as insights from './routes/insights';
import * as logs from './routes/logs';
import * as events from './routes/events';
import * as people from './routes/people';
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
import * as surveys from './routes/surveys';
import * as tracking from './routes/tracking';
import * as teams from './routes/teams';
import * as websites from './routes/websites';
import * as warehouse from './routes/warehouse';
import * as workflows from './routes/workflows';
import * as heatmaps from './routes/heatmaps';
import * as cohorts from './routes/cohorts';
import * as emailReports from './routes/email-reports';
import * as dataImport from './routes/import';
import internalRoutes from './routes/internal';
import { runScheduledMaintenance } from './lib/scheduled-jobs';
import { json } from './lib/response';

const app = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

app.use('*', (c, next) => {
  return cors({
    origin: (origin) => resolveCorsOrigin(c.env, origin),
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })(c, next);
});

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (c.env.ENVIRONMENT === 'production') {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
});

app.get('/', (c) => json({ name: 'flareboard-api', version: '0.0.1' }));
app.get('/api/heartbeat', (c) => json({ ok: true, service: 'flareboard-api', environment: c.env.ENVIRONMENT }));

app.route('/api/internal', internalRoutes);

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
app.get('/api/teams/:teamId/status', teams.handleStatus);
app.patch('/api/teams/:teamId', teams.handleUpdate);
app.delete('/api/teams/:teamId', teams.handleDelete);
app.get('/api/teams/:teamId/users', teams.handleListUsers);
app.patch('/api/teams/:teamId/users/:userId', teams.handleUpdateUser);
app.delete('/api/teams/:teamId/users/:userId', teams.handleDeleteUser);
app.post('/api/teams/:teamId/websites', teams.handleCreateWebsite);

app.use('/api/share/*', jwtAuth);
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

app.use('/api/insights/*', jwtAuth);
app.use('/api/insights', jwtAuth);
app.get('/api/insights', insights.handleList);
app.post('/api/insights', insights.handleCreate);
app.post('/api/insights/preview', insights.handlePreview);
app.get('/api/insights/:insightId', insights.handleGet);
app.patch('/api/insights/:insightId', insights.handleUpdate);
app.delete('/api/insights/:insightId', insights.handleDelete);
app.get('/api/insights/:insightId/run', insights.handleRun);

app.use('/api/websites/*', jwtAuth);
app.use('/api/websites', jwtAuth);

app.get('/api/websites', websites.handleList);
app.post('/api/websites', websites.handleCreate);
app.get('/api/websites/:websiteId', websites.handleGet);
app.get('/api/websites/:websiteId/permissions', websites.handlePermissions);
app.get('/api/websites/:websiteId/audit', websites.handleAuditLog);
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
app.get('/api/websites/:websiteId/warehouse/schema', warehouse.handleSchema);
app.post('/api/websites/:websiteId/warehouse/query', warehouse.handleQuery);
app.get('/api/websites/:websiteId/warehouse/history', warehouse.handleHistoryList);
app.get('/api/websites/:websiteId/warehouse/schedules', warehouse.handleScheduleList);
app.post('/api/websites/:websiteId/warehouse/schedules', warehouse.handleScheduleCreate);
app.post('/api/websites/:websiteId/warehouse/schedules/run-due', warehouse.handleScheduleRunDue);
app.patch('/api/websites/:websiteId/warehouse/schedules/:scheduledQueryId', warehouse.handleScheduleUpdate);
app.delete('/api/websites/:websiteId/warehouse/schedules/:scheduledQueryId', warehouse.handleScheduleDelete);
app.get('/api/websites/:websiteId/warehouse/data-sources', warehouse.handleDataSourceList);
app.post('/api/websites/:websiteId/warehouse/data-sources', warehouse.handleDataSourceCreate);
app.patch('/api/websites/:websiteId/warehouse/data-sources/:dataSourceId', warehouse.handleDataSourceUpdate);
app.delete('/api/websites/:websiteId/warehouse/data-sources/:dataSourceId', warehouse.handleDataSourceDelete);
app.get('/api/websites/:websiteId/warehouse/saved-queries', warehouse.handleSavedQueryList);
app.post('/api/websites/:websiteId/warehouse/saved-queries', warehouse.handleSavedQueryCreate);
app.patch('/api/websites/:websiteId/warehouse/saved-queries/:savedQueryId', warehouse.handleSavedQueryUpdate);
app.delete('/api/websites/:websiteId/warehouse/saved-queries/:savedQueryId', warehouse.handleSavedQueryDelete);
app.get('/api/websites/:websiteId/feature-flags', featureFlags.handleList);
app.post('/api/websites/:websiteId/feature-flags', featureFlags.handleCreate);
app.post('/api/websites/:websiteId/feature-flags/evaluate', featureFlags.handleEvaluate);
app.get('/api/websites/:websiteId/feature-flags/:flagId', featureFlags.handleGet);
app.patch('/api/websites/:websiteId/feature-flags/:flagId', featureFlags.handleUpdate);
app.delete('/api/websites/:websiteId/feature-flags/:flagId', featureFlags.handleDelete);
app.get('/api/websites/:websiteId/experiments', experiments.handleList);
app.post('/api/websites/:websiteId/experiments', experiments.handleCreate);
app.get('/api/websites/:websiteId/experiments/:experimentId', experiments.handleGet);
app.patch('/api/websites/:websiteId/experiments/:experimentId', experiments.handleUpdate);
app.delete('/api/websites/:websiteId/experiments/:experimentId', experiments.handleDelete);
app.get('/api/websites/:websiteId/experiments/:experimentId/results', experiments.handleResults);
app.post('/api/websites/:websiteId/experiments/:experimentId/apply', experiments.handleApply);
app.get('/api/websites/:websiteId/surveys', surveys.handleList);
app.post('/api/websites/:websiteId/surveys', surveys.handleCreate);
app.get('/api/websites/:websiteId/surveys/feedback', surveys.handleFeedback);
app.patch('/api/websites/:websiteId/surveys/:surveyId', surveys.handleUpdate);
app.delete('/api/websites/:websiteId/surveys/:surveyId', surveys.handleDelete);
app.get('/api/websites/:websiteId/surveys/:surveyId/responses', surveys.handleResponses);
app.get('/api/websites/:websiteId/workflows', workflows.handleList);
app.post('/api/websites/:websiteId/workflows', workflows.handleCreate);
app.patch('/api/websites/:websiteId/workflows/:workflowId', workflows.handleUpdate);
app.delete('/api/websites/:websiteId/workflows/:workflowId', workflows.handleDelete);
app.get('/api/websites/:websiteId/workflows/:workflowId/executions', workflows.handleExecutions);

app.get('/api/websites/:websiteId/sessions', sessions.handleList);
app.get('/api/websites/:websiteId/sessions/stats', sessions.handleStats);
app.get('/api/websites/:websiteId/sessions/weekly', sessions.handleWeekly);
app.get('/api/websites/:websiteId/sessions/:sessionId', sessions.handleGet);
app.get('/api/websites/:websiteId/sessions/:sessionId/activity', sessions.handleActivity);
app.get('/api/websites/:websiteId/sessions/:sessionId/context', sessions.handleContext);
app.get('/api/websites/:websiteId/sessions/:sessionId/properties', sessions.handleProperties);
app.get('/api/websites/:websiteId/sessions/:sessionId/replays', sessions.handleSessionReplays);
app.get('/api/websites/:websiteId/people', people.handleList);
app.get('/api/websites/:websiteId/people/:personId', people.handleGet);
app.patch('/api/websites/:websiteId/people/:personId', people.handlePatch);
app.get('/api/websites/:websiteId/groups/types', groups.handleTypes);
app.get('/api/websites/:websiteId/groups', groups.handleList);
app.get('/api/websites/:websiteId/groups/:groupType/:groupKey', groups.handleGet);
app.get('/api/websites/:websiteId/annotations', annotations.handleList);
app.post('/api/websites/:websiteId/annotations', annotations.handleCreate);
app.patch('/api/websites/:websiteId/annotations/:annotationId', annotations.handleUpdate);
app.delete('/api/websites/:websiteId/annotations/:annotationId', annotations.handleDelete);
app.get('/api/websites/:websiteId/actions', actions.handleList);
app.post('/api/websites/:websiteId/actions', actions.handleCreate);
app.get('/api/websites/:websiteId/actions/:actionId', actions.handleGet);
app.patch('/api/websites/:websiteId/actions/:actionId', actions.handleUpdate);
app.delete('/api/websites/:websiteId/actions/:actionId', actions.handleDelete);

app.get('/api/websites/:websiteId/events/catalog', events.handleCatalog);
app.get('/api/websites/:websiteId/events/catalog/:eventName', events.handleCatalogDetail);
app.get('/api/websites/:websiteId/events', events.handleEvents);
app.get('/api/websites/:websiteId/events/series', events.handleEventSeries);
app.get('/api/websites/:websiteId/events/stats', events.handleEventStats);
app.get('/api/websites/:websiteId/errors', errors.handleList);
app.patch('/api/websites/:websiteId/errors/issues', errors.handleUpdateIssue);
app.post('/api/websites/:websiteId/errors/issues/comments', errors.handleCreateIssueComment);
app.get('/api/websites/:websiteId/errors/source-maps', errors.handleListSourceMaps);
app.post('/api/websites/:websiteId/errors/source-maps', errors.handleUploadSourceMap);
app.get('/api/websites/:websiteId/errors/alerts', errors.handleListAlertRules);
app.post('/api/websites/:websiteId/errors/alerts', errors.handleCreateAlertRule);
app.patch('/api/websites/:websiteId/errors/alerts/:alertRuleId', errors.handleUpdateAlertRule);
app.delete('/api/websites/:websiteId/errors/alerts/:alertRuleId', errors.handleDeleteAlertRule);
app.get('/api/websites/:websiteId/errors/:eventId', errors.handleGet);
app.get('/api/websites/:websiteId/logs/tail', logs.handleTail);
app.get('/api/websites/:websiteId/logs/services', logs.handleServiceList);
app.get('/api/websites/:websiteId/logs/traces', logs.handleTraceList);
app.get('/api/websites/:websiteId/logs/traces/:traceId', logs.handleTraceDetail);
app.get('/api/websites/:websiteId/logs/filters', logs.handleSavedFilterList);
app.post('/api/websites/:websiteId/logs/filters', logs.handleSavedFilterCreate);
app.patch('/api/websites/:websiteId/logs/filters/:filterId', logs.handleSavedFilterUpdate);
app.delete('/api/websites/:websiteId/logs/filters/:filterId', logs.handleSavedFilterDelete);
app.get('/api/websites/:websiteId/logs/alerts', logs.handleAlertRuleList);
app.post('/api/websites/:websiteId/logs/alerts', logs.handleAlertRuleCreate);
app.patch('/api/websites/:websiteId/logs/alerts/:alertRuleId', logs.handleAlertRuleUpdate);
app.delete('/api/websites/:websiteId/logs/alerts/:alertRuleId', logs.handleAlertRuleDelete);
app.get('/api/websites/:websiteId/logs', logs.handleList);
app.get('/api/websites/:websiteId/ai-observability', aiObservability.handleList);

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
app.get('/api/reports/templates', reports.handleTemplates);
app.get('/api/reports/utm', reports.handleUtm);
app.get('/api/reports/goal', reports.handleGoal);
app.get('/api/reports/revenue', reports.handleRevenue);
app.get('/api/reports/funnel', reports.handleFunnel);
app.get('/api/reports/retention', reports.handleRetention);
app.get('/api/reports/stickiness', reports.handleStickiness);
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
    ctx.waitUntil(runScheduledMaintenance(env, event.cron));
  },
};
