import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import storageService from './StorageService.js';
import { proxyAgent, authHeaderFor } from './NetworkConfig.js';
import { requestFollowingRedirects } from '../utils/http.js';
import { safeName } from '../utils/paths.js';

// ---- Global bandwidth limiter (shared by ALL downloads) ----
// The configured limit is a TOTAL cap: 3 concurrent downloads share one budget.
const GLOBAL_BW = { windowStart: Date.now(), bytes: 0, paused: new Set(), active: new Set(), timer: null };

// Diske yazma kuyruğu dolduğu için duraklatılmış akışlar. Hız sınırlayıcının
// duraklattıklarından AYRI tutulur; yoksa `bwResumeAll()` disk beklerken de
// akışı devam ettirip belleği şişirirdi.
const DRAIN_PAUSED = new Set();

function globalLimitBytesPerSec() {
  const kbps = storageService.settings.globalSpeedLimitKbps || 0;
  return kbps > 0 ? kbps * 1024 : 0;
}

function bwResumeAll() {
  GLOBAL_BW.paused.forEach((s) => {
    if (DRAIN_PAUSED.has(s)) return; // disk hâlâ yetişemiyor — duraklı kalsın
    try { s.resume(); } catch (e) { /* akış zaten kapanmış */ }
  });
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
        try { s.pause(); } catch (e) { /* akış zaten kapanmış */ }
        GLOBAL_BW.paused.add(s);
      }
    });
    if (!GLOBAL_BW.paused.has(res)) {
      try { res.pause(); } catch (e) { /* akış zaten kapanmış */ }
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

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DeepNode/1.0';

export class DownloadEngine extends EventEmitter {
  constructor(item, options = {}) {
    super();
    this.id = item.id;
    this.url = item.url;
    // Yönlendirme sonrası çözülen gerçek adres (302 zincirleri). Segment
    // istekleri buradan sürer; kullanıcıya gösterilen `url` değişmez.
    this.resolvedUrl = item.resolvedUrl || null;
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
      this.downloadedBytes = this.sumSegmentBytes();
    }

    this.speed = 0;
    this.eta = 0;
    this.checksum = item.checksum || null;

    this.activeRequests = [];
    this.intervalTimer = null;
    this.lastDownloadedBytes = 0;
    this.lastSpeedCheck = Date.now();

    // Çalışma kuşağı: her start() bir sonrakini alır, her pause() bir artırır.
    // Duraklat→devam ettir sırasında ESKİ start()'ın Promise.all'ı geç çözülüp
    // yarım parçaları birleştirmesini engeller (sessiz veri bozulması).
    this._epoch = 0;
  }

  sumSegmentBytes() {
    return this.segments.reduce((total, s) => total + (s.downloaded || 0), 0);
  }

  // Request headers for this download: browser session (cookies/referer/UA) if
  // captured, otherwise a sane default UA.
  buildHeaders(extra = {}) {
    return {
      'User-Agent': DEFAULT_UA,
      ...this.headers,
      ...extra
    };
    // NOT: site girişi (Basic auth) artık her yönlendirme hop'unda hedef adrese
    // göre `authFor` ile eklenir — bkz. utils/http.js.
  }

  ensureTempDir() {
    if (!fs.existsSync(this.saveDir)) {
      fs.mkdirSync(this.saveDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  static filenameFromResponse(res, urlStr, fallbackUrl) {
    let filename = '';
    const cd = res.headers['content-disposition'];
    if (cd) {
      // RFC 5987 (filename*=UTF-8''...) ve düz filename="..." biçimlerini karşılar
      const match = cd.match(/filename\*?=['"]?(?:UTF-8''|")?([^'";]+)/i);
      if (match && match[1]) {
        try {
          filename = decodeURIComponent(match[1]);
        } catch (e) {
          filename = match[1];
        }
      }
    }
    if (!filename) {
      try { filename = path.basename(new URL(urlStr).pathname); } catch (e) { filename = ''; }
    }
    if (!filename) {
      try { filename = path.basename(new URL(fallbackUrl).pathname); } catch (e) { filename = ''; }
    }
    // Sunucudan gelen ad yol bileşeni ("../") içerebilir — indirme klasörünün
    // dışına yazılmasını engellemek için daima temizlenir.
    return safeName(filename, 'downloaded_file');
  }

  static async inspectUrl(downloadUrl, extraHeaders = {}) {
    const fallback = () => {
      let filename = 'downloaded_file';
      try { filename = safeName(path.basename(new URL(downloadUrl).pathname), 'downloaded_file'); } catch (e) { /* geçersiz URL */ }
      return {
        url: downloadUrl,
        finalUrl: downloadUrl,
        filename,
        totalSize: 0,
        acceptRanges: false,
        contentType: '',
        category: storageService.getCategoryForFilename(filename)
      };
    };

    const describe = (res, finalUrl) => {
      const filename = DownloadEngine.filenameFromResponse(res, finalUrl, downloadUrl);
      const contentType = res.headers['content-type'] || '';
      let totalSize = parseInt(res.headers['content-length'] || '0', 10);
      let acceptRanges = res.headers['accept-ranges'] === 'bytes';

      // GET + "Range: bytes=0-0" ile sorulduysa gerçek boyut Content-Range'de gelir
      const contentRange = res.headers['content-range'];
      if (contentRange) {
        acceptRanges = true;
        const m = /\/(\d+)\s*$/.exec(contentRange);
        if (m) totalSize = parseInt(m[1], 10);
      }

      return {
        url: downloadUrl,
        finalUrl,
        filename,
        totalSize: Number.isFinite(totalSize) ? totalSize : 0,
        acceptRanges,
        contentType,
        category: storageService.getCategoryForFilename(filename, contentType)
      };
    };

    const baseHeaders = { 'User-Agent': DEFAULT_UA, ...(extraHeaders || {}) };
    const common = {
      headers: baseHeaders,
      agentFactory: () => proxyAgent(),
      authFor: (u) => authHeaderFor(u),
      timeoutMs: 8000
    };

    // 1) HEAD — en ucuz yol.
    try {
      const { res, finalUrl } = await requestFollowingRedirects(downloadUrl, { ...common, method: 'HEAD' });
      res.resume();
      if (res.statusCode && res.statusCode < 400) return describe(res, finalUrl);
    } catch (err) {
      // HEAD başarısız — aşağıdaki GET denemesine düş
    }

    // 2) Bazı sunucular HEAD'i reddeder (405) veya Content-Length döndürmez.
    //    Tek baytlık Range isteğiyle hem boyut hem Range desteği öğrenilir.
    try {
      const { res, finalUrl } = await requestFollowingRedirects(downloadUrl, {
        ...common,
        method: 'GET',
        headers: { ...baseHeaders, Range: 'bytes=0-0' }
      });
      const info = describe(res, finalUrl);
      res.destroy(); // gövdeyi indirmeye gerek yok
      if (res.statusCode && res.statusCode < 400) return info;
    } catch (err) {
      // ağ hatası — yedek bilgiyle devam
    }

    return fallback();
  }

  async start() {
    // 'merging' de dahil: birleştirme sürerken yeni bir çalışma başlatılırsa,
    // biten birleştirme geçici klasörü silerken yeni çalışma oraya yazmaya
    // devam ediyor ve "Missing segment file" ile bozuluyordu.
    // 'completed' de dahil: bitmiş bir indirmeyi yeniden başlatmak parçaları
    // silinmiş bir motoru yeniden koşturur; baştan indirme için "Yeniden İndir"
    // (redownload) vardır.
    if (this.status === 'downloading' || this.status === 'merging' || this.status === 'completed') return;
    const epoch = ++this._epoch;
    this.status = 'downloading';
    this.ensureTempDir();

    this.emit('status-change', { id: this.id, status: this.status });

    try {
      // If total size unknown or segments not set up, initialize
      if (this.totalSize === 0 || this.segments.length === 0) {
        const info = await DownloadEngine.inspectUrl(this.url, this.headers);
        if (epoch !== this._epoch) return; // bu arada duraklatıldı/silindi
        this.totalSize = info.totalSize;
        if (info.finalUrl && info.finalUrl !== this.url) this.resolvedUrl = info.finalUrl;

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
      try {
        await Promise.all(this.segments.map((segment) => this.downloadSegment(segment, epoch)));
      } catch (err) {
        // Sunucu Range'i yok sayıyorsa çok parçalı indirme bozuk dosya üretir —
        // tek bağlantıya düşüp baştan indir (yavaş ama DOĞRU sonuç).
        if (err && err.code === 'RANGE_NOT_HONORED' && epoch === this._epoch && this.status === 'downloading') {
          console.warn(`[${this.id}] Sunucu Range desteklemiyor — tek parçaya düşülüyor.`);
          this.activeRequests.forEach((ctl) => { try { ctl.destroy(); } catch (e) { /* kapalı */ } });
          this.activeRequests = [];
          try { fs.rmSync(this.tempDir, { recursive: true, force: true }); } catch (e) { /* yoktu */ }
          this.ensureTempDir();
          this.segments = [{
            id: 0,
            startByte: 0,
            endByte: this.totalSize > 0 ? this.totalSize - 1 : 0,
            downloaded: 0,
            total: this.totalSize > 0 ? this.totalSize : 0,
            completed: false,
            tempFilePath: path.join(this.tempDir, 'part_0.tmp')
          }];
          this.downloadedBytes = 0;
          await this.downloadSegment(this.segments[0], epoch);
        } else {
          throw err;
        }
      }

      // ESKİ ÇALIŞMA KORUMASI: duraklat→devam ettir yarışında bu Promise.all,
      // kullanıcı yeniden başlattıktan SONRA çözülebilir. Kuşak değiştiyse bu
      // çalışma artık geçersizdir — birleştirmeyi yeni çalışma yapacak.
      if (epoch !== this._epoch || this.status !== 'downloading') return;

      // Tüm parçalar gerçekten tamamlandı mı? (yarım dosya birleştirilmesin)
      const incomplete = this.segments.filter((s) => !s.completed);
      if (incomplete.length > 0) {
        throw new Error(`Download incomplete (${incomplete.length} segment(s) unfinished)`);
      }

      await this.mergeSegments();
    } catch (err) {
      // 'merging' de dahil: birleştirme doğrulaması hata verdiğinde durum
      // 'merging'de takılı kalmamalı (indirme ne duraklatılabilir ne silinebilirdi).
      if (epoch === this._epoch && (this.status === 'downloading' || this.status === 'merging')) {
        this.status = 'error';
        this.errorMsg = err.message;
        this.stopSpeedTracker();
        this.emit('error', { id: this.id, error: err.message });
      }
    }
  }

  // Retries a segment on network errors / premature stream close, resuming from
  // the bytes already written to disk (auto reconnect).
  async downloadSegment(segment, epoch) {
    let lastError = null;
    const maxRetries = maxSegmentRetries();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (epoch !== this._epoch || this.status !== 'downloading') return;
      if (segment.completed) return;

      try {
        await this.attemptSegment(segment, epoch);

        // Verify completeness: a stream can end early without an error
        if (segment.total > 0 && segment.downloaded < segment.total) {
          throw new Error('Connection closed early (incomplete data)');
        }
        segment.completed = true;
        return;
      } catch (err) {
        lastError = err;
        if (epoch !== this._epoch || this.status !== 'downloading') return; // paused/cancelled: not an error

        // Yeniden denemenin faydası yok — sunucu aralık desteklemiyor.
        // start() bunu yakalayıp tek parçalı indirmeye düşecek.
        if (err && err.code === 'RANGE_NOT_HONORED') throw err;

        if (attempt < maxRetries) {
          const waitMs = Math.min(15000, 1000 * Math.pow(2, attempt)); // 1s,2s,4s,8s,15s
          this.emit('retry', { id: this.id, segmentId: segment.id, attempt: attempt + 1, error: err.message });
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }

    throw lastError || new Error('Could not download segment');
  }

  async attemptSegment(segment, epoch) {
    // Always resume from what is actually on disk
    let onDisk = 0;
    try { onDisk = fs.statSync(segment.tempFilePath).size; } catch (e) { onDisk = 0; }
    if (segment.total > 0 && onDisk > segment.total) onDisk = segment.total;
    segment.downloaded = onDisk;

    // Toplam sayacı parçalardan YENİDEN türet. Eskiden `downloadedBytes` yalnız
    // artıyordu; yeniden denemede parça sayacı diskten geri sarılınca toplam
    // şişip ilerleme %100'ü aşıyor, ETA saçmalıyordu.
    this.downloadedBytes = this.sumSegmentBytes();

    const segmentStart = segment.startByte + segment.downloaded;
    const segmentEnd = segment.endByte;

    if (segment.total > 0 && segment.downloaded >= segment.total) {
      segment.completed = true;
      return;
    }
    if (segmentStart > segmentEnd && segment.total > 0) {
      segment.completed = true;
      return;
    }

    const headers = this.buildHeaders();
    if (this.totalSize > 0 && this.segments.length > 1) {
      headers.Range = `bytes=${segmentStart}-${segmentEnd}`;
    } else if (segment.downloaded > 0) {
      headers.Range = `bytes=${segmentStart}-`; // single-segment resume
    }

    const controller = { destroy: () => { /* istek henüz kurulmadı */ } };
    this.activeRequests.push(controller);

    let res;
    let finalUrl;
    try {
      // 302/301 zincirlerini takip eder: eskiden yönlendirilen her link
      // "Server responded with status code 302" ile başarısız oluyordu.
      ({ res, finalUrl } = await requestFollowingRedirects(this.resolvedUrl || this.url, {
        method: 'GET',
        headers,
        agentFactory: () => proxyAgent(),
        authFor: (u) => authHeaderFor(u),
        timeoutMs: connectionTimeoutMs(),
        controller
      }));
    } finally {
      // Bu istek artık ya akıyor ya da başarısız; listeyi büyütmeye devam etme
      const idx = this.activeRequests.indexOf(controller);
      if (idx !== -1 && !res) this.activeRequests.splice(idx, 1);
    }

    if (this.resolvedUrl !== finalUrl && finalUrl !== this.url) this.resolvedUrl = finalUrl;

    if (res.statusCode !== 200 && res.statusCode !== 206) {
      res.resume();
      throw new Error(`Server responded with status code ${res.statusCode}`);
    }

    // Sunucu Range istediğimiz halde 206 yerine 200 döndüyse aralığı YOK SAYMIŞ
    // ve tüm dosyayı gönderiyor demektir. Çok parçalı indirmede her segment
    // dosyanın tamamını yazar → birleştirme bozuk dosya üretir. (Accept-Ranges
    // başlığı yalan söyleyen sunucular yaygındır.) Tek parçaya düşerek kurtar.
    if (headers.Range && res.statusCode === 200 && this.segments.length > 1) {
      res.destroy();
      const err = new Error('Server ignored Range request');
      err.code = 'RANGE_NOT_HONORED';
      throw err;
    }

    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(segment.tempFilePath, {
        flags: segment.downloaded > 0 ? 'a' : 'w'
      });

      GLOBAL_BW.active.add(res);
      const unregister = () => {
        GLOBAL_BW.active.delete(res);
        GLOBAL_BW.paused.delete(res);
        DRAIN_PAUSED.delete(res);
        const idx = this.activeRequests.indexOf(controller);
        if (idx !== -1) this.activeRequests.splice(idx, 1);
      };

      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        unregister();
        try { writeStream.destroy(); } catch (e) { /* zaten kapalı */ }
        reject(err);
      };

      res.on('data', (chunk) => {
        if (epoch !== this._epoch || this.status !== 'downloading') {
          unregister();
          controller.destroy();
          try { writeStream.end(); } catch (e) { /* zaten kapalı */ }
          return;
        }

        // Bazı sunucular `Range: bytes=a-b` isteğinin BİTİŞİNİ yok sayıp dosyanın
        // sonuna kadar gönderir. Fazlasını yazarsak segment taşar ve birleştirme
        // bozuk dosya üretir — istenen bayttan sonrasını kırp ve bağlantıyı kapat.
        let data = chunk;
        let reachedEnd = false;
        if (segment.total > 0 && segment.downloaded + data.length >= segment.total) {
          data = data.subarray(0, segment.total - segment.downloaded);
          reachedEnd = true;
        }

        segment.downloaded += data.length;
        this.downloadedBytes += data.length;

        // GERİ BASINÇ: disk ağdan yavaşsa (USB/ağ sürücüsü, antivirüs taraması,
        // 8 paralel bağlantı) `write()` false döner. Eskiden dönüş değeri yok
        // sayıldığı için yazma kuyruğu bellekte yüzlerce MB'a çıkabiliyordu.
        if (data.length > 0 && !writeStream.write(data) && !DRAIN_PAUSED.has(res)) {
          DRAIN_PAUSED.add(res);
          try { res.pause(); } catch (e) { /* akış kapanmış */ }
          writeStream.once('drain', () => {
            DRAIN_PAUSED.delete(res);
            // Hız sınırlayıcı da duraklattıysa devam ettirmeyi ONA bırak
            if (!GLOBAL_BW.paused.has(res) && !settled &&
                epoch === this._epoch && this.status === 'downloading') {
              try { res.resume(); } catch (e) { /* akış kapanmış */ }
            }
          });
        }

        bwConsume(data.length, res);

        // Segment doldu: sunucu göndermeye devam etse de bağlantıyı bırak
        if (reachedEnd) {
          segment.completed = true;
          if (!settled) {
            settled = true;
            unregister();
            controller.destroy();
            writeStream.end(() => resolve());
          }
        }
      });

      res.on('end', () => {
        if (settled) return;
        unregister();
        writeStream.end(() => {
          if (settled) return;
          settled = true;
          resolve();
        });
      });

      res.on('aborted', () => fail(new Error('Connection lost (aborted)')));
      res.on('error', (err) => {
        // Kullanıcı duraklattıysa bu bir hata değil
        if (epoch !== this._epoch || this.status !== 'downloading') {
          if (settled) return;
          settled = true;
          unregister();
          try { writeStream.end(); } catch (e) { /* zaten kapalı */ }
          resolve();
          return;
        }
        fail(err);
      });
      writeStream.on('error', (err) => fail(err));
    });
  }

  async mergeSegments() {
    const epoch = this._epoch;
    this.status = 'merging';
    this.emit('status-change', { id: this.id, status: 'merging' });

    const finalStream = fs.createWriteStream(this.savePath);
    let mergedBytes = 0;

    // Segmentleri sırayla stream ile birleştir (belleğe tümünü okumadan)
    try {
      for (const segment of this.segments) {
        if (!fs.existsSync(segment.tempFilePath)) {
          throw new Error(`Missing segment file (part ${segment.id})`);
        }
        await new Promise((resolve, reject) => {
          const readStream = fs.createReadStream(segment.tempFilePath);
          readStream.on('data', (chunk) => { mergedBytes += chunk.length; });
          readStream.on('error', reject);
          readStream.on('end', resolve);
          readStream.pipe(finalStream, { end: false });
        });
      }

      // Yazma tamamlanana kadar bekle
      await new Promise((resolve, reject) => {
        finalStream.on('finish', resolve);
        finalStream.on('error', reject);
        finalStream.end();
      });
    } catch (err) {
      try { finalStream.destroy(); } catch (e) { /* zaten kapalı */ }
      throw err;
    }

    // Boyut doğrulaması: eksik/bozuk birleştirmeyi "tamamlandı" diye işaretleme
    if (this.totalSize > 0 && mergedBytes !== this.totalSize) {
      throw new Error(`Merged size mismatch (${mergedBytes}/${this.totalSize})`);
    }

    // Clean up temporary segment files.
    // Kuşak değiştiyse (bu arada yeniden başlatıldı) geçici klasör ARTIK yeni
    // çalışmaya aittir — silmek onun parçalarını yok ederdi.
    try {
      if (epoch === this._epoch && fs.existsSync(this.tempDir)) {
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
    this._epoch++; // uçuştaki çalışmayı geçersiz kıl (bkz. start())
    this.status = 'paused';
    this.speed = 0;
    this.eta = 0;

    this.activeRequests.forEach((ctl) => {
      try { ctl.destroy(); } catch (e) { /* istek zaten kapalı */ }
    });
    this.activeRequests = [];
    this.stopSpeedTracker();

    this.emit('status-change', { id: this.id, status: this.status });
  }

  cleanup() {
    this.pause();
    if (this.tempDir && fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch (e) {
        console.error('Failed to remove temp dir:', e.message);
      }
    }
    if (this.status !== 'completed' && this.savePath && fs.existsSync(this.savePath)) {
      try {
        fs.unlinkSync(this.savePath);
      } catch (e) {
        console.error('Failed to remove partial file:', e.message);
      }
    }
  }

  startSpeedTracker() {
    this.lastDownloadedBytes = this.downloadedBytes;
    this.lastSpeedCheck = Date.now();
    this.stopSpeedTracker(); // çift zamanlayıcı bırakma (yeniden başlatmada)

    this.intervalTimer = setInterval(() => {
      if (this.status !== 'downloading') return;

      const now = Date.now();
      const timeDiff = (now - this.lastSpeedCheck) / 1000;
      const bytesDiff = this.downloadedBytes - this.lastDownloadedBytes;

      if (timeDiff > 0) {
        this.speed = Math.max(0, Math.round(bytesDiff / timeDiff)); // Bytes per sec

        const remainingBytes = Math.max(0, this.totalSize - this.downloadedBytes);
        this.eta = this.speed > 0 ? Math.round(remainingBytes / this.speed) : 0;
      }

      this.lastDownloadedBytes = this.downloadedBytes;
      this.lastSpeedCheck = now;

      // Toplam boyut biliniyorsa sayaç onu aşamaz (yeniden deneme sapması)
      const reported = this.totalSize > 0
        ? Math.min(this.downloadedBytes, this.totalSize)
        : this.downloadedBytes;

      this.emit('progress', {
        id: this.id,
        downloadedBytes: reported,
        totalSize: this.totalSize,
        speed: this.speed,
        eta: this.eta,
        segments: this.segments.map((s) => ({
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

  /**
   * @param {object} opts
   *   - secrets: true ise tarayıcı oturum başlıkları (çerezler) da eklenir.
   *     YALNIZCA diske kayıt (QueueManager.saveState) için kullanılır; API ve
   *     WebSocket yanıtlarında ASLA gönderilmez — eski davranışta `/api/downloads`
   *     kullanıcının başka sitelerdeki çerezlerini dışarı sızdırıyordu.
   */
  toSnapshot(opts = {}) {
    const snap = {
      id: this.id,
      url: this.url,
      filename: this.filename,
      saveDir: this.saveDir,
      savePath: this.savePath,
      category: storageService.getCategoryForFilename(this.filename),
      totalSize: this.totalSize,
      downloadedBytes: this.totalSize > 0 ? Math.min(this.downloadedBytes, this.totalSize) : this.downloadedBytes,
      status: this.status,
      speed: this.speed,
      eta: this.eta,
      segmentsCount: this.segmentsCount,
      checksum: this.checksum,
      priority: this.priority,
      // Arayüzdeki "Özellikler" penceresi hata sebebini gösterebilsin
      // (VideoDownloader zaten gönderiyordu, dosya motoru göndermiyordu).
      errorMsg: this.errorMsg || undefined,
      preflight: this.preflight ? true : undefined, // JSON'da yalnızca aktifken görünsün
      segments: this.segments.map((s) => ({
        id: s.id,
        startByte: s.startByte,
        endByte: s.endByte,
        downloaded: s.downloaded,
        total: s.total,
        completed: s.completed,
        tempFilePath: s.tempFilePath // required to resume after an app restart
      }))
    };

    if (opts.secrets) {
      // Kalıcı kayıt: uygulama yeniden başladığında oturum korumalı linkler
      // kaldığı yerden devam edebilsin diye başlıklar ve çözülen adres saklanır.
      snap.headers = this.headers;
      snap.resolvedUrl = this.resolvedUrl || undefined;
    }

    return snap;
  }
}
