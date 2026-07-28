// DeepNode Download Manager - content script (corner download button + grabber)
// (strings.js bu dosyadan önce yüklenir: DN_I18N, dnResolveLang, dnIsSiteBlocked)

let showButton = true;

// ---- Dil: uygulama ayarı ('auto'|'tr'|'en') → yoksa tarayıcı dili ----
function refreshLang() {
  let ui = 'en';
  try { ui = chrome.i18n.getUILanguage(); } catch (e) { /* ignore */ }
  chrome.storage.local.get({ appLanguage: 'auto' }, (v) => {
    DN_I18N.setLang(dnResolveLang(v.appLanguage, ui));
    applyButtonText();
  });
}

// ---- Site engelleme: kullanıcı "bu sitede çalışma" dediyse tamamen sus ----
let siteBlocked = false;
function refreshSiteBlocked(cb) {
  chrome.storage.local.get({ disabledSites: [] }, (v) => {
    siteBlocked = dnIsSiteBlocked(location.hostname, v.disabledSites);
    if (siteBlocked) {
      hide();
      document.querySelector('.dn-panel')?.remove();
      closeQualityMenu();
    }
    if (cb) cb();
  });
}

chrome.storage.local.get({ showButton: true }, (v) => { showButton = v.showButton; });
refreshLang();
refreshSiteBlocked();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get({ showButton: true }, (v) => {
    // Re-enabling the toggle from the popup also clears a temporary dismiss
    if (v.showButton && !showButton) dismissed = false;
    showButton = v.showButton;
  });
  if (changes.appLanguage) refreshLang();
  if (changes.disabledSites) refreshSiteBlocked();
});

// ---- Floating download button that follows hovered media ----
const btn = document.createElement('div');
btn.className = 'dn-dl-btn';
btn.setAttribute('role', 'button');
document.documentElement.appendChild(btn);

function applyButtonText() {
  btn.innerHTML = '<span class="dn-ic">↓</span><span>' + DN_I18N.t('btn_download_with') + '</span><span class="dn-close" role="button" aria-label="' + DN_I18N.t('btn_hide') + '" title="' + DN_I18N.t('btn_hide') + '">×</span>';
  btn.setAttribute('aria-label', DN_I18N.t('btn_aria'));
  const closeEl = btn.querySelector('.dn-close');
  if (closeEl) closeEl.addEventListener('click', onCloseClick);
}
applyButtonText();

// User can temporarily dismiss the button via the corner X. It stays hidden on
// this page; it comes back on SPA/page navigation or when the popup toggle is
// switched back on.
let dismissed = false;
let dismissedHref = '';
function onCloseClick(e) {
  e.preventDefault();
  e.stopPropagation();
  dismissed = true;
  dismissedHref = location.href;
  hide();
  toast(DN_I18N.t('toast_hidden'));
}
function maybeRestoreButton() {
  if (dismissed && location.href !== dismissedHref) dismissed = false;
}

let current = null;
let hideTimer = null;

function isMedia(el) {
  if (!el || !el.tagName) return false;
  const t = el.tagName;
  if (t === 'VIDEO' || t === 'AUDIO') return true;
  return false;
}

// Report modifier-key state so the background can skip capture while the user
// holds the configured "bypass" key (hold-to-not-capture).
function reportMods(e) {
  try {
    chrome.runtime.sendMessage({ type: 'DN_MODS', ev: e.type, mods: { Alt: e.altKey, Control: e.ctrlKey, Shift: e.shiftKey } });
  } catch (err) { /* ignore */ }
}
window.addEventListener('keydown', reportMods, true);
window.addEventListener('keyup', reportMods, true);
window.addEventListener('mousedown', reportMods, true);
window.addEventListener('blur', () => {
  try { chrome.runtime.sendMessage({ type: 'DN_MODS', mods: { Alt: false, Control: false, Shift: false } }); } catch (err) {}
});

function place(el) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { hide(); return; }
  btn.style.top = (window.scrollY + r.top + 8) + 'px';
  btn.style.left = (window.scrollX + r.left + r.width - 88) + 'px';
  btn.style.display = 'flex';
  current = el;
  // Warm the formats cache for THIS video as soon as the button appears
  // (feed pages like Twitter/X have per-tweet URLs different from location.href)
  if (onVideoSite) fetchFormats(getVideoContextUrl(el), null);
}

