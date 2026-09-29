import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { WebsiteShell } from './components/WebsiteShell';
import { LazyRouteFallback } from './components/LazyRouteFallback';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import Features from './pages/Features';
import Compare from './pages/Compare';
import Landing from './pages/Landing';
import Pricing from './pages/Pricing';
import Login from './pages/Login';
import Register from './pages/Register';

const SharePublic = lazy(() => import('./pages/SharePublic'));
const HostedSurvey = lazy(() => import('./pages/HostedSurvey'));
const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const Demo = lazy(() => import('./pages/Demo'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Terms = lazy(() => import('./pages/Terms'));
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
const WebsiteErrorIssue = lazy(() => import('./pages/WebsiteErrorIssue'));
const WebsiteAiObservability = lazy(() => import('./pages/WebsiteAiObservability'));
const WebsiteLogs = lazy(() => import('./pages/WebsiteLogs'));
const WebsiteExperiments = lazy(() => import('./pages/WebsiteExperiments'));
const WebsiteFeatureFlags = lazy(() => import('./pages/WebsiteFeatureFlags'));
const WebsiteSurveys = lazy(() => import('./pages/WebsiteSurveys'));
const WebsiteWorkflows = lazy(() => import('./pages/WebsiteWorkflows'));
const WebsiteWarehouse = lazy(() => import('./pages/WebsiteWarehouse'));
const WebsiteAuditLog = lazy(() => import('./pages/WebsiteAuditLog'));
const Billing = lazy(() => import('./pages/Billing'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));

function LazyPage({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // Inside the shell, so a failed page keeps the sidebar and can be navigated away from.
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<LazyRouteFallback />}>{children}</Suspense>
    </RouteErrorBoundary>
  );
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
        <Route
          path="/share/:slug"
          element={
            <LazyPage>
              <SharePublic />
            </LazyPage>
          }
        />
        <Route
          path="/s/:key"
          element={
            <LazyPage>
              <HostedSurvey />
            </LazyPage>
          }
        />
        <Route
          path="/demo"
          element={
            <LazyPage>
              <Demo />
            </LazyPage>
          }
        />
        <Route
          path="/privacy"
          element={
            <LazyPage>
              <Privacy />
            </LazyPage>
          }
        />
        <Route
          path="/terms"
          element={
            <LazyPage>
              <Terms />
            </LazyPage>
          }
        />
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
            path="/api-keys"
            element={
              <LazyPage>
                <ApiKeys />
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
              path="errors/issues/:fingerprint"
              element={
                <LazyPage>
                  <WebsiteErrorIssue />
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
