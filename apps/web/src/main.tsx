import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { startServiceWorker } from './sw/register.ts';
import { startup, type StartupHost } from './startup.ts';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/global.css';

// Guards first, before anything can create a worker or receive a drop (spec §11.2, §11.3).
void startup({ window: window as unknown as StartupHost['window'] });
// Offline use and the update prompt, in production builds only (spec §11.5).
void startServiceWorker(import.meta.env.PROD);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
