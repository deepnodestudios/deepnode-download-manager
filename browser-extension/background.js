// DeepNode Download Manager - browser integration (MV3 service worker)

// Chrome: service worker → sözlük importScripts ile yüklenir.
// Firefox: service_worker yok, manifest background.scripts strings.js'i zaten
// background.js'ten ÖNCE yükler (importScripts tanımlı değildir).
if (typeof importScripts === 'function') {
  importScripts('strings.js');
}

const DEFAULTS = { enabled: true, captureDownloads: true, showButton: true, port: 5000, disabledSites: [], appLanguage: 'auto' };
let cfg = { ...DEFAULTS };
let bypassKey = 'Shift';
let captureEnabled = true;

function applyLanguage() {
  let ui = 'en';
  try { ui = chrome.i18n.getUILanguage(); } catch (e) { /* ignore */ }
  DN_I18N.setLang(dnResolveLang(cfg.appLanguage, ui));
}

let storageReadyResolve;
const storageReady = new Promise((resolve) => { storageReadyResolve = resolve; });

chrome.storage.local.get({
  ...DEFAULTS,
  captureBypassKey: 'Shift',
  captureEnabled: true
}, (res) => {
  if (res) {
    cfg = {
      enabled: res.enabled !== undefined ? res.enabled : DEFAULTS.enabled,
      captureDownloads: res.captureDownloads !== undefined ? res.captureDownloads : DEFAULTS.captureDownloads,
      showButton: res.showButton !== undefined ? res.showButton : DEFAULTS.showButton,
      port: res.port || DEFAULTS.port,
      disabledSites: res.disabledSites || DEFAULTS.disabledSites,
      appLanguage: res.appLanguage || DEFAULTS.appLanguage
    };
    if (typeof res.captureBypassKey === 'string') bypassKey = res.captureBypassKey;
    if (typeof res.captureEnabled === 'boolean') captureEnabled = res.captureEnabled;
    applyLanguage();
  }
  if (storageReadyResolve) storageReadyResolve();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const prevLang = DN_I18N.lang;
  chrome.storage.local.get({
    ...DEFAULTS,
    captureBypassKey: bypassKey,
    captureEnabled: captureEnabled
  }, (v) => {
    if (v) {
      cfg = {
        enabled: v.enabled !== undefined ? v.enabled : cfg.enabled,
        captureDownloads: v.captureDownloads !== undefined ? v.captureDownloads : cfg.captureDownloads,
        showButton: v.showButton !== undefined ? v.showButton : cfg.showButton,
        port: v.port || cfg.port,
        disabledSites: v.disabledSites || cfg.disabledSites,
        appLanguage: v.appLanguage || cfg.appLanguage
      };
      if (typeof v.captureBypassKey === 'string') bypassKey = v.captureBypassKey;
      if (typeof v.captureEnabled === 'boolean') captureEnabled = v.captureEnabled;
      applyLanguage();
      if (DN_I18N.lang !== prevLang) buildContextMenus();
    }
  });
});

const MEDIA_RE = /\.(mp4|mkv|webm|avi|mov|flv|m4v|mp3|m4a|aac|flac|wav|ogg|opus|wma|wmv|asf|3gp|3gpp|f4m|f4f|mpd|m4s|ts|tsv|zip|rar|7z|tar|gz|bz2|iso|pdf|exe|msi|apk|dmg|deb|docx|xlsx|pptx|doc|xls|ppt|m3u8)(\?|$)/i;
const VIDEO_SITE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com)$/i;

function isVideoSite(url) {
  try { return VIDEO_SITE_RE.test(new URL(url).hostname); } catch (e) { return false; }
}

// HLS/DASH/HDS manifestleri (m3u8/mpd/f4m) siteden bağımsız olarak yt-dlp ile indirilir
function isManifestUrl(url) {
  return /\.(m3u8|mpd|f4m)(\?|$)/i.test(url || '');
}

// Recently seen media/stream URLs per tab (for blob/streaming fallback)
// MV3 service worker'ı boşta kalınca sonlandırılır ve bu Map silinir; m3u8
// manifesti yalnızca oynatma başında bir kez istendiği için kaybolurdu.
// Bu yüzden storage.session'a da yazıyoruz (oturum boyunca kalıcı).
const streamsByTab = new Map();
// Content-Type ile doğrulanmış manifestler ayrı tutulur: .txt gibi uzantısız
// manifestleri content.js URL'den ayırt edemez, bu liste ile kesin bilir.
const manifestsByTab = new Map();

