// Electron ana süreç UI metinleri (tepsi menüsü, bildirimler, diyaloglar)
// Dil çözümleme: settings.language ('auto'|'tr'|'en'); 'auto' ise app.getLocale().

const strings = {
  en: {
    dlg_select_folder_title: 'Select Download Folder',
    dlg_select_folder_btn: 'Select Folder',
    add_win_title: 'Add Download - DeepNode Download Manager',
    progress_win_title: 'Download Progress - DeepNode Download Manager',
    notif_dl_complete: 'Download completed',
    notif_file_downloaded: 'File downloaded.',
    notif_shutdown_title: 'Shutting down',
    notif_shutdown_body: 'All downloads finished. The PC will shut down in 60 seconds. To cancel: shutdown /a',
    notif_tray_hint: 'The app keeps running in the system tray. To quit completely, right-click the tray icon and choose Quit.',
    notif_link_title: 'DeepNode Download Manager - Link Detected',
    notif_link_body: 'Download dialog opened:',
    tray_open: 'Open Window',
    tray_start_all: 'Start All',
    tray_pause_all: 'Pause All',
    tray_quit: 'Quit'
  },
  tr: {
    dlg_select_folder_title: 'Kaydetme Klasörünü Seçin',
    dlg_select_folder_btn: 'Klasör Seç',
    add_win_title: 'İndirmeyi Ekle - DeepNode Download Manager',
    progress_win_title: 'İndirme İlerlemesi - DeepNode Download Manager',
    notif_dl_complete: 'İndirme tamamlandı',
    notif_file_downloaded: 'Dosya indirildi.',
    notif_shutdown_title: 'Bilgisayar kapatılıyor',
    notif_shutdown_body: 'Tüm indirmeler bitti. 60 saniye içinde kapanacak. İptal için: shutdown /a',
    notif_tray_hint: 'Uygulama sistem tepsisinde çalışmaya devam ediyor. Tamamen kapatmak için tepsi ikonuna sağ tıklayıp Çıkış deyin.',
    notif_link_title: 'DeepNode Download Manager - Bağlantı Algılandı',
    notif_link_body: 'İndirme İletişim Kutusu açıldı:',
    tray_open: 'Pencereyi Aç',
    tray_start_all: 'Tümünü Başlat',
    tray_pause_all: 'Tümünü Duraklat',
    tray_quit: 'Çıkış'
  }
};

let currentLang = 'en';

function resolve(pref, osLocale) {
  if (pref === 'tr' || pref === 'en') return pref;
  return String(osLocale || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export function setLanguage(pref, osLocale) {
  currentLang = resolve(pref, osLocale);
}

export function getLanguage() {
  return currentLang;
}

export function t(key) {
  return (strings[currentLang] && strings[currentLang][key]) || strings.en[key] || key;
}