function hide() { btn.style.display = 'none'; current = null; }

// ---- Tam ekran: video tam ekrandayken düğme kontrolleri kapatmasın —
// gizle ve tam ekrandan çıkana kadar gösterme.
let inFullscreen = false;
function onFsChange() {
  inFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (inFullscreen) { hide(); closeQualityMenu(); }
}
document.addEventListener('fullscreenchange', onFsChange, true);
document.addEventListener('webkitfullscreenchange', onFsChange, true);

let lastMove = 0;
document.addEventListener('mousemove', (e) => {
  if (!showButton || siteBlocked || inFullscreen) return;
  maybeRestoreButton(); // SPA navigation (e.g. YouTube) brings the button back
  if (dismissed) return;
  const now = Date.now();
  if (now - lastMove < 100) return;
  lastMove = now;

  // Don't hide button if mouse is over the download button itself
  if (btn && btn.style.display !== 'none') {
    const br = btn.getBoundingClientRect();
    if (e.clientX >= br.left && e.clientX <= br.right && e.clientY >= br.top && e.clientY <= br.bottom) {
      return;
    }
  }

  // Find video/audio element under cursor using boundingClientRect (bypasses pointer-events/overlays)
  const mediaEls = document.querySelectorAll('video, audio');
  let media = null;
  for (let i = 0; i < mediaEls.length; i++) {
    const el = mediaEls[i];
    const r = el.getBoundingClientRect();
    if (r.width > 40 && r.height > 40 &&
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom) {
      media = el;
      break;
    }
  }

  if (media) {
    clearTimeout(hideTimer);
    place(media);
  } else if (current) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 300);
  }
}, true);

btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
btn.addEventListener('mouseleave', () => { hideTimer = setTimeout(hide, 400); });
window.addEventListener('scroll', () => { if (current) place(current); }, { passive: true });
window.addEventListener('resize', () => { if (current) place(current); }, { passive: true });

function mediaUrl(el) {
  let url = el.currentSrc || el.src || '';
  if ((!url || url.startsWith('blob:')) && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
    const s = el.querySelector('source');
    if (s && s.src) url = s.src;
  }
  return url;
}

const VIDEO_SITE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com)$/i;
const onVideoSite = VIDEO_SITE_RE.test(location.hostname);

// ---- Format prefetch/cache (so the quality menu opens instantly) ----
const formatsCache = new Map();
function pageKey(u) {
  try {
    const url = new URL(u);
    if (/(^|\.)youtube\.com$/.test(url.hostname)) { const v = url.searchParams.get('v'); if (v) return 'yt:' + v; }
    if (url.hostname === 'youtu.be') return 'yt:' + url.pathname.slice(1);
    return url.origin + url.pathname;
  } catch (e) { return u; }
}
function fetchFormats(url, cb) {
  const key = pageKey(url);
  const c = formatsCache.get(key);
  if (c && c.data && !c.data.error) { if (cb) cb(c.data); return; }
  if (c && c.pending) { if (cb) c.waiters.push(cb); return; }
  // Failure cooldown: don't hammer the app while it's closed (hover prefetch
  // would otherwise retry every mousemove); retry is allowed after 5s.
  if (c && c.data && c.data.error) {
    if (Date.now() - (c.failedAt || 0) < 5000) { if (cb) cb(c.data); return; }
    formatsCache.delete(key);
  }
  const entry = { pending: true, data: null, failedAt: 0, waiters: cb ? [cb] : [] };
  formatsCache.set(key, entry);
  chrome.runtime.sendMessage({ type: 'DN_GET_FORMATS', url }, (resp) => {
    const data = (!chrome.runtime.lastError && resp) ? resp : { error: true };
    entry.pending = false;
    entry.data = data;
    entry.waiters.forEach(w => w(data));
    entry.waiters = [];
    // Mark failures for retry (e.g. once the app is running)
    if (data.error) { entry.failedAt = Date.now(); lastPrefetchKey = null; }
  });
}