function rememberStream(tabId, url, isManifest) {
  let arr = streamsByTab.get(tabId) || [];
  if (!arr.includes(url)) {
    // Manifestler (m3u8/mpd/uzantısız) listenin başında korunur — fallback önce onları dener
    if (isManifest) arr.unshift(url); else arr.push(url);
    arr = arr.slice(0, 40);
    streamsByTab.set(tabId, arr);
    try { chrome.storage.session.set({ ['streams_' + tabId]: arr }); } catch (e) { /* ignore */ }
  }
  if (isManifest) {
    let m = manifestsByTab.get(tabId) || [];
    if (!m.includes(url)) {
      m.unshift(url);
      m = m.slice(0, 20);
      manifestsByTab.set(tabId, m);
      try { chrome.storage.session.set({ ['manifests_' + tabId]: m }); } catch (e) { /* ignore */ }
    }
  }
}

async function getStreams(tabId) {
  let streams = streamsByTab.get(tabId) || [];
  let manifests = manifestsByTab.get(tabId) || [];
  if (!streams.length || !manifests.length) {
    try {
      const sk = 'streams_' + tabId, mk = 'manifests_' + tabId;
      const v = await chrome.storage.session.get([sk, mk]);
      if (!streams.length && v[sk]) { streams = v[sk]; streamsByTab.set(tabId, streams); }
      if (!manifests.length && v[mk]) { manifests = v[mk]; manifestsByTab.set(tabId, manifests); }
    } catch (e) { /* ignore */ }
  }
  return { streams, manifests };
}

// Sekme yeni bir sayfaya gidince eski film/manifest önbelleğini temizle — aksi halde
// aynı sekmede filmden filme geçince önceki filmin (bayat/süresi dolmuş) manifesti
// yeniden kullanılır ve indirme yanlış filmle/eksik başlar (0%'da takılır).
function clearTab(tabId) {
  streamsByTab.delete(tabId);
  manifestsByTab.delete(tabId);
  try { chrome.storage.session.remove(['streams_' + tabId, 'manifests_' + tabId]); } catch (e) { /* ignore */ }
}
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Üst çerçeve yeni bir URL'ye gidince (changeInfo.url) o sekmenin yakalananları geçersizdir
  if (changeInfo.url) clearTab(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => clearTab(tabId));

// "Bypass" key: while this modifier is held during a click, the
// download is NOT captured (browser downloads it normally). Configured in the
// app Settings; synced from /api/settings. 'None' disables the feature.

let heldMods = { Alt: false, Control: false, Shift: false };
let lastBypassClickAt = 0; // last mousedown made while the bypass key was held
function isBypassHeld() {
  if (!bypassKey || bypassKey === 'None') return false;
  return heldMods[bypassKey] === true;
}

// downloads.onCreated can fire AFTER the user released the key (redirects,
// server latency) and the MV3 service worker may have restarted in between
// (wiping heldMods). So a recent "bypass click" timestamp — also persisted to
// session storage — counts as an active bypass too.
const BYPASS_GRACE_MS = 5000;
async function isBypassActive() {
  if (!bypassKey || bypassKey === 'None') return false;
  if (isBypassHeld()) return true;
  let ts = lastBypassClickAt;
  if (!ts) {
    try { ts = (await chrome.storage.session.get('bypassClickAt')).bypassClickAt || 0; } catch (e) { ts = 0; }
  }
  if (ts && Date.now() - ts < BYPASS_GRACE_MS) {
    lastBypassClickAt = 0; // single use: only the download triggered by that click is bypassed
    try { chrome.storage.session.remove('bypassClickAt'); } catch (e) { /* ignore */ }
    return true;
  }
  return false;
}
// Uygulama 127.0.0.1 dinler. Chrome `localhost`'u IPv4'e çevirir; Firefox sıkça
// ::1 dener ve (IPv6 dinlenmiyorsa) istek zaman aşımına uğrar — popup "kontrol
// ediliyor"da asılı kalır. 127.0.0.1 önce, kısa zaman aşımı, sonra localhost.
const APP_HOSTS = ['127.0.0.1', 'localhost'];
let resolvedPort = null;
let resolvedHost = '127.0.0.1';

