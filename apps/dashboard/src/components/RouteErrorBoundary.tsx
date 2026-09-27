import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/button';
import { t } from '../lib/i18n';

type Props = {
  children: ReactNode;
  /** Clears the error when it changes (e.g. the route path), so navigation recovers. */
  resetKey?: string;
};

type State = { error: Error | null };

/**
 * Keeps one failing page (render error, or a lazy chunk that 404s after a deploy)
 * from unmounting the whole app.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route failed to render', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="route-error" role="alert">
        <h1 className="route-error-title">{t('errorBoundaryTitle')}</h1>
        <p className="route-error-body">{t('errorBoundaryBody')}</p>
        <Button variant="primary" onClick={() => window.location.reload()}>
          {t('errorBoundaryReload')}
        </Button>
      </div>
    );
  }
}