// Does this URL look like a dedicated video page? Lets us prefetch formats the
// moment the page loads, without waiting for a <video> element to appear.
function isVideoPageUrl(u) {
  try {
    const url = new URL(u);
    const h = url.hostname, p = url.pathname;
    if (/(^|\.)youtube\.com$/i.test(h)) return url.searchParams.has('v') || /^\/shorts\//.test(p);
    if (/^youtu\.be$/i.test(h)) return p.length > 1;
    if (/(^|\.)vimeo\.com$/i.test(h)) return /\/\d+/.test(p);
    if (/(^|\.)dailymotion\.com$/i.test(h)) return /^\/video\//.test(p);
    if (/(^|\.)twitch\.tv$/i.test(h)) return /^\/videos\//.test(p) || /\/clip\//.test(p);
    if (/(^|\.)tiktok\.com$/i.test(h)) return /\/video\//.test(p);
    if (/(^|\.)instagram\.com$/i.test(h)) return /^\/(reel|p|tv)\//.test(p);
    if (/(^|\.)(twitter\.com|x\.com)$/i.test(h)) return /\/status\/\d+/.test(p);
    if (/(^|\.)(facebook\.com|fb\.watch)$/i.test(h)) return /watch|\/videos\//i.test(u);
    if (/(^|\.)reddit\.com$/i.test(h)) return /\/comments\//.test(p);
    return false;
  } catch (e) { return false; }
}

// Warm the cache in the background as soon as the page loads (or a video is
// present/playing), so the download menu is ready before the user clicks.
let lastPrefetchKey = null;
function maybePrefetch() {
  if (!onVideoSite) return;
  if (!isVideoPageUrl(location.href) && !document.querySelector('video')) return;
  const key = pageKey(location.href);
  if (key === lastPrefetchKey) return;
  lastPrefetchKey = key;
  fetchFormats(location.href, null);
}
if (onVideoSite) {
  maybePrefetch();                                          // immediately on load
  window.addEventListener('yt-navigate-finish', maybePrefetch, true); // YouTube SPA nav (instant)
  setInterval(maybePrefetch, 2000);           // catches other SPA navigations
  document.addEventListener('play', maybePrefetch, true); // when a video starts
  setTimeout(maybePrefetch, 1500);
}

function getVideoContextUrl(el) {
  if (!el) return location.href;
  try {
    if (/(twitter\.com|x\.com)/i.test(location.hostname)) {
      const container = el.closest('article') || el.closest('[data-testid="tweet"]');
      if (container) {
        const link = container.querySelector('a[href*="/status/"]');
        if (link && link.href) return link.href;
      }
    }
  } catch (err) {}
  return location.href;
}

btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!current) return;
  const url = mediaUrl(current);
  const targetPageUrl = getVideoContextUrl(current);

  // Known streaming site (YouTube, Twitter etc.): show a quality menu, then download chosen quality
  if (onVideoSite && (current.tagName === 'VIDEO' || !url || url.startsWith('blob:'))) {
    openQualityMenu(targetPageUrl);
    return;
  }

  if (url && !url.startsWith('blob:')) {
    chrome.runtime.sendMessage({ type: 'DN_DOWNLOAD', url });
    toast(DN_I18N.t('toast_added'));
    return;
  }
  // blob/streaming video -> fall back to sniffed network streams
  chrome.runtime.sendMessage({ type: 'DN_GET_STREAMS' }, (resp) => {
    const streams = (!chrome.runtime.lastError && resp && resp.streams) || [];
    if (streams.length) {
      chrome.runtime.sendMessage({ type: 'DN_DOWNLOAD', url: streams[0] });
      toast(DN_I18N.t('toast_stream'));
    } else {
      toast(DN_I18N.t('toast_blob_fail'));
    }
  });
});

