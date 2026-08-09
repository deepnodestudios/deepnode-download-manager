import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { spawn, spawnSync } from 'child_process';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { StringDecoder } from 'string_decoder';
import storageService from './StorageService.js';
import { proxyUrl, siteLoginFor } from './NetworkConfig.js';

// Proxy / site girişi ayarlarını yt-dlp argümanlarına çevirir
function networkArgs(url) {
  const args = [];
  const px = proxyUrl();
  if (px) args.push('--proxy', px);
  const login = siteLoginFor(url);
  if (login) {
    args.push('--username', login.user);
    if (login.pass) args.push('--password', login.pass);
  }
  return args;
}

// Oturum/token korumalı CDN'ler (ör. .txt olarak sunulan HLS) manifesti yalnızca
// tarayıcının kurduğu oturuma bağlı verir; çıplak URL+Referer 404 döner. yt-dlp'ye
// tarayıcının çerezlerini okutarak bunu aşarız. DDM_COOKIES_BROWSER boşsa devre dışı.
function cookieBrowserArgs() {
  const b = (process.env.DDM_COOKIES_BROWSER ?? 'chrome').trim();
  return b ? ['--cookies-from-browser', b] : [];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(os.homedir(), '.deepnode');
const isWin = process.platform === 'win32';

// Force yt-dlp to emit UTF-8 so Turkish characters (ı, ş, ğ, ç...) aren't mangled
const YTDLP_ENV = { 
  ...process.env, 
  PYTHONIOENCODING: 'utf-8', 
  PYTHONUTF8: '1',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8'
};

// Binaries shipped inside the app (resources/app/bin)
const BUNDLED_DIR = path.join(__dirname, '..', '..', '..', 'bin');
const BUNDLED_YTDLP = path.join(BUNDLED_DIR, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const BUNDLED_FFMPEG = path.join(BUNDLED_DIR, isWin ? 'ffmpeg.exe' : 'ffmpeg');
const YTDLP_NAME = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const YTDLP_PATH = path.join(DATA_DIR, YTDLP_NAME);
const YTDLP_URL = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

// FFmpeg
const FFMPEG_PATH = path.join(DATA_DIR, isWin ? 'ffmpeg.exe' : 'ffmpeg');
const FFMPEG_ZIP_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip';

// Known sites
const VIDEO_HOST_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com)$/i;

export function sanitizeFilename(name) {
  if (!name) return 'video.mp4';
  return name
    .replace(/[\/\\?%*:|"<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Eklenti, sekme başlığını dosya adı olarak gönderir; Shorts/SPA sayfalarında bu
// çoğu zaman "YouTube" gibi jenerik site adıdır. Bunu gerçek başlık sanmak
// dosyayı "YouTube [640p].mp4" yapıyordu — jenerik adlar başlık sorgusunu tetikler.
const GENERIC_TITLE_RE = /^(youtube(\s+shorts)?|youtu\.?be|shorts|tiktok|instagram|facebook|fb|twitter|x|vimeo|dailymotion|twitch|reddit|soundcloud|bilibili|video|watch|video download)$/i;
export function isGenericVideoTitle(name, url) {
  if (!name) return true;
  const base = String(name)
    .replace(/\.(mp4|mkv|webm|m4a|mp3|aac|opus)$/i, '')
    .replace(/\s*\[\d+p\]\s*$/i, '')
    .trim();
  if (!base) return true;
  if (GENERIC_TITLE_RE.test(base)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    const b = base.toLowerCase();
    if (b === host || b === host.split('.')[0]) return true;
  } catch (e) { /* url yoksa ad üzerinden karar verildi */ }
  return false;
}

export function isVideoSiteUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return VIDEO_HOST_RE.test(u.hostname);
  } catch (e) {
    return false;
  }
}

// HLS/DASH manifestleri (m3u8/mpd) siteden bağımsız olarak yt-dlp ile indirilir
export function isStreamManifestUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return /\.(m3u8|mpd)(\?|$)/i.test(u.pathname + u.search);
  } catch (e) {
    return false;
  }
}

let ytDlpReady = null;
const MIN_BIN_SIZE = 1000000;

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const tmp = dest + '.part';
    let file;
    try {
      file = fs.createWriteStream(tmp);
    } catch (err) {
      return reject(err);
    }
    const cleanup = () => { try { file.close(); } catch (e) {} try { fs.unlinkSync(tmp); } catch (e) {} };

    file.on('error', (err) => { cleanup(); reject(err); });

    const req = https.get(url, { headers: { 'User-Agent': 'DeepNode/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        cleanup();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        cleanup();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            try { fs.unlinkSync(dest); } catch (e) {}
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (err) {
            try { fs.unlinkSync(tmp); } catch (e) {}
            reject(err);
          }
        });
      });
    });
    req.on('error', (err) => { cleanup(); reject(err); });
  });
}

function isValidBinary(p) {
  try { return fs.statSync(p).size >= MIN_BIN_SIZE; } catch (e) { return false; }
}

let lastUpdateCheck = 0;

// yt-dlp'nin en güncel sürümünü DATA_DIR içine (yazılabilir kopya) indirir.
// Kurulu uygulamada paketlenmiş bin/ klasörü salt-okunurdur (Program Files);
// bu yüzden `-U` kendini güncelleyemez. Bu durumda güncel ikili buraya indirilir
// ve ensureYtDlp önbelleği sıfırlanır ki sonraki tüm işlemler taze sürümü kullansın.
async function downloadLatestYtDlp() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  await download(YTDLP_URL, YTDLP_PATH);
  if (isValidBinary(YTDLP_PATH)) {
    if (!isWin) { try { fs.chmodSync(YTDLP_PATH, 0o755); } catch (e) {} }
    ytDlpReady = null; // sonraki ensureYtDlp() çağrısı taze kopyayı çözümlesin
    return true;
  }
  return false;
}

