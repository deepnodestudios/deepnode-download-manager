import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import storageService from './StorageService.js';
import { proxyAgent, authHeaderFor } from './NetworkConfig.js';

// ---- Global bandwidth limiter (shared by ALL downloads) ----
// The configured limit is a TOTAL cap: 3 concurrent downloads share one budget.
const GLOBAL_BW = { windowStart: Date.now(), bytes: 0, paused: new Set(), active: new Set(), timer: null };

function globalLimitBytesPerSec() {
  const kbps = storageService.settings.globalSpeedLimitKbps || 0;
  return kbps > 0 ? kbps * 1024 : 0;
}

function bwResumeAll() {
  GLOBAL_BW.paused.forEach((s) => { try { s.resume(); } catch (e) { /* ignore */ } });
  GLOBAL_BW.paused.clear();
}

function bwConsume(bytes, res) {
  const limit = globalLimitBytesPerSec();
  if (!limit) return;

  const now = Date.now();
  if (now - GLOBAL_BW.windowStart >= 1000) {
    // Carry the overshoot into the next window (socket buffers always deliver a
    // bit past the pause), so the long-run average matches the configured cap.
    GLOBAL_BW.bytes = Math.max(0, GLOBAL_BW.bytes - limit);
    GLOBAL_BW.windowStart = now;
    bwResumeAll();
  }

  GLOBAL_BW.bytes += bytes;

  if (GLOBAL_BW.bytes >= limit) {
    // Pause EVERY active stream, not just the one that crossed the budget —
    // otherwise each concurrent download overshoots by one chunk (n × limit).
    GLOBAL_BW.active.forEach((s) => {
      if (!GLOBAL_BW.paused.has(s)) {
        try { s.pause(); } catch (e) { /* ignore */ }
        GLOBAL_BW.paused.add(s);
      }
    });
    if (!GLOBAL_BW.paused.has(res)) {
      try { res.pause(); } catch (e) { /* ignore */ }
      GLOBAL_BW.paused.add(res);
    }
    if (!GLOBAL_BW.timer) {
      const delay = Math.max(5, 1000 - (now - GLOBAL_BW.windowStart) + 5);
      GLOBAL_BW.timer = setTimeout(() => {
        GLOBAL_BW.timer = null;
        GLOBAL_BW.bytes = Math.max(0, GLOBAL_BW.bytes - globalLimitBytesPerSec());
        GLOBAL_BW.windowStart = Date.now();
        bwResumeAll();
      }, delay);
    }
  }
}

