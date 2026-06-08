import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LazyRouteFallback } from './components/LazyRouteFallback';
import Features from './pages/Features';
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
const Boards = lazy(() => import('./pages/Boards'));
const Admin = lazy(() => import('./pages/Admin'));
const WebsiteStats = lazy(() => import('./pages/WebsiteStats'));
const Sessions = lazy(() => import('./pages/Sessions'));
const SessionDetail = lazy(() => import('./pages/SessionDetail'));
const WebsiteSettings = lazy(() => import('./pages/WebsiteSettings'));
const Replays = lazy(() => import('./pages/Replays'));
const Heatmaps = lazy(() => import('./pages/Heatmaps'));
const Revenue = lazy(() => import('./pages/Revenue'));
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
                <WebsiteStats />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/sessions"
            element={
              <LazyPage>
                <Sessions />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/sessions/:sessionId"
            element={
              <LazyPage>
                <SessionDetail />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/settings"
            element={
              <LazyPage>
                <WebsiteSettings />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/replays"
            element={
              <LazyPage>
                <Replays />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/heatmaps"
            element={
              <LazyPage>
                <Heatmaps />
              </LazyPage>
            }
          />
          <Route
            path="/websites/:websiteId/revenue"
            element={
              <LazyPage>
                <Revenue />
              </LazyPage>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
