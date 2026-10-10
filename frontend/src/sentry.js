import * as Sentry from '@sentry/react';

const DEFAULT_DSN = 'https://0539cc69af07f295b1a95145be9fab8a@o4512196697128960.ingest.de.sentry.io/4512196703420496';

let initialized = false;

export function initFrontendSentry() {
  if (initialized || Sentry.isInitialized()) return Sentry;

  const dsn = import.meta.env.VITE_SENTRY_DSN || DEFAULT_DSN;
  const disabled = import.meta.env.VITE_SENTRY_DISABLED === 'true' || !dsn;

  if (disabled) return Sentry;

  try {
    Sentry.init({
      dsn,
      release: 'deepnode-download-manager@1.5.5',
      environment: import.meta.env.MODE || 'production',
      tracesSampleRate: 0.1,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      beforeSend(event) {
        // Sanitize breadcrumbs or sensitive data if any
        return event;
      }
    });

    Sentry.setTag('process', 'renderer');
    initialized = true;
  } catch (err) {
    console.error('Failed to initialize Frontend Sentry:', err);
  }

  return Sentry;
}

export { Sentry };