export async function autoUpdateYtDlp(force = false) {
  const now = Date.now();
  if (!force && now - lastUpdateCheck < 6 * 3600 * 1000) return;
  lastUpdateCheck = now;

  let bin;
  try { bin = await ensureYtDlp(); } catch (e) { return; }

  // Salt-okunur paketli ikili kendini güncelleyemez -> yazılabilir kopya indir.
  // Böylece açılışta hâlâ eski (paketle gelen) sürümde olan kullanıcılar da
  // güncel sürüme otomatik geçer.
  if (path.resolve(bin) === path.resolve(BUNDLED_YTDLP)) {
    try {
      if (await downloadLatestYtDlp()) console.log('yt-dlp güncel sürümü indirildi (yazılabilir kopya).');
    } catch (e) { console.error('yt-dlp indirilemedi:', e.message); }
    return;
  }

  // Yazılabilir ikiliyi yerinde güncelle (-U). Başarısız olursa GitHub'dan taze indir.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const p = spawn(bin, ['-U'], { windowsHide: true, env: YTDLP_ENV });
      const decoder = new StringDecoder('utf-8');
      let out = '';
      p.stdout.on('data', (d) => { out += decoder.write(d); });
      p.stderr.on('data', (d) => { out += decoder.write(d); });
      p.on('error', finish);
      p.on('close', async (code) => {
        if (/Updated yt-dlp|Updating to|has been updated/i.test(out)) {
          console.log('yt-dlp güncellendi.');
        } else if (/up to date/i.test(out)) {
          // Zaten güncel — yapılacak bir şey yok.
        } else if (code !== 0 || /ERROR|failed|cannot|permission|read-only/i.test(out)) {
          // -U başarısız (ör. salt-okunur konum / ağ) -> güncel sürümü yazılabilir kopyaya indir.
          try {
            if (await downloadLatestYtDlp()) console.log('yt-dlp -U başarısız; güncel sürüm indirildi.');
          } catch (e) { console.error('yt-dlp yedek indirmesi başarısız:', e.message); }
        }
        finish();
      });
      setTimeout(() => { try { p.kill(); } catch (e) {} finish(); }, 90000);
    } catch (e) { finish(); }
  });
}

export async function ensureYtDlp() {
  if (ytDlpReady) return ytDlpReady;
  ytDlpReady = (async () => {
    const configured = storageService.settings.ytDlpPath;
    if (configured && fs.existsSync(configured)) return configured;

    try {
      const probe = spawnSync(isWin ? 'yt-dlp.exe' : 'yt-dlp', ['--version'], { encoding: 'utf-8', env: YTDLP_ENV });
      if (probe.status === 0) return isWin ? 'yt-dlp.exe' : 'yt-dlp';
    } catch (e) {}

    if (isValidBinary(YTDLP_PATH)) return YTDLP_PATH;

    try { fs.unlinkSync(YTDLP_PATH); } catch (e) {}
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      await download(YTDLP_URL, YTDLP_PATH);
      if (isValidBinary(YTDLP_PATH)) {
        if (!isWin) { try { fs.chmodSync(YTDLP_PATH, 0o755); } catch (e) {} }
        return YTDLP_PATH;
      }
    } catch (e) {}

    if (isValidBinary(BUNDLED_YTDLP)) return BUNDLED_YTDLP;

    throw new Error('yt-dlp not found. Check your internet connection or antivirus.');
  })().catch((err) => {
    ytDlpReady = null;
    throw err;
  });
  return ytDlpReady;
}

function runYtDlpJson(bin, url, extraArgs, timeoutMs) {
  return new Promise((resolve, reject) => {
    const args = [url, '-J', '--no-playlist', '--no-warnings', '--encoding', 'utf-8', '--socket-timeout', '20', ...networkArgs(url), ...extraArgs];
    const p = spawn(bin, args, { windowsHide: true, env: YTDLP_ENV });
    const stdoutDecoder = new StringDecoder('utf-8');
    const stderrDecoder = new StringDecoder('utf-8');
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += stdoutDecoder.write(d); });
    p.stderr.on('data', (d) => { err += stderrDecoder.write(d); });
    const timer = setTimeout(() => { try { p.kill(); } catch (e) {} }, timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const line = err.split('\n').find((l) => /ERROR/i.test(l));
        return reject(new Error(line || ('yt-dlp exit code ' + code)));
      }
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('Could not parse yt-dlp output')); }
    });
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// Hover-prefetch fırtınası koruması: her benzersiz video bir yt-dlp süreci
// doğurur; feed'de fare gezdirmek 10-30 eşzamanlı süreç başlatabilirdi
// (CPU/RAM sıçraması + siteden IP rate-limit riski). Aynı anahtar için uçuştaki
// sorgu paylaşılır, toplam eşzamanlı sorgu sayısı sınırlanır.
const MAX_INFO_PROBES = 3;
let activeInfoProbes = 0;
const infoProbeWaiters = [];
function acquireInfoSlot() {
  if (activeInfoProbes < MAX_INFO_PROBES) { activeInfoProbes++; return Promise.resolve(); }
  return new Promise((r) => infoProbeWaiters.push(r));
}
function releaseInfoSlot() {
  const next = infoProbeWaiters.shift();
  if (next) next(); else activeInfoProbes--;
}
const inflightInfo = new Map();

