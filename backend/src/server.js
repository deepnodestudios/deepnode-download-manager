import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import storageService from './services/StorageService.js';
import queueManager from './services/QueueManager.js';
import { LinkSniffer } from './services/LinkSniffer.js';
import { DownloadEngine } from './services/DownloadEngine.js';
import { getVideoInfo, autoUpdateYtDlp, isVideoSiteUrl } from './services/VideoDownloader.js';
import { startScheduler, schedulerStatus } from './services/Scheduler.js';
import { corsOptions, originGuard, appOnly, isExtensionOrigin, settingsForExtension } from './security.js';
import { createUpdateRouter } from './routes/update.js';
import { showItemInFolder, openPath } from './utils/shell.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const serverEvents = new EventEmitter();

// Browser session headers (cookie/referer/user-agent) captured by the extension.
// The confirm dialog only carries the URL, so we stash them here and re-attach
// them when the user confirms the download. Entries expire after 10 minutes.
const pendingHeaders = new Map();
const PENDING_TTL = 10 * 60 * 1000;

function stashHeaders(url, headers) {
  if (!url || !headers || Object.keys(headers).length === 0) return;
  pendingHeaders.set(url, { headers, ts: Date.now() });
  if (pendingHeaders.size > 200) {
    const now = Date.now();
    for (const [k, v] of pendingHeaders) {
      if (now - v.ts > PENDING_TTL) pendingHeaders.delete(k);
    }
    // Süresi dolmuş girdi yoksa da sınırı uygula: 200+ TAZE yakalama patlaması
    // çerezleri bellekte tutmaya devam etmesin — en eskiler atılır.
    while (pendingHeaders.size > 200) {
      pendingHeaders.delete(pendingHeaders.keys().next().value);
    }
  }
}

function takeHeaders(url, provided) {
  if (provided && Object.keys(provided).length > 0) return provided;
  const hit = pendingHeaders.get(url);
  if (!hit) return {};
  if (Date.now() - hit.ts > PENDING_TTL) { pendingHeaders.delete(url); return {}; }
  pendingHeaders.delete(url);
  return hit.headers;
}

// Filenames resolved during automatic capture (via a HEAD probe) so the confirm
// dialog / download shows the real name instead of re-probing or "downloaded_file".
const pendingNames = new Map();
function stashName(url, filename) {
  if (!url || !filename) return;
  pendingNames.set(url, { filename, ts: Date.now() });
  if (pendingNames.size > 200) {
    const now = Date.now();
    for (const [k, v] of pendingNames) {
      if (now - v.ts > PENDING_TTL) pendingNames.delete(k);
    }
    while (pendingNames.size > 200) { // taze patlamada da sınırı koru
      pendingNames.delete(pendingNames.keys().next().value);
    }
  }
}
function peekName(url) {
  const hit = pendingNames.get(url);
  if (!hit) return '';
  if (Date.now() - hit.ts > PENDING_TTL) { pendingNames.delete(url); return ''; }
  return hit.filename;
}

// Does a usable file extension exist in the given filename or the URL path?
function hasUsableExt(filename, url) {
  if (filename && /\.[a-z0-9]{1,8}$/i.test(filename)) return true;
  try {
    const p = new URL(url).pathname;
    if (/\.[a-z0-9]{1,8}$/i.test(p)) return true;
  } catch (e) { /* ignore */ }
  return false;
}

// IDM davranışı: onay penceresi açılır açılmaz arka planda GIZLI bir ön indirme
// (preflight) başlar. Kullanıcı "İndirmeyi Başlat" deyince aynı motor kaldığı
// yerden devam eder (confirm-preflight); pencere kapatılır/vazgeçilirse parçalar
// silinir (cancel-preflight). Videolar (yt-dlp) kalite seçimine bağlı olduğundan
// ön indirme yapılmaz.
const preflights = new Map(); // url -> { id, promise }
const PREFLIGHT_TTL = 15 * 60 * 1000; // onaylanmadan unutulan pencereler için emniyet

function dropPreflight(url, entry) {
  if (preflights.get(url) !== entry) return;
  if (entry.confirming) return; // onay işlemi sürüyor — iptal yarışı hayalet indirme bırakır
  preflights.delete(url);
  if (!entry.id) return;
  const snap = queueManager.getDownloadById(entry.id);
  if (snap && snap.preflight) queueManager.deleteDownload(entry.id, true);
}

