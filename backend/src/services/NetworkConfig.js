// Proxy ve site girişi (kullanıcı adı/şifre) yardımcıları.
// Hem normal indirmeler (DownloadEngine) hem video (yt-dlp) bunları kullanır.
import storageService from './StorageService.js';

// Agent paketleri isteğe bağlı yüklenir: biri eksikse yalnız o proxy türü
// devre dışı kalır, uygulama çalışmaya devam eder.
async function loadAgent(moduleName, exportName) {
  try {
    const mod = await import(moduleName);
    return mod[exportName] || mod.default || null;
  } catch (err) {
    console.warn(`[NetworkConfig] ${moduleName} yüklenemedi — bu proxy türü devre dışı.`);
    return null;
  }
}

const HttpsProxyAgent = await loadAgent('https-proxy-agent', 'HttpsProxyAgent');
const HttpProxyAgent = await loadAgent('http-proxy-agent', 'HttpProxyAgent');
const SocksProxyAgent = await loadAgent('socks-proxy-agent', 'SocksProxyAgent');

const SOCKS_SCHEME_RE = /^socks[45]?h?:$/i;

/**
 * Ayarlardaki proxy adresi. Şema `proxyHost` içinde verilebilir
 * ("socks5://127.0.0.1", "https://proxy.local"); verilmezse http varsayılır.
 * Böylece Ayarlar ekranında yeni alan olmadan SOCKS de kullanılabilir.
 */
export function proxyUrl() {
  const s = storageService.settings;
  if (!s.proxyEnabled || !s.proxyHost) return null;

  const raw = String(s.proxyHost).trim();
  const schemeMatch = raw.match(/^([a-z0-9+.-]+):\/\//i);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : 'http';
  let host = raw.replace(/^[a-z0-9+.-]+:\/\//i, '').replace(/\/.*$/, '');
  if (!host) return null;

  let port = parseInt(s.proxyPort, 10);
  // Kullanıcı proxyHost içine "host:port" yazmışsa ayır.
  // IPv6: "[::1]:1080" -> host "[::1]", port 1080. Çıplak "::1" (köşeli parantezsiz)
  // çoklu iki nokta içerdiği için port ayrıştırmasına girmez, olduğu gibi kalır.
  const bracketMatch = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (bracketMatch) {
    host = `[${bracketMatch[1]}]`;
    if (bracketMatch[2]) port = parseInt(bracketMatch[2], 10);
  } else if (host.split(':').length === 2) {
    const idx = host.lastIndexOf(':');
    if (idx > 0) {
      const extractedPort = parseInt(host.slice(idx + 1), 10);
      if (extractedPort) {
        host = host.slice(0, idx);
        port = extractedPort;
      }
    }
  }
  if (!port || isNaN(port)) port = 8080;

  const auth = s.proxyUser
    ? `${encodeURIComponent(s.proxyUser)}:${encodeURIComponent(s.proxyPass || '')}@`
    : '';

  return `${scheme}://${auth}${host}:${port}`;
}

/**
 * İstek için uygun proxy agent'ı.
 *
 * DÜZELTME: Eskiden hedef adresin protokolü ne olursa olsun daima
 * `HttpsProxyAgent` dönüyordu — `http://` indirmelerinde proxy sessizce
 * çalışmıyordu. Artık hedefe göre doğru agent seçilir ve SOCKS desteklenir.
 *
 * @param {string|URL} [targetUrl] İsteğin gideceği adres.
 */
export function proxyAgent(targetUrl) {
  const url = proxyUrl();
  if (!url) return undefined;

  try {
    const proxyScheme = new URL(url).protocol;

    if (SOCKS_SCHEME_RE.test(proxyScheme)) {
      return SocksProxyAgent ? new SocksProxyAgent(url) : undefined;
    }

    let targetProtocol = 'https:';
    if (targetUrl) {
      targetProtocol = typeof targetUrl === 'string' ? new URL(targetUrl).protocol : targetUrl.protocol;
    }

    if (targetProtocol === 'http:') {
      return HttpProxyAgent ? new HttpProxyAgent(url) : undefined;
    }
    return HttpsProxyAgent ? new HttpsProxyAgent(url) : undefined;
  } catch (err) {
    console.warn('[NetworkConfig] Proxy agent oluşturulamadı:', err.message);
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
  } catch (err) {
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
