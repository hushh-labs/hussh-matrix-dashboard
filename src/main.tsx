import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary.tsx';
import {recoverCurrentStaleChunk} from './lib/stale-chunk-recovery';
import './index.css';

window.addEventListener('vite:preloadError', (event) => {
  if (recoverCurrentStaleChunk((event as Event & { payload?: unknown }).payload)) event.preventDefault();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