function fetchWithTimeout(url, opts = {}, ms = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: 'no-store', ...opts, signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

function rememberApp(host, port) {
  resolvedHost = host;
  resolvedPort = port;
}

async function probeApp() {
  const ports = [resolvedPort, cfg.port, 5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010].filter((p, i, a) => p && a.indexOf(p) === i);
  const hosts = [resolvedHost, ...APP_HOSTS].filter((h, i, a) => h && a.indexOf(h) === i);
  for (const port of ports) {
    const ver = chrome.runtime.getManifest().version;
    for (const host of hosts) {
      try {
        const r = await fetchWithTimeout(`http://${host}:${port}/api/settings?extVersion=${encodeURIComponent(ver)}`, {}, 800);
        if (r.ok) { rememberApp(host, port); return true; }
      } catch (e) { /* bu host:port'ta uygulama yok */ }
    }
  }
  return false;
}

async function fetchApp(path, opts = {}, timeoutMs = 2500) {
  const attempt = () => {
    const host = resolvedHost || '127.0.0.1';
    const port = resolvedPort || cfg.port || 5000;
    return fetchWithTimeout(`http://${host}:${port}${path}`, opts, timeoutMs);
  };
  const hadPort = !!resolvedPort;
  try {
    if (!resolvedPort && !(await probeApp())) throw new Error('app unreachable');
    return await attempt();
  } catch (e) {
    resolvedPort = null;
    if (hadPort && (await probeApp())) {
      return attempt();
    }
    throw e;
  }
}

async function refreshRemoteSettings() {
  try {
    // Report our version so the app can warn when the loaded extension is stale
    // (Chrome doesn't auto-reload unpacked extensions after an app update).
    const ver = chrome.runtime.getManifest().version;
    const r = await fetchApp(`/api/settings?extVersion=${encodeURIComponent(ver)}`, {}, 1500);
    if (!r.ok) { resolvedPort = null; return; }
    const s = await r.json();
    if (s && typeof s.captureBypassKey === 'string') {
      bypassKey = s.captureBypassKey;
      chrome.storage.local.set({ captureBypassKey: s.captureBypassKey });
    }
    if (s && typeof s.captureEnabled === 'boolean') {
      captureEnabled = s.captureEnabled;
      chrome.storage.local.set({ captureEnabled: s.captureEnabled });
    }
    // Uygulamanın dil tercihi eklenti UI'ına da yansısın ('auto' ise tarayıcı dili)
    if (s && typeof s.language === 'string' && s.language !== cfg.appLanguage) {
      chrome.storage.local.set({ appLanguage: s.language });
    }
  } catch (e) {
    resolvedPort = null; // uygulama kapandı — sonraki turda yeniden ara
  }
}

// ÖNEMLİ: `setInterval` MV3 servis çalışanında GÜVENİLİR DEĞİL — çalışan ~30 sn
// boşta kaldıktan sonra sonlandırılır ve zamanlayıcı onunla birlikte ölür. Bu
// yüzden bypass tuşu / yakalama anahtarı senkronu bir süre sonra sessizce
// duruyordu. chrome.alarms çalışanı gerektiğinde uyandırır.
chrome.alarms.create('dn-settings-sync', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dn-settings-sync') refreshRemoteSettings();
});
refreshRemoteSettings();

function guessName(url) {
  try {
    const u = new URL(url);
    const base = decodeURIComponent((u.pathname.split('/').pop() || '').split('?')[0]);
    return base.includes('.') ? base : undefined;
  } catch (e) { return undefined; }
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'DeepNode — ' + title,
      message: String(message || '').slice(0, 140)
    });
  } catch (e) { /* ignore */ }
}

async function postJson(path, body) {
  try {
    const res = await fetchApp(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 8000);
    if (!res.ok) return null;
    try { return await res.json(); } catch (e) { return {}; }
  } catch (e) {
    return null;
  }
}

// Collect the browser session for a URL (cookies + referer + UA) so the app can
// download links that require a login/session or hotlink protection.
async function sessionHeaders(url, referrer) {
  const headers = {};
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (cookies && cookies.length) {
      headers.Cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    }
  } catch (e) { /* cookies permission missing or restricted URL */ }

  try {
    if (referrer && /^https?:/i.test(referrer)) headers.Referer = referrer;
  } catch (e) { /* ignore */ }

  try {
    if (navigator && navigator.userAgent) headers['User-Agent'] = navigator.userAgent;
  } catch (e) { /* ignore */ }

  return headers;
}

