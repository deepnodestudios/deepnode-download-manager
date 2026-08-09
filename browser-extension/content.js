// DeepNode Download Manager - content script (corner download button + grabber)
// (strings.js bu dosyadan önce yüklenir: DN_I18N, dnResolveLang, dnIsSiteBlocked)

let showButton = true;

// Eklenti yenilendiğinde/güncellendiğinde, o an açık sekmelerde çalışan bu content
// script "yetim" (orphaned) kalır: chrome.runtime.id undefined olur ve chrome.storage/
// runtime çağrıları "Cannot read properties of undefined" / "Extension context
// invalidated" hatası verir. Bağlam geçersizse API'lere hiç dokunmayalım.
function dnCtxValid() {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
}

// Yetim script'te chrome.runtime.sendMessage SENKRON "Extension context invalidated"
// fırlatır (storage guard'ları bunu kapsamıyordu). Tüm mesajlar bu sarmalayıcıdan
// geçer; bağlam geçersiz/hata varsa callback null alır (lastError burada tüketilir).
function dnSendMessage(msg, cb) {
  if (!dnCtxValid()) { if (cb) cb(null); return; }
  try {
    if (cb) {
      chrome.runtime.sendMessage(msg, (resp) => {
        cb(chrome.runtime.lastError ? null : (resp || null));
      });
    } else {
      chrome.runtime.sendMessage(msg);
    }
  } catch (e) { if (cb) cb(null); }
}

// ---- Dil: uygulama ayarı ('auto'|'tr'|'en') → yoksa tarayıcı dili ----
function refreshLang() {
  let ui = 'en';
  try { ui = chrome.i18n.getUILanguage(); } catch (e) { /* ignore */ }
  if (!dnCtxValid()) return;
  chrome.storage.local.get({ appLanguage: 'auto' }, (v) => {
    DN_I18N.setLang(dnResolveLang(v.appLanguage, ui));
    applyButtonText();
  });
}

// ---- Site engelleme: kullanıcı "bu sitede çalışma" dediyse tamamen sus ----
let siteBlocked = false;
function refreshSiteBlocked(cb) {
  if (!dnCtxValid()) return;
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

if (dnCtxValid()) chrome.storage.local.get({ showButton: true }, (v) => { showButton = v.showButton; });
refreshLang();
refreshSiteBlocked();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!dnCtxValid()) return;
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

// innerHTML yerine güvenli DOM kurucu — AMO "Unsafe assignment to innerHTML"
// uyarısına takılmamak için tüm dinamik içerik textContent ile yazılır.
function dnEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null && text !== '') el.textContent = text;
  return el;
}

function applyButtonText() {
  btn.textContent = '';
  btn.appendChild(dnEl('span', 'dn-ic', '↓'));
  btn.appendChild(dnEl('span', '', DN_I18N.t('btn_download_with')));
  const closeEl = dnEl('span', 'dn-close', '×');
  closeEl.setAttribute('role', 'button');
  closeEl.setAttribute('aria-label', DN_I18N.t('btn_hide'));
  closeEl.title = DN_I18N.t('btn_hide');
  closeEl.addEventListener('click', onCloseClick);
  btn.appendChild(closeEl);
  btn.setAttribute('aria-label', DN_I18N.t('btn_aria'));
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
    dnSendMessage({ type: 'DN_MODS', ev: e.type, mods: { Alt: e.altKey, Control: e.ctrlKey, Shift: e.shiftKey } });
  } catch (err) { /* ignore */ }
}
window.addEventListener('keydown', reportMods, true);
window.addEventListener('keyup', reportMods, true);
window.addEventListener('mousedown', reportMods, true);
window.addEventListener('blur', () => {
  try { dnSendMessage({ type: 'DN_MODS', mods: { Alt: false, Control: false, Shift: false } }); } catch (err) {}
});

// Hover prefetch debounce: feed'de fare gezdirirken üzerinden geçilen HER video
// için anında format sorgusu gitmesin (backend'de her biri bir yt-dlp süreci).
// Yalnızca aynı videoda ~400ms kalınırsa ısıtma yapılır; cache zaten mükerrer
// sorguyu engelliyor, bu sadece "yoldan geçerken" ateşlemeyi keser.
let hoverPrefetchTimer = null;
let hoverPrefetchCtx = null;

