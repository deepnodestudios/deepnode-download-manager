// HTTP(S) istek yardımcıları — YÖNLENDİRME (3xx) TAKİBİ.
//
// Node'un `http.get` / `http.request` fonksiyonları yönlendirmeleri KENDİLİĞİNDEN
// TAKİP ETMEZ. DownloadEngine bu yüzden 302 dönen linklerde (GitHub Releases,
// SourceForge, imzalı CDN adresleri, çoğu dosya barındırma sitesi) boyutu
// okuyamıyor, parçalara bölemiyor ve segment isteğinde "status code 302" hatası
// alıp indirmeyi hiç başlatamıyordu. Bu modül tüm HTTP çağrılarını tek bir
// yönlendirme takipçisi üzerinden geçirir.
//
// Güvenlik: yönlendirme BAŞKA bir siteye giderse `Cookie` ve `Authorization`
// başlıkları düşürülür (tarayıcıların ve curl'ün davranışı). Aynı sitenin alt
// alan adlarına (site.com -> cdn.site.com) geçişte korunur — indirme
// bağlantılarının ezici çoğunluğu bu biçimde çalışır.
import http from 'http';
import https from 'https';

const DEFAULT_MAX_REDIRECTS = 5;

function moduleFor(urlObj) {
  return urlObj.protocol === 'https:' ? https : http;
}

// "cdn.site.com" ile "site.com" aynı siteden sayılır; "site.com" ile "evil.com" sayılmaz.
function sameSite(hostA, hostB) {
  const a = String(hostA || '').toLowerCase();
  const b = String(hostB || '').toLowerCase();
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

function stripCredentialHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (lower === 'cookie' || lower === 'authorization') continue;
    out[key] = value;
  }
  return out;
}

/**
 * Yönlendirmeleri takip eden istek.
 *
 * @param {string} startUrl
 * @param {object} opts
 *   - method            'GET' | 'HEAD' (varsayılan 'GET')
 *   - headers           istek başlıkları
 *   - agentFactory      () => agent | undefined  (her hop için yeniden çağrılır)
 *   - authFor           (url) => 'Basic ...' | null  (site girişi; her hop için)
 *   - timeoutMs         yanıt gelmezse zaman aşımı (her hop için ayrı)
 *   - maxRedirects      varsayılan 5
 *   - controller        { destroy(err) } — çağıran, o an uçuşta olan isteği iptal edebilir
 * @returns {Promise<{ res: http.IncomingMessage, finalUrl: string, redirected: boolean }>}
 *   Promise YALNIZCA 3xx OLMAYAN yanıt geldiğinde çözülür; gövde okunmamıştır.
 */
export function requestFollowingRedirects(startUrl, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    agentFactory,
    authFor,
    timeoutMs = 30000,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    controller
  } = opts;

  return new Promise((resolve, reject) => {
    let settled = false;
    let currentReq = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    // Çağıran (ör. DownloadEngine.pause) hangi hop'ta olursak olalım isteği
    // iptal edebilmeli — yanıt akmaya BAŞLADIKTAN sonra da geçerlidir; isteği
    // yıkmak soketi kapatır ve yanıt akışı 'aborted'/'error' üretir.
    if (controller) {
      controller.destroy = (err) => {
        if (!currentReq) return;
        // ÖNEMLİ: hatasız `destroy()` — yanıt akmaya başladıktan sonra bir HATA ile
        // yıkmak, hatayı artık istek nesnesine değil sokete düşürüyor ve
        // yakalanmamış 'error' olayı olarak SÜRECİ ÇÖKERTİYORDU. Temiz iptalde
        // hata üretilmez; gerçek bir sebep varsa (zaman aşımı) çağıran verir.
        try { currentReq.destroy(err); } catch (e) { /* zaten kapalı */ }
      };
    }

    const hop = (urlStr, hopsLeft, hopHeaders) => {
      let urlObj;
      try {
        urlObj = new URL(urlStr);
      } catch (err) {
        return finish(reject, new Error(`Invalid URL: ${urlStr}`));
      }
      if (!/^https?:$/.test(urlObj.protocol)) {
        return finish(reject, new Error(`Unsupported protocol: ${urlObj.protocol}`));
      }

      const sendHeaders = { ...hopHeaders };
      // Site girişi (Basic auth) her hop için hedefe göre yeniden hesaplanır
      if (authFor && !sendHeaders.Authorization && !sendHeaders.authorization) {
        const auth = authFor(urlStr);
        if (auth) sendHeaders.Authorization = auth;
      }

      const reqOpts = { method, headers: sendHeaders };
      const agent = agentFactory ? agentFactory(urlObj) : undefined;
      if (agent) reqOpts.agent = agent;

      const req = moduleFor(urlObj).request(urlStr, reqOpts, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (status >= 300 && status < 400 && location) {
          res.resume(); // gövdeyi boşalt, sokete sızıntı bırakma
          if (hopsLeft <= 0) {
            return finish(reject, new Error('Too many redirects'));
          }

          let nextUrl;
          try {
            nextUrl = new URL(location, urlStr).href;
          } catch (err) {
            return finish(reject, new Error('Invalid redirect target'));
          }

          // Başka bir siteye gidiliyorsa oturum başlıklarını taşıma
          let nextHeaders = sendHeaders;
          try {
            if (!sameSite(new URL(nextUrl).hostname, urlObj.hostname)) {
              nextHeaders = stripCredentialHeaders(sendHeaders);
            }
          } catch (err) {
            nextHeaders = stripCredentialHeaders(sendHeaders);
          }

          // 303 (ve POST sonrası 301/302) GET'e döner — bu modül zaten GET/HEAD kullanıyor
          return hop(nextUrl, hopsLeft - 1, nextHeaders);
        }

        finish(resolve, { res, finalUrl: urlStr, redirected: urlStr !== startUrl });
      });

      currentReq = req;

      req.on('error', (err) => finish(reject, err));

      if (timeoutMs > 0) {
        // NOT: `destroy()` hatasız çağrılırsa 'error' olayı GARANTİ değildir ve
        // Promise sonsuza dek askıda kalır — bu yüzden daima hata ile yıkılır.
        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`Timeout (${Math.round(timeoutMs / 1000)}s no response)`));
        });
      }

      req.end();
    };

    hop(startUrl, maxRedirects, headers);
  });
}
