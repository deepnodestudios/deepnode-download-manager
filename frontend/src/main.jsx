import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './theme.css';
import './dark.css';
import { initFrontendSentry, Sentry } from './sentry';

initFrontendSentry();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ error }) => (
        <div style={{ padding: '32px', color: '#ff6b6b', background: '#0b0f19', minHeight: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '8px', color: '#f87171' }}>Bir sorun oluştu / Something went wrong</h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '16px' }}>{error?.message || 'Beklenmeyen bir arayüz hatası meydana geldi.'}</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            Yeniden Yükle / Reload
          </button>
        </div>
      )}
    >
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
