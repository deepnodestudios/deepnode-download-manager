// DeepNode Download Manager - browser integration (MV3 service worker)

importScripts('strings.js');

const DEFAULTS = { enabled: true, captureDownloads: true, showButton: true, port: 5000, disabledSites: [], appLanguage: 'auto' };
let cfg = { ...DEFAULTS };

function applyLanguage() {
  let ui = 'en';
  try { ui = chrome.i18n.getUILanguage(); } catch (e) { /* ignore */ }
  DN_I18N.setLang(dnResolveLang(cfg.appLanguage, ui));
}

chrome.storage.local.get(DEFAULTS, (v) => { cfg = { ...DEFAULTS, ...v }; applyLanguage(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const prevLang = DN_I18N.lang;
  chrome.storage.local.get(DEFAULTS, (v) => {
    cfg = { ...DEFAULTS, ...v };
    applyLanguage();
    if (DN_I18N.lang !== prevLang) buildContextMenus();
  });
});

const MEDIA_RE = /\.(mp4|mkv|webm|avi|mov|flv|m4v|mp3|m4a|aac|flac|wav|ogg|opus|zip|rar|7z|tar|gz|bz2|iso|pdf|exe|msi|apk|dmg|deb|docx|xlsx|pptx|m3u8|ts)(\?|$)/i;
const VIDEO_SITE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com)$/i;

function isVideoSite(url) {
  try { return VIDEO_SITE_RE.test(new URL(url).hostname); } catch (e) { return false; }
}