// Returns 'accepted' | 'prompted' | 'ignored' (file-type filter) | 'failed' (app unreachable)
async function sendToApp(url, filename, referrer, explicit) {
  const headers = await sessionHeaders(url, referrer);
  const data = await postJson('/api/download/add', { url, filename, headers, explicit: !!explicit });
  if (!data) return 'failed';
  if (data.status === 'ignored') return 'ignored';
  if (data.status === 'prompted') return 'prompted';
  return 'accepted';
}
async function sendVideoToApp(url, quality, referer, filename) {
  return (await postJson('/api/download/video', { url, quality: quality || 'best', referer: referer || undefined, filename: filename || undefined })) !== null;
}

// "Tümünü indir": tek istekte, her çözünürlükten bir kaliteyi varsayılan Video klasörüne
// ekler (ayrı ayrı onay pencereleri açmadan). Standart "Download all" davranışına denk.
async function sendVideoBatchToApp(url, qualities, referer, filename) {
  return (await postJson('/api/download/video-batch', {
    url,
    qualities: Array.isArray(qualities) ? qualities : [],
    referer: referer || undefined,
    filename: filename || undefined
  })) !== null;
}

async function getVideoFormats(url, referer) {
  try {
    const res = await fetchApp('/api/video/formats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, referer: referer || undefined })
    }, 90000);
    if (!res.ok) return { error: true };
    return await res.json();
  } catch (e) {
    return { error: true };
  }
}

function wakeApp(url) {
  const customUrl = 'deepnode://add?url=' + encodeURIComponent(url);
  chrome.tabs.create({ url: customUrl, active: false }, (tab) => {
    if (tab && tab.id) {
      setTimeout(() => {
        try { chrome.tabs.remove(tab.id); } catch (e) {}
      }, 1500);
    }
  });
}

async function doDownload(url, referrer) {
  if (!url) return;
  // Streaming sites & HLS/DASH manifests -> let the app grab the real video via yt-dlp
  if (isVideoSite(url) || isManifestUrl(url)) {
    const ok = await sendVideoToApp(url, 'best', isVideoSite(url) ? undefined : referrer);
    if (!ok) wakeApp(url);
    return;
  }
  // Explicit user action (context menu / button / grabber): skip the automatic
  // file-type filter — the user asked for this exact file.
  const result = await sendToApp(url, guessName(url), referrer, true);
  if (result === 'failed') wakeApp(url);
}

// Sayfa başlığından site ekini (" - Site", " | Site", " » Site") atıp temizle
function cleanTitle(t) {
  if (!t) return '';
  t = String(t).trim();
  t = t.replace(/^\(\d+\+?\)\s*/, ''); // bildirim sayıları: (1), (99+)
  t = t.replace(/[ \t\r\n\u25B6\u25B7]+/g, ' '); // oynat simgeleri (▶, ▷) ve fazla boşluklar
  const parts = t.split(/\s*(?:»|\||::)\s*|\s+[-–—]\s+/);
  if (parts.length > 1 && parts[0].trim().length >= 2) t = parts[0].trim();
  return t.slice(0, 150);
}
// URL'nin son yol parçasından okunabilir ad türet (ör. scary-movie-2026 -> Scary Movie 2026)
function nameFromUrl(u) {
  try {
    const url = new URL(u);
    let seg = (url.pathname.split('/').filter(Boolean).pop() || '');
    seg = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, '');
    seg = seg.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!seg || seg.length < 2) return '';
    return seg.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 150);
  } catch (e) { return ''; }
}
// Üst sekmenin (çerçeveden bağımsız) başlığı/URL'sinden en iyi dosya adını bul.
// Video çapraz-köken iframe'de oynadığında bile üst film sayfasını verir.
function bestNameFromTab(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return resolve('');
        const t = cleanTitle(tab.title);
        if (t) return resolve(t);
        resolve(nameFromUrl(tab.url));
      });
    } catch (e) { resolve(''); }
  });
}

async function doVideo(url, quality, referer, title, tabId) {
  if (!url) return;
  let name = title || '';
  // Manifest/genel yakalama (referer var): üst sekme başlığı en güvenilir kaynaktır —
  // iframe içinden gelen (embed'e ait) başlığı ez. Bilinen video sitelerinde (referer yok)
  // yt-dlp'nin kendi metadatası daha iyi olduğundan dokunma.
  if (referer && tabId != null) {
    const tabName = await bestNameFromTab(tabId);
    if (tabName) name = tabName;
  }
  const ok = await sendVideoToApp(url, quality, referer, name || undefined);
  if (!ok) wakeApp(url);
}

