// Self-hosted fonts (bundled, never a runtime CDN fetch): Discord's Activity
// iframe CSP blocks external font origins.
import '@fontsource/alfa-slab-one/400.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './app/ErrorBoundary';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    {/* Last line of defence: nothing that throws while rendering leaves a blank frame. */}
    <ErrorBoundary layout="screen">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
