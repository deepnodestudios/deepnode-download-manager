import axios from 'axios';
import path from 'path';
import storageService from './StorageService.js';
import { proxyUrl, authHeaderFor } from './NetworkConfig.js';

// Dosya türü kategorileri: tarama filtresi bu gruplar üzerinden çalışır.
// Frontend'deki filtre seçenekleriyle (video/audio/image/document/archive/program) birebir aynıdır.
export const FILE_TYPE_GROUPS = {
  video: ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v'],
  audio: ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'],
  document: ['.pdf', '.docx', '.xlsx', '.pptx', '.epub'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso'],
  program: ['.exe', '.msi', '.apk', '.dmg']
};

const DEFAULT_MEDIA_EXT = Object.values(FILE_TYPE_GROUPS).flat();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function requestConfig(url) {
  const headers = { 'User-Agent': UA };
  const auth = authHeaderFor(url);
  if (auth) headers.Authorization = auth;

  const cfg = { headers, timeout: 12000, maxRedirects: 5, responseType: 'text' };
  const px = proxyUrl();
  if (px) {
    try {
      const u = new URL(px);
      cfg.proxy = {
        protocol: 'http',
        host: u.hostname,
        port: parseInt(u.port, 10) || 8080,
        ...(u.username ? { auth: { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password || '') } } : {})
      };
    } catch (e) { /* geçersiz proxy -> proxysiz devam */ }
  }
  return cfg;
}

function extractHrefs(html, baseUrl) {
  const out = new Set();
  const attrRe = /(?:href|src|source|data-src)\s*=\s*["']([^"']+)["']/gi;
  const bareRe = /https?:\/\/[^\s"'<>()]+\.(?:mp4|mkv|avi|mp3|wav|flac|zip|rar|7z|pdf|docx|xlsx|exe|msi|iso|apk|jpg|png|webm|m3u8)/gi;

  let m;
  while ((m = attrRe.exec(html)) !== null) {
    try { out.add(new URL(m[1], baseUrl).href); } catch (e) { /* geçersiz */ }
  }
  while ((m = bareRe.exec(html)) !== null) {
    out.add(m[0]);
  }
  return Array.from(out);
}

function isMediaLink(u, allowedExts) {
  try {
    const ext = path.extname(new URL(u).pathname).toLowerCase();
    return ext && allowedExts.includes(ext);
  } catch (e) {
    return false;
  }
}

// Uzantının ait olduğu tür grubunu döndürür (video/audio/image/document/archive/program)
function fileTypeOf(ext) {
  for (const [type, exts] of Object.entries(FILE_TYPE_GROUPS)) {
    if (exts.includes(ext)) return type;
  }
  return 'other';
}

function isCrawlable(u, rootHost, sameDomainOnly) {
  try {
    const url = new URL(u);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (sameDomainOnly) {
      const h = url.hostname.toLowerCase();
      if (h !== rootHost && !h.endsWith('.' + rootHost)) return false;
    }
    const ext = path.extname(url.pathname).toLowerCase();
    // sayfa gibi görünenleri gez (uzantısız veya html)
    return !ext || ['.html', '.htm', '.php', '.asp', '.aspx', '.jsp'].includes(ext);
  } catch (e) {
    return false;
  }
}

export class LinkSniffer {
  /**
   * Sayfayı (ve istenirse alt sayfalarını) tarayıp indirilebilir bağlantıları toplar.
   * @param {string} pageUrl  Başlangıç sayfası
   * @param {object} opts     { depth=0, sameDomainOnly=true, extensions=[], fileTypes=[], maxPages=40 }
   *                          fileTypes: FILE_TYPE_GROUPS anahtarları (video, audio, image, document, archive, program).
   *                          Boş/verilmezse tüm türler taranır. extensions verilirse fileTypes'a EK olarak dahil edilir.
   */
  static async sniffPage(pageUrl, opts = {}) {
    const depth = Math.max(0, Math.min(3, parseInt(opts.depth, 10) || 0));
    const sameDomainOnly = opts.sameDomainOnly !== false;
    const maxPages = Math.max(1, Math.min(100, parseInt(opts.maxPages, 10) || 40));

    // Tür filtresi: seçilen kategorilerin uzantıları + varsa özel uzantılar
    const typeExts = (Array.isArray(opts.fileTypes) ? opts.fileTypes : [])
      .filter((t) => FILE_TYPE_GROUPS[t])
      .flatMap((t) => FILE_TYPE_GROUPS[t]);
    const customExts = (Array.isArray(opts.extensions) ? opts.extensions : [])
      .map((e) => (e.startsWith('.') ? e : '.' + e).toLowerCase());
    const merged = [...typeExts, ...customExts];
    const allowedExts = merged.length ? Array.from(new Set(merged)) : DEFAULT_MEDIA_EXT;

    let rootHost = '';
    try { rootHost = new URL(pageUrl).hostname.toLowerCase(); } catch (e) {
      throw new Error('Invalid page URL');
    }

    const visited = new Set();
    const foundMedia = new Map(); // url -> { url, filename, extension, category, foundOn }
    const queue = [{ url: pageUrl, level: 0 }];
    let pagesFetched = 0;
    let firstError = null;

    while (queue.length && pagesFetched < maxPages) {
      const { url, level } = queue.shift();
      if (visited.has(url)) continue;
      visited.add(url);

      let html;
      try {
        const res = await axios.get(url, requestConfig(url));
        pagesFetched++;
        html = typeof res.data === 'string' ? res.data : String(res.data || '');
      } catch (err) {
        if (!firstError) firstError = err;
        continue; // tek sayfa hatası tüm taramayı bozmasın
      }

      for (const link of extractHrefs(html, url)) {
        if (isMediaLink(link, allowedExts)) {
          if (!foundMedia.has(link)) {
            // Bozuk %-dizili tek bir link (örn. "file%zz.zip") URIError fırlatıp
            // TÜM taramayı 500'e düşürüyordu — ham ada geri düş.
            const rawName = path.basename(new URL(link).pathname);
            let filename;
            try { filename = decodeURIComponent(rawName) || 'media'; }
            catch (e) { filename = rawName || 'media'; }
            const extension = path.extname(filename).toLowerCase();
            foundMedia.set(link, {
              url: link,
              filename,
              extension,
              fileType: fileTypeOf(extension),
              category: storageService.getCategoryForFilename(filename),
              foundOn: url
            });
          }
        } else if (level < depth && isCrawlable(link, rootHost, sameDomainOnly) && !visited.has(link)) {
          queue.push({ url: link, level: level + 1 });
        }
      }
    }

    if (foundMedia.size === 0 && firstError) {
      throw new Error(`Could not scan page: ${firstError.message}`);
    }

    return {
      links: Array.from(foundMedia.values()),
      pagesScanned: pagesFetched,
      depth
    };
  }
}
