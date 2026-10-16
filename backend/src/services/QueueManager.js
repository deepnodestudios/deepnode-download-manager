import storageService from './StorageService.js';
import { DownloadEngine } from './DownloadEngine.js';
import { VideoDownloader, isVideoSiteUrl, isStreamManifestUrl, getVideoInfo, isGenericVideoTitle } from './VideoDownloader.js';
import { LinkSniffer } from './LinkSniffer.js';
import { safeName } from '../utils/paths.js';
import { sanitizeSettingsForBroadcast } from '../security.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

class QueueManager {
  constructor() {
    this.engines = new Map();
    this.wsBroadcastCallback = null;
    this.initFromStorage();
  }

  setBroadcastCallback(cb) {
    this.wsBroadcastCallback = cb;
  }

  initFromStorage() {
    const saved = storageService.loadDownloads();
    let purgedPreflight = false;
    saved.forEach((item) => {
      // Onaylanmadan (pencere açıkken) uygulama kapanmış ön indirme kalıntısı:
      // listeye alma, parçalarını ve varsa dosyasını temizle
      if (item.preflight) {
        try {
          const eng = item.kind === 'video' ? new VideoDownloader(item) : new DownloadEngine(item);
          eng.cleanup();
          if (eng.savePath && fs.existsSync(eng.savePath)) fs.unlinkSync(eng.savePath);
        } catch (e) { /* ignore */ }
        purgedPreflight = true;
        return;
      }
      // If server crashed or restarted during download, mark as paused
      if (item.status === 'downloading' || item.status === 'merging') {
        item.status = 'paused';
      }
      const engine = item.kind === 'video' ? new VideoDownloader(item) : new DownloadEngine(item);
      this.attachEngineListeners(engine);
      this.engines.set(item.id, engine);
    });
    if (purgedPreflight) this.saveState();
  }