function place(el) {
  const r = el.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) { hide(); return; }
  btn.style.top = (window.scrollY + r.top + 8) + 'px';
  btn.style.left = (window.scrollX + r.left + r.width - 88) + 'px';
  btn.style.display = 'flex';
  current = el;
  // Warm the formats cache for THIS video as soon as the button appears
  // (feed pages like Twitter/X/YouTube have per-item URLs different from location.href)
  const ctx = getVideoContextUrl(el);
  if (!(onVideoSite || (ctx && ctx !== location.href))) return;
  if (ctx === hoverPrefetchCtx) return; // bu video için zaten planlandı/ateşlendi
  clearTimeout(hoverPrefetchTimer);
  hoverPrefetchCtx = ctx;
  hoverPrefetchTimer = setTimeout(() => { fetchFormats(ctx, null); }, 400);
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

const VIDEO_SITE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com|pornhub\.com|phncdn\.com|xnxx\.com|xxnx\.com|xnxx-cdn\.com|xvideos\.com|xvideos-cdn\.com|eporner\.com|spankbang\.com|hqporner\.com|beeg\.com|youporn\.com|redtube\.com|tube8\.com|xhamster\.com|txxx\.com|drtuber\.com|rule34video\.com)$/i;
const onVideoSite = VIDEO_SITE_RE.test(location.hostname);

// HLS/DASH manifestleri (m3u8/mpd) siteden bağımsız olarak yt-dlp ile indirilir
function isManifestUrl(u) {
  return /\.(m3u8|mpd)(\?|$)/i.test(u || '');
}

