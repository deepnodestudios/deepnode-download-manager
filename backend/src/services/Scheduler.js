// Zamanlayıcı: belirlenen saatte kuyruğu başlatır, belirlenen saatte duraklatır.
// Dakikada bir kontrol eder; aynı olayı gün içinde tekrar tetiklemez.
import storageService from './StorageService.js';
import queueManager from './QueueManager.js';

let timer = null;
let lastFired = { start: '', stop: '' }; // "YYYY-MM-DD HH:MM" damgası

function hhmm(d) {
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function stamp(d, time) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${time}`;
}

function isTodayEnabled(s, now) {
  const days = Array.isArray(s.scheduleDays) ? s.scheduleDays : [0, 1, 2, 3, 4, 5, 6];
  return days.map(Number).includes(now.getDay());
}

function tick(onEvent) {
  const s = storageService.settings;
  if (!s.schedulerEnabled) return;

  const now = new Date();
  if (!isTodayEnabled(s, now)) return;

  const cur = hhmm(now);

  if (s.scheduleStartTime && cur === s.scheduleStartTime) {
    const st = stamp(now, cur);
    if (lastFired.start !== st) {
      lastFired.start = st;
      try { queueManager.startAll(); } catch (e) { /* ignore */ }
      if (onEvent) onEvent('start');
    }
  }

  if (s.scheduleStopTime && cur === s.scheduleStopTime) {
    const st = stamp(now, cur);
    if (lastFired.stop !== st) {
      lastFired.stop = st;
      try { queueManager.pauseAll(); } catch (e) { /* ignore */ }
      if (onEvent) onEvent('stop');
    }
  }
}

export function startScheduler(onEvent) {
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick(onEvent), 30 * 1000); // 30 sn'de bir kontrol
  tick(onEvent);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

// Arayüzde "sıradaki çalışma" bilgisini göstermek için
export function schedulerStatus() {
  const s = storageService.settings;
  return {
    enabled: !!s.schedulerEnabled,
    startTime: s.scheduleStartTime || '',
    stopTime: s.scheduleStopTime || '',
    days: s.scheduleDays || [],
    lastFired
  };
}
