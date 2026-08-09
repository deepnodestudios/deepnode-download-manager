import storageService from './StorageService.js';
import { DownloadEngine } from './DownloadEngine.js';
import { VideoDownloader, isVideoSiteUrl, isStreamManifestUrl, getVideoInfo, isGenericVideoTitle } from './VideoDownloader.js';
import { LinkSniffer } from './LinkSniffer.js';
import { safeName } from '../utils/paths.js';
import fs from 'fs';
import path from 'path';

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

  async addDownload(url, customFilename = null, customCategory = null, segmentsCount = 8, forceVideo = false, quality = 'best', customSaveDir = null, headers = null, preflight = false, referer = null) {
    // NOTE: file-type filtering (capturedExtensions/ignoredExtensions) is applied
    // only to AUTOMATIC browser captures before prompting (see server /api/download/add).
    // An explicit/confirmed add must never be blocked here.
    const id = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

    // Streaming sites (YouTube, etc.) and HLS/DASH manifests -> handled by yt-dlp video engine
    if (forceVideo || isVideoSiteUrl(url) || isStreamManifestUrl(url)) {
      const saveDir = customSaveDir || this.categoryDir('Video');
      const videoReferer = referer || (headers && (headers.Referer || headers.referer)) || null;

      let videoTitle = customFilename;
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
        quality: quality || 'best',
        referer: videoReferer,
        saveDir,
        status: 'queued',
        preflight // IDM ön indirmesi: onaylanana dek arayüzde gizli
      });
      this.attachEngineListeners(engine);
      this.engines.set(id, engine);
      this.saveState();
      this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });
      this.checkQueue();
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
      segmentsCount: segmentsCount || storageService.settings.defaultSegments,
      preflight // IDM ön indirmesi: onaylanana dek arayüzde gizli
    };

    const engine = new DownloadEngine(item);
    this.attachEngineListeners(engine);
    this.engines.set(id, engine);
    this.saveState();

    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: engine.toSnapshot() });

    this.checkQueue();
    return engine.toSnapshot();
  }

  // Ayara göre kategori alt klasörü kullan ya da hepsini kök klasöre indir
  categoryDir(category) {
    const root = storageService.settings.downloadDir;
    if (storageService.settings.useCategoryFolders === false) return root;
    // AI_Guidelines §5: yol birleştirmede string toplama değil path.join
    return path.join(root, safeName(category || 'General', 'General'));
  }

  // "dosya.zip" varsa "dosya (1).zip", "dosya (2).zip" ... döndürür
  uniqueFilename(dir, name) {
    try {
      if (!name) return name;
      const full = (n) => path.join(dir, n);
      if (!fs.existsSync(full(name))) return name;

      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';

      for (let i = 1; i < 1000; i++) {
        const candidate = `${base} (${i})${ext}`;
        if (!fs.existsSync(full(candidate))) return candidate;
      }
      return `${base} (${Date.now()})${ext}`;
    } catch (e) {
      return name;
    }
  }

  async addBatchDownloads(urls) {
    const results = [];
    for (const url of urls) {
      if (url.trim()) {
        const item = await this.addDownload(url.trim());
        results.push(item);
      }
    }
    return results;
  }

  startDownload(id) {
    const engine = this.engines.get(id);
    if (engine) {
      engine.start();
    }
  }

  pauseDownload(id) {
    const engine = this.engines.get(id);
    if (engine) {
      engine.pause();
    }
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
      if (engine.status === 'downloading') {
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
    if (newReferer !== undefined && newReferer !== null) {
      engine.referer = newReferer;
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

      // 1. Eşleşme 1: Referer (sayfa URL'si) aynı mı?
      if (referer && engine.referer) {
        try {
          const r1 = referer.split('?')[0].toLowerCase();
          const r2 = engine.referer.split('?')[0].toLowerCase();
          if (r1 === r2) return engine;
        } catch (e) {}
      }

      // 2. Eşleşme 2: Dosya adı / video başlığı aynı mı?
      if (filename && engine.filename) {
        const clean1 = filename.replace(/\.(mp4|mkv|webm|txt|m3u8)$/i, '').replace(/\s*\[\d+p\]\s*$/i, '').trim().toLowerCase();
        const clean2 = engine.filename.replace(/\.(mp4|mkv|webm|txt|m3u8)$/i, '').replace(/\s*\[\d+p\]\s*$/i, '').trim().toLowerCase();
        if (clean1 && clean2 && (clean1 === clean2 || clean1.includes(clean2) || clean2.includes(clean1))) return engine;
      }

      // 3. Eşleşme 3: URL yol bileşeni aynı mı? (token parametreleri hariç)
      if (url && engine.url) {
        try {
          const u1 = new URL(url).pathname.toLowerCase();
          const u2 = new URL(engine.url).pathname.toLowerCase();
          if (u1 && u2 && u1 === u2 && u1 !== '/') return engine;
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

  checkQueue() {
    // "Eklenince otomatik başlat" kapalıysa kuyruktakiler kullanıcı başlatana kadar bekler
    if (storageService.settings.autoStartDownloads === false) return;
    this._fillSlots();
  }

  // Boş slotları (maxConcurrentDownloads - aktif) önceliğe göre kuyruktakilerle
  // doldurur. `checkQueue` (otomatik başlat) ve `startAll` (buton/zamanlayıcı) bunu
  // ortak kullanır; böylece eşzamanlılık sınırı HER iki yolda da uygulanır.
  _fillSlots() {
    const maxActive = storageService.settings.maxConcurrentDownloads || 3;
    let activeCount = 0;

    this.engines.forEach((engine) => {
      if (engine.status === 'downloading' || engine.status === 'merging') {
        activeCount++;
      }
    });

    if (activeCount < maxActive) {
      // Yüksek öncelikli indirmeler önce başlar
      const rank = { high: 0, normal: 1, low: 2 };
      const queued = Array.from(this.engines.values())
        .filter((e) => e.status === 'queued')
        .sort((a, b) => (rank[a.priority || 'normal'] ?? 1) - (rank[b.priority || 'normal'] ?? 1));

      for (const engine of queued) {
        engine.start();
        activeCount++;
        if (activeCount >= maxActive) break;
      }
    }
  }

  getAllDownloads() {
    return Array.from(this.engines.values()).map(e => e.toSnapshot());
  }

  getDownloadById(id) {
    const e = this.engines.get(id);
    return e ? e.toSnapshot() : null;
  }

  // IDM ön indirmesi onaylandı: kullanıcının seçtiği ad/klasörü uygula ve aynı
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

    if (opts.autoStart === false) {
      // "Daha Sonra İndir": inen baytlar korunur, duraklatılmış olarak listelenir
      if (engine.status === 'downloading') engine.pause();
      else if (engine.status === 'queued') engine.status = 'paused';
    } else if (['paused', 'queued', 'error'].includes(engine.status)) {
      engine.start(); // kaldığı yerden devam
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
    if (opts.autoStart === false) {
      if (engine.status === 'downloading') engine.pause();
      else if (engine.status === 'queued') engine.status = 'paused';
    } else if (['paused', 'queued', 'error'].includes(engine.status)) {
      engine.start(); // kaldığı baytlardan devam
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

    if (snap.kind === 'video') {
      return this.addDownload(
        snap.url, snap.filename, 'Video', 1, true, snap.quality || 'best',
        snap.saveDir, null, false, snap.referer || null
      );
    }
    return this.addDownload(
      snap.url, snap.filename, snap.category, snap.segmentsCount,
      false, 'best', snap.saveDir, snap.headers || {}
    );
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

    this.saveState();
    const snap = engine.toSnapshot();
    this.broadcast({ type: 'DOWNLOAD_ADDED', payload: snap });
    return snap;
  }
}

export default new QueueManager();