export function getVideoInfo(url, referer = null) {
  const cacheKey = url + '|' + (referer || '');
  const cached = infoCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < INFO_TTL) return Promise.resolve(cached.info);

  const running = inflightInfo.get(cacheKey);
  if (running) return running;

  const p = (async () => {
    await acquireInfoSlot();
    try {
      return await probeVideoInfo(url, referer, cacheKey);
    } finally {
      releaseInfoSlot();
    }
  })();
  inflightInfo.set(cacheKey, p);
  p.catch(() => {}).finally(() => inflightInfo.delete(cacheKey));
  return p;
}

async function probeVideoInfo(url, referer, cacheKey) {
  // Semafor beklerken başka bir sorgu cache'i doldurmuş olabilir
  const cached = infoCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < INFO_TTL) return cached.info;

  const bin = await ensureYtDlp();

  // Film/dizi sitelerinin CDN'leri Referer başlıksız manifest isteklerine 403 döner
  const refArgs = referer ? ['--referer', referer] : [];
  // Sniff edilmiş akış (referer var) oturum korumalı olabilir -> tarayıcı çerezleri
  const ckArgs = referer ? cookieBrowserArgs() : [];

  // Deneme SIRASI hız için kritik: `--cookies-from-browser chrome`, Chrome AÇIKKEN
  // (Chrome 127+ App-Bound şifreleme) çerez DB'sini okumak çok yavaştır / askıda kalır.
  // Bu yüzden önce ÇEREZSİZ (hızlı) deneriz; yalnızca o başarısız olursa (oturum korumalı
  // CDN) çerezlerle tekrar deneriz. Çoğu film-sitesi HLS'i sadece Referer ile çalışır.
  const attempts = referer
    ? [refArgs, [...refArgs, ...ckArgs]]
    : [[], ['--extractor-args', 'youtube:player_client=android']];

  let j, lastErr = null;
  for (const extra of attempts) {
    try { j = await runYtDlpJson(bin, url, extra, 30000); lastErr = null; break; }
    catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;

  const duration = j.duration || 0;
  const formats = (j.formats || []).map((f, idx) => ({ ...f, _i: idx }));
  const fsize = (f) => f.filesize || f.filesize_approx || (f.tbr && duration ? Math.round((f.tbr * 1000 / 8) * duration) : 0);

  const audioOnly = formats.filter((f) => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
  const bestAudioFmt = audioOnly.slice().sort((a, b) => a._i - b._i).pop();
  const bestAudio = bestAudioFmt ? fsize(bestAudioFmt) : 0;

  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== 'none' && f.height);
  const heightsSet = [...new Set(videoFormats.map((f) => f.height))].sort((a, b) => b - a);

  const qualities = heightsSet.map((h) => {
    const fmts = videoFormats.filter((f) => f.height === h);
    const best = fmts.slice().sort((a, b) => a._i - b._i).pop();
    let size = 0;
    if (best) {
      const hasAudio = best.acodec && best.acodec !== 'none';
      size = fsize(best) + (hasAudio ? 0 : bestAudio);
    }
    return { height: h, size };
  });

  // IDM benzeri ÇEŞİTLİLİK: aynı çözünürlükte hem düşük boyutlu (ör. AV1/mp4) hem yüksek
  // boyutlu (ör. H.264/mp4 veya VP9/webm) varyantı ayrı satır olarak sun. Her (kapsayıcı,
  // codec) ailesinden en yüksek bit hızlı formatı seçip dedup ederiz; kullanıcı hangi
  // format_id'yi seçerse indirme tam onu (+ en iyi ses) getirir.
  const codecName = (v) => {
    const c = (v || '').toLowerCase();
    if (c.startsWith('avc1') || c.startsWith('h264')) return 'H.264';
    if (c.startsWith('av01') || c.startsWith('av1')) return 'AV1';
    if (c.startsWith('vp9') || c.startsWith('vp09')) return 'VP9';
    if (c.startsWith('vp8') || c.startsWith('vp08')) return 'VP8';
    if (c.startsWith('hev1') || c.startsWith('hvc1') || c.startsWith('h265')) return 'H.265';
    return ((v || '').split('.')[0] || '').toUpperCase();
  };
  const containerName = (f) => {
    const e = (f.ext || '').toLowerCase();
    if (e === 'mp4' || e === 'm4v') return 'MP4';
    if (e === 'webm') return 'WebM';
    if (e === 'mkv') return 'MKV';
    return (e || '').toUpperCase();
  };

  const variants = [];
  for (const h of heightsSet) {
    const fmts = videoFormats.filter((f) => f.height === h);
    const groups = new Map(); // anahtar: "KAPSAYICI|CODEC" -> o ailenin en iyi bit hızlısı
    for (const f of fmts) {
      const key = containerName(f) + '|' + codecName(f.vcodec);
      const prev = groups.get(key);
      if (!prev || (fsize(f) || 0) > (fsize(prev) || 0)) groups.set(key, f);
    }
    for (const f of groups.values()) {
      const hasAudio = f.acodec && f.acodec !== 'none';
      const size = fsize(f) + (hasAudio ? 0 : bestAudio);
      variants.push({
        height: h,
        formatId: String(f.format_id),
        container: containerName(f),
        vcodec: codecName(f.vcodec),
        hasAudio: !!hasAudio,
        size
      });
    }
  }
  // Yükseklik azalan, sonra boyut azalan sırada düzenle (menüde derli toplu görünsün).
  variants.sort((a, b) => b.height - a.height || (b.size || 0) - (a.size || 0));

  const info = {
    title: j.title || null,
    thumbnail: j.thumbnail || null,
    duration,
    heights: heightsSet,
    qualities,
    variants,
    audioSize: bestAudio
  };
  infoCache.set(cacheKey, { info, ts: Date.now() });
  return info;
}

