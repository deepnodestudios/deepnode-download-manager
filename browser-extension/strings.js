// DeepNode Download Manager — paylaşılan eklenti sözlüğü (TR/EN)
// background.js (importScripts), content.js (manifest js sırasıyla) ve
// popup.html (<script>) tarafından ortak kullanılır.

const DN_STRINGS = {
  en: {
    ctx_download_with: 'Download with DeepNode',
    ctx_download_video: 'Download this video (YouTube etc.)',
    ctx_scan: 'Scan this page for media (Grabber)',
    notif_captured: 'Browser download captured',
    notif_grabber_added: '{n} link(s) added to queue',
    notif_site_disabled: 'DeepNode is disabled on this site',

    btn_download_with: 'Download with DDM',
    btn_hide: 'Hide button',
    btn_aria: 'Download with DeepNode',
    toast_hidden: 'Download button hidden on this page. It will reappear when you navigate.',
    toast_added: 'Added to downloads',
    toast_stream: 'Video stream captured and added',
    toast_blob_fail: 'This video is a live (blob) stream — cannot download directly. Play the video once and try again.',
    toast_video_started: 'Downloading video in the app…',

    q_title: 'Video Quality',
    q_loading: 'Fetching qualities…',
    q_best: 'Best Quality (Auto)',
    q_audio: 'Audio Only (MP3)',
    q_error: 'Could not fetch qualities — "Best" will download the highest resolution.',

    g_download: 'Download',
    g_added: 'Added',
    g_download_all: 'Download all',
    g_all_added: 'All added ({n})',
    g_empty: 'No downloadable media found on this page.',
    g_close: 'Close',

    type_video: 'Video',
    type_audio: 'Audio',
    type_image: 'Image',
    type_document: 'Document',
    type_archive: 'Archive',
    type_program: 'Program',
    type_other: 'Other',

    pop_integration: 'Browser Integration',
    pop_checking: 'Checking the app…',
    pop_connected: 'App connected (localhost:{port})',
    pop_disconnected: 'App not running — open DeepNode Download Manager.',
    pop_update_msg: 'App updated to v{new} — reload the extension to match.',
    pop_reload_btn: 'Reload extension now',
    pop_enabled: 'Integration enabled',
    pop_capture: 'Capture browser downloads',
    pop_show_btn: 'Show Download button on media',
    pop_port: 'App port',
    pop_scan: 'Scan this page for media',
    pop_hint: 'Tip: hover a video/image and a Download button appears in the corner. You can also right-click a link and choose "Download with DeepNode".',
    pop_site_disable: "Don't run on this site",
    pop_site_enable: 'Run on this site',
    pop_site_disabled_note: 'DDM is disabled on {host}'
  },
  tr: {
    ctx_download_with: 'DeepNode ile indir',
    ctx_download_video: 'Bu videoyu indir (YouTube vb.)',
    ctx_scan: 'Bu sayfadaki medyayı tara (Grabber)',
    notif_captured: 'Tarayıcı indirmesi yakalandı',
    notif_grabber_added: '{n} bağlantı kuyruğa eklendi',
    notif_site_disabled: 'Bu sitede DeepNode devre dışı',

    btn_download_with: 'DDM ile İndir',
    btn_hide: 'Butonu gizle',
    btn_aria: 'DeepNode ile indir',
    toast_hidden: 'İndir butonu bu sayfada gizlendi. Başka bir sayfaya geçince tekrar görünür.',
    toast_added: 'İndirmeye eklendi',
    toast_stream: 'Video akışı yakalandı ve eklendi',
    toast_blob_fail: 'Bu video canlı akış (blob) — doğrudan indirilemiyor. Videoyu bir kez oynatıp tekrar dene.',
    toast_video_started: 'Video uygulamada indiriliyor…',

    q_title: 'Görüntü Kalitesi',
    q_loading: 'Kaliteler alınıyor…',
    q_best: 'En Yüksek Kalite (Otomatik)',
    q_audio: 'Sadece Ses (MP3)',
    q_error: 'Kaliteler alınamadı — "En Yüksek" ile en iyi çözünürlük iner.',

    g_download: 'İndir',
    g_added: 'Eklendi',
    g_download_all: 'Tümünü indir',
    g_all_added: 'Tümü eklendi ({n})',
    g_empty: 'Bu sayfada indirilebilir medya bulunamadı.',
    g_close: 'Kapat',

    type_video: 'Video',
    type_audio: 'Ses',
    type_image: 'Resim',
    type_document: 'Belge',
    type_archive: 'Arşiv',
    type_program: 'Program',
    type_other: 'Diğer',

    pop_integration: 'Tarayıcı Entegrasyonu',
    pop_checking: 'Uygulama kontrol ediliyor…',
    pop_connected: 'Uygulama bağlı (localhost:{port})',
    pop_disconnected: 'Uygulama çalışmıyor — DeepNode Download Manager\'ı aç.',
    pop_update_msg: 'Uygulama v{new} sürümüne güncellendi — uzantıyı yenileyerek eşitle.',
    pop_reload_btn: 'Uzantıyı şimdi yenile',
    pop_enabled: 'Entegrasyon açık',
    pop_capture: 'Tarayıcı indirmelerini yakala',
    pop_show_btn: 'Medyada İndir butonu göster',
    pop_port: 'Uygulama portu',
    pop_scan: 'Bu sayfadaki medyayı tara',
    pop_hint: 'İpucu: video/resim üzerine gelince köşede İndir butonu çıkar. Bağlantıya sağ tıklayıp "DeepNode ile indir" de diyebilirsin.',
    pop_site_disable: 'Bu sitede çalışma',
    pop_site_enable: 'Bu sitede çalış',
    pop_site_disabled_note: '{host} sitesinde DDM devre dışı'
  }
};

// Dil çözümleme: uygulama ayarı (appLang: 'auto'|'tr'|'en') öncelikli;
// 'auto' ise tarayıcı arayüz dili (desteklenmiyorsa İngilizce).
function dnResolveLang(appLang, uiLang) {
  if (appLang === 'tr' || appLang === 'en') return appLang;
  return String(uiLang || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

const DN_I18N = {
  lang: 'en',
  t(key, vars) {
    const dict = DN_STRINGS[this.lang] || DN_STRINGS.en;
    let s = dict[key];
    if (s === undefined) s = DN_STRINGS.en[key];
    if (s === undefined) return key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.split('{' + k + '}').join(String(vars[k]));
      }
    }
    return s;
  },
  setLang(lang) {
    this.lang = (lang === 'tr') ? 'tr' : 'en';
  }
};

// Site engelleme yardımcıları: disabledSites dizisi hostname barındırır;
// 'example.com' girdisi 'www.example.com' ve tüm alt alan adlarını kapsar.
function dnHostMatches(host, site) {
  if (!host || !site) return false;
  host = host.toLowerCase();
  site = site.toLowerCase();
  return host === site || host.endsWith('.' + site);
}

function dnIsSiteBlocked(host, disabledSites) {
  if (!host || !Array.isArray(disabledSites)) return false;
  return disabledSites.some((s) => dnHostMatches(host, s));
}