// Onaylanan ekleme, bekleyen ön indirmeyi devralır: kullanıcının ad/klasörü
// uygulanıp AYNI motor kaldığı baytlardan sürer. Devralınacak ön indirme yoksa
// null döner ve normal ekleme yapılır. confirming bayrağı, pencere kapanırken
// gönderilen cancel-preflight'ın bu sırada kaydı silmesini engeller.
async function confirmPreflightForUrl(url, opts) {
  const entry = url ? preflights.get(url) : null;
  if (!entry || entry.confirming) return null;
  entry.confirming = true;
  try {
    // Ön indirme henüz hazırlanıyorsa (HEAD sürüyor) kurulmasını bekle
    if (!entry.id && entry.promise) { try { await entry.promise; } catch (e) { /* ignore */ } }
    if (!entry.id) { preflights.delete(url); return null; }

    const snap = await queueManager.confirmPreflight(entry.id, opts);
    preflights.delete(url);
    if (snap) {
      if (snap.status === 'completed') {
        if (opts && opts.autoStart !== false) {
          serverEvents.emit('download-completed', snap);
        }
      } else if (opts && opts.autoStart !== false) {
        serverEvents.emit('open-progress', entry.id);
      }
    }
    return snap || null;
  } catch (e) {
    entry.confirming = false;
    dropPreflight(url, entry); // kalıntı bırakma; çağran normal eklemeye düşer
    return null;
  }
}

function startPreflight(url, filename, headers) {
  try {
    if (preflights.has(url)) return;
    if (isVideoSiteUrl(url)) return;

    const entry = { id: null, promise: null };
    preflights.set(url, entry);

    entry.promise = queueManager
      .addDownload(url, filename || peekName(url) || null, null, null, false, 'best', null, headers || {}, true)
      .then((item) => {
        if (preflights.get(url) !== entry) {
          // pencere ön indirme hazırlanırken kapatıldı — kalıntı bırakma
          if (item && item.id) queueManager.deleteDownload(item.id, true);
          return;
        }
        if (!item || !item.id) { preflights.delete(url); return; }
        entry.id = item.id;
        queueManager.startDownload(item.id);
        setTimeout(() => dropPreflight(url, entry), PREFLIGHT_TTL);
      })
      .catch(() => { if (preflights.get(url) === entry) preflights.delete(url); });
  } catch (e) { /* ön indirme başlamasa da onay penceresi normal çalışır */ }
}


// Video ön indirmesi (yt-dlp): onay penceresi açılırken eklentide seçilen kaliteyle
// arka planda GIZLI indirmeye başla. Kullanıcı "İndir" derse aynı motor kaldığı
// baytlardan devam eder (confirm-video-preflight); pencere kapanırsa parçalar silinir
// (cancel-preflight, dosya ön indirmesiyle aynı yol). Video siteleri kalite seçimine
// bağlı olduğundan bu yol dosya startPreflight'ından ayrıdır.
function startVideoPreflight(url, quality, referer, filename) {
  try {
    if (!url || preflights.has(url)) return;

    const entry = { id: null, promise: null, video: true };
    preflights.set(url, entry);

    entry.promise = queueManager
      .addDownload(url, filename || null, 'Video', 1, true, quality || 'best', null, null, true, referer || null)
      .then((item) => {
        if (preflights.get(url) !== entry) {
          // pencere ön indirme hazırlanırken kapatıldı — kalıntı bırakma
          if (item && item.id) queueManager.deleteDownload(item.id, true);
          return;
        }
        if (!item || !item.id) { preflights.delete(url); return; }
        entry.id = item.id;
        queueManager.startDownload(item.id);
        setTimeout(() => dropPreflight(url, entry), PREFLIGHT_TTL);
      })
      .catch(() => { if (preflights.get(url) === entry) preflights.delete(url); });
  } catch (e) { /* ön indirme başlamasa da onay penceresi normal çalışır */ }
}

// Onaylanan video eklemesi bekleyen video ön indirmesini devralır: kalite/klasör/ad
// tabanı aynıysa aynı motor kaldığı baytlardan sürer. Devralınamıyorsa (değişmiş
// ya da yok) ön indirme silinir ve null döner — çağıran normal eklemeye düşer.
async function confirmVideoPreflightForUrl(url, opts) {
  const entry = url ? preflights.get(url) : null;
  if (!entry || !entry.video || entry.confirming) return null;
  entry.confirming = true;
  try {
    if (!entry.id && entry.promise) { try { await entry.promise; } catch (e) { /* ignore */ } }
    if (!entry.id) { preflights.delete(url); return null; }
    const snap = queueManager.confirmVideoPreflight(entry.id, opts || {});
    if (!snap) {
      // Kalite/klasör/ad değişti: kaldığı yerden devam mümkün değil — parçaları sil,
      // çağıran sıfırdan indirir.
      entry.confirming = false;
      dropPreflight(url, entry);
      return null;
    }
    preflights.delete(url);
    if (snap.status === 'completed') {
      if (opts && opts.autoStart !== false) {
        serverEvents.emit('download-completed', snap);
      }
    } else if (opts && opts.autoStart !== false) {
      serverEvents.emit('open-progress', entry.id);
    }
    return snap;
  } catch (e) {
    entry.confirming = false;
    dropPreflight(url, entry);
    return null;
  }
}


