import re

with open("browser-extension/background.js", "r", encoding="utf-8") as f:
    content = f.read()

# First, remove the old listener
old_listener = """chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    (async () => {
      try {
        if (!cfg.enabled || !cfg.captureDownloads) return suggest();
        const url = item.finalUrl || item.url || '';
        // Capture ALL real browser downloads (http/https). blob:/data: cannot be
        // re-fetched by URL, so leave those to the browser.
        if (!captureEnabled) return suggest(); // capture disabled from app Settings
        if (!/^https?:/i.test(url)) return suggest();
        
        // Geri besleme döngüsünü önle: kendi backend'imizden gelen indirmeyi yakalama.
        try {
          const u = new URL(url);
          if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
            const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
            const appPorts = [cfg.port, resolvedPort, 5000, 5001, 5002, 5003].filter(Boolean);
            if (appPorts.includes(p)) return suggest();
          }
        } catch (e) { /* ignore */ }
        
        if (item.state && item.state !== 'in_progress') return suggest();
        if (item.paused) return suggest();
        try {
          const started = item.startTime ? Date.parse(item.startTime) : 0;
          if (started && Date.now() - started > 60000) return suggest();
        } catch (e) { /* ignore */ }
        
        if (await isBypassActive()) return suggest();
        
        // Site engelleme: indirme veya yönlendiren sayfa engelli sitedeyse yakalama
        try {
          const dlHost = new URL(url).hostname;
          const refHost = item.referrer ? new URL(item.referrer).hostname : '';
          if (dnIsSiteBlocked(dlHost, cfg.disabledSites) || dnIsSiteBlocked(refHost, cfg.disabledSites)) return suggest();
        } catch (e) { /* ignore */ }
        
        let name = item.filename ? item.filename.split(/[\\\\/]/).pop() : '';
        if (!name) name = guessName(url);
        if ((!name || !/\\.[a-z0-9]{1,8}$/i.test(name)) && MIME_EXT[item.mime || '']) {
          name = (name || 'download') + '.' + MIME_EXT[item.mime || ''];
        }
        
        const result = await sendToApp(url, name, item.referrer);
        if (result === 'accepted') {
          try {
            try { await chrome.downloads.cancel(item.id); } catch (e) { }
            const [d] = await chrome.downloads.search({ id: item.id });
            if (d && d.state === 'complete') {
              try { await chrome.downloads.removeFile(item.id); } catch (e) { }
            }
            await chrome.downloads.erase({ id: item.id });
          } catch (e) { /* ignore */ }
          notify(DN_I18N.t('notif_captured'), name || url);
          suggest(); // Resolve Chrome's wait pipeline
        } else {
          suggest();
        }
      } catch (err) {
        suggest();
      }
    })();
    return true; // We will call suggest asynchronously
  });"""

new_listener = """chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!cfg.enabled || !cfg.captureDownloads) return;
  if (!captureEnabled) return;
  const url = item.finalUrl || item.url || '';
  if (!/^https?:/i.test(url)) return;

  try {
    const u = new URL(url);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      const p = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
      const appPorts = [cfg.port, resolvedPort, 5000, 5001, 5002, 5003].filter(Boolean);
      if (appPorts.includes(p)) return;
    }
  } catch (e) { }

  if (item.state && item.state !== 'in_progress') return;
  if (item.paused) return;
  try {
    const started = item.startTime ? Date.parse(item.startTime) : 0;
    if (started && Date.now() - started > 60000) return;
  } catch (e) { }

  if (isBypassHeld()) {
    lastBypassClickAt = 0;
    try { chrome.storage.session.remove('bypassClickAt'); } catch(e){}
    return;
  }

  try {
    const dlHost = new URL(url).hostname;
    const refHost = item.referrer ? new URL(item.referrer).hostname : '';
    if (dnIsSiteBlocked(dlHost, cfg.disabledSites) || dnIsSiteBlocked(refHost, cfg.disabledSites)) return;
  } catch (e) { }

  (async () => {
    try {
      let ts = lastBypassClickAt;
      if (!ts) {
        try { ts = (await chrome.storage.session.get('bypassClickAt')).bypassClickAt || 0; } catch (e) { ts = 0; }
      }
      if (ts && Date.now() - ts < BYPASS_GRACE_MS) {
        lastBypassClickAt = 0;
        try { chrome.storage.session.remove('bypassClickAt'); } catch (e) { }
        return suggest();
      }

      let name = item.filename ? item.filename.split(/[\\\\/]/).pop() : '';
      if (!name) name = guessName(url);
      if ((!name || !/\\.[a-z0-9]{1,8}$/i.test(name)) && MIME_EXT[item.mime || '']) {
        name = (name || 'download') + '.' + MIME_EXT[item.mime || ''];
      }
      
      const result = await sendToApp(url, name, item.referrer);
      if (result === 'accepted') {
        try {
          try { await chrome.downloads.cancel(item.id); } catch (e) { }
          const [d] = await chrome.downloads.search({ id: item.id });
          if (d && d.state === 'complete') {
            try { await chrome.downloads.removeFile(item.id); } catch (e) { }
          }
          await chrome.downloads.erase({ id: item.id });
        } catch (e) { }
        notify(DN_I18N.t('notif_captured'), name || url);
        suggest();
      } else {
        suggest();
      }
    } catch (err) {
      suggest();
    }
  })();
  return true;
});"""

content = content.replace(old_listener, new_listener)

with open("browser-extension/background.js", "w", encoding="utf-8") as f:
    f.write(content)
print("done")
