import * as Sentry from '@sentry/node';

const DEFAULT_DSN = 'https://0539cc69af07f295b1a95145be9fab8a@o4512196697128960.ingest.de.sentry.io/4512196703420496';

let initialized = false;

/**
 * Initializes Sentry for Node / Electron Main / Backend environments.
 * @param {Object} options
 * @param {string} [options.processName='backend'] - e.g. 'electron-main' or 'backend'
 * @param {string} [options.appVersion='1.5.5']
 */
export function initSentry({ processName = 'backend', appVersion = '1.5.5' } = {}) {
  if (initialized || Sentry.isInitialized()) {
    Sentry.setTag('process', processName);
    return Sentry;
  }

  const dsn = process.env.SENTRY_DSN || DEFAULT_DSN;
  const disabled = process.env.SENTRY_DISABLED === 'true' || !dsn;

  if (disabled) {
    return Sentry;
  }

  try {
    Sentry.init({
      dsn,
      release: `deepnode-download-manager@${appVersion}`,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.1,
      beforeSend(event) {
        // Sanitize sensitive fields if present in error context
        if (event.request?.headers) {
          delete event.request.headers['cookie'];
          delete event.request.headers['authorization'];
        }
        return event;
      }
    });

    Sentry.setTag('process', processName);
    Sentry.setTag('platform', process.platform);
    Sentry.setTag('arch', process.arch);
    initialized = true;
  } catch (err) {
    console.error('Failed to initialize Sentry:', err);
  }

  return Sentry;
}

export { Sentry };