// Retry count / timeout come from Settings (read live so changes apply at once)
function maxSegmentRetries() {
  const n = parseInt(storageService.settings.maxRetries, 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}
function connectionTimeoutMs() {
  const n = parseInt(storageService.settings.connectionTimeoutSec, 10);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 1000;
}

export class DownloadEngine extends EventEmitter {
  constructor(item, options = {}) {
    super();
    this.id = item.id;
    this.url = item.url;
    this.filename = item.filename;
    this.saveDir = item.saveDir || path.join(storageService.settings.downloadDir, item.category || 'General');
    this.segmentsCount = item.segmentsCount || storageService.settings.defaultSegments || 8;
    this.speedLimitKbps = item.speedLimitKbps || storageService.settings.globalSpeedLimitKbps || 0;
    
    this.savePath = path.join(this.saveDir, this.filename);
    this.tempDir = path.join(this.saveDir, `.tmp_${this.id}`);
    
    this.status = item.status || 'queued'; // queued, downloading, paused, completed, error
    this.totalSize = item.totalSize || 0;
    this.downloadedBytes = item.downloadedBytes || 0;

    // Browser session headers (cookies / referer / UA) so protected links work
    this.headers = item.headers || {};
    this.priority = item.priority || 'normal'; // high | normal | low
    this.preflight = item.preflight || false; // IDM ön indirmesi: onaylanana dek gizli

    // Restore segments. Older snapshots (and crashes) may lack tempFilePath, so
    // rebuild it deterministically and trust the bytes actually present on disk.
    this.segments = (item.segments || []).map((s) => ({
      ...s,
      tempFilePath: s.tempFilePath || path.join(this.tempDir, `part_${s.id}.tmp`)
    }));
    this.segments.forEach((s) => {
      let onDisk = 0;
      try { onDisk = fs.statSync(s.tempFilePath).size; } catch (e) { onDisk = 0; }
      if (s.total > 0 && onDisk > s.total) onDisk = s.total;
      s.downloaded = onDisk;
      s.completed = s.total > 0 ? onDisk >= s.total : Boolean(s.completed);
    });
    if (this.segments.length > 0) {
      this.downloadedBytes = this.segments.reduce((a, s) => a + (s.downloaded || 0), 0);
    }

    this.speed = 0;
    this.eta = 0;
    this.checksum = item.checksum || null;

    this.activeRequests = [];
    this.intervalTimer = null;
    this.lastDownloadedBytes = 0;
    this.lastSpeedCheck = Date.now();
  }

  // Request headers for this download: browser session (cookies/referer/UA) if
  // captured, otherwise a sane default UA.
  buildHeaders(extra = {}) {
    const h = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DeepNode/1.0',
      ...this.headers,
      ...extra
    };
    // Ayarlarda bu site için kullanıcı adı/şifre varsa ekle
    if (!h.Authorization && !h.authorization) {
      const auth = authHeaderFor(this.url);
      if (auth) h.Authorization = auth;
    }
    return h;
  }

  ensureTempDir() {
    if (!fs.existsSync(this.saveDir)) {
      fs.mkdirSync(this.saveDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  static async inspectUrl(downloadUrl, extraHeaders = {}) {
    return new Promise((resolve) => {
      try {
        const u = new URL(downloadUrl);
        const protocol = u.protocol === 'https:' ? https : http;

        const reqHeaders = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DeepNode/1.0',
          ...(extraHeaders || {})
        };
        if (!reqHeaders.Authorization) {
          const auth = authHeaderFor(downloadUrl);
          if (auth) reqHeaders.Authorization = auth;
        }

        const agent = proxyAgent();
        const reqOpts = { method: 'HEAD', headers: reqHeaders };
        if (agent) reqOpts.agent = agent;

        const req = protocol.request(downloadUrl, reqOpts, (res) => {
          let filename = path.basename(u.pathname) || 'downloaded_file';
          
          // Try Content-Disposition
          const cd = res.headers['content-disposition'];
          if (cd) {
            const filenameMatch = cd.match(/filename\*?=['"]?(?:UTF-8''|")?([^'";]+)/i);
            if (filenameMatch && filenameMatch[1]) {
              filename = decodeURIComponent(filenameMatch[1]);
            }
          }

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          const acceptRanges = res.headers['accept-ranges'] === 'bytes' || Boolean(res.headers['content-range']);
          const contentType = res.headers['content-type'] || '';

          resolve({
            url: downloadUrl,
            filename,
            totalSize: contentLength,
            acceptRanges,
            contentType,
            category: storageService.getCategoryForFilename(filename, contentType)
          });
        });

        req.on('error', () => {
          // Fallback if HEAD fails
          const filename = path.basename(new URL(downloadUrl).pathname) || 'downloaded_file';
          resolve({
            url: downloadUrl,
            filename,
            totalSize: 0,
            acceptRanges: false,
            contentType: '',
            category: storageService.getCategoryForFilename(filename)
          });
        });

        req.setTimeout(5000, () => {
          req.destroy();
        });

        req.end();
      } catch (err) {
        resolve({
          url: downloadUrl,
          filename: 'downloaded_file',
          totalSize: 0,
          acceptRanges: false,
          contentType: '',
          category: 'General'
        });
      }
    });
  }

  async start() {
    if (this.status === 'downloading') return;
    this.status = 'downloading';
    this.ensureTempDir();

    this.emit('status-change', { id: this.id, status: this.status });

    try {
      // If total size unknown or segments not set up, initialize
      if (this.totalSize === 0 || this.segments.length === 0) {
        const info = await DownloadEngine.inspectUrl(this.url, this.headers);
        this.totalSize = info.totalSize;
        
        if (info.filename && !this.filename) {
          this.filename = info.filename;
          this.savePath = path.join(this.saveDir, this.filename);
        }

        const canSplit = info.acceptRanges && this.totalSize > 1024 * 1024; // > 1MB
        const segCount = canSplit ? this.segmentsCount : 1;

        const chunkSize = Math.floor(this.totalSize / segCount);
        this.segments = [];

        for (let i = 0; i < segCount; i++) {
          const start = i * chunkSize;
          const end = i === segCount - 1 ? this.totalSize - 1 : (i + 1) * chunkSize - 1;
          this.segments.push({
            id: i,
            startByte: start,
            endByte: end,
            downloaded: 0,
            total: end - start + 1,
            completed: false,
            tempFilePath: path.join(this.tempDir, `part_${i}.tmp`)
          });
        }
      }

      this.startSpeedTracker();

      // Launch segment downloads concurrently
      const downloadPromises = this.segments.map((segment) => this.downloadSegment(segment));
      await Promise.all(downloadPromises);

      if (this.status === 'downloading') {
        await this.mergeSegments();
      }
    } catch (err) {
      if (this.status === 'downloading') {
        this.status = 'error';
        this.errorMsg = err.message;
        this.stopSpeedTracker();
        this.emit('error', { id: this.id, error: err.message });
      }
    }
  }

  // Retries a segment on network errors / premature stream close, resuming from
  // the bytes already written to disk (auto reconnect).
  async downloadSegment(segment) {
    let lastError = null;
    const maxRetries = maxSegmentRetries();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.status !== 'downloading') return;
      if (segment.completed) return;

      try {
        await this.attemptSegment(segment);

        // Verify completeness: a stream can end early without an error
        if (segment.total > 0 && segment.downloaded < segment.total) {
          throw new Error('Connection closed early (incomplete data)');
        }
        segment.completed = true;
        return;
      } catch (err) {
        lastError = err;
        if (this.status !== 'downloading') return; // paused/cancelled: not an error

        if (attempt < maxRetries) {
          const waitMs = Math.min(15000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s,8s,15s
          this.emit('retry', { id: this.id, segmentId: segment.id, attempt: attempt + 1, error: err.message });
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }

    throw lastError || new Error('Could not download segment');
  }

  attemptSegment(segment) {
    return new Promise((resolve, reject) => {
      // Always resume from what is actually on disk
      let onDisk = 0;
      try { onDisk = fs.statSync(segment.tempFilePath).size; } catch (e) { onDisk = 0; }
      if (segment.total > 0 && onDisk > segment.total) onDisk = segment.total;
      segment.downloaded = onDisk;

      const segmentStart = segment.startByte + segment.downloaded;
      const segmentEnd = segment.endByte;

      if (segment.total > 0 && segment.downloaded >= segment.total) {
        segment.completed = true;
        return resolve();
      }

      if (segmentStart > segmentEnd && segment.total > 0) {
        segment.completed = true;
        return resolve();
      }

      const u = new URL(this.url);
      const protocol = u.protocol === 'https:' ? https : http;

      const headers = this.buildHeaders();

      if (this.totalSize > 0 && this.segments.length > 1) {
        headers['Range'] = `bytes=${segmentStart}-${segmentEnd}`;
      } else if (segment.downloaded > 0) {
        // single-segment resume
        headers['Range'] = `bytes=${segmentStart}-`;
      }

      const agent = proxyAgent(); // Ayarlar > Proxy açıksa kullanılır
      const req = protocol.get(this.url, agent ? { headers, agent } : { headers }, (res) => {
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          return reject(new Error(`Server responded with status code ${res.statusCode}`));
        }

        const writeStream = fs.createWriteStream(segment.tempFilePath, {
          flags: segment.downloaded > 0 ? 'a' : 'w'
        });

        // Register with the global bandwidth limiter
        GLOBAL_BW.active.add(res);
        const unregister = () => { GLOBAL_BW.active.delete(res); GLOBAL_BW.paused.delete(res); };

        let settled = false;
        const fail = (err) => {
          if (settled) return;
          settled = true;
          unregister();
          try { writeStream.destroy(); } catch (e) { /* ignore */ }
          reject(err);
        };

        res.on('data', (chunk) => {
          if (this.status !== 'downloading') {
            unregister();
            req.destroy();
            try { writeStream.end(); } catch (e) { /* ignore */ }
            return;
          }

          segment.downloaded += chunk.length;
          this.downloadedBytes += chunk.length;
          writeStream.write(chunk);

          // Global hız sınırı: toplam bütçe dolunca akışı duraklat
          bwConsume(chunk.length, res);
        });

        res.on('end', () => {
          if (settled) return;
          unregister();
          // Wait for the file to be flushed before reporting success
          writeStream.end(() => {
            if (settled) return;
            settled = true;
            resolve();
          });
        });

        res.on('aborted', () => fail(new Error('Connection lost (aborted)')));
        res.on('error', (err) => fail(err));
        writeStream.on('error', (err) => fail(err));
      });

      req.on('error', (err) => {
        if (this.status === 'downloading') {
          reject(err);
        } else {
          resolve(); // paused/cancelled by user
        }
      });

      const timeoutMs = connectionTimeoutMs();
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s no response)`));
      });

      this.activeRequests.push(req);
    });
  }

  async mergeSegments() {
    this.status = 'merging';
    this.emit('status-change', { id: this.id, status: 'merging' });

    const finalStream = fs.createWriteStream(this.savePath);

    // Segmentleri sırayla stream ile birleştir (belleğe tümünü okumadan)
    for (const segment of this.segments) {
      if (fs.existsSync(segment.tempFilePath)) {
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(segment.tempFilePath);
          readStream.on('error', reject);
          readStream.on('end', resolve);
          readStream.pipe(finalStream, { end: false });
        });
      }
    }

    // Yazma tamamlanana kadar bekle
    await new Promise((resolve, reject) => {
      finalStream.on('finish', resolve);
      finalStream.on('error', reject);
      finalStream.end();
    });

    // Clean up temporary segment files
    try {
      if (fs.existsSync(this.tempDir)) {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      }
    } catch (e) {
      console.error('Failed to cleanup temp dir:', e.message);
    }

    // Compute checksum
    try {
      this.checksum = await this.calculateFileChecksum(this.savePath);
    } catch (e) {
      this.checksum = 'N/A';
    }

    this.status = 'completed';
    this.percent = 100;
    if (this.totalSize > 0) {
      this.downloadedBytes = this.totalSize;
    } else if (this.savePath && fs.existsSync(this.savePath)) {
      const sz = fs.statSync(this.savePath).size;
      this.totalSize = sz;
      this.downloadedBytes = sz;
    }
    this.speed = 0;
    this.eta = 0;
    this.stopSpeedTracker();
    this.emit('progress', {
      id: this.id,
      downloadedBytes: this.downloadedBytes,
      totalSize: this.totalSize,
      speed: 0,
      eta: 0,
      percent: 100,
      segments: this.segments
    });
    this.emit('completed', { id: this.id, savePath: this.savePath, checksum: this.checksum });
  }

  calculateFileChecksum(filePath) {
    return new Promise((resolve) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', () => resolve('N/A'));
    });
  }

  pause() {
    if (this.status !== 'downloading') return;
    this.status = 'paused';
    this.speed = 0;
    this.eta = 0;

    this.activeRequests.forEach((req) => req.destroy());
    this.activeRequests = [];
    this.stopSpeedTracker();

    this.emit('status-change', { id: this.id, status: this.status });
  }

  cleanup() {
    this.pause();
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch (e) {}
    }
    if (this.status !== 'completed' && this.savePath && fs.existsSync(this.savePath)) {
      try {
        fs.unlinkSync(this.savePath);
      } catch (e) {}
    }
  }

  startSpeedTracker() {
    this.lastDownloadedBytes = this.downloadedBytes;
    this.lastSpeedCheck = Date.now();

    this.intervalTimer = setInterval(() => {
      if (this.status !== 'downloading') return;

      const now = Date.now();
      const timeDiff = (now - this.lastSpeedCheck) / 1000;
      const bytesDiff = this.downloadedBytes - this.lastDownloadedBytes;

      if (timeDiff > 0) {
        this.speed = Math.max(0, Math.round(bytesDiff / timeDiff)); // Bytes per sec
        
        const remainingBytes = this.totalSize - this.downloadedBytes;
        this.eta = this.speed > 0 ? Math.round(remainingBytes / this.speed) : 0;
      }

      this.lastDownloadedBytes = this.downloadedBytes;
      this.lastSpeedCheck = now;

      this.emit('progress', {
        id: this.id,
        downloadedBytes: this.downloadedBytes,
        totalSize: this.totalSize,
        speed: this.speed,
        eta: this.eta,
        segments: this.segments.map(s => ({
          id: s.id,
          downloaded: s.downloaded,
          total: s.total,
          percent: s.total > 0 ? Math.round((s.downloaded / s.total) * 100) : 0
        }))
      });
    }, 250);
  }

  stopSpeedTracker() {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  toSnapshot() {
    return {
      id: this.id,
      url: this.url,
      filename: this.filename,
      saveDir: this.saveDir,
      savePath: this.savePath,
      category: storageService.getCategoryForFilename(this.filename),
      totalSize: this.totalSize,
      downloadedBytes: this.downloadedBytes,
      status: this.status,
      speed: this.speed,
      eta: this.eta,
      segmentsCount: this.segmentsCount,
      checksum: this.checksum,
      headers: this.headers,
      priority: this.priority,
      preflight: this.preflight ? true : undefined, // JSON'da yalnızca aktifken görünsün
      segments: this.segments.map(s => ({
        id: s.id,
        startByte: s.startByte,
        endByte: s.endByte,
        downloaded: s.downloaded,
        total: s.total,
        completed: s.completed,
        tempFilePath: s.tempFilePath // required to resume after an app restart
      }))
    };
  }
}