// "Tümünü indir" akışı: doVideo ile aynı ad çözümlemesini yapar, sonra tüm kaliteleri
// tek toplu istekte gönderir.
async function doVideoAll(url, qualities, referer, title, tabId) {
  if (!url) return;
  let name = title || '';
  if (referer && tabId != null) {
    const tabName = await bestNameFromTab(tabId);
    if (tabName) name = tabName;
  }
  const ok = await sendVideoBatchToApp(url, qualities, referer, name || undefined);
  if (!ok) wakeApp(url);
}

// ---- Context menu ----
function buildContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'dn-link',
      title: DN_I18N.t('ctx_download_with'),
      contexts: ['link', 'image', 'video', 'audio']
    });
    chrome.contextMenus.create({
      id: 'dn-video',
      title: DN_I18N.t('ctx_download_video'),
      contexts: ['page', 'video']
    });
    chrome.contextMenus.create({
      id: 'dn-scan',
      title: DN_I18N.t('ctx_scan'),
      contexts: ['page', 'frame']
    });
    chrome.contextMenus.create({
      id: 'dn-selection',
      title: DN_I18N.t('ctx_download_selected'),
      contexts: ['selection']
    });
  });
}
chrome.runtime.onInstalled.addListener(buildContextMenus);
applyLanguage();
buildContextMenus();

function tabHost(tab) {
  try { return new URL(tab && tab.url ? tab.url : '').hostname; } catch (e) { return ''; }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Site engelleme: kullanıcı bu siteyi kapattıysa menü eylemleri çalışmaz
  if (dnIsSiteBlocked(tabHost(tab), cfg.disabledSites)) {
    notify('DeepNode', DN_I18N.t('notif_site_disabled'));
    return;
  }
  if (info.menuItemId === 'dn-link') {
    doDownload(info.srcUrl || info.linkUrl, info.pageUrl || (tab && tab.url));
  } else if (info.menuItemId === 'dn-video') {
    const pageUrl = info.pageUrl || (tab && tab.url);
    if (isVideoSite(pageUrl)) {
      // yt-dlp'nin kendi çıkarıcısı olan siteler (YouTube vb.): sayfa URL'sini ver
      doVideo(pageUrl, 'best', undefined, undefined, tab && tab.id);
    } else {
      // Desteklenmeyen site (ör. hdfilmcehennemi): sayfa URL'si yt-dlp'de çalışmaz — bu
      // sekmede yakalanan manifesti kullan (Referer = sayfa), yoksa son çare sayfa URL'si.
      const { manifests, streams } = tab ? await getStreams(tab.id) : { manifests: [], streams: [] };
      const manifest = manifests[0] || (streams || []).find(isManifestUrl);
      doVideo(manifest || pageUrl, 'best', pageUrl, undefined, tab && tab.id);
    }
  } else if (info.menuItemId === 'dn-scan' && tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'DN_SCAN' });
  } else if (info.menuItemId === 'dn-selection' && tab) {
    chrome.tabs.sendMessage(tab.id, { type: 'DN_GET_SELECTION_URLS' }, async (response) => {
      let urls = (response && response.urls) || [];
      if (!urls.length && info.selectionText) {
        const matches = info.selectionText.match(/https?:\/\/[^\s"'<>]+/gi);
        if (matches) urls = matches;
      }
      if (urls.length > 0) {
        try {
          await postJson('/api/download/prompt-batch', { urls, referer: tab.url });
        } catch (err) {
          wakeApp(urls[0]);
        }
      }
    });
  }
});