// HLS/DASH manifestleri (m3u8/mpd) siteden bağımsız olarak yt-dlp ile indirilir
function isManifestUrl(url) {
  return /\.(m3u8|mpd)(\?|$)/i.test(url || '');
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
let bypassKey = 'Alt';
let captureEnabled = true;
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
// Uygulamanın dinlediği port. Varsayılan 5000; doluysa uygulama sıradakine
// düşer (bkz. backend/src/server.js), bu yüzden bağlanamazsak kısa bir tarama
// yapılır ve bulunan port ayarlara yazılır.
let resolvedPort = null;
async function findAppPort() {
  const candidates = [cfg.port, 5000, 5001, 5002, 5003].filter((p, i, a) => p && a.indexOf(p) === i);
  for (const port of candidates) {
    try {
      const r = await fetch(`http://localhost:${port}/api/settings`, { cache: 'no-store' });
      if (r.ok) return port;
    } catch (e) { /* bu portta uygulama yok */ }
  }
  return null;
}

async function refreshRemoteSettings() {
  try {
    if (!resolvedPort) {
      resolvedPort = await findAppPort();
      if (!resolvedPort) return; // uygulama çalışmıyor
      if (resolvedPort !== cfg.port) {
        cfg.port = resolvedPort;
        chrome.storage.local.set({ port: resolvedPort });
      }
    }
    // Report our version so the app can warn when the loaded extension is stale
    // (Chrome doesn't auto-reload unpacked extensions after an app update).
    const ver = chrome.runtime.getManifest().version;
    const r = await fetch(`http://localhost:${resolvedPort}/api/settings?extVersion=${encodeURIComponent(ver)}`);
    if (!r.ok) { resolvedPort = null; return; }
    const s = await r.json();
    if (s && typeof s.captureBypassKey === 'string') bypassKey = s.captureBypassKey;
    if (s && typeof s.captureEnabled === 'boolean') captureEnabled = s.captureEnabled;
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

function endpoint(path) { return `http://localhost:${cfg.port}${path}`; }

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
    const res = await fetch(endpoint(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
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

// Returns 'accepted' | 'ignored' (file-type filter) | 'failed' (app unreachable)
async function sendToApp(url, filename, referrer, explicit) {
  const headers = await sessionHeaders(url, referrer);
  const data = await postJson('/api/download/add', { url, filename, headers, explicit: !!explicit });
  if (!data) return 'failed';
  return data.status === 'ignored' ? 'ignored' : 'accepted';
}
async function sendVideoToApp(url, quality, referer, filename) {
  return (await postJson('/api/download/video', { url, quality: quality || 'best', referer: referer || undefined, filename: filename || undefined })) !== null;
}

async function getVideoFormats(url, referer) {
  try {
    const res = await fetch(endpoint('/api/video/formats'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, referer: referer || undefined })
    });
    if (!res.ok) return { error: true };
    return await res.json();
  } catch (e) {
    return { error: true };
  }
}

function wakeApp(url) {
  const customUrl = 'deepnode://add?url=' + encodeURIComponent(url);
  chrome.tabs.create({ url: customUrl }, (tab) => {
    // Leave tab open for the user to confirm the protocol prompt in Chrome
    // They can close the blank tab manually after clicking "Open"
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
  }
});

// The real filename (Content-Disposition) is often still empty at onCreated
// time (e.g. torrent sites serving "download.php?id=…"). Poll briefly so the
// file-type filter can see the actual extension. Falls back to the MIME type
// when no filename can be resolved (URL has no extension either).
const MIME_EXT = {
  'application/x-bittorrent': 'torrent',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/pdf': 'pdf',
  'application/x-msdownload': 'exe',
  'application/x-iso9660-image': 'iso',
  'application/vnd.android.package-archive': 'apk'
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
chrome.downloads.onCreated.addListener(async (item) => {
  if (!cfg.enabled || !cfg.captureDownloads) return;
  const url = item.finalUrl || item.url || '';
  // Capture ALL real browser downloads (http/https). blob:/data: cannot be
  // re-fetched by URL, so leave those to the browser.
  if (!captureEnabled) return; // capture disabled from app Settings
  if (!/^https?:/i.test(url)) return;
  // Geri besleme döngüsünü önle: kendi backend'imizden gelen indirmeyi yakalama.
  // Eski `localhost:PORT` string kontrolü 127.0.0.1'i ve yedek portu (EADDRINUSE
  // sonrası 5001+) kaçırıyordu — adresi gerçekten ayrıştırıp karşılaştır.
  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      const appPorts = [cfg.port, resolvedPort, 5000, 5001, 5002, 5003].filter(Boolean);
      if (appPorts.includes(p)) return;
    }
  } catch (e) { /* URL bozuksa yakalama akışı zaten aşağıda eler */ }

  // Chrome, tarayıcı açılışında ve MV3 servis çalışanı her yeniden başladığında,
  // hâlâ süren / duraklatılmış / yarıda kalmış ESKİ indirmeler için de onCreated
  // tetikler. Bunları YENİ indirme sanıp uygulamaya gönderirsek, dün kapatılan bir
  // indirme her Chrome açılışında yeniden yakalanır. Yalnızca gerçekten yeni başlayan
  // indirmeleri yakala:
  if (item.state && item.state !== 'in_progress') return; // interrupted / complete
  if (item.paused) return; // duraklatılmış (yeniden gönderim)
  try {
    const started = item.startTime ? Date.parse(item.startTime) : 0;
    if (started && Date.now() - started > 60000) return; // 60 sn'den eski = yeniden gönderim, yeni değil
  } catch (e) { /* ignore */ }

  if (await isBypassActive()) return; // user held the bypass key -> let the browser download it

  // Site engelleme: indirme veya yönlendiren sayfa engelli sitedeyse yakalama
  try {
    const dlHost = new URL(url).hostname;
    const refHost = item.referrer ? new URL(item.referrer).hostname : '';
    if (dnIsSiteBlocked(dlHost, cfg.disabledSites) || dnIsSiteBlocked(refHost, cfg.disabledSites)) return;
  } catch (e) { /* ignore */ }

  const name = await resolveItemFilename(item);

  // Send first; only cancel the browser download if the app really took it over.
  // 'ignored' (excluded file type) and 'failed' (app not running) must leave the
  // browser download untouched — otherwise the file is lost on both sides.
  const result = await sendToApp(url, name, item.referrer);
  if (result === 'accepted') {
    try {
      // Küçük/hızlı dosya cancel'dan önce tamamlanmış olabilir: cancel başarısız
      // olur, erase yalnız geçmiş kaydını siler ve dosya dupe olarak diskte
      // kalırdı (biri tarayıcı UI'ında görünmez). Tamamlandıysa dosyayı da sil —
      // tek kopya DDM'inki olsun.
      try { await chrome.downloads.cancel(item.id); } catch (e) { /* bitmiş olabilir */ }
      const [d] = await chrome.downloads.search({ id: item.id });
      if (d && d.state === 'complete') {
        try { await chrome.downloads.removeFile(item.id); } catch (e) { /* dosya zaten yok */ }
      }
      await chrome.downloads.erase({ id: item.id });
    } catch (e) { /* ignore */ }
    notify(DN_I18N.t('notif_captured'), name || url);
  }
});

// ---- Sniff media stream URLs (for blob/HLS fallback) ----
chrome.webRequest.onCompleted.addListener((d) => {
  if (d.tabId < 0) return;
  const url = d.url || '';
  // .ts parçaları tek başına işe yaramaz ve m3u8 manifestlerini tampondan iterdi
  if (/\.ts(\?|$)/i.test(url)) return;
  // Manifest URL uzantısız/tokenlı olabilir — Content-Type ile de yakala
  const ctHeader = (d.responseHeaders || []).find((h) => h.name && h.name.toLowerCase() === 'content-type');
  const ct = ctHeader && ctHeader.value ? ctHeader.value.toLowerCase() : '';
  const ctManifest = /mpegurl|dash\+xml/.test(ct);
  const urlMedia = MEDIA_RE.test(url) || /mime=(video|audio)/i.test(url);
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
    fetch(endpoint('/api/settings'))
      .then((r) => sendResponse({ ok: r.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
