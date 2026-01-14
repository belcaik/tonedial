import React from 'react';
import type { ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[Discord Activity Error]', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="app-shell">
          <header>
            <h1>ToneDial Roulette</h1>
          </header>
          <section className="panel">
            <h2>Something Went Wrong</h2>
            <p>The Discord Activity encountered an error and could not load properly.</p>
            {this.state.error && (
              <div className="status-banner warning">
                <strong>Error:</strong> {this.state.error.message}
              </div>
            )}
            <button onClick={() => window.location.reload()}>Reload Activity</button>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}