// ---- Toast ----
let toastTimer = null;
function toast(msg) {
  let t = document.querySelector('.dn-toast');
  if (!t) { t = document.createElement('div'); t.className = 'dn-toast'; document.documentElement.appendChild(t); }
  t.textContent = 'DeepNode: ' + msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

// ---- Quality menu for streaming sites ----
function fmtBytes(b) {
  if (!b || b <= 0) return '';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}
function qLabel(h) {
  return h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : h >= 1080 ? ' (Full HD)' : h >= 720 ? ' (HD)' : '';
}

function closeQualityMenu() {
  document.querySelector('.dn-qmenu')?.remove();
  document.removeEventListener('click', onDocClickForMenu, true);
}
function onDocClickForMenu(e) {
  const menu = document.querySelector('.dn-qmenu');
  if (menu && !menu.contains(e.target) && e.target !== btn) closeQualityMenu();
}

function openQualityMenu(pageUrl) {
  closeQualityMenu();
  const menu = document.createElement('div');
  menu.className = 'dn-qmenu';
  const r = btn.getBoundingClientRect();
  menu.style.top = (window.scrollY + r.bottom + 4) + 'px';
  menu.style.left = (window.scrollX + Math.max(4, r.right - 240)) + 'px';
  const preloaded = formatsCache.get(pageKey(pageUrl));
  const loadingText = (preloaded && preloaded.data) ? '' : DN_I18N.t('q_loading');
  menu.innerHTML = '<div class="dn-qhead">' + DN_I18N.t('q_title') + '</div><div class="dn-qbody">' + (loadingText ? `<div class="dn-qload">${loadingText}</div>` : '') + '</div>';
  document.documentElement.appendChild(menu);
  setTimeout(() => document.addEventListener('click', onDocClickForMenu, true), 0);

  const pick = (quality) => {
    chrome.runtime.sendMessage({ type: 'DN_DOWNLOAD_VIDEO', url: pageUrl, quality });
    toast(DN_I18N.t('toast_video_started'));
    closeQualityMenu();
  };

  fetchFormats(pageUrl, (data) => {
    const body = menu.querySelector('.dn-qbody');
    if (!body) return;
    const rows = [];
    rows.push('<div class="dn-qitem" data-q="best"><span>' + DN_I18N.t('q_best') + '</span></div>');
    const qualities = (data && data.qualities) || [];
    if (data && data.error) {
      rows.push('<div class="dn-qnote">' + DN_I18N.t('q_error') + '</div>');
    } else {
      qualities.forEach(q => {
        const size = q.size ? `<span class="dn-qsize">~${fmtBytes(q.size)}</span>` : '';
        rows.push(`<div class="dn-qitem" data-q="${q.height}"><span>${q.height}p${qLabel(q.height)}</span>${size}</div>`);
      });
    }
    rows.push('<div class="dn-qitem dn-qaudio" data-q="audio"><span>' + DN_I18N.t('q_audio') + '</span></div>');
    body.innerHTML = rows.join('');
    if (data && data.title) {
      const t = document.createElement('div');
      t.className = 'dn-qtitle';
      t.textContent = data.title;
      menu.appendChild(t);
    }
    body.querySelectorAll('.dn-qitem').forEach(el => el.addEventListener('click', () => pick(el.dataset.q)));
  });
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeQualityMenu(); });

// ---- Grabber panel (scan page for media) ----
// Dosya türü grupları — uygulamadaki Medya Yakalayıcı filtresiyle aynı kategoriler
const DN_TYPE_GROUPS = {
  video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', 'm3u8'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg'],
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
  document: ['pdf', 'docx', 'xlsx', 'pptx', 'epub'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
  program: ['exe', 'msi', 'apk', 'dmg']
};
function dnTypeLabel(tkey) { return DN_I18N.t('type_' + tkey); }

function typeOfUrl(u) {
  try {
    const p = new URL(u, location.href).pathname;
    const ext = (p.includes('.') ? p.split('.').pop() : '').toLowerCase().split('?')[0];
    for (const t in DN_TYPE_GROUPS) { if (DN_TYPE_GROUPS[t].includes(ext)) return t; }
  } catch (e) { /* ignore */ }
  return 'other';
}

function fileName(url) {
  try {
    const u = new URL(url, location.href);
    return decodeURIComponent((u.pathname.split('/').pop() || u.hostname).split('?')[0]) || url;
  } catch (e) { return url; }
}