// Dinlenen port: 5000 doluysa çalışma anında bir sonrakine düşülür (bkz. listen).
// Güvenlik katmanı beyaz listeyi bu değerle kurduğu için fonksiyonla okunur.
const DEFAULT_PORT = Number(process.env.DN_PORT) || 5000;
let activePort = DEFAULT_PORT;
const getPort = () => activePort;

const app = express();

// GÜVEN SINIRI (bkz. security.js): yalnız tarayıcı uzantısı ve uygulamanın kendi
// penceresi API'yi kullanabilir. Ziyaret edilen web sayfaları hem yanıtı okuyamaz
// (CORS beyaz listesi) hem de isteği hiç işlenmeden reddedilir (originGuard).
app.use(cors(corsOptions(getPort)));
app.use(express.json({ limit: '1mb' }));
app.use('/api', originGuard(getPort));

// Serve static frontend dist for web and electron
const distPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket real-time broadcasting
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // İşlenmeyen 'error' olayı süreci düşürebilirdi
  ws.on('error', (err) => {
    console.error('WebSocket client error:', err.message);
    clients.delete(ws);
  });

  // Send initial state upon connection
  ws.send(JSON.stringify({
    type: 'INIT_STATE',
    payload: {
      downloads: queueManager.getAllDownloads(),
      settings: storageService.settings
    }
  }));

  ws.on('close', () => {
    clients.delete(ws);
  });
});

wss.on('error', (err) => console.error('WebSocket server error:', err.message));

// Kalp atışı: uyku/ağ kopması sonrası ölü bağlantılar `clients` kümesinde
// birikip her yayında boşa serileştirmeye yol açıyordu.
const wsHeartbeat = setInterval(() => {
  clients.forEach((ws) => {
    if (ws.isAlive === false) {
      clients.delete(ws);
      try { ws.terminate(); } catch (e) { /* zaten kapalı */ }
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* zaten kapalı */ }
  });
}, 30000);
wsHeartbeat.unref();

queueManager.setBroadcastCallback((message) => {
  // Let the Electron layer react to finished downloads (notification / sound /
  // "after all downloads" action).
  try {
    if (message && message.type === 'COMPLETED') {
      const snap = queueManager.getDownloadById(message.payload.id);
      const isPreflight = Boolean(
        (snap && snap.preflight) || (message.payload && message.payload.preflight)
      );
      if (!isPreflight) {
        serverEvents.emit('download-completed', snap || message.payload);

        const busy = queueManager.getAllDownloads().some(
          (d) => (d.status === 'downloading' || d.status === 'merging' || d.status === 'queued') && !d.preflight
        );
        if (!busy) serverEvents.emit('all-complete');
      }
    }
  } catch (e) { /* ignore */ }

  // Görev çubuğu ilerlemesi: aktif indirmelerin toplam ilerlemesini Electron'a bildir
  try { emitTaskbarProgress(message && message.type !== 'PROGRESS'); } catch (e) { /* ignore */ }

  const jsonStr = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(jsonStr);
    }
  });
});

// Windows görev çubuğu ilerleme çubuğu için birleşik ilerleme (0..1, -1 = gizle).
// PROGRESS mesajları çok sık geldiğinden 400ms'de bir hesaplanır; durum
// değişimleri (tamamlandı/duraklatıldı vb.) throttle'ı atlar ki çubuk anında kalksın.
let lastTaskbarEmit = 0;
function emitTaskbarProgress(force) {
  const now = Date.now();
  if (!force && now - lastTaskbarEmit < 400) return;
  lastTaskbarEmit = now;

  const active = queueManager.getAllDownloads().filter(
    (d) => (d.status === 'downloading' || d.status === 'merging') && !d.preflight
  );
  let value = -1; // aktif indirme yok → çubuğu kaldır
  if (active.length > 0) {
    let total = 0, done = 0;
    for (const d of active) {
      const t = Number(d.totalSize) || 0;
      if (t > 0) { total += t; done += Math.min(Number(d.downloadedBytes) || 0, t); }
    }
    // Boyutu bilinmeyen indirmeler (t=0) toplam dışı; hiçbirinin boyutu yoksa belirsiz mod
    value = total > 0 ? done / total : 2;
  }
  serverEvents.emit('taskbar-progress', value);
}

// REST API Endpoints

// 1. Get all downloads
app.get('/api/downloads', appOnly(getPort), (req, res) => {
  res.json(queueManager.getAllDownloads());
});