// The real filename (Content-Disposition) is often still empty at onCreated
// time (e.g. torrent sites serving "download.php?id=…"). Poll briefly so the
// file-type filter can see the actual extension. Falls back to the MIME type
// when no filename can be resolved (URL has no extension either).
const MIME_EXT = {
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
  'flv-application/octet-stream': 'flv',
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
async function resolveItemFilename(item) {
  let name = item.filename ? item.filename.split(/[\\/]/).pop() : '';
  let mime = item.mime || '';
  for (let i = 0; !name && i < 14; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try {
      const [d] = await chrome.downloads.search({ id: item.id });
      if (!d) break;
      if (d.filename) name = d.filename.split(/[\\/]/).pop();
      if (d.mime) mime = d.mime;
      if (d.state && d.state !== 'in_progress') break;
    } catch (e) { break; }
  }
  if (!name) name = guessName(item.finalUrl || item.url || '');
  // No usable extension anywhere -> derive one from the MIME type so the
  // app's ignored/captured extension filter can do its job (.torrent etc.)
  if ((!name || !/\.[a-z0-9]{1,8}$/i.test(name)) && MIME_EXT[mime]) {
    name = (name || 'download') + '.' + MIME_EXT[mime];
  }
  return name;
}

// ---- Capture browser-initiated downloads ----
async function handleDownloadItem(item, suggest) {
  await storageReady;
  if (!cfg.enabled || !cfg.captureDownloads) { if (suggest) suggest(); return; }
  if (!captureEnabled) { if (suggest) suggest(); return; }
  const url = item.finalUrl || item.url || '';
  if (!/^https?:/i.test(url)) { if (suggest) suggest(); return; }

  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      const appPorts = [cfg.port, resolvedPort, 5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010].filter(Boolean);
      if (appPorts.includes(p)) { if (suggest) suggest(); return; }
    }
  } catch (e) { }

  if (item.state && item.state !== 'in_progress') { if (suggest) suggest(); return; }
  if (item.paused) { if (suggest) suggest(); return; }
  try {
    const started = item.startTime ? Date.parse(item.startTime) : 0;
    if (started && Date.now() - started > 60000) { if (suggest) suggest(); return; }
  } catch (e) { }

  if (await isBypassActive()) {
    if (suggest) suggest();
    return;
  }

  try {
    const dlHost = new URL(url).hostname;
    const refHost = item.referrer ? new URL(item.referrer).hostname : '';
    if (dnIsSiteBlocked(dlHost, cfg.disabledSites) || dnIsSiteBlocked(refHost, cfg.disabledSites)) {
      if (suggest) suggest();
      return;
    }
  } catch (e) { }

  try {

    let name = item.filename ? item.filename.split(/[\\/]/).pop() : '';
    if (!name) name = guessName(url);
    if ((!name || !/\.[a-z0-9]{1,8}$/i.test(name)) && MIME_EXT[item.mime || '']) {
      name = (name || 'download') + '.' + MIME_EXT[item.mime || ''];
    }
    
    const result = await sendToApp(url, name, item.referrer);
    if (result === 'accepted') {
      try {
        const finalizeInterception = () => {
          chrome.downloads.search({ id: item.id }, (res) => {
            let _ = chrome.runtime.lastError;
            if (res && res[0] && res[0].state === 'complete') {
              try { chrome.downloads.removeFile(item.id).catch(() => {}); } catch (e) {}
            }
            try { chrome.downloads.erase({ id: item.id }).catch(() => {}); } catch (e) {}
          });
        };

        if (item.state !== 'interrupted' && item.state !== 'complete') {
          chrome.downloads.cancel(item.id, () => {
            let _ = chrome.runtime.lastError;
            setTimeout(finalizeInterception, 100);
          });
        } else {
          finalizeInterception();
        }
      } catch (e) { }
      notify(DN_I18N.t('notif_captured'), name || url);
      if (suggest) suggest();
    } else if (result === 'prompted') {
      // DDM onay penceresi açtı (ön indirme arka planda çalışıyor).
      // Kullanıcı onay penceresini iptal edebileceğinden tarayıcı indirmesini erken silmiyoruz.
      notify(DN_I18N.t('notif_captured'), name || url);
      if (suggest) suggest();
    } else {
      if (suggest) suggest();
    }
  } catch (err) {
    if (suggest) suggest();
  }
}

// Chrome: onDeterminingFilename (suggest desteği ile dosya oluşturulmadan yakalar)
// Firefox: onDeterminingFilename yoktur, onCreated kullanılır
if (typeof chrome !== 'undefined' && chrome.downloads) {
  const onDet = chrome.downloads['onDeterminingFilename'];
  if (onDet && typeof onDet.addListener === 'function') {
    onDet.addListener((item, suggest) => {
      handleDownloadItem(item, suggest);
      return true;
    });
  } else if (chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener((item) => {
      handleDownloadItem(item, null);
    });
  }
}

