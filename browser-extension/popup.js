// DeepNode Download Manager — popup (strings.js önce yüklenir)
const DEFAULTS = { enabled: true, captureDownloads: true, showButton: true, port: 5000, disabledSites: [], appLanguage: 'auto' };
let cfg = { ...DEFAULTS };
let currentHost = '';

// Show the LOADED extension version so a stale copy is immediately visible
try {
  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
} catch (e) { /* ignore */ }

const els = {
  enabled: document.getElementById('enabled'),
  captureDownloads: document.getElementById('captureDownloads'),
  showButton: document.getElementById('showButton'),
  port: document.getElementById('port')
};

function t(key, vars) { return DN_I18N.t(key, vars); }

function applyTexts() {
  document.getElementById('subtitle').textContent = t('pop_integration');
  document.getElementById('lblEnabled').textContent = t('pop_enabled');
  document.getElementById('lblCapture').textContent = t('pop_capture');
  document.getElementById('lblShowBtn').textContent = t('pop_show_btn');
  document.getElementById('lblPort').textContent = t('pop_port');
  document.getElementById('scan').textContent = t('pop_scan');
  document.getElementById('hint').textContent = t('pop_hint');
  renderSiteRow();
}

// ---- Aktif sekmenin sitesi + "bu sitede çalışma" durumu ----
function siteBlocked() {
  return dnIsSiteBlocked(currentHost, cfg.disabledSites);
}

function renderSiteRow() {
  const box = document.getElementById('siteBox');
  const hostEl = document.getElementById('siteHost');
  const btn = document.getElementById('siteToggle');
  const note = document.getElementById('siteNote');
  if (!currentHost) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const blocked = siteBlocked();
  hostEl.textContent = currentHost;
  hostEl.className = 'host' + (blocked ? ' off' : '');
  btn.textContent = blocked ? t('pop_site_enable') : t('pop_site_disable');
  btn.className = 'site-btn' + (blocked ? ' on' : '');
  note.style.display = blocked ? 'block' : 'none';
  note.textContent = blocked ? t('pop_site_disabled_note', { host: currentHost }) : '';
}

function toggleSite() {
  if (!currentHost) return;
  const host = currentHost.toLowerCase();
  let list = Array.isArray(cfg.disabledSites) ? [...cfg.disabledSites] : [];
  if (dnIsSiteBlocked(host, list)) {
    list = list.filter((s) => !dnHostMatches(host, s) && s.toLowerCase() !== host);
  } else {
    list.push(host);
  }
  chrome.storage.local.set({ disabledSites: list }, () => {
    cfg.disabledSites = list;
    renderSiteRow();
  });
}

document.getElementById('siteToggle').addEventListener('click', toggleSite);

chrome.storage.local.get(DEFAULTS, (v) => {
  cfg = { ...DEFAULTS, ...v };
  DN_I18N.setLang(dnResolveLang(cfg.appLanguage, chrome.i18n.getUILanguage()));
  els.enabled.checked = cfg.enabled;
  els.captureDownloads.checked = cfg.captureDownloads;
  els.showButton.checked = cfg.showButton;
  els.port.value = cfg.port;
  applyTexts();
  ping();
});

// Uygulamada dil değişirse popup da anında uyum sağlar
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  chrome.storage.local.get(DEFAULTS, (v) => {
    const prev = DN_I18N.lang;
    cfg = { ...DEFAULTS, ...v };
    DN_I18N.setLang(dnResolveLang(cfg.appLanguage, chrome.i18n.getUILanguage()));
    if (DN_I18N.lang !== prev) applyTexts();
    if (changes.disabledSites) renderSiteRow();
  });
});

// Aktif sekmenin host'unu bul (chrome:// gibi sayfalarda site satırı gizlenir)
try {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    try {
      const u = new URL(tabs && tabs[0] && tabs[0].url ? tabs[0].url : '');
      currentHost = /^https?:$/.test(u.protocol) ? u.hostname : '';
    } catch (e) { currentHost = ''; }
    renderSiteRow();
  });
} catch (e) { /* ignore */ }

function save() {
  chrome.storage.local.set({
    enabled: els.enabled.checked,
    captureDownloads: els.captureDownloads.checked,
    showButton: els.showButton.checked,
    port: parseInt(els.port.value, 10) || 5000
  });
}

Object.values(els).forEach((el) => el.addEventListener('change', () => { save(); ping(); }));

function ping() {
  const dot = document.getElementById('dot');
  const txt = document.getElementById('statusText');
  dot.className = 'dot';
  txt.textContent = t('pop_checking');
  chrome.runtime.sendMessage({ type: 'DN_PING' }, (resp) => {
    if (!chrome.runtime.lastError && resp && resp.ok) {
      dot.className = 'dot ok';
      txt.textContent = t('pop_connected', { port: parseInt(els.port.value, 10) || 5000 });
    } else {
      dot.className = 'dot bad';
      txt.textContent = t('pop_disconnected');
    }
  });
  checkExtUpdate();
}

// Sem-ver karşılaştırma: a>b ise 1, a<b ise -1, eşitse 0
function dnVerCmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// Uygulama güncellenince paketlenmiş eklenti sürümü (`expected`) yükseltilir; Chrome
// paketten yüklenen eklentiyi otomatik yenilemediği için çalışan kopya eski kalır.
// Uygulama beklenen sürüm çalışandan yeniyse tek tıkla yenileme uyarısı göster.
function checkExtUpdate() {
  const port = parseInt(els.port.value, 10) || 5000;
  const box = document.getElementById('updateBox');
  const msg = document.getElementById('updateMsg');
  const btn = document.getElementById('reloadExt');
  let own = '';
  try { own = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
  fetch('http://localhost:' + port + '/api/extension/status')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const expected = d && d.expected ? String(d.expected) : '';
      if (expected && own && dnVerCmp(expected, own) > 0) {
        msg.textContent = t('pop_update_msg', { new: expected });
        btn.textContent = t('pop_reload_btn');
        box.style.display = 'flex';
      } else {
        box.style.display = 'none';
      }
    })
    .catch(() => { box.style.display = 'none'; });
}

// Uzantıyı yerinden (disk) yeniden yükler — kurulum güncellenen dosyaları alır.
document.getElementById('reloadExt').addEventListener('click', () => {
  try { chrome.runtime.reload(); } catch (e) { /* ignore */ }
});

document.getElementById('scan').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'DN_SCAN' });
      window.close();
    }
  });
});
