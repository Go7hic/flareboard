import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ConfirmProvider } from './components/ConfirmDialog';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { ApiError } from './lib/api';
import { initTheme } from './lib/theme';
import { initFlareboardTracking } from './lib/tracking';
import './styles/global.css';
import './styles/console.css';
import './styles/pages/traffic.css';
import './styles/pages/behavior.css';
import './styles/pages/audience.css';
import './styles/pages/product.css';
import './styles/pages/quality.css';
import './styles/pages/workspace.css';

initTheme();
initFlareboardTracking();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // 4xx (bad id, no access, expired session) will not succeed on retry.
        if (error instanceof ApiError && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConfirmProvider>
          {/* Last resort for eager routes; lazy routes have their own boundary in App. */}
          <RouteErrorBoundary>
            <App />
          </RouteErrorBoundary>
        </ConfirmProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
