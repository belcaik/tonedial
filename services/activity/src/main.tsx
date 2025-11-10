import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDiscord } from './lib/discord';
import './styles.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

async function bootstrap() {
  try {
    const discord = await initDiscord();
    root.render(
      <React.StrictMode>
        <App discord={discord} />
      </React.StrictMode>,
    );
  } catch (error) {
    root.render(
      <React.StrictMode>
        <App fallbackError={(error as Error).message ?? 'Failed to initialize Discord SDK'} />
      </React.StrictMode>,
    );
  }
}

bootstrap();
