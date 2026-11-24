import * as Sentry from '@sentry/node';
import storageService from './services/StorageService.js';

const DEFAULT_DSN = 'https://0539cc69af07f295b1a95145be9fab8a@o4512196697128960.ingest.de.sentry.io/4512196703420496';
const TRACE_SAMPLE_RATE = 0.1;

let initialized = false;

function isTelemetryEnabled() {
  return !(storageService.settings && storageService.settings.telemetryEnabled === false);
}

// Sentry, düşürülen olayların sayısını "client report" zarfıyla ayrıca gönderir;
// telemetri kapalıyken bu zarf da sessizce kapatılmalı.
function syncClientReports(enabled) {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().sendClientReports = enabled;
  }
}

/**
 * Initializes Sentry for Node / Electron Main / Backend environments.
 * @param {Object} options
 * @param {string} [options.processName='backend'] - e.g. 'electron-main' or 'backend'
 * @param {string} [options.appVersion='1.6.8']
 * @param {string|null} [options.anonymousId=null]
 */
export function initSentry({ processName = 'backend', appVersion = '1.6.8', anonymousId = null } = {}) {
  if (initialized || Sentry.isInitialized()) {
    Sentry.setTag('process', processName);
    if (anonymousId) {
      Sentry.setUser({ id: anonymousId });
    }
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
      // Sentry v11 varsayılanı `traceLifecycle: 'stream'` olduğu için `beforeSendTransaction`
      // yok sayılır; örnekleme kararı ancak `tracesSampler` ile verilebilir.
      tracesSampler: () => (isTelemetryEnabled() ? TRACE_SAMPLE_RATE : 0),
      beforeSend(event) {
        const enabled = isTelemetryEnabled();
        syncClientReports(enabled);
        if (!enabled) {
          return null;
        }
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
    if (anonymousId) {
      Sentry.setUser({ id: anonymousId });
    }
    initialized = true;
  } catch (err) {
    console.error('Failed to initialize Sentry:', err);
  }

  return Sentry;
}

export function setAnonymousUser(anonymousId) {
  if (anonymousId) {
    Sentry.setUser({ id: anonymousId });
  }
}

export { Sentry };
