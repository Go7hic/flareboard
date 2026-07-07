import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { WebsiteShell } from './components/WebsiteShell';
import { LazyRouteFallback } from './components/LazyRouteFallback';
import Features from './pages/Features';
import Compare from './pages/Compare';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import Login from './pages/Login';
import Register from './pages/Register';
import SharePublic from './pages/SharePublic';

const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const Websites = lazy(() => import('./pages/Websites'));
const Teams = lazy(() => import('./pages/Teams'));
const LinksPixels = lazy(() => import('./pages/LinksPixels'));
const LinkAnalytics = lazy(() => import('./pages/LinkAnalytics'));
const Reports = lazy(() => import('./pages/Reports'));
const Insights = lazy(() => import('./pages/Insights'));
const Boards = lazy(() => import('./pages/Boards'));
const Admin = lazy(() => import('./pages/Admin'));
const WebsiteStats = lazy(() => import('./pages/WebsiteStats'));
const Sessions = lazy(() => import('./pages/Sessions'));
const SessionDetail = lazy(() => import('./pages/SessionDetail'));
const WebsiteSettings = lazy(() => import('./pages/WebsiteSettings'));
const Replays = lazy(() => import('./pages/Replays'));
const Heatmaps = lazy(() => import('./pages/Heatmaps'));
const Revenue = lazy(() => import('./pages/Revenue'));
const Performance = lazy(() => import('./pages/Performance'));
const WebsiteRealtime = lazy(() => import('./pages/WebsiteRealtime'));
const WebsiteEvents = lazy(() => import('./pages/WebsiteEvents'));
const WebsiteActions = lazy(() => import('./pages/WebsiteActions'));
const WebsiteBreakdown = lazy(() => import('./pages/WebsiteBreakdown'));
const WebsiteUtm = lazy(() => import('./pages/WebsiteUtm'));
const WebsiteAttribution = lazy(() => import('./pages/WebsiteAttribution'));
const WebsiteAnnotations = lazy(() => import('./pages/WebsiteAnnotations'));
const WebsiteFunnel = lazy(() => import('./pages/WebsiteFunnel'));
const WebsiteRetention = lazy(() => import('./pages/WebsiteRetention'));
const WebsiteStickiness = lazy(() => import('./pages/WebsiteStickiness'));
const WebsiteGoals = lazy(() => import('./pages/WebsiteGoals'));
const WebsiteJourneys = lazy(() => import('./pages/WebsiteJourneys'));
const WebsiteSegments = lazy(() => import('./pages/WebsiteSegments'));
const WebsiteCohorts = lazy(() => import('./pages/WebsiteCohorts'));
const WebsitePeople = lazy(() => import('./pages/WebsitePeople'));
const WebsiteGroups = lazy(() => import('./pages/WebsiteGroups'));
const WebsiteCompare = lazy(() => import('./pages/WebsiteCompare'));
const WebsiteShareLinks = lazy(() => import('./pages/WebsiteShareLinks'));
const WebsiteErrors = lazy(() => import('./pages/WebsiteErrors'));
const WebsiteErrorDetail = lazy(() => import('./pages/WebsiteErrorDetail'));
const WebsiteAiObservability = lazy(() => import('./pages/WebsiteAiObservability'));
const WebsiteLogs = lazy(() => import('./pages/WebsiteLogs'));
const WebsiteExperiments = lazy(() => import('./pages/WebsiteExperiments'));
const WebsiteFeatureFlags = lazy(() => import('./pages/WebsiteFeatureFlags'));
const WebsiteSurveys = lazy(() => import('./pages/WebsiteSurveys'));
const WebsiteWorkflows = lazy(() => import('./pages/WebsiteWorkflows'));
const WebsiteWarehouse = lazy(() => import('./pages/WebsiteWarehouse'));
const WebsiteAuditLog = lazy(() => import('./pages/WebsiteAuditLog'));
const Billing = lazy(() => import('./pages/Billing'));

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LazyRouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <div className="app-root">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/features" element={<Features />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/share/:slug" element={<SharePublic />} />
        <Route element={<AppShell />}>
          <Route
            path="/dashboard"
            element={
              <LazyPage>
                <DashboardHome />
              </LazyPage>
            }
          />
          <Route
            path="/websites"
            element={
              <LazyPage>
                <Websites />
              </LazyPage>
            }
          />
          <Route
            path="/teams"
            element={
              <LazyPage>
                <Teams />
              </LazyPage>
            }
          />
          <Route
            path="/links"
            element={
              <LazyPage>
                <LinksPixels />
              </LazyPage>
            }
          />
          <Route
            path="/links/analytics"
            element={
              <LazyPage>
                <LinkAnalytics />
              </LazyPage>
            }
          />
          <Route
            path="/reports"
            element={
              <LazyPage>
                <Reports />
              </LazyPage>
            }
          />
          <Route
            path="/insights"
            element={
              <LazyPage>
                <Insights />
              </LazyPage>
            }
          />
          <Route
            path="/boards"
            element={
              <LazyPage>
                <Boards />
              </LazyPage>
            }
          />
          <Route
            path="/billing"
            element={
              <LazyPage>
                <Billing />
              </LazyPage>
            }
          />
          <Route
            path="/admin"
            element={
              <LazyPage>
                <Admin />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId"
            element={
              <LazyPage>
                <WebsiteShell />
              </LazyPage>
            }
          >
            <Route
              index
              element={
                <LazyPage>
                  <WebsiteStats />
                </LazyPage>
              }
            />
            <Route
              path="sessions"
              element={
                <LazyPage>
                  <Sessions />
                </LazyPage>
              }
            />
            <Route
              path="sessions/:sessionId"
              element={
                <LazyPage>
                  <SessionDetail />
                </LazyPage>
              }
            />
            <Route
              path="settings"
              element={
                <LazyPage>
                  <WebsiteSettings />
                </LazyPage>
              }
            />
            <Route
              path="share"
              element={
                <LazyPage>
                  <WebsiteShareLinks />
                </LazyPage>
              }
            />
            <Route
              path="replays"
              element={
                <LazyPage>
                  <Replays />
                </LazyPage>
              }
            />
            <Route
              path="heatmaps"
              element={
                <LazyPage>
                  <Heatmaps />
                </LazyPage>
              }
            />
            <Route
              path="revenue"
              element={
                <LazyPage>
                  <Revenue />
                </LazyPage>
              }
            />
            <Route
              path="performance"
              element={
                <LazyPage>
                  <Performance />
                </LazyPage>
              }
            />
            <Route
              path="realtime"
              element={
                <LazyPage>
                  <WebsiteRealtime />
                </LazyPage>
              }
            />
            <Route
              path="events"
              element={
                <LazyPage>
                  <WebsiteEvents />
                </LazyPage>
              }
            />
            <Route
              path="actions"
              element={
                <LazyPage>
                  <WebsiteActions />
                </LazyPage>
              }
            />
            <Route
              path="breakdown"
              element={
                <LazyPage>
                  <WebsiteBreakdown />
                </LazyPage>
              }
            />
            <Route
              path="utm"
              element={
                <LazyPage>
                  <WebsiteUtm />
                </LazyPage>
              }
            />
            <Route
              path="attribution"
              element={
                <LazyPage>
                  <WebsiteAttribution />
                </LazyPage>
              }
            />
            <Route
              path="annotations"
              element={
                <LazyPage>
                  <WebsiteAnnotations />
                </LazyPage>
              }
            />
            <Route
              path="funnel"
              element={
                <LazyPage>
                  <WebsiteFunnel />
                </LazyPage>
              }
            />
            <Route
              path="retention"
              element={
                <LazyPage>
                  <WebsiteRetention />
                </LazyPage>
              }
            />
            <Route
              path="stickiness"
              element={
                <LazyPage>
                  <WebsiteStickiness />
                </LazyPage>
              }
            />
            <Route
              path="goals"
              element={
                <LazyPage>
                  <WebsiteGoals />
                </LazyPage>
              }
            />
            <Route
              path="journeys"
              element={
                <LazyPage>
                  <WebsiteJourneys />
                </LazyPage>
              }
            />
            <Route
              path="segments"
              element={
                <LazyPage>
                  <WebsiteSegments />
                </LazyPage>
              }
            />
            <Route
              path="cohorts"
              element={
                <LazyPage>
                  <WebsiteCohorts />
                </LazyPage>
              }
            />
            <Route
              path="compare"
              element={
                <LazyPage>
                  <WebsiteCompare />
                </LazyPage>
              }
            />
            <Route
              path="errors"
              element={
                <LazyPage>
                  <WebsiteErrors />
                </LazyPage>
              }
            />
            <Route
              path="errors/:eventId"
              element={
                <LazyPage>
                  <WebsiteErrorDetail />
                </LazyPage>
              }
            />
            <Route
              path="logs"
              element={
                <LazyPage>
                  <WebsiteLogs />
                </LazyPage>
              }
            />
            <Route
              path="ai-observability"
              element={
                <LazyPage>
                  <WebsiteAiObservability />
                </LazyPage>
              }
            />
            <Route
              path="feature-flags"
              element={
                <LazyPage>
                  <WebsiteFeatureFlags />
                </LazyPage>
              }
            />
            <Route
              path="experiments"
              element={
                <LazyPage>
                  <WebsiteExperiments />
                </LazyPage>
              }
            />
            <Route
              path="surveys"
              element={
                <LazyPage>
                  <WebsiteSurveys />
                </LazyPage>
              }
            />
            <Route
              path="people"
              element={
                <LazyPage>
                  <WebsitePeople />
                </LazyPage>
              }
            />
            <Route
              path="groups"
              element={
                <LazyPage>
                  <WebsiteGroups />
                </LazyPage>
              }
            />
            <Route
              path="workflows"
              element={
                <LazyPage>
                  <WebsiteWorkflows />
                </LazyPage>
              }
            />
            <Route
              path="warehouse"
              element={
                <LazyPage>
                  <WebsiteWarehouse />
                </LazyPage>
              }
            />
            <Route
              path="audit"
              element={
                <LazyPage>
                  <WebsiteAuditLog />
                </LazyPage>
              }
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