function collectPageMedia(cb) {
  const map = new Map(); // url -> type
  const add = (u, type) => { if (u && !map.has(u)) map.set(u, type || typeOfUrl(u)); };
  document.querySelectorAll('video, audio, source').forEach((el) => {
    const u = el.currentSrc || el.src;
    if (u && !u.startsWith('blob:')) {
      const parentTag = el.tagName === 'SOURCE' && el.parentElement ? el.parentElement.tagName : el.tagName;
      add(u, parentTag === 'AUDIO' ? 'audio' : 'video');
    }
  });
  document.querySelectorAll('img').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width >= 200 && r.height >= 200 && el.src) add(el.src, 'image');
  });
  document.querySelectorAll('a[href]').forEach((a) => {
    if (/\.(mp4|mkv|webm|mp3|m4a|flac|wav|zip|rar|7z|pdf|exe|msi|iso|apk|docx|xlsx|pptx)(\?|$)/i.test(a.href)) add(a.href);
  });
  chrome.runtime.sendMessage({ type: 'DN_GET_STREAMS' }, (resp) => {
    // Ağdan yakalanan akışlar (m3u8/googlevideo) uzantısız olabilir -> video say
    if (!chrome.runtime.lastError && resp && resp.streams) resp.streams.forEach((u) => add(u, 'video'));
    cb(Array.from(map, ([url, type]) => ({ url, type })));
  });
}

function openPanel(entries) {
  document.querySelector('.dn-panel')?.remove();
  const panel = document.createElement('div');
  panel.className = 'dn-panel';

  // Tür filtresi: yalnızca sayfada bulunan türler için chip göster, tümü seçili başlar
  const presentTypes = Array.from(new Set(entries.map((it) => it.type)));
  const activeTypes = new Set(presentTypes);
  const chips = presentTypes.map((t) =>
    `<button class="dn-ft dn-ft-on" data-t="${t}">${dnTypeLabel(t)}</button>`
  ).join('');

  const items = entries.length
    ? entries.map((it) => `<div class="dn-item" data-t="${it.type}"><span class="dn-name" title="${it.url.replace(/"/g, '&quot;')}">${fileName(it.url)}</span><span class="dn-tag">${dnTypeLabel(it.type)}</span><button class="dn-get" data-u="${it.url.replace(/"/g, '&quot;')}">${DN_I18N.t('g_download')}</button></div>`).join('')
    : '<div class="dn-empty">' + DN_I18N.t('g_empty') + '</div>';
  panel.innerHTML =
    '<div class="dn-panel-h"><span>DeepNode Grabber (' + entries.length + ')</span><span class="dn-x" role="button" aria-label="' + DN_I18N.t('g_close') + '">×</span></div>' +
    (presentTypes.length > 1 ? '<div class="dn-filters">' + chips + '</div>' : '') +
    '<div class="dn-panel-b">' + items + '</div>' +
    (entries.length ? '<div class="dn-panel-f"><button class="dn-all">' + DN_I18N.t('g_download_all') + '</button></div>' : '');
  document.documentElement.appendChild(panel);

  const visibleUrls = () => entries.filter((it) => activeTypes.has(it.type)).map((it) => it.url);

  const applyFilter = () => {
    panel.querySelectorAll('.dn-item').forEach((row) => {
      row.style.display = activeTypes.has(row.dataset.t) ? 'flex' : 'none';
    });
    const head = panel.querySelector('.dn-panel-h span');
    if (head) head.textContent = 'DeepNode Grabber (' + visibleUrls().length + ')';
    const all = panel.querySelector('.dn-all');
    if (all && !all.disabled) all.style.display = visibleUrls().length ? '' : 'none';
  };

  panel.querySelectorAll('.dn-ft').forEach((chip) => chip.addEventListener('click', () => {
    const t = chip.dataset.t;
    if (activeTypes.has(t)) { activeTypes.delete(t); chip.classList.remove('dn-ft-on'); }
    else { activeTypes.add(t); chip.classList.add('dn-ft-on'); }
    applyFilter();
  }));

  panel.querySelector('.dn-x').addEventListener('click', () => panel.remove());
  panel.querySelectorAll('.dn-get').forEach((b) => b.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'DN_DOWNLOAD', url: b.dataset.u });
    b.textContent = DN_I18N.t('g_added');
    b.disabled = true;
  }));
  const all = panel.querySelector('.dn-all');
  if (all) all.addEventListener('click', () => {
    // Yalnızca aktif filtreden geçen (görünen) dosyaları indir
    const urls = visibleUrls();
    if (!urls.length) return;
    chrome.runtime.sendMessage({ type: 'DN_DOWNLOAD_MANY', urls });
    all.textContent = DN_I18N.t('g_all_added', { n: urls.length });
    all.disabled = true;
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'DN_SCAN' && !siteBlocked) collectPageMedia(openPanel);
});
