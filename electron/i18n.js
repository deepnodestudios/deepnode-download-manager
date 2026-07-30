// Electron ana süreç UI metinleri (tepsi menüsü, bildirimler, diyaloglar)
// Dil çözümleme: settings.language ('auto'|desteklenen kod); 'auto' ise app.getLocale().

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
  },
  es: {
    dlg_select_folder_title: 'Seleccionar carpeta de descargas',
    dlg_select_folder_btn: 'Seleccionar carpeta',
    add_win_title: 'Añadir descarga - DeepNode Download Manager',
    progress_win_title: 'Progreso de descarga - DeepNode Download Manager',
    notif_dl_complete: 'Descarga completada',
    notif_file_downloaded: 'Archivo descargado.',
    notif_shutdown_title: 'Apagando',
    notif_shutdown_body: 'Todas las descargas terminaron. El PC se apagará en 60 segundos. Para cancelar: shutdown /a',
    notif_tray_hint: 'La aplicación sigue ejecutándose en la bandeja del sistema. Para salir por completo, haz clic derecho en el icono de la bandeja y elige Salir.',
    notif_link_title: 'DeepNode Download Manager - Enlace detectado',
    notif_link_body: 'Diálogo de descarga abierto:',
    tray_open: 'Abrir ventana',
    tray_start_all: 'Iniciar todo',
    tray_pause_all: 'Pausar todo',
    tray_quit: 'Salir'
  },
  'pt-BR': {
    dlg_select_folder_title: 'Selecionar pasta de downloads',
    dlg_select_folder_btn: 'Selecionar pasta',
    add_win_title: 'Adicionar download - DeepNode Download Manager',
    progress_win_title: 'Progresso do download - DeepNode Download Manager',
    notif_dl_complete: 'Download concluído',
    notif_file_downloaded: 'Arquivo baixado.',
    notif_shutdown_title: 'Desligando',
    notif_shutdown_body: 'Todos os downloads terminaram. O PC desligará em 60 segundos. Para cancelar: shutdown /a',
    notif_tray_hint: 'O aplicativo continua em execução na bandeja do sistema. Para sair completamente, clique com o botão direito no ícone da bandeja e escolha Sair.',
    notif_link_title: 'DeepNode Download Manager - Link detectado',
    notif_link_body: 'Diálogo de download aberto:',
    tray_open: 'Abrir janela',
    tray_start_all: 'Iniciar tudo',
    tray_pause_all: 'Pausar tudo',
    tray_quit: 'Sair'
  },
  ru: {
    dlg_select_folder_title: 'Выберите папку загрузки',
    dlg_select_folder_btn: 'Выбрать папку',
    add_win_title: 'Добавить загрузку - DeepNode Download Manager',
    progress_win_title: 'Ход загрузки - DeepNode Download Manager',
    notif_dl_complete: 'Загрузка завершена',
    notif_file_downloaded: 'Файл загружен.',
    notif_shutdown_title: 'Выключение',
    notif_shutdown_body: 'Все загрузки завершены. ПК выключится через 60 секунд. Для отмены: shutdown /a',
    notif_tray_hint: 'Приложение продолжает работать в системном трее. Чтобы выйти полностью, щёлкните правой кнопкой по значку в трее и выберите «Выход».',
    notif_link_title: 'DeepNode Download Manager - Обнаружена ссылка',
    notif_link_body: 'Открыто окно загрузки:',
    tray_open: 'Открыть окно',
    tray_start_all: 'Запустить все',
    tray_pause_all: 'Приостановить все',
    tray_quit: 'Выход'
  },
  de: {
    dlg_select_folder_title: 'Download-Ordner auswählen',
    dlg_select_folder_btn: 'Ordner auswählen',
    add_win_title: 'Download hinzufügen - DeepNode Download Manager',
    progress_win_title: 'Download-Fortschritt - DeepNode Download Manager',
    notif_dl_complete: 'Download abgeschlossen',
    notif_file_downloaded: 'Datei heruntergeladen.',
    notif_shutdown_title: 'Wird heruntergefahren',
    notif_shutdown_body: 'Alle Downloads abgeschlossen. Der PC wird in 60 Sekunden heruntergefahren. Zum Abbrechen: shutdown /a',
    notif_tray_hint: 'Die App läuft im Infobereich weiter. Zum vollständigen Beenden mit der rechten Maustaste auf das Tray-Symbol klicken und Beenden wählen.',
    notif_link_title: 'DeepNode Download Manager - Link erkannt',
    notif_link_body: 'Download-Dialog geöffnet:',
    tray_open: 'Fenster öffnen',
    tray_start_all: 'Alle starten',
    tray_pause_all: 'Alle pausieren',
    tray_quit: 'Beenden'
  },
  fr: {
    dlg_select_folder_title: 'Sélectionner le dossier de téléchargement',
    dlg_select_folder_btn: 'Sélectionner le dossier',
    add_win_title: 'Ajouter un téléchargement - DeepNode Download Manager',
    progress_win_title: 'Progression du téléchargement - DeepNode Download Manager',
    notif_dl_complete: 'Téléchargement terminé',
    notif_file_downloaded: 'Fichier téléchargé.',
    notif_shutdown_title: 'Arrêt en cours',
    notif_shutdown_body: 'Tous les téléchargements sont terminés. Le PC s’éteindra dans 60 secondes. Pour annuler : shutdown /a',
    notif_tray_hint: 'L’application continue de fonctionner dans la zone de notification. Pour quitter complètement, faites un clic droit sur l’icône et choisissez Quitter.',
    notif_link_title: 'DeepNode Download Manager - Lien détecté',
    notif_link_body: 'Boîte de dialogue de téléchargement ouverte :',
    tray_open: 'Ouvrir la fenêtre',
    tray_start_all: 'Tout démarrer',
    tray_pause_all: 'Tout mettre en pause',
    tray_quit: 'Quitter'
  },
  'zh-CN': {
    dlg_select_folder_title: '选择下载文件夹',
    dlg_select_folder_btn: '选择文件夹',
    add_win_title: '添加下载 - DeepNode Download Manager',
    progress_win_title: '下载进度 - DeepNode Download Manager',
    notif_dl_complete: '下载完成',
    notif_file_downloaded: '文件已下载。',
    notif_shutdown_title: '正在关机',
    notif_shutdown_body: '所有下载已完成。电脑将在 60 秒后关机。取消请执行：shutdown /a',
    notif_tray_hint: '应用仍在系统托盘中运行。要完全退出，请右键点击托盘图标并选择“退出”。',
    notif_link_title: 'DeepNode Download Manager - 检测到链接',
    notif_link_body: '已打开下载对话框：',
    tray_open: '打开窗口',
    tray_start_all: '全部开始',
    tray_pause_all: '全部暂停',
    tray_quit: '退出'
  },
  ar: {
    dlg_select_folder_title: 'اختر مجلد التنزيل',
    dlg_select_folder_btn: 'اختيار المجلد',
    add_win_title: 'إضافة تنزيل - DeepNode Download Manager',
    progress_win_title: 'تقدم التنزيل - DeepNode Download Manager',
    notif_dl_complete: 'اكتمل التنزيل',
    notif_file_downloaded: 'تم تنزيل الملف.',
    notif_shutdown_title: 'جارٍ إيقاف التشغيل',
    notif_shutdown_body: 'انتهت جميع التنزيلات. سيتم إيقاف تشغيل الكمبيوتر خلال 60 ثانية. للإلغاء: shutdown /a',
    notif_tray_hint: 'يستمر التطبيق في العمل في علبة النظام. للخروج تمامًا، انقر بزر الفأرة الأيمن على أيقونة العلبة واختر «خروج».',
    notif_link_title: 'DeepNode Download Manager - تم اكتشاف رابط',
    notif_link_body: 'تم فتح مربع حوار التنزيل:',
    tray_open: 'فتح النافذة',
    tray_start_all: 'بدء الكل',
    tray_pause_all: 'إيقاف الكل مؤقتًا',
    tray_quit: 'خروج'
  },
  hi: {
    dlg_select_folder_title: 'डाउनलोड फ़ोल्डर चुनें',
    dlg_select_folder_btn: 'फ़ोल्डर चुनें',
    add_win_title: 'डाउनलोड जोड़ें - DeepNode Download Manager',
    progress_win_title: 'डाउनलोड प्रगति - DeepNode Download Manager',
    notif_dl_complete: 'डाउनलोड पूर्ण',
    notif_file_downloaded: 'फ़ाइल डाउनलोड हो गई।',
    notif_shutdown_title: 'बंद हो रहा है',
    notif_shutdown_body: 'सभी डाउनलोड पूरे हुए। PC 60 सेकंड में बंद होगा। रद्द करने के लिए: shutdown /a',
    notif_tray_hint: 'ऐप सिस्टम ट्रे में चलता रहता है। पूरी तरह बंद करने के लिए ट्रे आइकन पर राइट-क्लिक करें और बाहर निकलें चुनें।',
    notif_link_title: 'DeepNode Download Manager - लिंक मिला',
    notif_link_body: 'डाउनलोड डायलॉग खुला:',
    tray_open: 'विंडो खोलें',
    tray_start_all: 'सभी शुरू करें',
    tray_pause_all: 'सभी रोकें',
    tray_quit: 'बाहर निकलें'
  },
  id: {
    dlg_select_folder_title: 'Pilih Folder Unduhan',
    dlg_select_folder_btn: 'Pilih Folder',
    add_win_title: 'Tambah Unduhan - DeepNode Download Manager',
    progress_win_title: 'Kemajuan Unduhan - DeepNode Download Manager',
    notif_dl_complete: 'Unduhan selesai',
    notif_file_downloaded: 'Berkas terunduh.',
    notif_shutdown_title: 'Mematikan',
    notif_shutdown_body: 'Semua unduhan selesai. PC akan mati dalam 60 detik. Untuk membatalkan: shutdown /a',
    notif_tray_hint: 'Aplikasi tetap berjalan di baki sistem. Untuk keluar sepenuhnya, klik kanan ikon baki dan pilih Keluar.',
    notif_link_title: 'DeepNode Download Manager - Tautan Terdeteksi',
    notif_link_body: 'Dialog unduhan dibuka:',
    tray_open: 'Buka Jendela',
    tray_start_all: 'Mulai Semua',
    tray_pause_all: 'Jeda Semua',
    tray_quit: 'Keluar'
  },
  vi: {
    dlg_select_folder_title: 'Chọn thư mục tải xuống',
    dlg_select_folder_btn: 'Chọn thư mục',
    add_win_title: 'Thêm tải xuống - DeepNode Download Manager',
    progress_win_title: 'Tiến trình tải xuống - DeepNode Download Manager',
    notif_dl_complete: 'Tải xuống hoàn tất',
    notif_file_downloaded: 'Đã tải tệp xuống.',
    notif_shutdown_title: 'Đang tắt máy',
    notif_shutdown_body: 'Tất cả tải xuống đã xong. Máy tính sẽ tắt sau 60 giây. Để hủy: shutdown /a',
    notif_tray_hint: 'Ứng dụng vẫn chạy trong khay hệ thống. Để thoát hoàn toàn, nhấp chuột phải vào biểu tượng khay và chọn Thoát.',
    notif_link_title: 'DeepNode Download Manager - Phát hiện liên kết',
    notif_link_body: 'Đã mở hộp thoại tải xuống:',
    tray_open: 'Mở cửa sổ',
    tray_start_all: 'Bắt đầu tất cả',
    tray_pause_all: 'Tạm dừng tất cả',
    tray_quit: 'Thoát'
  },
  ja: {
    dlg_select_folder_title: 'ダウンロードフォルダーを選択',
    dlg_select_folder_btn: 'フォルダーを選択',
    add_win_title: 'ダウンロードを追加 - DeepNode Download Manager',
    progress_win_title: 'ダウンロードの進行状況 - DeepNode Download Manager',
    notif_dl_complete: 'ダウンロード完了',
    notif_file_downloaded: 'ファイルをダウンロードしました。',
    notif_shutdown_title: 'シャットダウン中',
    notif_shutdown_body: 'すべてのダウンロードが完了しました。PC は 60 秒後にシャットダウンします。キャンセルするには：shutdown /a',
    notif_tray_hint: 'アプリはシステムトレイで実行され続けます。完全に終了するには、トレイアイコンを右クリックして「終了」を選択してください。',
    notif_link_title: 'DeepNode Download Manager - リンクを検出',
    notif_link_body: 'ダウンロードダイアログを開きました：',
    tray_open: 'ウィンドウを開く',
    tray_start_all: 'すべて開始',
    tray_pause_all: 'すべて一時停止',
    tray_quit: '終了'
  },
  ko: {
    dlg_select_folder_title: '다운로드 폴더 선택',
    dlg_select_folder_btn: '폴더 선택',
    add_win_title: '다운로드 추가 - DeepNode Download Manager',
    progress_win_title: '다운로드 진행률 - DeepNode Download Manager',
    notif_dl_complete: '다운로드 완료',
    notif_file_downloaded: '파일이 다운로드되었습니다.',
    notif_shutdown_title: '시스템 종료 중',
    notif_shutdown_body: '모든 다운로드가 끝났습니다. PC가 60초 후 종료됩니다. 취소하려면: shutdown /a',
    notif_tray_hint: '앱은 시스템 트레이에서 계속 실행됩니다. 완전히 종료하려면 트레이 아이콘을 우클릭하고 종료를 선택하세요.',
    notif_link_title: 'DeepNode Download Manager - 링크 감지됨',
    notif_link_body: '다운로드 대화 상자가 열렸습니다:',
    tray_open: '창 열기',
    tray_start_all: '모두 시작',
    tray_pause_all: '모두 일시정지',
    tray_quit: '종료'
  }
};

const SUPPORTED = Object.keys(strings);
// 'pt' gibi taban kodları desteklenen bölgesel koda eşle
const BASE_LANG_MAP = { pt: 'pt-BR', zh: 'zh-CN' };

let currentLang = 'en';

function resolve(pref, osLocale) {
  if (SUPPORTED.includes(pref)) return pref;
  const loc = String(osLocale || 'en');
  const exact = SUPPORTED.find(l => l.toLowerCase() === loc.toLowerCase());
  if (exact) return exact;
  const base = loc.toLowerCase().split('-')[0];
  if (SUPPORTED.includes(base)) return base;
  if (BASE_LANG_MAP[base]) return BASE_LANG_MAP[base];
  return 'en';
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