// 2. Inspect URL metadata before adding
app.post('/api/download/inspect', async (req, res) => {
  const { url, headers } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  try {
    // Reuse the browser session captured at capture-time so cookie/login
    // protected links (e.g. torrent sites) return the real file metadata.
    // (takeHeaders gibi TTL'e uy; ama girdiyi SİLME — onay anında hâlâ lazım.)
    const hit = pendingHeaders.get(url);
    const fresh = hit && (Date.now() - hit.ts) <= PENDING_TTL;
    const sessionHeaders = (headers && Object.keys(headers).length) ? headers : (fresh ? hit.headers : {});
    const info = await DownloadEngine.inspectUrl(url, sessionHeaders);
    // Prefer a filename already resolved during automatic capture.
    const cached = peekName(url);
    if (cached && (!info.filename || !/\.[a-z0-9]{1,8}$/i.test(info.filename))) {
      info.filename = cached;
      info.category = storageService.getCategoryForFilename(cached, info.contentType || '');
    }
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Inspect video formats / qualities for video sites (YouTube, Vimeo, etc.)
app.post('/api/video/formats', async (req, res) => {
  const { url, referer } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const info = await getVideoInfo(url, referer || null);
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch formats: ' + err.message });
  }
});

// 4. Prompt Download Dialog in UI for captured URL
app.post('/api/download/prompt-add', appOnly(getPort), (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // Opens the dedicated add-window (main.js listens to this event).
  // Note: do NOT also broadcast to the main window, or two dialogs would open.
  serverEvents.emit('prompt-add', url);
  res.json({ success: true });
});

// 4.5. Native Windows Folder Browser Dialog Endpoint
app.post('/api/select-folder', appOnly(getPort), async (req, res) => {
  if (process.platform === 'win32') {
    const tmpPs1 = path.join(os.tmpdir(), `select_folder_${Date.now()}.ps1`);
    const script = `\uFEFF
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Kaydetme Klasörünü Seçin"
$dialog.Filter = "Klasör Seçin|*.none"
$dialog.CheckFileExists = $false
$dialog.CheckPathExists = $true
$dialog.FileName = "Klasörü Buraya Seçin"

if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  $folder = [System.IO.Path]::GetDirectoryName($dialog.FileName)
  [Console]::Out.WriteLine($folder)
}
`;
    try {
      fs.writeFileSync(tmpPs1, script, { encoding: 'utf8' });
      const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1], { windowsHide: false });
      let output = '';
      p.stdout.on('data', d => { output += d.toString('utf-8'); });
      p.on('close', () => {
        try { fs.unlinkSync(tmpPs1); } catch (e) {}
        const folderPath = output.trim();
        res.json({ folderPath: folderPath || null });
      });
      p.on('error', () => {
        try { fs.unlinkSync(tmpPs1); } catch (e) {}
        res.json({ folderPath: null });
      });
    } catch (e) {
      res.json({ folderPath: null });
    }
  } else {
    res.json({ folderPath: null });
  }
});

