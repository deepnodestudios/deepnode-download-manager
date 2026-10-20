import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const DATA_DIR = path.join(os.homedir(), '.deepnode');
// Eski markanın veri klasörü; ilk çalıştırmada .deepnode'a taşınır (bir kez).
const LEGACY_DATA_DIR = path.join(os.homedir(), '.omnidownloader');
const DOWNLOADS_FILE = path.join(DATA_DIR, 'downloads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const QUEUES_FILE = path.join(DATA_DIR, 'queues.json');

export const DEFAULT_QUEUES = [
  {
    id: 'main',
    name: 'Ana İndirme Kuyruğu',
    schedulerEnabled: false,
    startTime: '02:00',
    stopTime: '08:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    afterStop: 'nothing',
    speedLimitKbps: 0
  },
  {
    id: 'sync',
    name: 'Senkronizasyon Kuyruğu',
    maxConcurrent: 1,
    schedulerEnabled: false,
    startTime: '01:00',
    stopTime: '06:00',
    days: [0, 1, 2, 3, 4, 5, 6],
    afterStop: 'nothing',
    speedLimitKbps: 0
  }
];

// Standart Windows "İndirilenler" (Downloads) klasörü
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');
const OLD_DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'OmniDownloads');

// Content-Type -> file extension, so extensionless download URLs (e.g. torrent
// sites serving "?action=download&tid=…") can still be classified by the
// captured/ignored file-type filter.
const MIME_TO_EXT = {
  'application/x-bittorrent': 'torrent',
  'application/torrent': 'torrent',
  'application/zip': 'zip',
  'application/x-zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/x-compress-7z': '7z',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-tar': 'tar',
  'application/x-gtar': 'tar',
  'application/x-bzip2': 'bz2',
  'application/pdf': 'pdf',
  'application/x-msdownload': 'exe',
  'application/x-msdos-program': 'exe',
  'application/x-dosexec': 'exe',
  'application/x-msi': 'msi',
  'application/x-iso9660-image': 'iso',
  'application/vnd.android.package-archive': 'apk',
  'application/x-apple-diskimage': 'dmg',
  'application/vnd.debian.binary-package': 'deb',
  'application/x-deb': 'deb',
  'application/dash+xml': 'mpd',
  'application/f4m+xml': 'f4m',
  'application/vnd.apple.mpegurl': 'm3u8',
  'application/x-mpegurl': 'm3u8',
  'application/octet-stream-m3u8': 'm3u8',
  'video/vnd.mpeg.dash.mpd': 'mpd',
  'video/mpegurl': 'm3u8',
  'video/x-mpegurl': 'm3u8',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/quicktime': 'mov',
  'video/x-flv': 'flv',
  'video/flv': 'flv',
  'video/3gpp': '3gp',
  'video/3gpp2': '3gp',
  'video/x-ms-wmv': 'wmv',
  'video/x-ms-asf': 'asf',
  'video/avi': 'avi',
  'video/msvideo': 'avi',
  'video/x-msvideo': 'avi',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/mp4a-latm': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/x-ms-wma': 'wma',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx'
};

function extFromMime(mimeType = '') {
  const m = String(mimeType).split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[m] || '';
}