const infoCache = new Map();
const INFO_TTL = 10 * 60 * 1000;
// Süresi dolan girdiler yalnız okunurken atlanıyordu, hiç silinmiyordu —
// yoğun prefetch'te bellek uygulama ömrü boyunca büyürdü. Periyodik süpür.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of infoCache) {
    if ((now - v.ts) >= INFO_TTL) infoCache.delete(k);
  }
}, INFO_TTL).unref();

function ffmpegOnPath() {
  try {
    const p = spawnSync(isWin ? 'ffmpeg.exe' : 'ffmpeg', ['-version'], { encoding: 'utf-8', env: YTDLP_ENV });
    return p.status === 0;
  } catch (e) { return false; }
}

function findFileRecursive(dir, name) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = findFileRecursive(full, name);
      if (found) return found;
    } else if (e.name.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return null;
}

function extractZip(zipPath, destDir) {
  try {
    const t = spawnSync('tar', ['-xf', zipPath, '-C', destDir], { encoding: 'utf-8', env: YTDLP_ENV });
    if (t.status === 0) return true;
  } catch (e) {}
  try {
    const ps = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`], { encoding: 'utf-8', env: YTDLP_ENV });
    return ps.status === 0;
  } catch (e) { return false; }
}

let ffmpegReady = undefined;

export async function ensureFfmpeg(onProgress) {
  if (ffmpegReady !== undefined) return ffmpegReady;

  try {
    if (fs.statSync(BUNDLED_FFMPEG).size > 1000000) { ffmpegReady = BUNDLED_DIR; return ffmpegReady; }
  } catch (e) {}

  if (ffmpegOnPath()) { ffmpegReady = ''; return ffmpegReady; }
  if (fs.existsSync(FFMPEG_PATH) && (() => { try { return fs.statSync(FFMPEG_PATH).size > 1000000; } catch (e) { return false; } })()) {
    ffmpegReady = DATA_DIR;
    return ffmpegReady;
  }
  if (!isWin) { ffmpegReady = null; return ffmpegReady; }

  try {
    if (onProgress) onProgress();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const zip = path.join(DATA_DIR, 'ffmpeg_dl.zip');
    const tmpDir = path.join(DATA_DIR, 'ffmpeg_tmp');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(tmpDir, { recursive: true });

    await download(FFMPEG_ZIP_URL, zip);
    if (!extractZip(zip, tmpDir)) throw new Error('Could not extract zip');

    const ff = findFileRecursive(tmpDir, 'ffmpeg.exe');
    if (!ff) throw new Error('ffmpeg.exe not found');
    fs.copyFileSync(ff, FFMPEG_PATH);
    const fp = findFileRecursive(tmpDir, 'ffprobe.exe');
    if (fp) { try { fs.copyFileSync(fp, path.join(DATA_DIR, 'ffprobe.exe')); } catch (e) {} }

    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    try { fs.unlinkSync(zip); } catch (e) {}

    ffmpegReady = DATA_DIR;
    return ffmpegReady;
  } catch (err) {
    ffmpegReady = null;
    return ffmpegReady;
  }
}

const UNIT = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };
function toBytes(num, unit) { return Math.round(parseFloat(num) * (UNIT[unit] || 1)); }
function etaToSec(str) {
  const parts = str.split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

export class VideoDownloader extends EventEmitter {
  constructor(item) {
    super();
    this.kind = 'video';
    this.id = item.id;
    this.url = item.url;
    this.filename = item.filename || null;
    this.quality = item.quality || 'best';
    this.referer = item.referer || null; // akış yakalama: CDN Referer isteyebilir
    this.priority = item.priority || 'normal';
    this.saveDir = item.saveDir || path.join(storageService.settings.downloadDir, 'Video');
    this.savePath = item.savePath || null;
    this.status = item.status || 'queued';
    this.totalSize = item.totalSize || 0;
    this.downloadedBytes = item.downloadedBytes || 0;
    this.speed = 0;
    this.eta = 0;
    this.percent = item.percent || 0;
    this.checksum = null;
    this.segmentsCount = 1;
    this.preflight = item.preflight || false; // IDM ön indirmesi: onaylanana dek arayüzde gizli
    this.proc = null;
    this.errorMsg = item.errorMsg || null;
    this.createdFiles = new Set();
    // Çok akışlı (video+ses) indirmede kümülatif boyut takibi
    this._doneStreamsBytes = 0;
    this._curStreamPath = null;
    this._curStreamTotal = 0;
    // İndirme ekranında baştan gösterilecek SABİT toplam boyut (video+ses birlikte)
    this.plannedTotal = 0;
  }

  // Seçilen kaliteye göre indirmenin TOPLAM boyutunu (video+ses birleşik) döndürür.
  // getVideoInfo, her yükseklik için `qualities[].size` içinde bu birleşik boyutu verir.
  _plannedTotalFrom(info) {
    if (!info) return 0;
    if (this.quality === 'audio') return info.audioSize || 0;
    // Belirli bir format_id seçildiyse (eklenti varyant listesi), boyutu variants'tan al.
    if (this.quality && /^fmt:/.test(this.quality)) {
      const fid = this.quality.slice(4);
      const v = (info.variants || []).find((x) => String(x.formatId) === fid);
      if (v) return v.size || 0;
    }
    const qs = info.qualities || [];
    if (!qs.length) return 0;
    if (this.quality && this.quality !== 'best') {
      const h = parseInt(this.quality, 10);
      const eq = qs.find((q) => q.height === h && q.size);
      if (eq) return eq.size;
      // Format seçici `height<=` kullandığı için istenen yüksekliğe kadarki en iyiyi al.
      const le = qs.filter((q) => q.height <= h && q.size).sort((a, b) => b.height - a.height)[0];
      if (le) return le.size;
    }
    // 'best' ya da eşleşme yok: en yüksek kalite (qualities zaten yükseklik azalan sırada).
    const top = qs.find((q) => q.size);
    return top ? top.size || 0 : 0;
  }

  async start() {
    if (this.status === 'downloading') return;
    this.status = 'downloading';
    this.emit('status-change', { id: this.id, status: this.status });

    let bin;
    try {
      if (!this.filename || this.filename.includes('…')) {
        this.filename = 'Fetching video info…';
        this.emit('meta', { id: this.id });
      }
      bin = await ensureYtDlp();

      // Video bilgisini bir kez al (cache'li, ucuz): hem başlık hem de indirme
      // ekranında gösterilecek TOPLAM boyut (video+ses birlikte) için kullanılır.
      let vinfo = null;
      try { vinfo = await getVideoInfo(this.url, this.referer); } catch (e) {}

      // Resolve real video title if missing, placeholder or a generic site name
      if (vinfo && vinfo.title && (!this.filename || this.filename === 'Fetching video info…' ||
          this.filename === 'Video Download' || this.filename.includes('…') ||
          isGenericVideoTitle(this.filename, this.url))) {
        const hStr = this.quality && this.quality !== 'best' && this.quality !== 'audio' ? ` [${this.quality}p]` : '';
        this.filename = sanitizeFilename(`${vinfo.title}${hStr}.mp4`);
        this.emit('meta', { id: this.id });
      }

      // İndirme ekranında EN BAŞTAN sabit toplam boyut göster. Aksi hâlde çok akışlı
      // (önce video, sonra ses) indirmede önce yalnız video boyutu görünüp ses akışı
      // başlayınca boyut aniden büyüyordu. Planlı toplam = seçilen kalitenin video+ses
      // birleşik boyutu.
      const planned = this._plannedTotalFrom(vinfo);
      if (planned) {
        this.plannedTotal = planned;
        if (!this.totalSize || this.totalSize < planned) {
          this.totalSize = planned;
          this.percent = this.totalSize ? Math.min(100, ((this.downloadedBytes || 0) / this.totalSize) * 100) : (this.percent || 0);
          this.emit('progress', {
            id: this.id,
            downloadedBytes: this.downloadedBytes || 0,
            totalSize: this.totalSize,
            speed: 0,
            eta: 0,
            percent: Math.round(this.percent || 0),
            segments: []
          });
        }
      }
    } catch (err) {
      this.status = 'error';
      this.errorMsg = 'Could not download yt-dlp: ' + err.message;
      this.filename = 'Error: yt-dlp missing';
      this.emit('error', { id: this.id, error: this.errorMsg });
      return;
    }

    if (!fs.existsSync(this.saveDir)) fs.mkdirSync(this.saveDir, { recursive: true });

    const ffmpegLoc = await ensureFfmpeg();
    const merge = ffmpegLoc !== null;

    const q = this.quality;
    let format;
    if (q === 'audio') {
      format = 'ba/b';
    } else if (q && /^fmt:/.test(q)) {
      // Eklenti varyant listesinden gelen BELİRLİ video format_id'si. Kullanıcı aynı
      // çözünürlüğün küçük (AV1) ya da büyük (H.264/VP9) varyantını seçebilir; tam
      // seçtiği format + en iyi ses inip tek dosyaya birleşir (kapsayıcıyı yt-dlp seçer).
      // Güvenlik: format_id yalnızca güvenli karakterlere sınırlanır, aksi halde 'best'.
      const fid = q.slice(4);
      if (/^[a-zA-Z0-9_\-]+$/.test(fid)) {
        format = merge ? `${fid}+ba[ext=m4a]/${fid}+ba/${fid}` : `${fid}`;
      } else {
        format = merge ? 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b' : 'b[ext=mp4]/b';
      }
    } else if (q && q !== 'best') {
      const h = parseInt(q, 10);
      // mp4(avc1) video + m4a(AAC) ses tercih edilir: bu ikisi HERHANGİ bir ffmpeg
      // ile transcode gerektirmeden temiz mp4'e birleşir. webm/opus ses ise eski
      // ffmpeg'de "Postprocessing: Stream copy" hatası verip 3 ayrı dosya bırakıyordu.
      // Uygun mp4/m4a yoksa genel bv*+ba'ya, o da yoksa tek parça 'b'ye düşülür.
      format = merge
        ? `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`
        : `b[ext=mp4][height<=${h}]/b[height<=${h}]/b`;
    } else {
      format = merge
        ? 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b'
        : 'b[ext=mp4]/b';
    }
    // Eklenti/kullanıcı gerçek bir ad verdiyse (ör. sayfa başlığı) yt-dlp'nin %(title)s'i
    // yerine onu kullan — HLS master.txt gibi metadatasız kaynaklarda dosya "master" olmasın.
    let providedBase = null;
    if (this.filename && !this.filename.includes('…') &&
        !/^(Fetching video info|Preparing|Error:|Video Download)/.test(this.filename) &&
        !isGenericVideoTitle(this.filename, this.url)) {
      providedBase = sanitizeFilename(this.filename)
        .replace(/\.(mp4|mkv|webm|m4a|mp3|aac|opus)$/i, '')
        .replace(/\s*\[\d+p\]\s*$/i, '')
        .trim();
      if (!providedBase) providedBase = null;
    }
    const outName = q === 'audio'
      ? (providedBase ? `${providedBase}.%(ext)s` : '%(title)s.%(ext)s')
      : (providedBase ? `${providedBase} [%(height)sp].%(ext)s` : '%(title)s [%(height)sp].%(ext)s');
    const outTemplate = path.join(this.saveDir, outName);

    const args = [
      this.url,
      '--encoding', 'utf-8',
      '-f', format,
      '-o', outTemplate,
      '--no-playlist',
      '--newline',
      '--no-color',
      '--continue',
      '--force-overwrites',
      '--no-mtime',
      // %100'de takılma düzeltmesi & CDN korumaları: yanıt vermeyen soketler,
      // CDN anti-bot engelleri ve parça zaman aşımları için dayanıklı ayarlar.
      '--socket-timeout', '30',
      '--retries', '10',
      '--fragment-retries', '15',
      '--retry-sleep', '2',
      '--hls-use-mpegts',
      '--skip-unavailable-fragments',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      // Hız: DASH/HLS parçalarını IDM gibi PARALEL indir. Varsayılan (sıralı) indirmede
      // her parça sırayla iniyor ve bant genişliği boşta kalıyordu; N parça aynı anda
      // inince YouTube indirmeleri belirgin hızlanır. 4 güvenli/dengeli bir değer.
      '--concurrent-fragments', '4',
      '--progress-template', 'download:OMNI|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'
    ];
    args.push(...networkArgs(this.url)); // proxy / site girişi
    if (this.referer) args.push('--referer', this.referer);
    // NOT: `--merge-output-format mp4` ZORLAMIYORUZ. mp4'e zorlamak, akışlar
    // vp9/opus (webm) olduğunda eski bundled ffmpeg'de "Postprocessing: Stream
    // copy" hatası verip indirmeyi 3 parça (video+ses+0KB temp) hâlinde bırakıyordu.
    // Bayrak olmadan yt-dlp uyumlu konteyneri kendi seçer: mp4+m4a -> .mp4,
    // vp9+opus -> .webm, uyumsuz karışım -> .mkv. Her durumda TEK dosya, hata yok.
    // Format seçici zaten önce mp4+m4a tercih ettiği için yaygın durum yine .mp4.
    if (q === 'audio' && merge) args.push('-x', '--audio-format', 'mp3');
    if (ffmpegLoc) args.push('--ffmpeg-location', ffmpegLoc);

    // Oturum/token korumalı CDN'ler için tarayıcı çerezleri (sniff edilmiş akış = referer var).
    // Çerez okuma başarısız olursa (ör. Chrome App-Bound şifreleme) çerezsiz bir kez daha denenir.
    this._baseArgs = args;
    this._cookieArgs = this.referer ? cookieBrowserArgs() : [];
    this._cookieRetried = false;
    this._launch(bin, [...this._cookieArgs, ...args]);
  }

  _launch(bin, fullArgs) {
    // Her indirme denemesi (ilk deneme + yeniden denemeler) sıfırdan başlar; çok
    // akışlı (bv*+ba) boyut birikimini sıfırla ki toplam yanlış hesaplanmasın.
    this._doneStreamsBytes = 0;
    this._curStreamPath = null;
    this._curStreamTotal = 0;
    try {
      this.proc = spawn(bin, fullArgs, { windowsHide: true, env: YTDLP_ENV });
    } catch (err) {
      this.status = 'error';
      this.errorMsg = err.message;
      this.emit('error', { id: this.id, error: err.message });
      return;
    }

    // Takılma bekçisi: yt-dlp bazen %100'den sonra hiç çıktı vermeden asılı
    // kalıyor (ör. SABR/403 ses akışı). 120 sn sessizlikte süreç öldürülür;
    // close işleyicisi bunu hata/yeniden deneme akışına sokar.
    this._lastOutputTs = Date.now();
    this._stalled = false;
    if (this._stallTimer) clearInterval(this._stallTimer);
    this._stallTimer = setInterval(() => {
      if (this.status !== 'downloading' || !this.proc) return;
      if (Date.now() - this._lastOutputTs > 120000) {
        this._stalled = true;
        try {
          if (isWin && this.proc.pid) {
            spawnSync('taskkill', ['/F', '/T', '/PID', this.proc.pid.toString()]);
          } else {
            this.proc.kill('SIGKILL');
          }
        } catch (e) {}
      }
    }, 15000);
    if (this._stallTimer.unref) this._stallTimer.unref();

    this.proc.on('error', (err) => {
      this.proc = null;
      if (this.status === 'paused') return;
      this.status = 'error';
      this.errorMsg = 'Could not run yt-dlp (' + (err.code || '') + '). Your antivirus may be blocking it.';
      this.emit('error', { id: this.id, error: this.errorMsg });
    });

    const stdoutDecoder = new StringDecoder('utf-8');
    const stderrDecoder = new StringDecoder('utf-8');

    let buffer = '';
    const handleStdout = (chunk) => {
      this._lastOutputTs = Date.now();
      buffer += stdoutDecoder.write(chunk);
      const lines = buffer.split(/\r|\n/);
      buffer = lines.pop();
      for (const line of lines) this.parseLine(line);
    };

    let errBuffer = '';
    const handleStderr = (chunk) => {
      this._lastOutputTs = Date.now();
      errBuffer += stderrDecoder.write(chunk);
      const lines = errBuffer.split(/\r|\n/);
      errBuffer = lines.pop();
      for (const line of lines) this.parseLine(line);
    };

    this.proc.stdout.on('data', handleStdout);
    this.proc.stderr.on('data', handleStderr);

    this.proc.on('close', (code) => {
      this.proc = null;
      if (this._stallTimer) { clearInterval(this._stallTimer); this._stallTimer = null; }
      if (this.status === 'paused') return;
      if (code === 0) {
        this.status = 'completed';
        this.percent = 100;
        this.speed = 0;
        this.eta = 0;
        if (this.savePath && fs.existsSync(this.savePath)) {
          try {
            const sz = fs.statSync(this.savePath).size;
            if (sz) { this.totalSize = sz; this.downloadedBytes = sz; }
          } catch (e) {}
        }
        if (this.totalSize && !this.downloadedBytes) this.downloadedBytes = this.totalSize;
        this.emit('meta', { id: this.id });
        this.emit('status-change', { id: this.id, status: 'completed' });
        this.emit('completed', { id: this.id, savePath: this.savePath, checksum: null });
      } else if (this.status !== 'error') {
        // Çerez okuma hatası (ör. Chrome App-Bound / DPAPI) -> çerezsiz bir kez daha dene
        if (this._cookieArgs && this._cookieArgs.length && !this._cookieRetried &&
            /cookie|decrypt|dpapi/i.test(this.errorMsg || '')) {
          this._cookieRetried = true;
          this.errorMsg = null;
          this._launch(bin, this._baseArgs);
          return;
        }
        // YouTube web istemcisi takıldıysa/başarısızsa (SABR, 403, takılma
        // bekçisinin öldürmesi) android istemciyle bir kez daha dene.
        if (!this._ytRetried && this._baseArgs && this._isYouTube()) {
          this._ytRetried = true;
          const wasStalled = this._stalled;
          this._stalled = false;
          this.errorMsg = null;
          console.log(`[VideoDownloader] ${wasStalled ? 'stalled' : 'exit ' + code} -> retrying with android player client`);
          this._launch(bin, ['--extractor-args', 'youtube:player_client=android', ...this._baseArgs]);
          return;
        }
        this.status = 'error';
        this.errorMsg = this._stalled
          ? 'Download stalled (no data received)'
          : (this.errorMsg || ('yt-dlp exit code ' + code));
        this.emit('error', { id: this.id, error: this.errorMsg });
      }
    });
  }

  _isYouTube() {
    try {
      const host = new URL(this.url).hostname;
      return /(^|\.)(youtube\.com|youtu\.be)$/i.test(host);
    } catch (e) {
      return false;
    }
  }

  cleanup() {
    // 1. Force kill yt-dlp & child processes (ffmpeg) on Windows
    if (this.proc) {
      try {
        if (isWin && this.proc.pid) {
          spawnSync('taskkill', ['/F', '/T', '/PID', this.proc.pid.toString()]);
        } else {
          this.proc.kill('SIGKILL');
        }
      } catch (e) {}
      this.proc = null;
    }

    // 2. Delete all intermediate split stream files (.f401.mp4, .f251.webm, .temp.mp4, .part, .ytdl)
    if (this.status !== 'completed') {
      const deleteTargetFile = (filePath) => {
        if (!filePath) return;
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (err) {}
          }, 300);
        }
      };

      // Delete explicitly recorded file paths
      this.createdFiles.forEach(fPath => deleteTargetFile(fPath));

      // Delete main savePath if set
      if (this.savePath) deleteTargetFile(this.savePath);

      // Scan saveDir for any remaining partial files matching this download
      if (this.saveDir && fs.existsSync(this.saveDir)) {
        try {
          const files = fs.readdirSync(this.saveDir);
          
          let titlePrefix = '';
          if (this.filename && !this.filename.startsWith('Preparing') && !this.filename.startsWith('Fetching video info')) {
            titlePrefix = this.filename.replace(/\[\d+p\]|\.mp4|\.mkv|\.webm|\.f\d+.*$/g, '').trim();
          }

          // ÖNEMLİ: Eskiden `!titlePrefix` durumunda klasördeki TÜM yarım
          // dosyalar siliniyordu — aynı klasöre inen BAŞKA bir videonun
          // parçalarını da yok ediyordu. Artık ad öneki bilinmiyorsa yalnızca
          // bu indirmenin kendi kaydettiği dosyalar (createdFiles/savePath)
          // temizlenir; klasör taraması yapılmaz.
          if (titlePrefix) {
            files.forEach(f => {
              const fullPath = path.join(this.saveDir, f);
              const isPartialFile = f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.tmp') || f.includes('.temp.') || /\.f\d+\./.test(f);

              if (isPartialFile && f.startsWith(titlePrefix)) {
                deleteTargetFile(fullPath);
              }
            });
          }
        } catch (e) {
          console.error('Error scanning saveDir during cleanup:', e.message);
        }
      }
    }
  }

  parseLine(line) {
    if (!line) return;

    // Çok akışlı indirmede her yeni akış "[download] Destination:" ile başlar.
    // Yeni akışa geçildiğinde önceki akışın toplam boyutunu tabana taşı ki
    // OMNI ilerlemesinde toplam/indirilen düşmesin (boyut hesabı doğru kalsın).
    const destStart = line.match(/\[download\]\s+Destination:\s+(.+)$/);
    if (destStart) {
      const d = destStart[1].trim().replace(/^"|"$/g, '');
      if (this._curStreamPath && this._curStreamPath !== d) {
        this._doneStreamsBytes = (this._doneStreamsBytes || 0) + (this._curStreamTotal || 0);
        this._curStreamTotal = 0;
      }
      this._curStreamPath = d;
    }

    // Track output file paths
    let m = line.match(/\[download\]\s+Destination:\s+(.+)$/)
         || line.match(/Merging formats into\s+"(.+)"/)
         || line.match(/\[download\]\s+(.+?)\s+has already been downloaded/);
    if (m) {
      const rawPath = m[1].trim().replace(/^"|"$/g, '');
      if (rawPath) {
        this.createdFiles.add(rawPath);

        const baseName = path.basename(rawPath);
        let cleanName = baseName.replace(/\.f\d+\.[^/.]+$/, '').replace(/\.temp\.[^/.]+$/, '');
        if (!cleanName.endsWith('.mp4') && !cleanName.endsWith('.webm') && !cleanName.endsWith('.mkv') && !cleanName.endsWith('.mp3')) {
          cleanName += '.mp4';
        }
        cleanName = sanitizeFilename(cleanName);

        if (!rawPath.endsWith('.tmp') && !rawPath.endsWith('.part') && !rawPath.endsWith('.ytdl')) {
          this.savePath = rawPath.endsWith('.mp4') || rawPath.endsWith('.webm') || rawPath.endsWith('.mkv') ? rawPath : (this.savePath || rawPath);
          this.filename = cleanName;
          this.emit('meta', { id: this.id });
        }
      }
    }

    // Catch secondary partial files (e.g. .f401.mp4, .f251.webm, .temp.mp4)
    let partMatch = line.match(/\[(?:download|ffmpeg|Merger|VideoConvertor)\]\s+(?:Destination:\s+|Merging formats into\s+"?)([^"\r\n]+)/i);
    if (partMatch && partMatch[1]) {
      const p = partMatch[1].trim().replace(/^"|"$/g, '');
      if (p.includes('.')) {
        this.createdFiles.add(p);
      }
    }

    // Machine-readable progress: OMNI|downloaded|total|total_estimate|speed|eta
    const oi = line.indexOf('OMNI|');
    if (oi !== -1) {
      const p = line.slice(oi + 5).split('|');
      const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
      const downloaded = num(p[0]);
      const total = num(p[1]) || num(p[2]);
      // Çok akışlı indirmede (video sonra ses) her akışın total'ı ayrı raporlanır;
      // önceki akışların toplamını tabana ekleyerek boyutun düşmesini engelle.
      const base = this._doneStreamsBytes || 0;
      if (total) this._curStreamTotal = total;
      this.downloadedBytes = Math.round(base + downloaded);
      const combinedTotal = base + (this._curStreamTotal || total || 0);
      // Toplam boyut ASLA küçülmesin: baştan hesaplanan planlı toplamı ve o ana dek
      // görülen en büyük değeri taban al. Çok akışlıda tek akışın total'ı gerçek
      // birleşik boyuttan küçük olduğu için ekranda boyut düşmesin.
      const bestTotal = Math.max(combinedTotal || 0, this.plannedTotal || 0, this.totalSize || 0);
      if (bestTotal) this.totalSize = Math.round(bestTotal);
      this.speed = Math.round(num(p[3]));
      this.eta = Math.round(num(p[4]));
      this.percent = this.totalSize ? Math.min(100, (this.downloadedBytes / this.totalSize) * 100) : this.percent;
      this.emit('progress', {
        id: this.id,
        downloadedBytes: this.downloadedBytes,
        totalSize: this.totalSize,
        speed: this.speed,
        eta: this.eta,
        percent: Math.round(this.percent),
        segments: []
      });
      return;
    }

    // Fallback progress parser
    m = line.match(/\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)(B|KiB|MiB|GiB|TiB)(?:\s+at\s+([\d.]+)(B|KiB|MiB|GiB|TiB)\/s)?(?:\s+ETA\s+([\d:]+))?/);
    if (m) {
      this.percent = parseFloat(m[1]);
      this.totalSize = toBytes(m[2], m[3]);
      this.downloadedBytes = Math.round(this.totalSize * this.percent / 100);
      this.speed = m[4] ? toBytes(m[4], m[5]) : 0;
      this.eta = m[6] ? etaToSec(m[6]) : 0;
      this.emit('progress', {
        id: this.id,
        downloadedBytes: this.downloadedBytes,
        totalSize: this.totalSize,
        speed: this.speed,
        eta: this.eta,
        percent: Math.round(this.percent),
        segments: []
      });
    }

    if (/^ERROR:/.test(line)) {
      this.errorMsg = line.replace(/^ERROR:\s*/, '').slice(0, 300);
    }
  }

  pause() {
    if (this.status !== 'downloading') return;
    this.status = 'paused';
    this.speed = 0;
    this.eta = 0;
    if (this.proc) {
      try {
        if (isWin && this.proc.pid) {
          spawnSync('taskkill', ['/F', '/T', '/PID', this.proc.pid.toString()]);
        } else {
          this.proc.kill('SIGTERM');
        }
      } catch (e) {}
    }
    this.emit('status-change', { id: this.id, status: this.status });
  }

  toSnapshot() {
    return {
      id: this.id,
      kind: 'video',
      url: this.url,
      filename: this.filename,
      quality: this.quality,
      referer: this.referer,
      priority: this.priority,
      saveDir: this.saveDir,
      savePath: this.savePath,
      category: 'Video',
      totalSize: this.totalSize,
      downloadedBytes: this.downloadedBytes,
      status: this.status,
      speed: this.speed,
      eta: this.eta,
      percent: Math.round(this.percent),
      segmentsCount: 1,
      checksum: null,
      errorMsg: this.errorMsg,
      preflight: this.preflight ? true : undefined,
      segments: []
    };
  }
}