// inject.js (MAIN world) sayfanın fetch/XHR çağrılarından yakaladığı manifest
// URL'lerini buraya postMessage eder. Bu, cross-origin iframe içinde de çalışır
// ve chrome.webRequest'e (MV3 worker uykusu) bağımlı değildir. inject.js yalnızca
// DOĞRULANMIŞ manifest gönderir (Content-Type mpegurl/dash), .txt gibi uzantısız
// olanlar dahil — bu yüzden dnSniffed girdileri doğrudan manifest kabul edilir.
const dnSniffed = [];
const dnMasters = []; // #EXT-X-STREAM-INF içeren (tüm kaliteleri barındıran) master'lar
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!(d && d.__dnHls && d.url)) return;
  if (!dnSniffed.includes(d.url)) {
    dnSniffed.unshift(d.url);
    if (dnSniffed.length > 100) dnSniffed.length = 100; // uzun oturumda sınırsız büyümesin
  }
  // Master tercih edilir: yt-dlp'ye master verirsek oynatıcıdaki tüm kaliteler gelir.
  if (d.master && !dnMasters.includes(d.url)) {
    dnMasters.unshift(d.url);
    if (dnMasters.length > 100) dnMasters.length = 100;
    // Kaliteleri ARKA PLANDA ısıt: kullanıcı "DDM ile İndir"e bastığında menü anında
    // hazır olsun (yt-dlp master+varyant probe gecikmesi tıklamadan ÖNCE yapılır).
    try { fetchFormats(d.url, null, location.href); } catch (e) { /* ignore */ }
  }
}, false);

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
function fetchFormats(url, cb, referer) {
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
  // Sonsuz kaydırmalı SPA oturumlarında (YouTube) video başına bir girdi
  // birikiyordu — en eskisini atarak sınırla (Map ekleme sırasını korur).
  if (formatsCache.size >= 200) {
    const oldest = formatsCache.keys().next().value;
    if (oldest !== undefined) formatsCache.delete(oldest);
  }
  formatsCache.set(key, entry);
  dnSendMessage({ type: 'DN_GET_FORMATS', url, referer: referer || undefined }, (resp) => {
    const data = resp || { error: true };
    entry.pending = false;
    entry.data = data;
    entry.waiters.forEach(w => w(data));
    entry.waiters = [];
    // Mark failures for retry (e.g. once the app is running)
    if (data.error) { entry.failedAt = Date.now(); lastPrefetchKey = null; hoverPrefetchCtx = null; }
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
    if (/(^|\.)(pornhub\.com|phncdn\.com|xnxx\.com|xxnx\.com|xnxx-cdn\.com|xvideos\.com|xvideos-cdn\.com|eporner\.com|spankbang\.com|hqporner\.com|beeg\.com|youporn\.com|redtube\.com|tube8\.com|xhamster\.com|txxx\.com|drtuber\.com|rule34video\.com)$/i.test(h)) return true;
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

// YouTube watch URL'sini sadeleştir (?v=ID) — &list=/&pp= gibi playlist/izleme
// parametrelerini atar; yt-dlp'nin doğru tek videoyu çekmesini sağlar.
function ytCleanWatch(href) {
  try {
    const u = new URL(href, location.href);
    const v = u.searchParams.get('v');
    if (v) return 'https://www.youtube.com/watch?v=' + v;
    if (/^\/shorts\//.test(u.pathname)) return u.origin + u.pathname;
  } catch (e) { /* ignore */ }
  return href;
}

// Feed/liste/ana sayfa hover önizlemesi: oynayan önizleme <video>'sunun geometrik
// olarak üzerinde durduğu thumbnail linkinin (/watch?v=) URL'sini bul. Önizleme
// oynatıcısı çoğu zaman thumbnail item'ının DIŞINDA (ayrık) olduğundan, ata-arama
// yerine ekran konumu kesişimine bakarız.
function ytWatchUrlFromFeed(el) {
  try {
    const renderer = el.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer');
    if (renderer) {
      const a = renderer.querySelector('a#thumbnail[href*="watch?v="], a.yt-simple-endpoint[href*="watch?v="], a[href*="/shorts/"], a[href*="watch?v="]');
      if (a && a.href) return ytCleanWatch(a.href);
    }
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const links = document.querySelectorAll('a#thumbnail[href*="watch?v="], a[href*="/watch?v="], a[href*="/shorts/"]');
    let best = null, bestArea = Infinity;
    for (const a of links) {
      const ar = a.getBoundingClientRect();
      if (ar.width < 40 || ar.height < 40) continue;
      if (cx >= ar.left && cx <= ar.right && cy >= ar.top && cy <= ar.bottom) {
        const area = ar.width * ar.height;
        if (area < bestArea) { bestArea = area; best = a; }
      }
    }
    if (best && best.href) return ytCleanWatch(best.href);
  } catch (e) { /* ignore */ }
  return null;
}

// Site-bağımsız: video/önizleme başka bir sayfaya giden bir bağlantının (kart /
// thumbnail sarmalayıcısı) İÇİNDEYSE o permalinki kullan. Feed/liste görünümlü
// çoğu site (haber, sosyal, blog, film listeleri) videoyu böyle bir <a> ile sarar.
// Tek videolu sayfalarda oynatıcı böyle bir linkin içinde olmaz → null döner.
function genericContextUrl(el) {
  try {
    const a = el.closest('a[href]');
    if (!a) return null;
    const href = a.href;
    if (!href || !/^https?:/i.test(href)) return null;
    if (href.split('#')[0] === location.href.split('#')[0]) return null; // kendine link
    return href;
  } catch (e) { /* ignore */ }
  return null;
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
    // YouTube: watch sayfasında location.href zaten doğru; ana sayfa/feed/abonelik
    // listelerinde hover önizlemesi tıklanınca hangi videonun izlendiğini konumdan bul.
    if (/(^|\.)youtube\.com$/i.test(location.hostname)) {
      const w = ytWatchUrlFromFeed(el);
      if (w) return w;
    }
    // Diğer TÜM siteler: video bir permalink linkinin içindeyse o sayfayı kullan.
    const g = genericContextUrl(el);
    if (g) return g;
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

  // Herhangi bir sitede feed/liste: video başka bir sayfaya (permalink) giden bir
  // linkin içindeyse ve doğrudan dosya değilse, o sayfayı yt-dlp'ye gönder.
  if (targetPageUrl !== location.href &&
      (current.tagName === 'VIDEO' || current.tagName === 'AUDIO') &&
      (!url || url.startsWith('blob:'))) {
    openQualityMenu(targetPageUrl);
    return;
  }

  if (url && !url.startsWith('blob:')) {
    // Doğrudan m3u8/mpd kaynağı: kalite menüsüyle yt-dlp'ye gönder (Referer = sayfa)
    if (isManifestUrl(url)) {
      openQualityMenu(url, location.href);
      return;
    }
    dnSendMessage({ type: 'DN_DOWNLOAD', url, referer: location.href });
    toast(DN_I18N.t('toast_added'));
    return;
  }
  // blob/streaming video -> önce bu çerçevede yakalanan manifest (inject.js), sonra
  // arka plandaki sniff edilmiş akışlar (HER sitede çalışır, 16 site sınırı yok)
  const localManifest = dnMasters[0] || dnSniffed[0];
  if (localManifest) {
    openQualityMenu(localManifest, location.href);
    return;
  }
  dnSendMessage({ type: 'DN_GET_STREAMS' }, (resp) => {
    const streams = (resp && resp.streams) || [];
    const manifests = (resp && resp.manifests) || [];
    // Önce master (tüm kaliteler), sonra doğrulanmış manifest, sonra ilk akış
    const manifest = dnMasters[0] || manifests[0] || streams.find(isManifestUrl) || dnSniffed[0];
    if (manifest) {
      openQualityMenu(manifest, location.href);
      return;
    }
    if (streams.length) {
      dnSendMessage({ type: 'DN_DOWNLOAD', url: streams[0], referer: location.href });
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

// Sayfa başlığından dosya adı tahmini — HLS/.txt manifestlerinde başlık metadatası yok,
// yt-dlp "master" derdi. Site ekini (" - Site", " | Site", " » Site") at, ilk parçayı al.
function dnPageTitleGuess() {
  let t = (document.title || '').trim();
  const parts = t.split(/\s*(?:»|\||::)\s*|\s+[-–—]\s+/);
  if (parts.length > 1 && parts[0].trim().length >= 2) t = parts[0].trim();
  return t.slice(0, 150);
}

function openQualityMenu(pageUrl, referer) {
  closeQualityMenu();
  const menu = document.createElement('div');
  menu.className = 'dn-qmenu';
  const r = btn.getBoundingClientRect();
  menu.style.top = (window.scrollY + r.bottom + 4) + 'px';
  menu.style.left = (window.scrollX + Math.max(4, r.right - 300)) + 'px';
  const preloaded = formatsCache.get(pageKey(pageUrl));
  const loadingText = (preloaded && preloaded.data) ? '' : DN_I18N.t('q_loading');
  menu.appendChild(dnEl('div', 'dn-qhead', DN_I18N.t('q_title')));
  const qbody = dnEl('div', 'dn-qbody');
  if (loadingText) qbody.appendChild(dnEl('div', 'dn-qload', loadingText));
  menu.appendChild(qbody);
  document.documentElement.appendChild(menu);
  setTimeout(() => document.addEventListener('click', onDocClickForMenu, true), 0);

  const pick = (quality) => {
    dnSendMessage({ type: 'DN_DOWNLOAD_VIDEO', url: pageUrl, quality, referer: referer || undefined, title: dnPageTitleGuess() || undefined });
    toast(DN_I18N.t('toast_video_started'));
    closeQualityMenu();
  };

  // "Tümünü indir": her çözünürlükten bir tane (IDM gibi) — varsayılan Video klasörüne,
  // ayrı ayrı onay pencereleri açmadan toplu eklenir.
  const pickAll = (heights) => {
    dnSendMessage({
      type: 'DN_DOWNLOAD_VIDEO_ALL',
      url: pageUrl,
      referer: referer || undefined,
      title: dnPageTitleGuess() || undefined,
      qualities: (heights || []).map(String)
    });
    toast(DN_I18N.t('toast_video_started'));
    closeQualityMenu();
  };

  fetchFormats(pageUrl, (data) => {
    const body = menu.querySelector('.dn-qbody');
    if (!body) return;
    body.textContent = '';
    // Kalite satırı kurucusu: data-q + etiket + opsiyonel boyut rozeti
    const addRow = (q, label, sizeBytes, extraClass) => {
      const row = dnEl('div', 'dn-qitem' + (extraClass ? ' ' + extraClass : ''));
      row.dataset.q = q;
      row.appendChild(dnEl('span', '', label));
      if (sizeBytes) row.appendChild(dnEl('span', 'dn-qsize', '~' + fmtBytes(sizeBytes)));
      body.appendChild(row);
    };
    const variants = (data && data.variants) || [];
    const qualities = (data && data.qualities) || [];
    // "Tümünü indir" satırı: mevcut çözünürlükler (her birinden bir kalite).
    const allHeights = (data && data.heights && data.heights.length)
      ? data.heights
      : [...new Set(qualities.map(q => q.height))];
    // IDM gibi menünün EN ÜSTÜNDE dursun.
    if (!(data && data.error) && allHeights.length > 1) {
      addRow('__all__', DN_I18N.t('g_download_all'), 0, 'dn-qall');
    }
    addRow('best', DN_I18N.t('q_best'));
    if (data && data.error) {
      body.appendChild(dnEl('div', 'dn-qnote', DN_I18N.t('q_error')));
    } else if (variants.length) {
      // Aynı çözünürlüğün her format varyantı (ör. 1080p MP4·AV1 küçük, 1080p MP4·H.264 büyük):
      // kapsayıcı + codec + boyut göster; seçilince tam o format_id iner.
      variants.forEach(v => {
        const meta = [v.container, v.vcodec].filter(Boolean).join(' · ');
        addRow('fmt:' + v.formatId, `${v.height}p${qLabel(v.height)}${meta ? ' · ' + meta : ''}`, v.size);
      });
    } else {
      qualities.forEach(q => {
        addRow(String(q.height), `${q.height}p${qLabel(q.height)}`, q.size);
      });
    }
    addRow('audio', DN_I18N.t('q_audio'), 0, 'dn-qaudio');
    // yt-dlp, HLS manifestlerine dosya adından jenerik başlık verir (master/index/
    // playlist...). Bunları menüde göstermek kafa karıştırır — yalnızca anlamlı başlıkları göster.
    const genericTitle = /^(master|index|playlist|chunklist|manifest|stream|video|hls)$/i;
    if (data && data.title && !genericTitle.test(String(data.title).trim())) {
      const t = document.createElement('div');
      t.className = 'dn-qtitle';
      t.textContent = data.title;
      menu.appendChild(t);
    }
    body.querySelectorAll('.dn-qitem').forEach(el => el.addEventListener('click', () => {
      if (el.dataset.q === '__all__') pickAll(allHeights);
      else pick(el.dataset.q);
    }));
  }, referer);
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
  dnSendMessage({ type: 'DN_GET_STREAMS' }, (resp) => {
    // Ağdan yakalanan akışlar (m3u8/googlevideo) uzantısız olabilir -> video say
    if (resp && resp.streams) resp.streams.forEach((u) => add(u, 'video'));
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

  const header = dnEl('div', 'dn-panel-h');
  header.appendChild(dnEl('span', '', 'DeepNode Grabber (' + entries.length + ')'));
  const closeX = dnEl('span', 'dn-x', '×');
  closeX.setAttribute('role', 'button');
  closeX.setAttribute('aria-label', DN_I18N.t('g_close'));
  header.appendChild(closeX);
  panel.appendChild(header);

  if (presentTypes.length > 1) {
    const filters = dnEl('div', 'dn-filters');
    presentTypes.forEach((t) => {
      const chip = dnEl('button', 'dn-ft dn-ft-on', dnTypeLabel(t));
      chip.dataset.t = t;
      filters.appendChild(chip);
    });
    panel.appendChild(filters);
  }

  const listBody = dnEl('div', 'dn-panel-b');
  if (entries.length) {
    entries.forEach((it) => {
      const row = dnEl('div', 'dn-item');
      row.dataset.t = it.type;
      const name = dnEl('span', 'dn-name', fileName(it.url));
      name.title = it.url;
      row.appendChild(name);
      row.appendChild(dnEl('span', 'dn-tag', dnTypeLabel(it.type)));
      const get = dnEl('button', 'dn-get', DN_I18N.t('g_download'));
      get.dataset.u = it.url;
      row.appendChild(get);
      listBody.appendChild(row);
    });
  } else {
    listBody.appendChild(dnEl('div', 'dn-empty', DN_I18N.t('g_empty')));
  }
  panel.appendChild(listBody);

  if (entries.length) {
    const foot = dnEl('div', 'dn-panel-f');
    foot.appendChild(dnEl('button', 'dn-all', DN_I18N.t('g_download_all')));
    panel.appendChild(foot);
  }
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
    dnSendMessage({ type: 'DN_DOWNLOAD', url: b.dataset.u });
    b.textContent = DN_I18N.t('g_added');
    b.disabled = true;
  }));
  const all = panel.querySelector('.dn-all');
  if (all) all.addEventListener('click', () => {
    // Yalnızca aktif filtreden geçen (görünen) dosyaları indir
    const urls = visibleUrls();
    if (!urls.length) return;
    dnSendMessage({ type: 'DN_DOWNLOAD_MANY', urls });
    all.textContent = DN_I18N.t('g_all_added', { n: urls.length });
    all.disabled = true;
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'DN_SCAN' && !siteBlocked) collectPageMedia(openPanel);
});
