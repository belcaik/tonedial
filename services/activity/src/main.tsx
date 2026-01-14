import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initDiscord } from './lib/discord';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

async function bootstrap() {
  console.log('[Bootstrap] Starting Discord Activity initialization...');
  try {
    const discord = await initDiscord();
    console.log('[Bootstrap] Discord SDK initialized successfully');
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App discord={discord} />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    console.error('[Bootstrap] Failed to initialize Discord SDK:', error);
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <App fallbackError={(error as Error).message ?? 'Failed to initialize Discord SDK'} />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  }
}

bootstrap();
