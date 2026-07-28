// Proxy ve site girişi (kullanıcı adı/şifre) yardımcıları.
// Hem normal indirmeler (DownloadEngine) hem video (yt-dlp) bunları kullanır.
import storageService from './StorageService.js';

let AgentCtor = null;
try {
  const mod = await import('https-proxy-agent');
  AgentCtor = mod.HttpsProxyAgent || mod.default || null;
} catch (e) {
  AgentCtor = null; // proxy paketi yoksa proxy sessizce devre dışı kalır
}

// "http://kullanici:sifre@host:port" biçiminde proxy adresi (yoksa null)
export function proxyUrl() {
  const s = storageService.settings;
  if (!s.proxyEnabled || !s.proxyHost) return null;

  const port = parseInt(s.proxyPort, 10) || 8080;
  const auth = s.proxyUser
    ? `${encodeURIComponent(s.proxyUser)}:${encodeURIComponent(s.proxyPass || '')}@`
    : '';
  const host = String(s.proxyHost).replace(/^https?:\/\//i, '');
  return `http://${auth}${host}:${port}`;
}

// http/https istekleri için proxy agent (proxy kapalıysa undefined)
export function proxyAgent() {
  const url = proxyUrl();
  if (!url || !AgentCtor) return undefined;
  try {
    return new AgentCtor(url);
  } catch (e) {
    return undefined;
  }
}

// URL'nin alan adına kayıtlı site girişi (varsa)
export function siteLoginFor(rawUrl) {
  try {
    const list = storageService.settings.siteLogins || [];
    if (!list.length) return null;

    const host = new URL(rawUrl).hostname.toLowerCase();
    // En uzun (en spesifik) eşleşmeyi seç: "cdn.site.com" > "site.com"
    let best = null;
    for (const entry of list) {
      if (!entry || !entry.host || !entry.user) continue;
      const h = String(entry.host).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (host === h || host.endsWith('.' + h)) {
        if (!best || h.length > String(best.host).length) best = entry;
      }
    }
    return best;
  } catch (e) {
    return null;
  }
}

// Site girişi varsa Basic Authorization başlığı üretir
export function authHeaderFor(rawUrl) {
  const login = siteLoginFor(rawUrl);
  if (!login) return null;
  const token = Buffer.from(`${login.user}:${login.pass || ''}`).toString('base64');
  return 'Basic ' + token;
}
