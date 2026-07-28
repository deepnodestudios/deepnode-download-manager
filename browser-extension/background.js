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

// Recently seen media/stream URLs per tab (for blob/streaming fallback)
const streamsByTab = new Map();

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
async function refreshRemoteSettings() {
  try {
    // Report our version so the app can warn when the loaded extension is stale
    // (Chrome doesn't auto-reload unpacked extensions after an app update).
    const ver = chrome.runtime.getManifest().version;
    const r = await fetch(`http://localhost:${cfg.port}/api/settings?extVersion=${encodeURIComponent(ver)}`);
    if (r.ok) {
      const s = await r.json();
      if (s && typeof s.captureBypassKey === 'string') bypassKey = s.captureBypassKey;
      if (s && typeof s.captureEnabled === 'boolean') captureEnabled = s.captureEnabled;
      // Uygulamanın dil tercihi eklenti UI'ına da yansısın ('auto' ise tarayıcı dili)
      if (s && typeof s.language === 'string' && s.language !== cfg.appLanguage) {
        chrome.storage.local.set({ appLanguage: s.language });
      }
    }
  } catch (e) { /* app not running */ }
}
refreshRemoteSettings();
setInterval(refreshRemoteSettings, 30000);

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
async function sendVideoToApp(url, quality) {
  return (await postJson('/api/download/video', { url, quality: quality || 'best' })) !== null;
}

async function getVideoFormats(url) {
  try {
    const res = await fetch(endpoint('/api/video/formats'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
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
  // Streaming sites -> let the app grab the real video via yt-dlp
  if (isVideoSite(url)) {
    const ok = await sendVideoToApp(url);
    if (!ok) wakeApp(url);
    return;
  }
  // Explicit user action (context menu / button / grabber): skip the automatic
  // file-type filter — the user asked for this exact file.
  const result = await sendToApp(url, guessName(url), referrer, true);
  if (result === 'failed') wakeApp(url);
}

async function doVideo(url, quality) {
  if (!url) return;
  const ok = await sendVideoToApp(url, quality);
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Site engelleme: kullanıcı bu siteyi kapattıysa menü eylemleri çalışmaz
  if (dnIsSiteBlocked(tabHost(tab), cfg.disabledSites)) {
    notify('DeepNode', DN_I18N.t('notif_site_disabled'));
    return;
  }
  if (info.menuItemId === 'dn-link') {
    doDownload(info.srcUrl || info.linkUrl, info.pageUrl || (tab && tab.url));
  } else if (info.menuItemId === 'dn-video') {
    doVideo(info.pageUrl || (tab && tab.url));
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
  if (url.includes('localhost:' + cfg.port)) return; // avoid feedback loop
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
      await chrome.downloads.cancel(item.id);
      await chrome.downloads.erase({ id: item.id });
    } catch (e) { /* ignore */ }
    notify(DN_I18N.t('notif_captured'), name || url);
  }
});

// ---- Sniff media stream URLs (for blob/HLS fallback) ----
chrome.webRequest.onCompleted.addListener((d) => {
  if (d.tabId < 0) return;
  const url = d.url || '';
  if (!MEDIA_RE.test(url) && !/mime=(video|audio)/i.test(url)) return;
  let arr = streamsByTab.get(d.tabId) || [];
  if (!arr.includes(url)) {
    arr.unshift(url);
    arr = arr.slice(0, 40);
    streamsByTab.set(d.tabId, arr);
  }
}, { urls: ['<all_urls>'] });

chrome.tabs.onRemoved.addListener((id) => streamsByTab.delete(id));
chrome.webNavigation && chrome.webNavigation.onCommitted && chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId === 0) streamsByTab.delete(d.tabId);
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
    doDownload(msg.url);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DN_DOWNLOAD_VIDEO') {
    doVideo(msg.url, msg.quality);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'DN_GET_FORMATS') {
    getVideoFormats(msg.url).then((data) => sendResponse(data));
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
    sendResponse({ streams: streamsByTab.get(id) || [] });
    return true;
  }
  if (msg.type === 'DN_PING') {
    fetch(endpoint('/api/settings'))
      .then((r) => sendResponse({ ok: r.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});
