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

function minutesSinceMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return -1;
  const parts = timeStr.split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return -1;
  return parts[0] * 60 + parts[1];
}

function isTimeToTrigger(targetTimeStr, now) {
  const targetMin = parseHHMM(targetTimeStr);
  if (targetMin < 0) return false;
  const currentMin = minutesSinceMidnight(now);
  const diff = currentMin - targetMin;
  return diff >= 0 && diff <= 2;
}

function isTodayEnabled(s, now) {
  const days = Array.isArray(s.days || s.scheduleDays) ? (s.days || s.scheduleDays) : [0, 1, 2, 3, 4, 5, 6];
  return days.map(Number).includes(now.getDay());
}

function tick(onEvent) {
  const s = storageService.settings;
  const queues = storageService.getQueues();
  const now = new Date();

  // 1. Global / Legacy Scheduler
  if (s.schedulerEnabled && isTodayEnabled(s, now)) {
    if (s.scheduleStartTime && isTimeToTrigger(s.scheduleStartTime, now)) {
      const st = stamp(now, s.scheduleStartTime);
      if (lastFired.start !== st) {
        lastFired.start = st;
        try { queueManager.startAll(); } catch (e) { /* ignore */ }
        if (onEvent) onEvent('start');
      }
    }

    if (s.scheduleStopTime && isTimeToTrigger(s.scheduleStopTime, now)) {
      const st = stamp(now, s.scheduleStopTime);
      if (lastFired.stop !== st) {
        lastFired.stop = st;
        try { queueManager.pauseAll(); } catch (e) { /* ignore */ }
        const afterAction = s.schedulerAfterStop || s.afterAllComplete || 'nothing';
        if (onEvent) onEvent('stop', afterAction);
      }
    }
  }

  // 2. Per-Queue Independent Schedulers
  if (Array.isArray(queues)) {
    queues.forEach((q) => {
      if (!q.schedulerEnabled) return;
      if (!isTodayEnabled(q, now)) return;

      const qKey = `queue_${q.id}`;
      if (!lastFired[qKey]) lastFired[qKey] = { start: '', stop: '' };

      if (q.startTime && isTimeToTrigger(q.startTime, now)) {
        const st = stamp(now, q.startTime);
        if (lastFired[qKey].start !== st) {
          lastFired[qKey].start = st;
          try { queueManager.startQueue(q.id); } catch (e) { /* ignore */ }
          if (onEvent) onEvent('start', null, q.id);
        }
      }

      if (q.stopTime && isTimeToTrigger(q.stopTime, now)) {
        const st = stamp(now, q.stopTime);
        if (lastFired[qKey].stop !== st) {
          lastFired[qKey].stop = st;
          try { queueManager.pauseQueue(q.id); } catch (e) { /* ignore */ }
          if (q.afterStop && q.afterStop !== 'nothing') {
            if (onEvent) onEvent('stop', q.afterStop, q.id);
          }
        }
      }
    });
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