  attachEngineListeners(engine) {
    engine.on('progress', (data) => {
      this.broadcast({ type: 'PROGRESS', payload: data });
    });

    // Metadata change -> push a fresh snapshot
    engine.on('meta', () => {
      this.saveState();
      this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });
    });

    engine.on('status-change', ({ id, status }) => {
      this.saveState();
      this.checkQueue();
      this.broadcast({ type: 'STATUS_CHANGE', payload: { id, status } });
    });

    engine.on('completed', ({ id, savePath, checksum }) => {
      this.saveState();
      this.checkQueue();
      this.broadcast({ type: 'COMPLETED', payload: { id, savePath, checksum } });
      if (storageService.settings.virusScanEnabled && savePath && fs.existsSync(savePath)) {
        this.runVirusScan(id, savePath);
      }
    });

    engine.on('error', ({ id, error }) => {
      this.saveState();
      this.checkQueue();
      this.broadcast({ type: 'ERROR', payload: { id, error } });
    });

    engine.on('link-expired', async ({ id, referer }) => {
      if (!referer) return;
      console.log(`[QueueManager] Link expired for download #${id}, auto-sniffing referer page: ${referer}`);
      try {
        const sniffed = await LinkSniffer.sniffPage(referer, { depth: 1, maxPages: 2 });
        if (sniffed && sniffed.links && sniffed.links.length > 0) {
          const newStream = sniffed.links.find(l => /\.m3u8|\.mpd|\.txt|master/i.test(l.url)) || sniffed.links[0];
          if (newStream && newStream.url) {
            console.log(`[QueueManager] Auto-refreshed stream URL for #${id}: ${newStream.url}`);
            this.updateDownloadUrl(id, newStream.url, referer);
            this.startDownload(id);
            return;
          }
        }
      } catch (err) {
        console.warn(`[QueueManager] Auto-sniff refresh failed for #${id}:`, err.message);
      }
    });
  }

  broadcast(message) {
    if (this.wsBroadcastCallback) {
      this.wsBroadcastCallback(message);
    }
  }

  saveState() {
    // `secrets: true` YALNIZ burada: tarayıcı oturum başlıkları (çerezler) diske
    // yazılır ki uygulama yeniden başladığında oturum korumalı indirmeler kaldığı
    // yerden devam edebilsin. API/WebSocket snapshot'ları bunları taşımaz.
    const snapshots = Array.from(this.engines.values()).map(e => e.toSnapshot({ secrets: true }));
    storageService.saveDownloads(snapshots);
  }

  async addDownload(url, customFilename = null, customCategory = null, segmentsCount = 8, forceVideo = false, quality = 'best', customSaveDir = null, headers = null, preflight = false, referer = null, queueId = 'main') {
    // NOTE: file-type filtering (capturedExtensions/ignoredExtensions) is applied
    // only to AUTOMATIC browser captures before prompting (see server /api/download/add).
    // An explicit/confirmed add must never be blocked here.
    const id = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // Streaming sites (YouTube, etc.) and HLS/DASH manifests -> handled by yt-dlp video engine
    if (forceVideo || isVideoSiteUrl(url) || isStreamManifestUrl(url)) {
      const saveDir = customSaveDir || this.categoryDir('Video');
      const videoReferer = referer || (headers && (headers.Referer || headers.referer)) || null;

      let videoTitle = customFilename;
      const hasCustom = !!(customFilename && !isGenericVideoTitle(customFilename, url));
      // Eklentiden gelen ad "YouTube" gibi jenerik bir site adıysa gerçek başlığı sorgula
      if (!videoTitle || isGenericVideoTitle(videoTitle, url)) {
        try {
          const info = await getVideoInfo(url, videoReferer);
          if (info && info.title) {
            videoTitle = info.title + '.mp4';
          }
        } catch (e) {
          if (!videoTitle) videoTitle = 'Video Download';
        }
      }

      const engine = new VideoDownloader({
        id,
        url,
        filename: videoTitle ? safeName(videoTitle, 'Video Download') : 'Video Download',
        customFilename: hasCustom,
        quality: quality || 'best',
        referer: videoReferer,
        saveDir,
        status: 'queued',
        queueId: queueId || 'main',
        preflight // Arka plan ön indirmesi: onaylanana dek arayüzde gizli
      });
      this.attachEngineListeners(engine);
      this.engines.set(id, engine);
      this.saveState();
      this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });
      if (storageService.settings.autoStartDownloads !== false) {
        this.checkQueue(queueId);
      }
      return engine.toSnapshot();
    }

    const info = await DownloadEngine.inspectUrl(url, headers || {});
    // Ad üç dış kaynaktan gelebilir (kullanıcı / eklenti / sunucunun
    // Content-Disposition başlığı) — üçü de yol bileşeni taşıyabilir.
    let filename = safeName(customFilename || info.filename, 'downloaded_file');
    const category = customCategory || info.category;
    const saveDir = customSaveDir || this.categoryDir(category);

    // Aynı isimde dosya varsa: 'rename' -> "ad (1).ext", 'overwrite' -> üzerine yaz
    if ((storageService.settings.duplicateAction || 'rename') === 'rename') {
      filename = this.uniqueFilename(saveDir, filename);
    }

    const item = {
      id,
      url,
      filename,
      category,
      saveDir,
      headers: headers || {},
      totalSize: info.totalSize,
      downloadedBytes: 0,
      status: 'queued',
      queueId: queueId || 'main',
      segmentsCount: Math.max(1, Math.min(32, parseInt(segmentsCount, 10) || parseInt(storageService.settings.defaultSegments, 10) || 8)),
      preflight // Arka plan ön indirmesi: onaylanana dek arayüzde gizli
    };

    const engine = new DownloadEngine(item);
    this.attachEngineListeners(engine);
    this.engines.set(id, engine);
    this.saveState();

    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });

    if (storageService.settings.autoStartDownloads !== false) {
      this.checkQueue(queueId);
    }
    return engine.toSnapshot();
  }

  // Ayara göre kategori alt klasörü kullan ya da hepsini kök klasöre indir
  categoryDir(category) {
    const root = storageService.settings.downloadDir;
    const cat = safeName(category || 'General', 'General');
    if (storageService.settings.useCategoryFolders === false) return root;
    const customDirs = storageService.settings.categoryDirs || {};
    if (customDirs[cat] && typeof customDirs[cat] === 'string' && customDirs[cat].trim()) {
      return customDirs[cat].trim();
    }
    // AI_Guidelines §5: yol birleştirmede string toplama değil path.join
    return path.join(root, cat);
  }

  // "dosya.zip" varsa "dosya (1).zip", "dosya (2).zip" ... döndürür
  uniqueFilename(dir, name, excludeId = null) {
    try {
      if (!name) return name;
      const full = (n) => path.join(dir, n);
      const isTaken = (n) => {
        if (fs.existsSync(full(n))) return true;
        const normDir = path.resolve(dir);
        for (const engine of this.engines.values()) {
          if (engine.id !== excludeId && engine.saveDir && path.resolve(engine.saveDir) === normDir) {
            if (engine.filename && engine.filename.toLowerCase() === n.toLowerCase()) {
              return true;
            }
          }
        }
        return false;
      };

      if (!isTaken(name)) return name;

      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';

      for (let i = 1; i < 1000; i++) {
        const candidate = `${base} (${i})${ext}`;
        if (!isTaken(candidate)) return candidate;
      }
      return `${base} (${Date.now()})${ext}`;
    } catch (e) {
      return name;
    }
  }

  async addBatchDownloads(urls, saveDir = null, autoStart = true, queueId = 'main') {
    const results = [];
    for (const url of urls) {
      if (url && url.trim()) {
        const item = await this.addDownload(url.trim(), null, null, null, false, null, saveDir || null, null, false, null, queueId || 'main');
        if (autoStart === false && item && item.id) {
          this.pauseDownload(item.id);
        }
        results.push(item);
      }
    }
    return results;
  }

  startDownload(id) {
    const engine = this.engines.get(id);
    if (engine) {
      Promise.resolve(engine.start()).catch((err) => {
        console.error(`[QueueManager] Error starting engine ${id}:`, err);
      });
    }
  }

  pauseDownload(id) {
    const engine = this.engines.get(id);
    if (engine) {
      engine.pause();
    }
  }

  cancelDownload(id) {
    const engine = this.engines.get(id);
    if (!engine) return false;
    if (engine.status === 'completed') return true;

    if (engine.preflight) {
      this.deleteDownload(id, true);
      return true;
    }

    if (typeof engine.cancel === 'function') {
      engine.cancel();
    } else {
      if (engine.status === 'downloading') {
        engine.pause();
      }
      engine.status = 'canceled';
      engine.speed = 0;
      engine.eta = 0;
      this.saveState();
      this.checkQueue();
      this.broadcast({ type: 'STATUS_CHANGE', payload: { id, status: 'canceled' } });
    }
    return true;
  }

  startAll() {
    // "Tümünü Başlat" ve zamanlayıcı da eşzamanlılık sınırına UYMALI. Eskiden
    // burada her motora doğrudan `start()` çağrılıyor, `maxConcurrentDownloads`
    // tamamen atlanıyordu: 50 sıralı indirme varken buton (veya zamanlanmış
    // başlangıç) hepsini AYNI ANDA başlatıp bağlantı/bant genişliğini boğuyordu.
    // Çözüm: uygun indirmeleri 'queued' yapıp slot doldurmayı `_fillSlots`'a
    // bırak — o hem sınırı hem önceliği uygular (checkQueue ile aynı mantık).
    this.engines.forEach((engine) => {
      if (engine.status === 'paused' || engine.status === 'error') {
        engine.status = 'queued';
        this.broadcast({ type: 'STATUS_CHANGE', payload: { id: engine.id, status: 'queued' } });
      }
    });
    this.saveState();
    this._fillSlots();
  }

  pauseAll() {
    this.engines.forEach((engine) => {
      if (engine.status === 'downloading' || engine.status === 'queued' || engine.status === 'merging') {
        engine.pause();
      }
    });
  }

  updateDownloadUrl(id, newUrl, newReferer) {
    const engine = this.engines.get(id);
    if (!engine) return null;

    if (engine.status === 'downloading' || engine.status === 'merging') {
      engine.pause();
    }

    engine.url = newUrl;
    engine.resolvedUrl = null;
    if (newReferer !== undefined && newReferer !== null) {
      engine.referer = newReferer;
      if (engine.headers) {
        engine.headers.Referer = newReferer;
      }
    }

    if (engine.status === 'error' || engine.status === 'paused') {
      engine.status = 'paused';
      engine.errorMsg = null;
    }

    this.saveState();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });
    return engine.toSnapshot();
  }

  findIncompleteDownloadByContext({ url, referer, filename }) {
    for (const engine of this.engines.values()) {
      if (engine.status !== 'paused' && engine.status !== 'error') continue;

      // 1. Eşleşme 1: Referer ve Dosya Adı birlikte tam eşleşmeli (sadece referer eşleşmesi çok gevşek)
      if (referer && engine.referer && filename && engine.filename) {
        try {
          const r1 = referer.split('?')[0].toLowerCase();
          const r2 = engine.referer.split('?')[0].toLowerCase();
          const clean1 = filename.replace(/\.(mp4|mkv|webm|txt|m3u8)$/i, '').replace(/\s*\[\d+p\]\s*$/i, '').trim().toLowerCase();
          const clean2 = engine.filename.replace(/\.(mp4|mkv|webm|txt|m3u8)$/i, '').replace(/\s*\[\d+p\]\s*$/i, '').trim().toLowerCase();
          if (r1 === r2 && clean1 && clean2 && clean1 === clean2) return engine;
        } catch (e) {}
      }

      // 2. Eşleşme 2: URL origin ve path bileşeni tam aynı mı? (query tokenleri hariç)
      if (url && engine.url) {
        try {
          const u1 = new URL(url);
          const u2 = new URL(engine.url);
          if (u1.origin === u2.origin && u1.pathname === u2.pathname && u1.pathname !== '/') return engine;
        } catch (e) {}
      }
    }
    return null;
  }

  deleteDownload(id, deleteFile = false) {
    const engine = this.engines.get(id);
    if (!engine) {
      // Kayıt sunucuda yok ama arayüzde kalmış olabilir (ör. eski bir yarış
      // durumundan hayalet satır) — yine de silindi yayını yap ki liste temizlensin
      this.broadcast({ type: 'DOWNLOAD_DELETED', payload: { id } });
      return;
    }
    engine.pause();

    // Cleanup temp directories and unfinished partial download files (.part, .f401.mp4, .f251.webm, .temp.mp4)
    if (typeof engine.cleanup === 'function') {
      engine.cleanup();
    }

    // If explicit delete file requested OR if the download was not completed (incomplete/paused), remove savePath!
    if ((deleteFile || engine.status !== 'completed') && engine.savePath) {
      try {
        if (fs.existsSync(engine.savePath)) {
          fs.unlinkSync(engine.savePath);
        }
      } catch (e) {
        console.error('Failed to delete file:', e.message);
      }
    }

    this.engines.delete(id);
    this.saveState();
    this.broadcast({ type: 'DOWNLOAD_DELETED', payload: { id } });
  }

  checkQueue(targetQueueId = null) {
    this._fillSlots(targetQueueId);
  }

  canStartMore(queueId = 'main') {
    const qId = queueId || 'main';
    const queues = storageService.getQueues();
    const q = queues.find(x => x.id === qId) || { id: 'main', maxConcurrent: 3 };
    const maxActive = qId === 'main'
      ? (storageService.settings.maxConcurrentDownloads || q.maxConcurrent || 3)
      : (q.maxConcurrent || storageService.settings.maxConcurrentDownloads || 3);
    let activeCount = 0;
    this.engines.forEach((engine) => {
      if ((engine.queueId || 'main') === qId && (engine.status === 'downloading' || engine.status === 'merging')) {
        activeCount++;
      }
    });
    return activeCount < maxActive;
  }

  // Boş slotları önceliğe göre kuyruktakilerle doldurur.
  // Her bağımsız kuyruk kendi eşzamanlı indirme sınırına (maxConcurrent) göre yönetilir.
  _fillSlots(targetQueueId = null) {
    const queues = storageService.getQueues();
    const targetQueues = targetQueueId ? queues.filter(q => q.id === targetQueueId) : queues;

    targetQueues.forEach((q) => {
      const qId = q.id;
      const maxActive = q.id === 'main'
        ? (storageService.settings.maxConcurrentDownloads || q.maxConcurrent || 3)
        : (q.maxConcurrent || storageService.settings.maxConcurrentDownloads || 3);
      let activeCount = 0;

      this.engines.forEach((engine) => {
        if ((engine.queueId || 'main') === qId && (engine.status === 'downloading' || engine.status === 'merging')) {
          activeCount++;
        }
      });

      if (activeCount < maxActive) {
        const rank = { high: 0, normal: 1, low: 2 };
        const queued = Array.from(this.engines.values())
          .filter((e) => (e.queueId || 'main') === qId && e.status === 'queued')
          .sort((a, b) => (rank[a.priority || 'normal'] ?? 1) - (rank[b.priority || 'normal'] ?? 1));

        for (const engine of queued) {
          Promise.resolve(engine.start()).catch((err) => {
            console.error(`[QueueManager] Error starting engine ${engine.id}:`, err);
          });
          activeCount++;
          if (activeCount >= maxActive) break;
        }
      }
    });
  }

  startQueue(queueId) {
    const qId = queueId || 'main';
    this.engines.forEach((engine) => {
      if ((engine.queueId || 'main') === qId && (engine.status === 'paused' || engine.status === 'error')) {
        engine.status = 'queued';
        this.broadcast({ type: 'STATUS_CHANGE', payload: { id: engine.id, status: 'queued' } });
      }
    });
    this.saveState();
    this._fillSlots(qId);
  }

  pauseQueue(queueId) {
    const qId = queueId || 'main';
    this.engines.forEach((engine) => {
      if ((engine.queueId || 'main') === qId && (engine.status === 'downloading' || engine.status === 'merging' || engine.status === 'queued')) {
        engine.pause();
        this.broadcast({ type: 'STATUS_CHANGE', payload: { id: engine.id, status: engine.status } });
      }
    });
    this.saveState();
  }

  moveDownloadToQueue(id, targetQueueId) {
    const engine = this.engines.get(id);
    if (!engine) return null;
    const targetQ = targetQueueId || 'main';
    engine.queueId = targetQ;
    if ((engine.status === 'downloading' || engine.status === 'merging') && !this.canStartMore(targetQ)) {
      engine.pause();
      engine.status = 'queued';
    }
    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    this.checkQueue(targetQ);
    return snap;
  }

  onQueueDeleted(deletedQueueId) {
    this.engines.forEach((engine) => {
      if (engine.queueId === deletedQueueId) {
        engine.queueId = 'main';
      }
    });
    this.saveState();
    this.broadcast({
      type: 'INIT_STATE',
      payload: {
        downloads: this.getAllDownloads(),
        settings: sanitizeSettingsForBroadcast(storageService.settings)
      }
    });
  }

  getAllDownloads() {
    return Array.from(this.engines.values()).map(e => e.toSnapshot());
  }

  getDownloadById(id) {
    const e = this.engines.get(id);
    return e ? e.toSnapshot() : null;
  }

  // Ön indirme onaylandı: kullanıcının seçtiği ad/klasörü uygula ve aynı
  // motorla KALDIĞI YERDEN devam et. Klasör değiştiyse geçici parçalar taşınır
  // (attemptSegment diskteki gerçek bayttan sürdüğü için veri kaybı olmaz).
  async confirmPreflight(id, opts = {}) {
    const engine = this.engines.get(id);
    if (!engine || !engine.preflight) return null;

    // Birleştirme sürüyorsa bitmesini bekle (küçük dosya onay sırasında bitmiş olabilir)
    for (let i = 0; i < 80 && engine.status === 'merging'; i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    // Beklerken indirme silinmiş olabilir (iptal yarışı) — hayalet motor bırakma
    if (this.engines.get(id) !== engine) { engine.pause(); return null; }

    const newDir = (opts.saveDir && String(opts.saveDir).trim()) || engine.saveDir;
    let newName = opts.filename && String(opts.filename).trim()
      ? safeName(opts.filename, engine.filename)
      : engine.filename;
    const dirChanged = path.resolve(newDir) !== path.resolve(engine.saveDir);
    const nameChanged = newName !== engine.filename;

    if (dirChanged || nameChanged) {
      if ((storageService.settings.duplicateAction || 'rename') === 'rename') {
        newName = this.uniqueFilename(newDir, newName);
      }
      try { fs.mkdirSync(newDir, { recursive: true }); } catch (e) { /* ignore */ }

      if (engine.status === 'completed') {
        // Dosya onay beklerken tamamlandı: nihai dosyayı istenen yere taşı
        const np = path.join(newDir, newName);
        try { if (fs.existsSync(np) && np !== engine.savePath) fs.unlinkSync(np); } catch (e) { /* ignore */ }
        try {
          fs.renameSync(engine.savePath, np);
        } catch (e) {
          fs.copyFileSync(engine.savePath, np);
          try { fs.unlinkSync(engine.savePath); } catch (e2) { /* ignore */ }
        }
        engine.saveDir = newDir;
        engine.filename = newName;
        engine.savePath = np;
      } else {
        // Yalnız ad değiştiyse duraklatmaya gerek yok: parçalar tempDir'e yazar,
        // nihai ad birleştirmede kullanılır — indirme kesintisiz sürer (hızlı onay).
        if (dirChanged) {
          if (engine.status === 'downloading') {
            engine.pause();
            await new Promise((r) => setTimeout(r, 300)); // yazma akışları kapansın
          }
          const newTemp = path.join(newDir, `.tmp_${engine.id}`);
          if (fs.existsSync(engine.tempDir)) {
            let moved = false;
            for (let i = 0; i < 3 && !moved; i++) {
              try { fs.renameSync(engine.tempDir, newTemp); moved = true; }
              catch (e) { await new Promise((r) => setTimeout(r, 250)); } // Windows dosya kilidi
            }
            if (!moved) {
              // farklı sürücü: kopyala + eskiyi sil
              fs.cpSync(engine.tempDir, newTemp, { recursive: true });
              try { fs.rmSync(engine.tempDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
            }
          }
          engine.tempDir = newTemp;
          engine.segments.forEach((s) => { s.tempFilePath = path.join(newTemp, `part_${s.id}.tmp`); });
        }
        engine.saveDir = newDir;
        engine.filename = newName;
        engine.savePath = path.join(newDir, newName);
      }
    }

    // Motor henüz bölünmediyse kullanıcının parça sayısı tercihi uygulanabilir
    if (opts.segmentsCount && engine.segments.length === 0) {
      engine.segmentsCount = Number(opts.segmentsCount) || engine.segmentsCount;
    }

    // Taşıma beklemeleri sırasında silinmiş olabilir — hayalet motor başlatma
    if (this.engines.get(id) !== engine) { engine.pause(); return null; }

    engine.preflight = false;
    if (opts.queueId) engine.queueId = opts.queueId;

    if (opts.autoStart === false) {
      // "Daha Sonra İndir": inen baytlar korunur, duraklatılmış olarak listelenir
      if (engine.status === 'downloading') engine.pause();
      else if (engine.status === 'queued') engine.status = 'paused';
    } else if (['paused', 'queued', 'error'].includes(engine.status)) {
      Promise.resolve(engine.start()).catch((err) => {
        console.error(`[QueueManager] Error starting engine ${engine.id}:`, err);
      }); // kaldığı yerden devam
    }

    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    return snap;
  }

  // Video ön indirmesi onaylandı (yt-dlp motoru). Dosya motorundan farklı olarak
  // yt-dlp çıktıyı ÖN İNDİRMENİN BAŞLADIĞI yola yazar ve --continue yalnız o yola
  // bakar. Bu yüzden devam edebilmenin tek koşulu KALİTENİN aynı olmasıdır (kalite
  // hangi akışların indiğini belirler). Kalite değiştiyse kaldığı baytlar geçersiz —
  // null döner, çağıran ön indirmeyi silip (parçalar temizlenir) sıfırdan indirir.
  //
  // Klasör/ad onay penceresinde değiştirilse bile AKTİF ön indirme dosyaları o an
  // yt-dlp tarafından açık olduğundan taşınamaz; bu nedenle motor kendi yolunda
  // devam eder (kullanıcının açık önceliği: sıfırdan başlamasın). Eskiden klasör/ad
  // farkı yanlış "değişti" tespitiyle gereksiz yere sıfırdan indirmeye yol açıyordu.
  confirmVideoPreflight(id, opts = {}) {
    const engine = this.engines.get(id);
    if (!engine || engine.kind !== 'video' || !engine.preflight) return null;

    const newQuality = opts.quality || engine.quality;
    if (String(newQuality) !== String(engine.quality)) return null; // kalite değişti → sıfırdan

    // Kalite aynı: gizlilikten çıkar, kaldığı yerden devam et.
    engine.preflight = false;
    if (opts.filename && String(opts.filename).trim()) {
      engine.filename = safeName(opts.filename, engine.filename);
      engine.userNamed = true;
      engine.customFilename = true;
    }
    if (opts.queueId) engine.queueId = opts.queueId;
    if (opts.autoStart === false) {
      if (engine.status === 'downloading') engine.pause();
      else if (engine.status === 'queued') engine.status = 'paused';
    } else if (['paused', 'queued', 'error'].includes(engine.status)) {
      Promise.resolve(engine.start()).catch((err) => {
        console.error(`[QueueManager] Error starting engine ${engine.id}:`, err);
      }); // kaldığı baytlardan devam
    }

    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    return snap;
  }

  // Sağ tık > Yeniden İndir: dosyayı ve geçici parçaları silip sıfırdan indirir
  async redownload(id) {
    const old = this.engines.get(id);
    if (!old) return null;

    // secrets:true — headers/referer olmadan oturum korumalı yakalamalar 403
    // ya da login HTML'i indirirdi. Dahili çağrı: sırlar süreç dışına çıkmıyor
    // (aşağıdaki broadcast yalnız id taşıyor).
    const snap = old.toSnapshot({ secrets: true });
    old.pause();
    if (typeof old.cleanup === 'function') { try { old.cleanup(); } catch (e) {} }
    try {
      if (snap.savePath && fs.existsSync(snap.savePath)) fs.unlinkSync(snap.savePath);
    } catch (e) { /* dosya kilitli olabilir */ }

    this.engines.delete(id);
    this.broadcast({ type: 'DOWNLOAD_DELETED', payload: { id } });

    let newItem;
    if (snap.kind === 'video') {
      newItem = await this.addDownload(
        snap.url, snap.filename, 'Video', 1, true, snap.quality || 'best',
        snap.saveDir, null, false, snap.referer || null, snap.queueId || 'main'
      );
    } else {
      newItem = await this.addDownload(
        snap.url, snap.filename, snap.category, snap.segmentsCount,
        false, 'best', snap.saveDir, snap.headers || {}, false, snap.referer || null, snap.queueId || 'main'
      );
    }
    if (newItem && snap.speedLimitKbps) {
      this.setSpeedLimit(newItem.id, snap.speedLimitKbps);
    }
    if (newItem && snap.priority) {
      this.setPriority(newItem.id, snap.priority);
    }
    return newItem;
  }

  // Sağ tık > Öncelik (high | normal | low)
  setPriority(id, priority) {
    const engine = this.engines.get(id);
    if (!engine) return null;
    engine.priority = ['high', 'normal', 'low'].includes(priority) ? priority : 'normal';
    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    this.checkQueue();
    return snap;
  }

  // Sağ tık > Yeniden Adlandır
  renameDownload(id, newName) {
    const engine = this.engines.get(id);
    if (!engine) return null;

    // Kullanıcı girdisi doğrudan yol olarak kullanılamaz: "../../Startup/x.exe"
    // gibi bir ad dosyayı indirme klasörünün dışına taşırdı.
    const cleanName = safeName(newName, engine.filename);
    const dir = engine.saveDir;
    const oldPath = engine.savePath;
    const newPath = path.join(dir, cleanName);

    if (oldPath && fs.existsSync(oldPath) && oldPath !== newPath) {
      fs.renameSync(oldPath, newPath);
    }
    engine.filename = cleanName;
    engine.savePath = newPath;
    engine.customFilename = true;

    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    return snap;
  }

  // Sağ tık > Özel Hız Sınırı (Per-download speed limit)
  setSpeedLimit(id, kbps) {
    const engine = this.engines.get(id);
    if (!engine) return null;
    if (typeof engine.setSpeedLimit === 'function') {
      engine.setSpeedLimit(kbps);
    } else {
      engine.speedLimitKbps = Math.max(0, parseInt(kbps, 10) || 0);
    }
    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    return snap;
  }

  // Kuyruk Sıralaması: Tüm listeyi verilen ID sırasına göre yeniden dizer
  reorderDownloads(orderedIds) {
    if (!Array.isArray(orderedIds)) return;
    const newMap = new Map();
    for (const id of orderedIds) {
      if (this.engines.has(id)) {
        newMap.set(id, this.engines.get(id));
      }
    }
    // Listede yer almayan kalanlar varsa sonuna ekle
    for (const [id, eng] of this.engines.entries()) {
      if (!newMap.has(id)) {
        newMap.set(id, eng);
      }
    }
    this.engines = newMap;
    this.saveState();
    this.broadcast({
      type: 'INIT_STATE',
      payload: {
        downloads: this.getAllDownloads(),
        settings: sanitizeSettingsForBroadcast(storageService.settings)
      }
    });
  }

  // Kuyrukta Yukarı / Aşağı / Başa / Sona Taşı
  moveDownload(id, direction) {
    const keys = Array.from(this.engines.keys());
    const idx = keys.indexOf(id);
    if (idx === -1) return null;

    if (direction === 'up' && idx > 0) {
      [keys[idx - 1], keys[idx]] = [keys[idx], keys[idx - 1]];
    } else if (direction === 'down' && idx < keys.length - 1) {
      [keys[idx], keys[idx + 1]] = [keys[idx + 1], keys[idx]];
    } else if (direction === 'top') {
      keys.splice(idx, 1);
      keys.unshift(id);
    } else if (direction === 'bottom') {
      keys.splice(idx, 1);
      keys.push(id);
    }
    this.reorderDownloads(keys);
    return this.getAllDownloads();
  }

  // Otomatik Antivirüs / Güvenlik Taraması
  findDefaultVirusScanner() {
    if (process.platform !== 'win32') return null;
    const std = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';
    if (fs.existsSync(std)) return std;
    const plat = 'C:\\ProgramData\\Microsoft\\Windows Defender\\Platform';
    if (fs.existsSync(plat)) {
      try {
        const subdirs = fs.readdirSync(plat).sort().reverse();
        for (const d of subdirs) {
          const c = path.join(plat, d, 'MpCmdRun.exe');
          if (fs.existsSync(c)) return c;
        }
      } catch (e) {}
    }
    return null;
  }

  runVirusScan(id, filePath) {
    const scannerPath = storageService.settings.virusScannerPath || this.findDefaultVirusScanner();
    if (!scannerPath || !fs.existsSync(scannerPath)) {
      console.log(`[QueueManager] Virus scanner path not found: ${scannerPath}`);
      return;
    }
    console.log(`[QueueManager] Scanning completed download with antivirus: ${filePath}`);
    try {
      const isDefender = /mpcmdrun/i.test(scannerPath);
      const args = isDefender
        ? ['-Scan', '-ScanType', '3', '-File', filePath]
        : [filePath];

      const child = spawn(scannerPath, args, { windowsHide: true });
      child.on('close', (code) => {
        if (code === 0) {
          console.log(`[QueueManager] Antivirus scan clean: ${filePath}`);
        } else if (code === 2) {
          console.warn(`[QueueManager] THREAT DETECTED in ${filePath} (exit code 2)`);
          const eng = this.engines.get(id);
          if (eng) {
            eng.virusAlert = true;
            this.saveState();
            this.broadcast({
              type: 'VIRUS_ALERT',
              payload: { id, filename: eng.filename, filePath, threat: 'Malware detected (exit code 2)' }
            });
          }
        } else {
          console.log(`[QueueManager] Antivirus scan exit code: ${code}`);
        }
      });
      child.on('error', (err) => {
        console.warn(`[QueueManager] Antivirus execution error:`, err.message);
      });
    } catch (e) {
      console.error(`[QueueManager] Failed to launch virus scan:`, e.message);
    }
  }
}

export default new QueueManager();
