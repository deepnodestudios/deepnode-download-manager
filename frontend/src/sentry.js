import * as Sentry from '@sentry/react';

const DEFAULT_DSN = 'https://0539cc69af07f295b1a95145be9fab8a@o4512196697128960.ingest.de.sentry.io/4512196703420496';

let initialized = false;
let isTelemetryEnabled = true;

export function setTelemetryEnabled(enabled) {
  isTelemetryEnabled = !!enabled;
}

export function initFrontendSentry() {
  if (initialized || Sentry.isInitialized()) return Sentry;

  const dsn = import.meta.env.VITE_SENTRY_DSN || DEFAULT_DSN;
  const disabled = import.meta.env.VITE_SENTRY_DISABLED === 'true' || !dsn;

  if (disabled) return Sentry;

  try {
    const appVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.6.1';
    Sentry.init({
      dsn,
      release: `deepnode-download-manager@${appVer}`,
      environment: import.meta.env.MODE || 'production',
      tracesSampleRate: 0.1,
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      beforeSend(event) {
        if (!isTelemetryEnabled) return null;
        return event;
      },
      beforeSendTransaction(event) {
        if (!isTelemetryEnabled) return null;
        return event;
      }
    });

    Sentry.setTag('process', 'renderer');

    // Restore cached anonymous ID from localStorage if available
    try {
      const cachedId = localStorage.getItem('ddm_anonymous_id');
      if (cachedId) {
        Sentry.setUser({ id: cachedId });
      }
    } catch (e) {}

    initialized = true;
  } catch (err) {
    console.error('Failed to initialize Frontend Sentry:', err);
  }

  return Sentry;
}

export function setAnonymousUser(anonymousId) {
  if (!anonymousId) return;
  try {
    localStorage.setItem('ddm_anonymous_id', anonymousId);
  } catch (e) {}
  Sentry.setUser({ id: anonymousId });
}

export { Sentry };
