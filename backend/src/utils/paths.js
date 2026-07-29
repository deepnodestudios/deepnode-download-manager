// Dosya adı / yol güvenliği yardımcıları.
//
// İndirilecek dosyanın adı üç DIŞ kaynaktan gelebilir:
//   1. Sunucunun `Content-Disposition` başlığı (DownloadEngine.inspectUrl)
//   2. Tarayıcı eklentisinin gönderdiği ad (/api/download/add gövdesi)
//   3. Kullanıcının "Yeniden Adlandır" girdisi (/api/download/:id/rename)
// Üçü de yol bileşeni ("../", "..\", "C:\") taşıyabildiğinden, indirme klasörünün
// DIŞINA yazmayı engellemek için adlar tek noktadan temizlenir.
//
// Not: Yalnızca yol/denetim karakterleri ve Windows'un yasakladığı karakterler
// elenir — Türkçe ve diğer Unicode karakterler (ı, ş, ğ, ç, ö, ü) KORUNUR.
import path from 'path';

// Windows'ta uzantıyla bile olsa dosya adı olarak kullanılamayan aygıt adları
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

// Windows'ta dosya adında yasak olan karakterler + C0 denetim karakterleri
const ILLEGAL_CHARS_RE = /[<>:"/\\|?*\u0000-\u001f]/g;

const MAX_NAME_LENGTH = 180; // uzantı payı + uzun yol riskine karşı emniyet payı

/**
 * Bir dosya adını tek bir yol bileşenine indirger ve güvenli hale getirir.
 * "../../evil.exe" -> "evil.exe", "C:\Windows\x.dll" -> "x.dll"
 */
export function safeName(rawName, fallback = 'download') {
  if (rawName === null || rawName === undefined) return fallback;

  let name = String(rawName).trim();
  if (!name) return fallback;

  // Yol bileşenlerini at: hem POSIX (/) hem Windows (\) ayırıcıları
  const lastSep = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  if (lastSep >= 0) name = name.slice(lastSep + 1);

  // Sürücü öneki tek başına kalmış olabilir ("C:") — kalan iki nokta da elenir
  name = name.replace(ILLEGAL_CHARS_RE, '_');

  // Baştaki noktalar gizli dosya/".." üretir; sondaki nokta ve boşluklar
  // Windows'ta sessizce kırpıldığı için beklenmedik üzerine yazmaya yol açar
  name = name.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');

  if (!name) return fallback;

  if (WIN_RESERVED_RE.test(name)) name = '_' + name;

  if (name.length > MAX_NAME_LENGTH) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, MAX_NAME_LENGTH - ext.length) + ext;
  }

  return name || fallback;
}

/**
 * `target` gerçekten `dir` içinde mi? (sembolik bağlar çözülmeden, saf yol
 * karşılaştırması — indirme klasörü dışına yazmayı son bir kez doğrular.)
 */
export function isInsideDir(dir, target) {
  try {
    const base = path.resolve(dir);
    const full = path.resolve(target);
    if (full === base) return true;
    return full.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
  } catch (err) {
    return false;
  }
}

/**
 * Klasör + (temizlenmiş) dosya adını birleştirir; sonuç klasörün dışına
 * düşerse yedek adla klasörün içinde kalmaya zorlar.
 */
export function safeJoin(dir, rawName, fallback = 'download') {
  const name = safeName(rawName, fallback);
  const full = path.join(dir, name);
  return isInsideDir(dir, full) ? full : path.join(dir, fallback);
}
