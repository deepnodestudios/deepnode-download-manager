import fs from 'fs';
import path from 'path';
import os from 'os';

const DATA_DIR = path.join(os.homedir(), '.deepnode');
// Eski markanın veri klasörü; ilk çalıştırmada .deepnode'a taşınır (bir kez).
const LEGACY_DATA_DIR = path.join(os.homedir(), '.omnidownloader');
const DOWNLOADS_FILE = path.join(DATA_DIR, 'downloads.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Standart Windows "İndirilenler" (Downloads) klasörü
const DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads');
const OLD_DEFAULT_DOWNLOAD_DIR = path.join(os.homedir(), 'Downloads', 'OmniDownloads');

// Content-Type -> file extension, so extensionless download URLs (e.g. torrent
// sites serving "?action=download&tid=…") can still be classified by the
// captured/ignored file-type filter.
const MIME_TO_EXT = {
  'application/x-bittorrent': 'torrent',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.rar': 'rar',
  'application/x-7z-compressed': '7z',
  'application/gzip': 'gz',
  'application/x-tar': 'tar',
  'application/pdf': 'pdf',
  'application/x-msdownload': 'exe',
  'application/x-msdos-program': 'exe',
  'application/x-iso9660-image': 'iso',
  'application/vnd.android.package-archive': 'apk',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
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
    if (Array.isArray(parsed)) return parsed;
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

  loadSettings() {
    const defaultSettings = {
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
      afterAllComplete: 'nothing',  // 'nothing' | 'exit' | 'shutdown'

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

      // Bakım
      autoUpdateYtDlp: true,
      theme: 'system', // 'system' | 'light' | 'dark'
      language: 'auto', // UI dili: 'auto' (Windows dili) | 'tr' | 'en'
      captureBypassKey: 'Shift', // hold this key while clicking a link to NOT capture it ('None' disables)
      captureEnabled: true, // master switch for automatic browser/clipboard capture
      enableFileFiltering: true,
      capturedExtensions: 'ZIP RAR 7Z TAR GZ ISO EXE MSI APK PDF DOCX XLSX PPTX MP4 MKV AVI MOV WEBM MP3 FLAC WAV',
      // Torrent dosyaları tarayıcıya bırakılır (torrent istemcisi açsın diye)
      ignoredExtensions: 'JS CSS HTML PHP TS JSON WOFF WOFF2 PNG JPG GIF SVG ICO XML TORRENT'
    };

    const parsed = safeReadJsonSync(SETTINGS_FILE, null);
    if (parsed && typeof parsed === 'object') {
      const merged = { ...defaultSettings, ...parsed };
      if (!merged.downloadDir || merged.downloadDir === OLD_DEFAULT_DOWNLOAD_DIR) {
        merged.downloadDir = DEFAULT_DOWNLOAD_DIR;
      }
      if (merged.captureBypassKey === 'Alt') {
        merged.captureBypassKey = 'Shift';
      }
      return merged;
    }
    return defaultSettings;
  }

  saveSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      atomicWriteJsonSync(SETTINGS_FILE, this.settings);
      return this.settings;
    } catch (err) {
      console.error('Error saving settings.json:', err.message);
      return this.settings;
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
    
    if (['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v'].includes(ext) || mimeType.startsWith('video/')) {
      return 'Video';
    }
    if (['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'].includes(ext) || mimeType.startsWith('audio/')) {
      return 'Music';
    }
    if (['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso'].includes(ext)) {
      return 'Compressed';
    }
    if (['.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.txt', '.epub', '.csv'].includes(ext) || mimeType.includes('pdf') || mimeType.includes('document')) {
      return 'Documents';
    }
    if (['.exe', '.msi', '.bat', '.cmd', '.dmg', '.apk', '.sh'].includes(ext)) {
      return 'Programs';
    }
    if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp'].includes(ext) || mimeType.startsWith('image/')) {
      return 'Images';
    }
    return 'General';
  }
}

export default new StorageService();
