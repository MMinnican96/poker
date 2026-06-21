// Self-hosted fonts (bundled, not a runtime CDN fetch) so the chunky display
// type renders reliably offline, behind privacy blockers, and inside Discord's
// CSP-restricted Activity iframe. Variable fonts cover all weights we use.
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