function atomicWriteJsonSync(targetPath, data) {
  const tmpPath = `${targetPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const bakPath = `${targetPath}.bak`;
  const jsonStr = JSON.stringify(data, null, 2);

  // 1. Geçici dosyaya yaz
  fs.writeFileSync(tmpPath, jsonStr, 'utf-8');

  // 2. Mevcut sağlam dosya varsa yedek kopyasını al (.bak)
  if (fs.existsSync(targetPath)) {
    try {
      fs.copyFileSync(targetPath, bakPath);
    } catch (e) { /* ignore */ }
  }

  // 3. Atomik taşıma / üzerine yazma
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    // Windows dosya kilidi durumunda kopyala ve sil yedeği
    try {
      fs.copyFileSync(tmpPath, targetPath);
      fs.unlinkSync(tmpPath);
    } catch (e2) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (e3) {}
      throw err;
    }
  }
}

function safeReadJsonSync(targetPath, fallbackValue = null) {
  const bakPath = `${targetPath}.bak`;
  if (fs.existsSync(targetPath)) {
    try {
      const data = fs.readFileSync(targetPath, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      console.error(`Error reading ${path.basename(targetPath)}:`, err.message);
      // Geçici okuma hatası (dosya kilidi, antivirüs, izin): dosya bozuk DEĞİL.
      // Bu durumda eski .bak'ı ana dosyanın üzerine kopyalamak, son yazılan
      // verileri sessizce geriye sarardı — yalnızca gerçek JSON bozulmasında kurtar.
      if (!(err instanceof SyntaxError)) return fallbackValue;
      // Ana dosya bozulduysa (.bak) yedeğinden kurtar
      if (fs.existsSync(bakPath)) {
        try {
          console.warn(`Attempting recovery from backup: ${path.basename(bakPath)}`);
          const bakData = fs.readFileSync(bakPath, 'utf-8');
          const parsed = JSON.parse(bakData);
          try { fs.copyFileSync(bakPath, targetPath); } catch (e) {}
          return parsed;
        } catch (bakErr) {
          console.error(`Backup ${path.basename(bakPath)} also corrupted:`, bakErr.message);
        }
      }
      // Bozuk dosya varsa ve yedekten kurtarılamadıysa, üzerine yazılmadan önce .corrupted_<timestamp> olarak kopyala
      try {
        const corruptBackup = `${targetPath}.corrupted_${Date.now()}`;
        fs.copyFileSync(targetPath, corruptBackup);
        console.warn(`Preserved corrupted file to ${path.basename(corruptBackup)} for recovery`);
      } catch (e) {}
    }
  }
  return fallbackValue;
}

class StorageService {
  constructor() {
    this.migrateLegacyDataDir();
    this.ensureDirectoryExists(DATA_DIR);
    this.ensureDirectoryExists(DEFAULT_DOWNLOAD_DIR);

    this.downloads = this.loadDownloads();
    this.settings = this.loadSettings();
    this.queues = this.loadQueues();
  }

  // OmniDownload döneminden kalan ~/.omnidownloader klasörünü (indirilenler
  // listesi, ayarlar, yt-dlp) yeni ~/.deepnode klasörüne taşır. Yalnızca yeni
  // klasör henüz yoksa ve eskisi varsa çalışır; başarısızlık sessizce yutulur.
  migrateLegacyDataDir() {
    try {
      if (fs.existsSync(LEGACY_DATA_DIR) && !fs.existsSync(DATA_DIR)) {
        fs.renameSync(LEGACY_DATA_DIR, DATA_DIR);
      }
    } catch (err) {
      console.error('Veri klasörü taşınamadı (.omnidownloader → .deepnode):', err.message);
    }
  }

  ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  loadDownloads() {
    const parsed = safeReadJsonSync(DOWNLOADS_FILE, null);
    if (Array.isArray(parsed)) {
      return parsed.map(item => ({
        ...item,
        queueId: item.queueId || 'main'
      }));
    }
    return [];
  }

  saveDownloads(downloadsList) {
    try {
      this.downloads = downloadsList;
      atomicWriteJsonSync(DOWNLOADS_FILE, downloadsList);
    } catch (err) {
      console.error('Error saving downloads.json:', err.message);
    }
  }

  loadQueues() {
    const parsed = safeReadJsonSync(QUEUES_FILE, null);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Ensure 'main' queue always exists
      if (!parsed.some(q => q.id === 'main')) {
        parsed.unshift({ ...DEFAULT_QUEUES[0] });
      }
      return parsed;
    }
    return JSON.parse(JSON.stringify(DEFAULT_QUEUES));
  }

  saveQueues(queuesList) {
    try {
      this.queues = queuesList;
      atomicWriteJsonSync(QUEUES_FILE, queuesList);
    } catch (err) {
      console.error('Error saving queues.json:', err.message);
    }
  }

  getQueues() {
    if (!this.queues || !this.queues.length) {
      this.queues = this.loadQueues();
    }
    return this.queues;
  }

  createQueue(name, options = {}) {
    if (!name || typeof name !== 'string') throw new Error('Queue name is required');
    const id = 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const newQueue = {
      id,
      name: name.trim(),
      maxConcurrent: Math.max(1, parseInt(options.maxConcurrent, 10) || 3),
      schedulerEnabled: !!options.schedulerEnabled,
      startTime: options.startTime || '02:00',
      stopTime: options.stopTime || '08:00',
      days: Array.isArray(options.days) ? options.days : [0, 1, 2, 3, 4, 5, 6],
      afterStop: options.afterStop || 'nothing',
      speedLimitKbps: Math.max(0, parseInt(options.speedLimitKbps, 10) || 0)
    };
    const list = [...this.getQueues(), newQueue];
    this.saveQueues(list);
    return newQueue;
  }

  updateQueue(id, updates = {}) {
    const list = this.getQueues().map(q => {
      if (q.id === id) {
        return {
          ...q,
          ...(updates.name && id !== 'main' ? { name: updates.name.trim() } : {}),
          ...(typeof updates.maxConcurrent !== 'undefined' ? { maxConcurrent: Math.max(1, parseInt(updates.maxConcurrent, 10) || 3) } : {}),
          ...(typeof updates.schedulerEnabled !== 'undefined' ? { schedulerEnabled: !!updates.schedulerEnabled } : {}),
          ...(typeof updates.startTime !== 'undefined' ? { startTime: updates.startTime } : {}),
          ...(typeof updates.stopTime !== 'undefined' ? { stopTime: updates.stopTime } : {}),
          ...(Array.isArray(updates.days) ? { days: updates.days } : {}),
          ...(updates.afterStop ? { afterStop: updates.afterStop } : {}),
          ...(typeof updates.speedLimitKbps !== 'undefined' ? { speedLimitKbps: Math.max(0, parseInt(updates.speedLimitKbps, 10) || 0) } : {})
        };
      }
      return q;
    });
    this.saveQueues(list);
    return list.find(q => q.id === id) || null;
  }

  deleteQueue(id) {
    if (id === 'main') throw new Error('Cannot delete main queue');
    const list = this.getQueues().filter(q => q.id !== id);
    this.saveQueues(list);
    return list;
  }

  loadSettings() {
    const defaultSettings = {
      anonymousId: null,
      downloadDir: DEFAULT_DOWNLOAD_DIR,
      maxConcurrentDownloads: 3,
      defaultSegments: 8,
      globalSpeedLimitKbps: 0, // 0 = Unlimited
      clipboardWatch: true,
      soundNotifications: true,
      ytDlpPath: '',

      // Başlangıç / pencere davranışı
      launchOnStartup: false,       // Windows açılışında başlat
      startMinimized: false,        // tepside gizli başlat
      minimizeToTrayOnClose: true,  // kapatma tuşu tepsiye küçültsün

      // İndirme davranışı
      useCategoryFolders: true,     // false ise tüm dosyalar doğrudan kök klasöre iner
      autoStartDownloads: true,     // eklenince hemen başlat (kapalıysa kuyrukta bekler)
      duplicateAction: 'rename',    // 'rename' | 'overwrite'
      maxRetries: 5,                // bağlantı koparsa yeniden deneme sayısı
      connectionTimeoutSec: 30,     // yanıt yoksa zaman aşımı

      // Bildirimler ve bitiş eylemi
      notifyOnComplete: true,
      confirmOnDelete: true,
      afterAllComplete: 'nothing',  // 'nothing' | 'exit' | 'shutdown' | 'sleep'

      // Antivirüs / Güvenlik Taraması (Windows Defender / Özel Antivirüs)
      virusScanEnabled: false,
      virusScannerPath: '',

      // Kategoriye özel klasör yolları (boş ise downloadDir/Kategori kullanılır)
      categoryDirs: {
        General: '',
        Compressed: '',
        Documents: '',
        Music: '',
        Programs: '',
        Video: '',
        Images: ''
      },

      // Proxy (Proxy/Socks ayarları)
      proxyEnabled: false,
      proxyHost: '',
      proxyPort: 8080,
      proxyUser: '',
      proxyPass: '',

      // Site girişleri (Site Logins): [{ host, user, pass }]
      siteLogins: [],

      // Zamanlayıcı (Scheduler)
      schedulerEnabled: false,
      scheduleStartTime: '02:00',   // kuyruğu başlat
      scheduleStopTime: '08:00',    // kuyruğu duraklat ('' = durdurma)
      scheduleDays: [1, 2, 3, 4, 5, 6, 0], // 0=Pazar ... 6=Cumartesi
      schedulerAfterStop: 'nothing', // 'nothing' | 'exit' | 'shutdown' | 'sleep'

      // Bakım
      autoUpdateYtDlp: true,
      theme: 'system', // 'system' | 'light' | 'dark'
      language: 'auto', // UI dili: 'auto' (Windows dili) | 'tr' | 'en'
      captureBypassKey: 'Shift', // hold this key while clicking a link to NOT capture it ('None' disables)
      captureEnabled: true, // master switch for automatic browser/clipboard capture
      enableFileFiltering: true,
      capturedExtensions: 'ZIP RAR 7Z TAR GZ ISO EXE MSI APK PDF DOCX XLSX PPTX MP4 MKV AVI MOV WEBM MP3 FLAC WAV',
      // Torrent dosyaları tarayıcıya bırakılır (torrent istemcisi açsın diye)
      ignoredExtensions: 'JS CSS HTML PHP JSON WOFF WOFF2 PNG JPG GIF SVG ICO XML TORRENT',
      telemetryEnabled: true
    };

    const settingsExisted = fs.existsSync(SETTINGS_FILE);
    const parsed = safeReadJsonSync(SETTINGS_FILE, null);
    if (!parsed && settingsExisted) {
      // Geçici okuma hatası (kilit/izin): varsayılanları DOSYAYA YAZMA — aksi
      // halde anlık bir EACCES/EBUSY tüm kullanıcı ayarlarını silerdi.
      console.error('settings.json okunamadı; dosya korunuyor, varsayılanlar bellekte kullanılacak.');
      defaultSettings.anonymousId = crypto.randomUUID();
      return defaultSettings;
    }
    if (parsed && typeof parsed === 'object') {
      const merged = { ...defaultSettings, ...parsed };
      if (!merged.downloadDir || merged.downloadDir === OLD_DEFAULT_DOWNLOAD_DIR) {
        merged.downloadDir = DEFAULT_DOWNLOAD_DIR;
      }
      if (merged.captureBypassKey === 'Alt') {
        merged.captureBypassKey = 'Shift';
      }
      if (!merged.anonymousId) {
        merged.anonymousId = crypto.randomUUID();
        try {
          atomicWriteJsonSync(SETTINGS_FILE, merged);
        } catch (e) {}
      }
      return merged;
    }
    defaultSettings.anonymousId = crypto.randomUUID();
    try {
      atomicWriteJsonSync(SETTINGS_FILE, defaultSettings);
    } catch (e) {}
    return defaultSettings;
  }

  getAnonymousId() {
    return this.settings?.anonymousId || null;
  }

  saveSettings(newSettings) {
    const previousSettings = this.settings;
    try {
      const currentAnonymousId = this.settings?.anonymousId;
      const existingProxyPass = this.settings?.proxyPass;
      const existingSiteLogins = this.settings?.siteLogins || [];

      // Şifre koruması: frontend sanitize edilmiş boş şifre döndürdüğünde ve
      // kullanıcı şifreyi açıkça değiştirmedikçe mevcut şifre ezilmez.
      // Ancak kullanıcı şifreyi silmek istediyse (proxyPassEdited === true), boş string geçerli sayılır.
      const sanitizedIncoming = { ...newSettings };
      if (sanitizedIncoming.proxyPassEdited !== true && (sanitizedIncoming.proxyPass === '' || sanitizedIncoming.proxyPass === undefined)) {
        if (existingProxyPass) {
          sanitizedIncoming.proxyPass = existingProxyPass;
        }
      }
      delete sanitizedIncoming.proxyPassEdited;

      if (Array.isArray(sanitizedIncoming.siteLogins)) {
        sanitizedIncoming.siteLogins = sanitizedIncoming.siteLogins.map(login => {
          const l = { ...login };
          if (l.passEdited !== true && !l.pass) {
            const match = existingSiteLogins.find(el => (l.id && el.id === l.id) || (el.site && el.site === l.site) || (el.host && el.host === l.host));
            if (match && match.pass) {
              l.pass = match.pass;
            }
          }
          delete l.hasPass;
          delete l.passEdited;
          return l;
        });
      }

      this.settings = { ...this.settings, ...sanitizedIncoming };
      if (!this.settings.anonymousId && currentAnonymousId) {
        this.settings.anonymousId = currentAnonymousId;
      } else if (!this.settings.anonymousId) {
        this.settings.anonymousId = crypto.randomUUID();
      }
      atomicWriteJsonSync(SETTINGS_FILE, this.settings);

      // Keep main queue concurrency in sync with settings.maxConcurrentDownloads
      if (typeof newSettings.maxConcurrentDownloads !== 'undefined') {
        const mc = Math.max(1, parseInt(newSettings.maxConcurrentDownloads, 10) || 3);
        const qList = this.getQueues().map(q => q.id === 'main' ? { ...q, maxConcurrent: mc } : q);
        this.saveQueues(qList);
      }

      return this.settings;
    } catch (err) {
      console.error('Error saving settings.json:', err.message);
      // Disk dolu/izin hatasında çağırana HATA dönmeli: aksi halde istemci
      // kaydın başarılı olduğunu sanıp arayüzü kapatıyor, ayar sessizce kayboluyordu.
      this.settings = previousSettings;
      throw err;
    }
  }

  shouldCaptureUrl(url, filename = '', mimeType = '') {
    if (!this.settings.enableFileFiltering) return true;

    let ext = '';
    if (filename && filename.includes('.')) {
      ext = path.extname(filename).toLowerCase();
    } else {
      try {
        const u = new URL(url);
        ext = path.extname(u.pathname).toLowerCase();
      } catch (e) {}
    }

    // No extension in the filename or URL -> fall back to the Content-Type
    // (torrent sites serve extensionless "?action=download&tid=…" URLs).
    if (!ext && mimeType) {
      const mimeExt = extFromMime(mimeType);
      if (mimeExt) ext = '.' + mimeExt;
    }

    if (!ext) return true;

    const cleanExt = ext.replace(/^\./, '').toUpperCase();

    // Lists accept entries with or without a leading dot (".torrent" == "TORRENT")
    const parseExtList = (str) => (str || '')
      .split(/[\s,;]+/)
      .map(s => s.trim().replace(/^\.+/, '').toUpperCase())
      .filter(Boolean);

    // Check ignored extensions list
    const ignored = parseExtList(this.settings.ignoredExtensions);
    if (ignored.includes(cleanExt)) {
      return false;
    }

    // Check captured extensions list
    const captured = parseExtList(this.settings.capturedExtensions);
    if (captured.length > 0) {
      return captured.includes(cleanExt);
    }

    return true;
  }

  getCategoryForFilename(filename, mimeType = '') {
    const ext = path.extname(filename).toLowerCase();
    
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.3gp', '.3gpp', '.asf', '.f4m', '.f4f', '.mpd', '.m3u8', '.ts'].includes(ext) || mimeType.startsWith('video/') || /mpegurl|dash\+xml|f4m\+xml/.test(mimeType)) {
      return 'Video';
    }
    if (['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.mid', '.midi'].includes(ext) || mimeType.startsWith('audio/')) {
      return 'Music';
    }
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso', '.xz', '.tgz', '.dmg'].includes(ext)) {
      return 'Compressed';
    }
    if (['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt', '.txt', '.epub', '.csv', '.tsv', '.rtf', '.odt'].includes(ext) || mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('spreadsheet') || mimeType.includes('presentation')) {
      return 'Documents';
    }
    if (['.exe', '.msi', '.bat', '.cmd', '.apk', '.sh', '.deb', '.rpm', '.appimage'].includes(ext)) {
      return 'Programs';
    }
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico', '.avif', '.tiff', '.tif'].includes(ext) || mimeType.startsWith('image/')) {
      return 'Images';
    }
    return 'General';
  }
}

export default new StorageService();
