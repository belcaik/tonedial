import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDiscord } from './lib/discord';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

/**
 * Categorize Discord SDK initialization errors to provide user-friendly messages.
 */
function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // Configuration errors - missing client ID
  if (message.includes('VITE_DISCORD_CLIENT_ID') || message.includes('cid')) {
    return 'Discord Activity configuration error: Missing client ID. Please ensure VITE_DISCORD_CLIENT_ID is set.';
  }

  // Environment errors - server-side or non-browser
  if (message.includes('only available in the browser')) {
    return 'Discord Activity must run in a browser environment.';
  }

  // SDK initialization errors - ready() timeout or failure
  if (message.includes('ready') || message.includes('timeout')) {
    return 'Discord SDK failed to initialize. Please ensure this Activity is launched from within Discord.';
  }

  // Network/connection errors
  if (message.includes('network') || message.includes('fetch') || message.includes('connect')) {
    return 'Network error connecting to Discord. Please check your connection and try again.';
  }

  // SDK not initialized errors
  if (message.includes('not initialized')) {
    return 'Discord SDK not properly initialized. Please refresh the Activity.';
  }

  // Default fallback with original message for debugging
  return message || 'Failed to initialize Discord SDK. Please try launching the Activity again from Discord.';
}

async function bootstrap() {
  try {
    const discord = await initDiscord();
    root.render(
      <React.StrictMode>
        <App discord={discord} />
      </React.StrictMode>,
    );
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    root.render(
      <React.StrictMode>
        <App fallbackError={errorMessage} />
      </React.StrictMode>,
    );
  }
}

bootstrap();
