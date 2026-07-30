// DeepNode - MAIN world ağ kancası
// Oynatıcı (hls.js/jwplayer vb.) HLS/DASH manifestini sayfa JS'i ile çeker;
// bu istekler chrome.webRequest'e her zaman güvenilir düşmez (MV3 worker uykusu,
// uzantısız/tokenlı URL'ler). Burada sayfanın kendi fetch/XHR çağrılarını
// kancalayıp manifest URL'lerini yakalar ve içerik betiğine postMessage ederiz.
//
// ÖNEMLİ: Bazı CDN'ler HLS master playlist'i .m3u8 yerine .txt gibi uzantılarla
// sunar (Content-Type: application/vnd.apple.mpegurl). Bu yüzden manifesti sadece
// URL uzantısından değil, yanıtın Content-Type'ından da tanırız.
(function () {
  if (window.__dnHooked) return;
  window.__dnHooked = true;

  var URL_RE = /\.(m3u8|mpd)(\?|$)/i;
  var CT_RE = /(mpegurl|dash\+xml|vnd\.apple\.mpegurl|x-mpegurl)/i;

  // Sayfanın kendi fetch çağrılarını sarmaladığımız için (window.fetch değiştiriliyor),
  // sayfanın YAKALAMADIĞI fetch ağ hataları ("TypeError: Failed to fetch") yığın izinde
  // inject.js'i gösterir ve uzantının Hatalar paneline düşer — oysa bu sayfanın kendi ağ
  // hatası (iptal/engellenen istek/çevrimdışı/tracker). NOT: reddedilen promise çoğu zaman
  // bizim döndürdüğümüz `p` değil, sayfanın ondan türettiği (await/.then) BAŞKA bir
  // promise'tir; bu yüzden promise kimliğine değil, reddin SEBEBİNE bakarız. Yalnızca
  // fetch AĞ hatalarını bastırırız; sayfanın gerçek kod hataları (SyntaxError vb.) ETKİLENMEZ.
  var dnOurFetch = (typeof WeakSet === 'function') ? new WeakSet() : null;
  function dnIsFetchNetErr(r) {
    try {
      if (!r) return false;
      var msg = (r.message != null) ? String(r.message) : String(r);
      return /failed to fetch|networkerror when attempting|load failed|network ?error/i.test(msg);
    } catch (e) { return false; }
  }
  window.addEventListener('unhandledrejection', function (ev) {
    try {
      if (!ev) return;
      if ((dnOurFetch && ev.promise && dnOurFetch.has(ev.promise)) || dnIsFetchNetErr(ev.reason)) {
        ev.preventDefault();
      }
    } catch (e) { /* ignore */ }
  }, true);

  function post(u, isMaster) {
    try {
      if (!u) return;
      var abs = new URL(u, location.href).href;
      window.postMessage({ __dnHls: true, url: abs, master: !!isMaster }, '*');
    } catch (e) { /* ignore */ }
  }

  // HLS master playlist'i, tek kaliteli media playlist'ten ayırt et: master içinde
  // #EXT-X-STREAM-INF (varyant/kalite listesi) bulunur. Master'ı tercih edersek yt-dlp
  // TÜM kaliteleri görür; yoksa yalnızca o an oynayan tek kalite gelir.
  function looksMaster(txt) {
    return typeof txt === 'string' && txt.indexOf('#EXT-X-STREAM-INF') !== -1;
  }
  function isM3u8Url(u) {
    try { return !!(u && URL_RE.test(new URL(u, location.href).href)); } catch (e) { return false; }
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var u = typeof input === 'string' ? input : (input && input.url);
      // Hızlı yol: URL zaten .m3u8/.mpd (master bilgisi yok, hemen yakala)
      try { if (isM3u8Url(u)) post(u); } catch (e) { /* ignore */ }
      var p = origFetch.apply(this, arguments);
      // Bu promise'i sardığımızı işaretle: sayfa yakalamazsa reddini sessizleştireceğiz.
      if (dnOurFetch) { try { dnOurFetch.add(p); } catch (e) { /* ignore */ } }
      // Manifest yanıtı: Content-Type doğrula + içeriğe bakıp master mı belirle
      try {
        p.then(function (res) {
          try {
            var ct = res && res.headers && res.headers.get('content-type');
            var isM3u8 = isM3u8Url(u) || (ct && CT_RE.test(ct));
            if (!isM3u8) return;
            // clone ile orijinali TÜKETMEDEN gövdeyi oku (m3u8 küçük metindir)
            if (res.clone) {
              res.clone().text().then(function (txt) { post(u, looksMaster(txt)); }, function () { post(u); });
            } else { post(u); }
          } catch (e) { /* ignore */ }
        }, function () {});
      } catch (e) { /* ignore */ }
      return p;
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__dnUrl = url;
      // Hızlı yol: URL zaten manifest
      if (isM3u8Url(url)) post(url);
      // Oynatıcılar tek XHR nesnesini onlarca segment isteği için yeniden
      // kullanır — her open() yeni dinleyici eklerse birikir ve mükerrer
      // post atılır. Nesne başına bir kez tak (__dnUrl her open'da güncel).
      if (!this.__dnHooked) {
        this.__dnHooked = true;
        this.addEventListener('load', function () {
          try {
            var ct = this.getResponseHeader && this.getResponseHeader('content-type');
            var isM3u8 = isM3u8Url(this.__dnUrl) || (ct && CT_RE.test(ct));
            if (!isM3u8) return;
            var txt = '';
            try { txt = this.responseText || ''; } catch (e) { /* non-text responseType */ }
            post(this.__dnUrl, looksMaster(txt));
          } catch (e) { /* ignore */ }
        });
      }
    } catch (e) { /* ignore */ }
    return origOpen.apply(this, arguments);
  };
})();
