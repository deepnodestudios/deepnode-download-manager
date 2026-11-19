import * as Sentry from '@sentry/react';

const DEFAULT_DSN = 'https://0539cc69af07f295b1a95145be9fab8a@o4512196697128960.ingest.de.sentry.io/4512196703420496';
const TRACE_SAMPLE_RATE = 0.1;
const TELEMETRY_CACHE_KEY = 'ddm_telemetry_enabled';

let initialized = false;

function readCachedTelemetry() {
  try {
    const cached = localStorage.getItem(TELEMETRY_CACHE_KEY);
    return cached === null ? null : cached === 'true';
  } catch (e) {
    return null;
  }
}

// Ayar sunucudan gelene kadar önceki tercih kullanılır; aksi halde telemetriyi
// kapatan kullanıcı için açılış işlemi örneklenebilirdi.
let isTelemetryEnabled = readCachedTelemetry() ?? true;

// Sentry, düşürülen olayların sayısını "client report" zarfıyla ayrıca gönderir;
// telemetri kapalıyken bu zarf da sessizce kapatılmalı.
function syncClientReports(enabled) {
  const client = Sentry.getClient();
  if (client) {
    client.getOptions().sendClientReports = enabled;
  }
}

export function setTelemetryEnabled(enabled) {
  isTelemetryEnabled = !!enabled;
  syncClientReports(isTelemetryEnabled);
  try {
    localStorage.setItem(TELEMETRY_CACHE_KEY, isTelemetryEnabled ? 'true' : 'false');
  } catch (e) {}
}

export function initFrontendSentry() {
  if (initialized || Sentry.isInitialized()) return Sentry;

  const dsn = import.meta.env.VITE_SENTRY_DSN || DEFAULT_DSN;
  const disabled = import.meta.env.VITE_SENTRY_DISABLED === 'true' || !dsn;

  if (disabled) return Sentry;

  try {
    const appVer = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.6.7';
    Sentry.init({
      dsn,
      release: `deepnode-download-manager@${appVer}`,
      environment: import.meta.env.MODE || 'production',
      // Sentry v11 varsayılanı `traceLifecycle: 'stream'` olduğu için `beforeSendTransaction`
      // yok sayılır; örnekleme kararı ancak `tracesSampler` ile verilebilir.
      tracesSampler: () => (isTelemetryEnabled ? TRACE_SAMPLE_RATE : 0),
      integrations: [
        Sentry.browserTracingIntegration(),
      ],
      beforeSend(event) {
        if (!isTelemetryEnabled) return null;
        return event;
      }
    });

    syncClientReports(isTelemetryEnabled);

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
