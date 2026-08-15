// Yerel API'nin güven sınırı.
//
// SORUN: Sunucu `cors()` ile TÜM kaynaklara açıktı ve 0.0.0.0'a bağlanıyordu.
// Kullanıcı DDM açıkken herhangi bir web sayfasını ziyaret ettiğinde o sayfanın
// JavaScript'i indirme ekleyebiliyor, ayarları (ve proxy/site şifrelerini)
// okuyabiliyor, `/api/downloads` üzerinden eklentinin gönderdiği TARAYICI
// ÇEREZLERİNİ çekebiliyor ve `/api/update/*` ikilisiyle rastgele bir çalıştırılabilir
// dosya indirtip çalıştırabiliyordu. `confirmedByUser` bir koruma değildi; saldırgan
// da `true` gönderebilir.
//
// ÇÖZÜM (üç katman):
//   1. Sunucu yalnız 127.0.0.1'e bağlanır (server.js) — LAN'dan erişim yok.
//   2. CORS beyaz listesi: yalnız tarayıcı UZANTISI kaynakları + uygulamanın kendi
//      sayfası. Web sayfaları yanıtı OKUYAMAZ.
//   3. Origin muhafızı: beyaz listede olmayan bir http(s) kaynağından gelen istek
//      hiç işlenmeden reddedilir (CORS tek başına isteğin GÖNDERİLMESİNİ engellemez;
//      CSRF için bu katman şart).
//
// Uyumluluk: Tarayıcı uzantısı istekleri `Origin: chrome-extension://<id>` taşır ve
// beyaz listededir — KURULU ESKİ EKLENTİLER DAHİL hiçbir eklenti sürümü bozulmaz.
// Origin başlığı olmayan istekler (Electron ana süreci, yerel betikler) da geçer:
// tarayıcıdaki bir sayfa çapraz-kaynak istekte Origin göndermek ZORUNDADIR.

const EXTENSION_ORIGIN_RE = /^(chrome|moz|edge|safari-web)-extension:\/\/[a-z0-9@._+-]+\/?$/i;

// Uygulamanın kendi arayüzü (ana pencere + ekleme/ilerleme pencereleri).
// Firefox `localhost`'u bazen IPv6 `[::1]` olarak çözdüğü için üç loopback
// biçimi de kabul edilir — LAN adresi değil, yalnız geri döngü.
function isAppOrigin(origin, port) {
  return origin === `http://localhost:${port}`
    || origin === `http://127.0.0.1:${port}`
    || origin === `http://[::1]:${port}`;
}

export function isExtensionOrigin(origin) {
  return EXTENSION_ORIGIN_RE.test(String(origin || ''));
}

export function isAllowedOrigin(origin, port) {
  if (!origin) return true; // başlık yok = tarayıcı sayfası değil (Electron/CLI)
  return isExtensionOrigin(origin) || isAppOrigin(origin, port);
}

/**
 * `cors` paketine verilecek seçenekler. Port çalışma anında belli olduğu için
 * (5000 doluysa 5001'e düşülür) fonksiyonla okunur.
 */
export function corsOptions(getPort) {
  return {
    origin(origin, callback) {
      callback(null, isAllowedOrigin(origin, getPort()));
    }
  };
}

/**
 * Tüm /api isteklerinde çalışır: beyaz listede olmayan bir tarayıcı kaynağından
 * gelen isteği daha rota çalışmadan reddeder.
 */
export function originGuard(getPort) {
  return function guard(req, res, next) {
    const origin = req.headers.origin;
    if (isAllowedOrigin(origin, getPort())) return next();
    return res.status(403).json({
      error: 'Forbidden origin',
      detail: 'This API only accepts requests from the DeepNode app and its browser extension.'
    });
  };
}

/**
 * Ayrıcalıklı uçlar (ayar yazma, güncelleyici, dosya/klasör açma, yeniden
 * adlandırma, silme): YALNIZ uygulamanın kendi arayüzünden çağrılabilir.
 * Tarayıcı uzantısının bunlara ihtiyacı yok; erişimi de olmamalı.
 */
export function appOnly(getPort) {
  return function guard(req, res, next) {
    const origin = req.headers.origin;
    if (!origin || isAppOrigin(origin, getPort())) return next();
    return res.status(403).json({
      error: 'Forbidden',
      detail: 'This endpoint is only available to the DeepNode app window.'
    });
  };
}

// --- Ayar gizliliği -------------------------------------------------------

// Eklentinin gerçekten okuduğu alanlar. Proxy/site-girişi şifreleri ve indirme
// klasörü gibi bilgiler eklentiye HİÇ gönderilmez.
const EXTENSION_SETTING_KEYS = [
  'captureBypassKey',
  'captureEnabled',
  'clipboardWatch',
  'language',
  'theme',
  'enableFileFiltering',
  'capturedExtensions',
  'ignoredExtensions'
];

export function settingsForExtension(settings) {
  const out = {};
  for (const key of EXTENSION_SETTING_KEYS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

// --- Güncelleyici kaynak kısıtı ------------------------------------------

// Güncelleme paketi yalnız projenin kendi yayın kanallarından indirilebilir.
// (GitHub Releases indirme adresleri objects.githubusercontent.com'a yönlenir;
// yönlendirmeyi `fetch(redirect:'follow')` izlediği için başlangıç konağı yeter.)
const UPDATE_HOST_ALLOWLIST = [
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'deepnodestudios.net'
];

export function isAllowedUpdateUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return UPDATE_HOST_ALLOWLIST.some((h) => host === h || host.endsWith('.' + h));
  } catch (err) {
    return false;
  }
}