// ---- Sniff media stream URLs (for blob/HLS fallback) ----
chrome.webRequest.onCompleted.addListener((d) => {
  if (d.tabId < 0) return;
  const url = d.url || '';
  // .ts, .tsv, .m4s ve .f4f parçaları tek başına işe yaramaz ve m3u8/mpd manifestlerini tampondan iterdi
  if (/\.(ts|tsv|m4s|f4f)(\?|$)/i.test(url)) return;
  // Manifest URL uzantısız/tokenlı olabilir — Content-Type ile de yakala
  const ctHeader = (d.responseHeaders || []).find((h) => h.name && h.name.toLowerCase() === 'content-type');
  const ct = ctHeader && ctHeader.value ? ctHeader.value.toLowerCase() : '';
  const ctManifest = /mpegurl|dash\+xml|f4m\+xml/.test(ct);
  const urlMedia = MEDIA_RE.test(url) || /mime=(video|audio)/i.test(url) || /^(video|audio)\//.test(ct);
  if (!urlMedia && !ctManifest) return;
  rememberStream(d.tabId, url, isManifestUrl(url) || ctManifest);
}, { urls: ['<all_urls>'] }, ['responseHeaders']);

chrome.tabs.onRemoved.addListener((id) => {
  streamsByTab.delete(id);
  manifestsByTab.delete(id);
  try { chrome.storage.session.remove(['streams_' + id, 'manifests_' + id]); } catch (e) { /* ignore */ }
});
chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) {
    streamsByTab.delete(d.tabId);
    manifestsByTab.delete(d.tabId);
    try { chrome.storage.session.remove(['streams_' + d.tabId, 'manifests_' + d.tabId]); } catch (e) { /* ignore */ }
  }
});

// ---- Messaging ----
// Popup açıkken port tutmak Firefox event page'in ping sırasında uyumasını engeller.
chrome.runtime.onConnect.addListener((port) => {
  if (!port || (port.name !== 'dn-popup' && port.name !== 'dn-formats')) return;
  port.onDisconnect.addListener(() => { /* popup/format sorgusu bitti */ });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'DN_MODS') {
    heldMods = { Alt: !!msg.mods.Alt, Control: !!msg.mods.Control, Shift: !!msg.mods.Shift };
    // A click made while the bypass key is held: remember it (with persistence)
    // so the download event can still see it after key release / SW restart.
    if (msg.ev === 'mousedown' && bypassKey && bypassKey !== 'None' && heldMods[bypassKey]) {
      lastBypassClickAt = Date.now();
      try { chrome.storage.session.set({ bypassClickAt: lastBypassClickAt }); } catch (e) { /* ignore */ }
    }
    return;
  }
  if (msg.type === 'DN_DOWNLOAD') {
    doDownload(msg.url, msg.referer || (sender && sender.tab && sender.tab.url) || null);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DN_DOWNLOAD_VIDEO') {
    doVideo(msg.url, msg.quality, msg.referer, msg.title, sender && sender.tab && sender.tab.id);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DN_DOWNLOAD_VIDEO_ALL') {
    doVideoAll(msg.url, msg.qualities, msg.referer, msg.title, sender && sender.tab && sender.tab.id);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DN_GET_FORMATS') {
    getVideoFormats(msg.url, msg.referer).then((data) => sendResponse(data));
    return true;
  }
  if (msg.type === 'DN_DOWNLOAD_MANY') {
    (async () => {
      let n = 0;
      for (const u of (msg.urls || [])) { if (await sendToApp(u, guessName(u), null, true) === 'accepted') n++; }
      notify('Grabber', DN_I18N.t('notif_grabber_added', { n }));
      sendResponse({ ok: true, count: n });
    })();
    return true;
  }
  if (msg.type === 'DN_GET_STREAMS') {
    const id = sender && sender.tab ? sender.tab.id : msg.tabId;
    getStreams(id).then((r) => sendResponse(r));
    return true;
  }
  if (msg.type === 'DN_PING') {
    fetchApp('/api/settings', {}, 1500)
      .then((r) => { try { sendResponse({ ok: !!r.ok, port: resolvedPort || cfg.port, host: resolvedHost }); } catch (e) { /* popup kapandı */ } })
      .catch(() => { try { sendResponse({ ok: false }); } catch (e) { /* popup kapandı */ } });
    return true;
  }
});