// 5. Add single download (STRICT RULE: Requires confirmedByUser: true from Download Dialog)
app.post('/api/download/add', async (req, res) => {
  const { url, filename, category, saveDir, segmentsCount, forceVideo, quality, autoStart, confirmedByUser, headers, explicit } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // STRICT USER GUARD: If user has not confirmed in the Save Location Dialog, DO NOT add or start download!
  if (!confirmedByUser) {
    // Automatic capture: honor the file-type filter BEFORE prompting, so ignored
    // types (css/js/images/…) don't pop a dialog. Explicit adds (context menu,
    // grabber, in-page button) skip the filter — the user asked for that file.
    if (!forceVideo && !explicit) {
      let effectiveName = filename || '';
      let contentType = '';

      // Extensionless URL/filename (torrent sites: "?action=download&tid=…").
      // Probe the server WITH the browser session (cookies/referer/UA) so we get
      // the real Content-Disposition filename and Content-Type behind a login.
      if (!hasUsableExt(effectiveName, url)) {
        try {
          const info = await DownloadEngine.inspectUrl(url, headers || {});
          if (info) {
            contentType = info.contentType || '';
            if (info.filename && /\.[a-z0-9]{1,8}$/i.test(info.filename)) {
              effectiveName = info.filename;
              stashName(url, effectiveName); // confirm dialog reuses the real name
            }
          }
        } catch (e) { /* probe failed — fall through with what we have */ }
      }

      if (!storageService.shouldCaptureUrl(url, effectiveName, contentType)) {
        return res.json({ status: 'ignored', message: 'File type is not in the capture list.' });
      }
    }
    stashHeaders(url, headers); // keep the browser session for the confirmed add
    startPreflight(url, filename, headers); // IDM gibi: onay beklerken arka planda indirmeye başla
    serverEvents.emit('prompt-add', url);
    return res.json({ status: 'prompted', message: 'Folder & download confirmation window opened.' });
  }


  try {
    const sessionHeaders = takeHeaders(url, headers);

    // IDM davranışı: onay penceresi açıkken arka planda inen ön indirme varsa
    // yeni kayıt AÇMA — aynı motor, kullanıcının seçtiği ad/klasörle devam eder.
    if (!forceVideo) {
      const pf = await confirmPreflightForUrl(url, { filename, saveDir, segmentsCount, autoStart });
      if (pf) {
        // open-progress zaten confirmPreflightForUrl içinde erken emit edildi
        return res.json(pf);
      }
    } else {
      // Kullanıcı video moduna geçti: dosya ön indirmesi geçersiz, iptal et
      const entry = preflights.get(url);
      if (entry) dropPreflight(url, entry);
    }

    const item = await queueManager.addDownload(url, filename, category, segmentsCount, forceVideo, quality, saveDir, sessionHeaders);
    if (autoStart === false && item && item.id) {
      queueManager.pauseDownload(item.id);
    } else if (item && item.id) {
      // IDM tarzı ilerleme penceresi: indirme başlatıldıysa Electron'a haber ver
      // (renderer IPC'ye güvenilmez — ana pencerede nodeIntegration kapalı)
      serverEvents.emit('open-progress', item.id);
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5b. Confirm a background preflight download: apply the user's final choices
// (name/folder) and CONTINUE from the bytes already downloaded (IDM behaviour).
app.post('/api/download/confirm-preflight', appOnly(getPort), async (req, res) => {
  const { url, filename, saveDir, segmentsCount, autoStart } = req.body || {};
  const snap = await confirmPreflightForUrl(url, { filename, saveDir, segmentsCount, autoStart });
  if (!snap) return res.status(404).json({ notFound: true });
  // open-progress zaten confirmPreflightForUrl içinde erken emit edildi
  res.json(snap);
});

// 5c. Cancel a background preflight (confirm window closed without starting).
// Onaylanmış indirmelere dokunmaz (preflight bayrağı kalkmış olur).
app.post('/api/download/cancel-preflight', appOnly(getPort), (req, res) => {
  const { url } = req.body || {};
  const entry = url ? preflights.get(url) : null;
  if (entry) dropPreflight(url, entry);
  res.json({ ok: true });
});

// 6. Add video download (STRICT RULE: Requires confirmedByUser: true from Download Dialog)
app.post('/api/download/video', async (req, res) => {
  const { url, filename, saveDir, quality, referer, autoStart, confirmedByUser } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  // STRICT USER GUARD: If user has not confirmed in the Save Location Dialog, DO NOT add or start download!
  if (!confirmedByUser) {
    // Eklentide seçilen kaliteyi ve referer'ı onay penceresine taşı (yoksa "en yüksek"e düşerdi)
    // video: true -> onay penceresi bunu daima video/manifest sayar (uzantıya bakmadan).
    // Uzantıdan gelen akış manifesti .txt gibi uzantısız olabilir; URL'den anlaşılmaz.
    // IDM gibi: onay penceresi açılırken arka planda seçilen kaliteyle indirmeye başla.
    startVideoPreflight(url, quality || null, referer || null, filename || null);
    serverEvents.emit('prompt-add', { url, quality: quality || null, referer: referer || null, video: true, filename: filename || null });
    return res.json({ status: 'prompted', message: 'Folder & download confirmation window opened.' });
  }

  try {
    // IDM davranışı: onay penceresi açıkken arka planda inen video ön indirmesi varsa
    // (kalite/klasör/ad aynıysa) yeni kayıt AÇMA — aynı motor kaldığı baytlardan devam eder.
    const pf = await confirmVideoPreflightForUrl(url, { quality, filename, saveDir, autoStart });
    if (pf) {
      // open-progress zaten confirmVideoPreflightForUrl içinde emit edildi
      return res.json(pf);
    }

    const item = await queueManager.addDownload(url, filename, 'Video', 1, true, quality, saveDir, null, false, referer || null);
    if (autoStart === false && item && item.id) {
      queueManager.pauseDownload(item.id);
    } else if (item && item.id) {
      serverEvents.emit('open-progress', item.id); // IDM tarzı ilerleme penceresi
    }
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5.5. "Download all" (IDM tarzı): tek videonun birden çok kalitesini/varyantını
// varsayılan Video klasörüne toplu ekler. Ayrı ayrı onay pencereleri açmadığı için
// AÇIK bir kullanıcı eylemidir (kullanıcı eklentide "Tümünü indir"e tıkladı) ve
// yalnızca video motoruna (yt-dlp) gider. Kötüye kullanımı sınırlamak için tavan var.
app.post('/api/download/video-batch', async (req, res) => {
  const { url, qualities, referer, filename } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });
  if (!Array.isArray(qualities) || qualities.length === 0) {
    return res.status(400).json({ error: 'qualities array is required' });
  }
  // Tekilleştir + tavan uygula (12): aynı çözünürlük iki kez kuyruğa girmesin.
  const uniq = [...new Set(qualities.map((q) => String(q)))].slice(0, 12);
  try {
    const ids = [];
    for (const q of uniq) {
      const item = await queueManager.addDownload(url, filename || null, 'Video', 1, true, q, null, null, false, referer || null);
      if (item && item.id) ids.push(item.id);
    }
    if (ids.length) serverEvents.emit('open-progress', ids[0]); // ilk indirme için ilerleme penceresi
    res.json({ status: 'ok', count: ids.length, ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Add batch downloads
app.post('/api/download/batch', appOnly(getPort), async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'URLs array is required' });
  }
  try {
    const items = await queueManager.addBatchDownloads(urls);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Start / Resume download
app.post('/api/download/:id/start', appOnly(getPort), (req, res) => {
  const { id } = req.params;
  queueManager.startDownload(id);
  res.json({ success: true });
});

// 8. Pause download
app.post('/api/download/:id/pause', appOnly(getPort), (req, res) => {
  const { id } = req.params;
  queueManager.pauseDownload(id);
  res.json({ success: true });
});

// 9. Delete download
app.delete('/api/download/:id', appOnly(getPort), (req, res) => {
  const { id } = req.params;
  const deleteFile = req.query.deleteFile === 'true';
  queueManager.deleteDownload(id, deleteFile);
  res.json({ success: true });
});

// 10. Open specific download folder / file in File Explorer
// NOT: Kabuk string'i YOK — dosya adı sunucudan/kullanıcıdan geldiği için
// komut enjeksiyonuna açıktı (bkz. utils/shell.js).
const revealInExplorer = async (item) => {
  if (!item) return;
  const savePath = item.savePath;
  const saveDir = item.saveDir || storageService.settings.downloadDir;

  if (savePath && fs.existsSync(savePath)) {
    await showItemInFolder(savePath);
  } else if (saveDir && fs.existsSync(saveDir)) {
    await openPath(saveDir);
  } else if (storageService.settings.downloadDir) {
    await openPath(storageService.settings.downloadDir);
  }
};

app.post('/api/download/:id/reveal', appOnly(getPort), async (req, res) => {
  const item = queueManager.getDownloadById(req.params.id);
  await revealInExplorer(item);
  res.json({ success: true });
});

app.post('/api/download/:id/open-folder', appOnly(getPort), async (req, res) => {
  const item = queueManager.getDownloadById(req.params.id);
  await revealInExplorer(item);
  res.json({ success: true });
});

// Open file directly with default application
app.post('/api/download/:id/open', appOnly(getPort), async (req, res) => {
  const item = queueManager.getDownloadById(req.params.id);
  if (item && item.savePath && fs.existsSync(item.savePath)) {
    await openPath(item.savePath);
  }
  res.json({ success: true });
});

// Open the bundled browser-extension folder (for loading it unpacked)
app.post('/api/open-extension-folder', appOnly(getPort), async (req, res) => {
  const candidates = [
    path.join(__dirname, '../../../../browser-extension'), // packaged: INSTDIR/browser-extension
    path.join(__dirname, '../../../browser-extension'),     // dev: project/browser-extension
    path.join(__dirname, '../../browser-extension')
  ];
  const dir = candidates.find((d) => { try { return fs.existsSync(d); } catch (e) { return false; } });
  if (!dir) return res.status(404).json({ error: 'Extension folder not found' });
  await openPath(dir);
  res.json({ success: true, path: dir });
});

// Open the default download root folder
app.post('/api/open-download-root', appOnly(getPort), async (req, res) => {
  const root = storageService.settings.downloadDir;
  if (!root) return res.status(404).json({ error: 'Download directory not configured' });
  await openPath(root);
  res.json({ success: true, path: root });
});

// Yeniden indir: dosyayı ve parçaları silip baştan indirir
app.post('/api/download/:id/redownload', appOnly(getPort), async (req, res) => {
  try {
    const item = await queueManager.redownload(req.params.id);
    if (!item) return res.status(404).json({ error: 'Download not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dosyayı yeniden adlandır (diskte + listede)
app.post('/api/download/:id/rename', appOnly(getPort), (req, res) => {
  const { filename } = req.body || {};
  if (!filename || !filename.trim()) return res.status(400).json({ error: 'New name required' });
  try {
    const item = queueManager.renameDownload(req.params.id, filename.trim());
    if (!item) return res.status(404).json({ error: 'Download not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Start All / Pause All
app.post('/api/download/start-all', appOnly(getPort), (req, res) => {
  queueManager.startAll();
  res.json({ success: true });
});

app.post('/api/download/pause-all', appOnly(getPort), (req, res) => {
  queueManager.pauseAll();
  res.json({ success: true });
});

// 12. Sniff web page links
app.post('/api/sniffer', appOnly(getPort), async (req, res) => {
  const { url, depth, sameDomainOnly, extensions, fileTypes, maxPages } = req.body;
  if (!url) return res.status(400).json({ error: 'Page URL is required' });
  try {
    const result = await LinkSniffer.sniffPage(url, { depth, sameDomainOnly, extensions, fileTypes, maxPages });
    res.json(result); // { links, pagesScanned, depth }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// İndirme önceliği (high | normal | low)
app.post('/api/download/:id/priority', appOnly(getPort), (req, res) => {
  const { priority } = req.body || {};
  const item = queueManager.setPriority(req.params.id, priority);
  if (!item) return res.status(404).json({ error: 'Download not found' });
  res.json(item);
});

// Zamanlayıcı durumu
app.get('/api/scheduler', (req, res) => res.json(schedulerStatus()));

// 13. Settings API
// The bundled browser-extension folder is refreshed on every app install, but
// Chrome keeps running the previously loaded copy until the user reloads it
// (chrome://extensions). Track the version the live extension reports on its
// periodic settings poll so the UI can warn when it is stale.
let bundledExtVersionCache = null;
function bundledExtensionVersion() {
  if (bundledExtVersionCache !== null) return bundledExtVersionCache;
  const candidates = [
    path.join(__dirname, '../../../../browser-extension/manifest.json'), // packaged: INSTDIR
    path.join(__dirname, '../../../browser-extension/manifest.json'),    // dev: project root
    path.join(__dirname, '../../browser-extension/manifest.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        bundledExtVersionCache = JSON.parse(fs.readFileSync(p, 'utf8')).version || '';
        return bundledExtVersionCache;
      }
    } catch (e) { /* try next */ }
  }
  bundledExtVersionCache = '';
  return bundledExtVersionCache;
}
const extensionSeen = { version: '', lastSeenAt: 0 };

app.get('/api/settings', (req, res) => {
  // Only requests coming from the browser extension carry an extension Origin;
  // old extensions (<=1.1.2) send no extVersion param and thus report ''.
  const origin = String(req.headers.origin || '');
  if (isExtensionOrigin(origin)) {
    extensionSeen.version = String(req.query.extVersion || '');
    extensionSeen.lastSeenAt = Date.now();
    // Eklentiye TÜM ayarlar gönderilmez: proxy şifresi, site giriş şifreleri ve
    // indirme klasörü gibi bilgilere ihtiyacı yok. Yalnız gerçekten okuduğu
    // alanlar döner (captureBypassKey, captureEnabled, language, filtreler...).
    return res.json(settingsForExtension(storageService.settings));
  }
  res.json(storageService.settings);
});

// Extension freshness status for the UI warning banner
app.get('/api/extension/status', (req, res) => {
  const expected = bundledExtensionVersion();
  const seen = extensionSeen.lastSeenAt > 0;
  res.json({
    expected,
    reported: extensionSeen.version,
    lastSeenAt: extensionSeen.lastSeenAt,
    seen,
    stale: !!(seen && expected && extensionSeen.version !== expected)
  });
});

// 14. App info (About screen): version comes from the app root package.json —
// dev: <project>/package.json, packaged: resources/app/package.json (same
// relative path from backend/src in both layouts).
let appVersionCache = null;
function appVersion() {
  if (appVersionCache !== null) return appVersionCache;
  try {
    appVersionCache = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')
    ).version || '';
  } catch (e) {
    appVersionCache = '';
  }
  return appVersionCache;
}

app.get('/api/app/info', (req, res) => {
  res.json({
    name: 'DeepNode Download Manager',
    version: appVersion(),
    developer: 'DeepNode Studios',
    email: 'deepnodestudios@gmail.com'
  });
});

// 15. Güncelleme uçları (kontrol / indirme / kurulum) ayrı modüle taşındı:
//   - AI_Guidelines §2: server.js 1000 satır sınırına yaklaşmıştı.
//   - Bu üç uç uygulamanın en ayrıcalıklı işlemini yapıyor (indirilen dosyayı
//     ÇALIŞTIRIYOR); sertleştirme tek yerde toplandı: kaynak adres beyaz listesi,
//     dosya adı kısıtı ve yalnız uygulama penceresinden çağrılabilme (appOnly).
app.use('/api/update', createUpdateRouter({
  appVersion,
  broadcast: (message) => {
    const json = JSON.stringify(message);
    clients.forEach((c) => { if (c.readyState === 1) c.send(json); });
  },
  serverEvents,
  appOnly: appOnly(getPort)
}));

app.post('/api/settings', appOnly(getPort), (req, res) => {
  const updated = storageService.saveSettings(req.body);
  // Electron tarafı (açılışta başlat, tepsi davranışı vb.) hemen uygulasın
  serverEvents.emit('settings-changed', updated);
  res.json(updated);
});

// 14. Built-in Local Test File Generator
app.get('/api/test-file', (req, res) => {
  // Sınırsız `mb` değeri bitmeyen bir akış üretiyordu; NaN ise Content-Length de
  // bozuluyordu. 1..4096 MB aralığına sabitlenir.
  const requested = parseInt(req.query.mb || '50', 10);
  const megabytes = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 4096) : 50;
  const totalSizeBytes = megabytes * 1024 * 1024;
  const fileName = `Test_Sample_${megabytes}MB.bin`;

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSizeBytes - 1;
    const chunksize = (end - start) + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSizeBytes}`);
    res.setHeader('Content-Length', chunksize);

    const dummyBuffer = Buffer.alloc(64 * 1024, 0x41);
    let bytesSent = 0;
    
    function sendChunk() {
      while (bytesSent < chunksize) {
        const toSend = Math.min(dummyBuffer.length, chunksize - bytesSent);
        const canContinue = res.write(dummyBuffer.subarray(0, toSend));
        bytesSent += toSend;
        if (!canContinue) {
          res.once('drain', sendChunk);
          return;
        }
      }
      res.end();
    }
    sendChunk();
  } else {
    res.setHeader('Content-Length', totalSizeBytes);
    res.status(200);
    
    const dummyBuffer = Buffer.alloc(64 * 1024, 0x41);
    let bytesSent = 0;

    function sendChunk() {
      while (bytesSent < totalSizeBytes) {
        const toSend = Math.min(dummyBuffer.length, totalSizeBytes - bytesSent);
        const canContinue = res.write(dummyBuffer.subarray(0, toSend));
        bytesSent += toSend;
        if (!canContinue) {
          res.once('drain', sendChunk);
          return;
        }
      }
      res.end();
    }
    sendChunk();
  }
});

// Fallback index.html for SPA frontend
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('DeepNode Download Manager Backend Running.');
  }
});

function onServerReady() {
  console.log(`🚀 DeepNode Download Manager Backend running on http://127.0.0.1:${activePort}`);
  console.log(`⚡ WebSocket stream ready on ws://127.0.0.1:${activePort}`);

  serverEvents.emit('server-ready', activePort);

  // Keep yt-dlp fresh automatically (no user action). Check shortly after start,
  // then every 12 hours while the app runs.
  const maybeUpdate = () => {
    if (storageService.settings.autoUpdateYtDlp === false) return;
    autoUpdateYtDlp(true).catch((err) => console.error('yt-dlp update check failed:', err.message));
  };
  setTimeout(maybeUpdate, 8000);
  setInterval(maybeUpdate, 12 * 3600 * 1000);

  // Zamanlayıcı (ayarlardan açılır)
  startScheduler((evt) => {
    queueManager.broadcast({ type: 'SCHEDULER', payload: { event: evt, at: new Date().toISOString() } });
  });
}

// Port çakışmasında sessizce ölme: eskiden `listen` hata verince işlenmemiş
// 'error' olayı oluşuyor, Electron'daki `uncaughtException` yakalayıcısı onu
// yutuyordu ve kullanıcı BOMBOŞ bir pencereyle kalıyordu (5000 çok yaygın bir port).
// Artık sıradaki portlar denenir; seçilen port ~/.deepnode/port dosyasına yazılır
// ki tarayıcı eklentisi ve arayüz doğru adrese bağlanabilsin.
const MAX_PORT_ATTEMPTS = 10;
let portAttempt = 0;

// GÜVENLİK: yalnız geri döngü arayüzü. Eskiden 0.0.0.0'a bağlanıyordu ve API
// yerel ağdaki her cihazdan erişilebilirdi.
const LISTEN_HOST = '127.0.0.1';

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && portAttempt < MAX_PORT_ATTEMPTS) {
    portAttempt++;
    activePort = DEFAULT_PORT + portAttempt;
    console.warn(`Port ${activePort - 1} kullanımda — ${activePort} deneniyor...`);
    setTimeout(() => server.listen(activePort, LISTEN_HOST), 150);
    return;
  }
  console.error('Backend sunucusu başlatılamadı:', err.message);
  serverEvents.emit('server-error', err);
});

function persistActivePort(port) {
  try {
    const dir = path.join(os.homedir(), '.deepnode');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'port'), String(port), 'utf-8');
  } catch (err) {
    console.error('Aktif port yazılamadı:', err.message);
  }
}

server.listen(activePort, LISTEN_HOST, () => {
  activePort = server.address().port;
  persistActivePort(activePort);
  onServerReady();
});
