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

export function isVideoSiteUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return VIDEO_HOST_RE.test(u.hostname);
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
export async function autoUpdateYtDlp(force = false) {
  const now = Date.now();
  if (!force && now - lastUpdateCheck < 6 * 3600 * 1000) return;
  lastUpdateCheck = now;

  let bin;
  try { bin = await ensureYtDlp(); } catch (e) { return; }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try {
      const p = spawn(bin, ['-U'], { windowsHide: true, env: YTDLP_ENV });
      const decoder = new StringDecoder('utf-8');
      let out = '';
      p.stdout.on('data', (d) => { out += decoder.write(d); });
      p.stderr.on('data', (d) => { out += decoder.write(d); });
      p.on('error', finish);
      p.on('close', () => {
        if (/Updated yt-dlp|Updating to|has been updated/i.test(out)) {
          console.log('yt-dlp güncellendi.');
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

export async function getVideoInfo(url) {
  const cached = infoCache.get(url);
  if (cached && (Date.now() - cached.ts) < INFO_TTL) return cached.info;

  const bin = await ensureYtDlp();

  let j;
  try {
    j = await runYtDlpJson(bin, url, [], 45000);
  } catch (e1) {
    j = await runYtDlpJson(bin, url, ['--extractor-args', 'youtube:player_client=android'], 45000);
  }

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

  const info = {
    title: j.title || null,
    thumbnail: j.thumbnail || null,
    duration,
    heights: heightsSet,
    qualities,
    audioSize: bestAudio
  };
  infoCache.set(url, { info, ts: Date.now() });
  return info;
}

const infoCache = new Map();
const INFO_TTL = 10 * 60 * 1000;

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
    this.proc = null;
    this.errorMsg = item.errorMsg || null;
    this.createdFiles = new Set();
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

      // Resolve real video title if missing or placeholder
      if (!this.filename || this.filename === 'Fetching video info…' || this.filename === 'Video Download' || this.filename.includes('…')) {
        try {
          const info = await getVideoInfo(this.url);
          if (info && info.title) {
            const hStr = this.quality && this.quality !== 'best' && this.quality !== 'audio' ? ` [${this.quality}p]` : '';
            this.filename = sanitizeFilename(`${info.title}${hStr}.mp4`);
            this.emit('meta', { id: this.id });
          }
        } catch (e) {}
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
    } else if (q && q !== 'best') {
      const h = parseInt(q, 10);
      format = merge
        ? `bv*[height<=${h}]+ba/b[height<=${h}]/b`
        : `b[ext=mp4][height<=${h}]/b[height<=${h}]/b`;
    } else {
      format = merge ? 'bv*+ba/b' : 'b[ext=mp4]/b';
    }
    const outTemplate = q === 'audio'
      ? path.join(this.saveDir, '%(title)s.%(ext)s')
      : path.join(this.saveDir, '%(title)s [%(height)sp].%(ext)s');

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
      '--progress-template', 'download:OMNI|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'
    ];
    args.push(...networkArgs(this.url)); // proxy / site girişi
    if (merge && q !== 'audio') args.push('--merge-output-format', 'mp4');
    if (q === 'audio' && merge) args.push('-x', '--audio-format', 'mp3');
    if (ffmpegLoc) args.push('--ffmpeg-location', ffmpegLoc);

    try {
      this.proc = spawn(bin, args, { windowsHide: true, env: YTDLP_ENV });
    } catch (err) {
      this.status = 'error';
      this.errorMsg = err.message;
      this.emit('error', { id: this.id, error: err.message });
      return;
    }

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
      buffer += stdoutDecoder.write(chunk);
      const lines = buffer.split(/\r|\n/);
      buffer = lines.pop();
      for (const line of lines) this.parseLine(line);
    };

    let errBuffer = '';
    const handleStderr = (chunk) => {
      errBuffer += stderrDecoder.write(chunk);
      const lines = errBuffer.split(/\r|\n/);
      errBuffer = lines.pop();
      for (const line of lines) this.parseLine(line);
    };

    this.proc.stdout.on('data', handleStdout);
    this.proc.stderr.on('data', handleStderr);

    this.proc.on('close', (code) => {
      this.proc = null;
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
        this.emit('completed', { id: this.id, savePath: this.savePath, checksum: null });
      } else if (this.status !== 'error') {
        this.status = 'error';
        this.errorMsg = this.errorMsg || ('yt-dlp exit code ' + code);
        this.emit('error', { id: this.id, error: this.errorMsg });
      }
    });
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

          files.forEach(f => {
            const fullPath = path.join(this.saveDir, f);
            const isPartialFile = f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.tmp') || f.includes('.temp.') || /\.f\d+\./.test(f);

            if (isPartialFile) {
              if (!titlePrefix || f.startsWith(titlePrefix) || (this.filename && f.includes(this.filename.substring(0, 8)))) {
                deleteTargetFile(fullPath);
              }
            }
          });
        } catch (e) {
          console.error('Error scanning saveDir during cleanup:', e.message);
        }
      }
    }
  }

  parseLine(line) {
    if (!line) return;

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
      this.downloadedBytes = Math.round(downloaded);
      if (total) this.totalSize = Math.round(total);
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
      segments: []
    };
  }
}
