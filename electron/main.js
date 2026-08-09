import { app, BrowserWindow, Tray, Menu, clipboard, Notification, ipcMain, dialog, shell, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { spawn } from 'child_process';
import { setLanguage, getLanguage, t as et } from './i18n.js';

// DİKKAT: Bunlar dosyanın EN BAŞINDA tanımlı kalmalı. `SECURE_WEB_PREFERENCES`
// gibi ÜST DÜZEY (top-level) sabitler `__dirname`'i modül yüklenirken kullanır;
// tanım aşağıda kalırsa "Cannot access '__dirname' before initialization" (TDZ)
// hatasıyla uygulama hiç açılmaz.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Register IPC handler for native modern Windows 10/11 File Explorer Folder Dialog.
// İletişim kutusu, isteği GÖNDEREN pencereye bağlanır: ekleme penceresinden
// çağrıldığında da çalışır (eskiden yalnız ana pencere varsa açılıyordu; ekleme
// penceresi PowerShell yedeğine düşüyordu).
ipcMain.handle('select-folder', async (e) => {
  const owner = BrowserWindow.fromWebContents(e.sender) || mainWindow;
  if (!owner) return null;
  const result = await dialog.showOpenDialog(owner, {
    title: et('dlg_select_folder_title'),
    buttonLabel: et('dlg_select_folder_btn'),
    properties: ['openDirectory', 'createDirectory', 'promptToCreate']
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Register IPC handler to forcefully bring app to the front
ipcMain.on('bring-to-front', () => {
  bringToFront();
});

// Harici bağlantıyı SİSTEM tarayıcısında aç. Renderer artık `shell`e doğrudan
// erişemediği için (contextIsolation) bu köprü gerekli; ayrıca yalnız http(s)
// şemalarına izin verilir — `file:` / özel şemalarla yerel program çalıştırılamaz.
ipcMain.on('open-external', (e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    shell.openExternal(url).catch((err) => console.error('openExternal başarısız:', err.message));
  }
});

// Import backend server statically so it starts express & websocket server
import '../backend/src/server.js';
import { serverEvents } from '../backend/src/server.js';

// Backend'in gerçekten dinlediği port. 5000 doluysa backend sıradakine düşer
// (bkz. server.js) ve bu olayla haber verir — pencereler/istekler doğru adrese gider.
let backendPort = Number(process.env.DN_PORT) || 5000;
const appUrl = (suffix = '') => `http://localhost:${backendPort}${suffix}`;

serverEvents.on('server-ready', (port) => {
  backendPort = port;
});

serverEvents.on('server-error', (err) => {
  dialog.showErrorBox(
    'DeepNode Download Manager',
    `Yerel sunucu başlatılamadı (${err.message}).\n\n` +
    'Başka bir uygulama gerekli portları kullanıyor olabilir. ' +
    'Uygulamayı kapatıp yeniden açmayı deneyin.'
  );
});

// Tüm pencerelerde ortak güvenlik ayarları (AI_Guidelines §5).
// Renderer Node'a erişemez; köprü yalnız preload.cjs'teki dar API'dir.
const SECURE_WEB_PREFERENCES = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false, // preload'un require('electron') yapabilmesi için
  preload: path.join(__dirname, 'preload.cjs')
};

// Pencereyi kendi kaynağına hapset: sayfa başka bir adrese gidemez,
// `window.open` Electron penceresi açmak yerine sistem tarayıcısına yönlenir.
function hardenWindow(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl())) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

// Support MANY simultaneous add windows (one per captured link).
const addWindows = new Set();
// Kötü niyetli bir sayfa `deepnode://add?url=...` ile sınırsız pencere açtırabilirdi.
const MAX_ADD_WINDOWS = 12;

function createAddDownloadWindow(url, quality, referer, video, filename) {
  if (addWindows.size >= MAX_ADD_WINDOWS) {
    console.warn('Açık ekleme penceresi sınırına ulaşıldı; yeni pencere açılmadı.');
    return;
  }
  const cascade = (addWindows.size % 6) * 30; // stagger so stacked windows don't fully overlap

  const win = new BrowserWindow({
    width: 640,
    height: 470,
    minWidth: 520,
    minHeight: 340,
    title: et('add_win_title'),
    backgroundColor: '#1b1a24', // standalone pencerenin gri-mor koyu paleti (dark.css ile uyumlu)
    frame: false, // kendi kapatma butonu var; Windows başlık çubuğu düğmeleri gizlenir
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    alwaysOnTop: true,
    center: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: { ...SECURE_WEB_PREFERENCES }
  });
  hardenWindow(win);

  // Cascade subsequent windows down-right from center
  if (cascade > 0) {
    const b = win.getBounds();
    win.setBounds({ x: b.x + cascade, y: b.y + cascade, width: b.width, height: b.height });
  }

  const targetUrl = appUrl('/?mode=add')
    + (url ? '&url=' + encodeURIComponent(url) : '')
    + (quality ? '&quality=' + encodeURIComponent(quality) : '')
    + (referer ? '&referer=' + encodeURIComponent(referer) : '')
    + (video ? '&video=1' : '')
    + (filename ? '&filename=' + encodeURIComponent(filename) : '');
  win.loadURL(targetUrl);

  addWindows.add(win);
  win.on('closed', () => {
    addWindows.delete(win);
    // Onaylanmadan kapatıldıysa arka plandaki ön indirmeyi (preflight) iptal et.
    // Onaylanmışsa backend'de bayrak kalkmış olur — istek zararsız no-op'tur.
    if (url) {
      fetch(appUrl('/api/download/cancel-preflight'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      }).catch((err) => console.error('cancel-preflight isteği başarısız:', err.message));
    }
  });
}

serverEvents.on('prompt-add', (payload) => {
  // payload: "url" (eski) veya { url, quality, referer } (eklentiden seçilen kalite/referer ile)
  if (typeof payload === 'string') return createAddDownloadWindow(payload);
  if (payload && payload.url) return createAddDownloadWindow(payload.url, payload.quality, payload.referer, payload.video, payload.filename);
});

// IDM tarzı bağımsız ilerleme penceresi: indirme başlatılınca açılır,
// içeriğe göre otomatik boyutlanır (resize-add-window IPC'sini paylaşır).
const progressWindows = new Set();
const MAX_PROGRESS_WINDOWS = 12;

function createProgressWindow(downloadId) {
  if (!downloadId) return;
  if (progressWindows.size >= MAX_PROGRESS_WINDOWS) {
    console.warn('Açık ilerleme penceresi sınırına ulaşıldı; yeni pencere açılmadı.');
    return;
  }
  const cascade = (progressWindows.size % 6) * 30;

  const win = new BrowserWindow({
    width: 560,
    height: 330,
    minWidth: 480,
    minHeight: 200,
    title: et('progress_win_title'),
    backgroundColor: '#1b1a24', // standalone pencerelerle aynı gri-mor koyu palet
    frame: false, // kendi başlık çubuğu ve kapatma/küçültme butonları var
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    center: true,
    resizable: true,
    skipTaskbar: false,
    webPreferences: { ...SECURE_WEB_PREFERENCES }
  });
  hardenWindow(win);

  if (cascade > 0) {
    const b = win.getBounds();
    win.setBounds({ x: b.x + cascade, y: b.y + cascade, width: b.width, height: b.height });
  }

  win.loadURL(appUrl('/?mode=progress&id=') + encodeURIComponent(downloadId));

  progressWindows.add(win);
  win.on('closed', () => { progressWindows.delete(win); });
}

ipcMain.on('open-progress-window', (e, id) => {
  try { createProgressWindow(id); } catch (err) { /* ignore */ }
});

// Backend indirme başlatıldığında haber verir (hangi pencereden eklendiğinden
// bağımsız güvenilir tetikleme — ana pencerede nodeIntegration kapalı olduğu
// için renderer IPC'si oraya ulaşamazdı).
serverEvents.on('open-progress', (id) => {
  try { createProgressWindow(id); } catch (err) { /* ignore */ }
});

// Close only the window that sent the request (each add window is independent).
ipcMain.on('close-add-window', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.close();
});

// Minimize the frameless add window to the taskbar (no native title bar buttons).
ipcMain.on('minimize-add-window', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && !w.isDestroyed()) w.minimize();
});

// İçerik yüksekliğine göre pencereyi boyutlandır (renderer ResizeObserver ile gönderir).
// Genişliğe dokunulmaz; yükseklik ekran çalışma alanıyla sınırlanır.
ipcMain.on('resize-add-window', (e, height) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isDestroyed() || w.isMinimized() || !Number.isFinite(height)) return;
  const workH = screen.getDisplayMatching(w.getBounds()).workAreaSize.height;
  const h = Math.min(Math.max(Math.round(height), 200), workH - 20);
  const [cw, ch] = w.getContentSize();
  if (Math.abs(ch - h) > 2) w.setContentSize(cw, h, false);
});

// Liste sağ tık menüsü: DOM menüsü pencere sınırlarında kırpılıyordu. Bunun yerine
// PENCEREDEN BAĞIMSIZ yerel (native) OS menüsü açılır; imleç konumunda belirir,
// pencereyi/ekranı aşabilir ve gerektiğinde kendi kaydırmasını yapar. Renderer menü
// öğelerini (etiket + command) gönderir; kullanıcının seçtiği command string'i döner.
ipcMain.handle('popup-download-menu', (e, items) => {
  return new Promise((resolve) => {
    let chosen = null;
    const toTemplate = (arr) => (Array.isArray(arr) ? arr : []).map((it) => {
      if (it.type === 'separator') return { type: 'separator' };
      const node = { label: String(it.label != null ? it.label : '') };
      if (it.type === 'radio') { node.type = 'radio'; node.checked = !!it.checked; }
      if (it.enabled === false) node.enabled = false;
      if (Array.isArray(it.submenu)) node.submenu = toTemplate(it.submenu);
      else node.click = () => { chosen = it.command; };
      return node;
    });
    let menu;
    try { menu = Menu.buildFromTemplate(toTemplate(items)); }
    catch (err) { return resolve(null); }
    const w = BrowserWindow.fromWebContents(e.sender) || mainWindow;
    menu.popup({ window: w, callback: () => resolve(chosen) });
  });
});

let mainWindow = null;
let tray = null;
let lastClipboardText = '';
let isQuitting = false;
let appSettings = {};

// ---- Ayarları uygula (Windows açılışı, tepsi davranışı, bildirimler) ----
async function loadSettings() {
  try {
    const res = await fetch(appUrl('/api/settings'));
    appSettings = await res.json();
    setLanguage(appSettings.language, app.getLocale());
  } catch (e) { /* backend henüz hazır değil */ }
  return appSettings;
}

function applyStartupSetting() {
  try {
    const enable = appSettings.launchOnStartup === true;
    app.setLoginItemSettings({
      openAtLogin: enable,
      // Açılışta doğrudan tepside başlasın
      args: appSettings.startMinimized ? ['--hidden'] : []
    });
  } catch (e) {
    console.error('setLoginItemSettings failed:', e.message);
  }
}

serverEvents.on('settings-changed', (s) => {
  const prevLang = getLanguage();
  appSettings = s || appSettings;
  setLanguage(appSettings.language, app.getLocale());
  applyStartupSetting();
  // Dil değiştiyse tepsi menüsünü yeni dilde yeniden kur
  if (getLanguage() !== prevLang) buildTrayMenu();
});

// İndirme bitince bildirim + ses + IDM tarzı "İndirme Tamamlandı" diyaloğu
serverEvents.on('download-completed', (item) => {
  try {
    if (appSettings.notifyOnComplete !== false && Notification.isSupported()) {
      const n = new Notification({
        title: et('notif_dl_complete'),
        body: (item && item.filename) ? item.filename : et('notif_file_downloaded')
      });
      n.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
      n.show();
    }
    if (appSettings.soundNotifications !== false) {
      shell.beep();
    }
    // IDM'deki gibi tamamlanma diyaloğu (ayarlardan "bir daha gösterme" ile kapatılabilir)
    if (appSettings.showCompleteDialog !== false && item && item.id) {
      createCompleteWindow(item.id);
    }
  } catch (e) { /* ignore */ }
});

// IDM tarzı "Download complete" diyaloğu: dosya bilgisi + Aç / Klasörü Aç.
// İlerleme pencereleriyle aynı frameless desen ve resize IPC'sini kullanır.
function createCompleteWindow(downloadId) {
  if (!downloadId) return;
  const win = new BrowserWindow({
    width: 560,
    height: 320,
    minWidth: 480,
    minHeight: 200,
    title: et('notif_dl_complete'),
    backgroundColor: '#1b1a24',
    frame: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    center: true,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true, // IDM gibi öne çıkar; kullanıcı görene kadar üstte kalır
    webPreferences: { ...SECURE_WEB_PREFERENCES }
  });
  hardenWindow(win);
  win.loadURL(appUrl('/?mode=complete&id=') + encodeURIComponent(downloadId));
  // Açıldıktan sonra kalıcı "her zaman üstte" davranışı bırakılır
  win.once('ready-to-show', () => setTimeout(() => { try { win.setAlwaysOnTop(false); } catch (e) {} }, 1500));
}

// Tüm indirmeler bitince: bir şey yapma / uygulamayı kapat / bilgisayarı kapat
serverEvents.on('all-complete', () => {
  const action = appSettings.afterAllComplete || 'nothing';
  if (action === 'exit') {
    isQuitting = true;
    app.quit();
  } else if (action === 'shutdown') {
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: et('notif_shutdown_title'),
          body: et('notif_shutdown_body')
        }).show();
      }
      if (process.platform === 'win32') {
        spawn('shutdown', ['/s', '/t', '60'], { detached: true, windowsHide: true }).unref();
      }
    } catch (e) { /* ignore */ }
  }
});

// Auto-update: installer started externally — quit app so NSIS can overwrite files
serverEvents.on('quit-and-install', () => {
  isQuitting = true;
  app.quit();
});

// Görev çubuğu ilerleme çubuğu: backend aktif indirmelerin birleşik ilerlemesini
// yayınlar (0..1); -1 çubuğu kaldırır, 2 belirsiz (boyutu bilinmeyen) moddur.
serverEvents.on('taskbar-progress', (value) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (typeof value !== 'number' || value < 0) mainWindow.setProgressBar(-1);
    else if (value > 1) mainWindow.setProgressBar(2, { mode: 'indeterminate' });
    else mainWindow.setProgressBar(value, { mode: 'normal' });
  } catch (e) { /* ignore */ }
});

// Safety net: never let a background error crash the whole app with the
// "A JavaScript error occurred in the main process" dialog. Log instead.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (handled):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (handled):', reason);
});

function createWindow(showWindow = true) {
  mainWindow = new BrowserWindow({
    show: showWindow,
    width: 1078,
    height: 580,
    minWidth: 1078,
    minHeight: 420,
    title: 'DeepNode Download Manager',
    backgroundColor: '#0b0f19',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { ...SECURE_WEB_PREFERENCES }
  });
  hardenWindow(mainWindow);

  // Always load through the local backend to eliminate file:// path encoding issues!
  mainWindow.loadURL(appUrl());

  // Kapatma tuşuna basınca uygulamayı kapatma; sistem tepsisine gizle
  // (Ayarlar > "Kapatınca tepsiye küçült" kapalıysa uygulama gerçekten kapanır)
  mainWindow.on('close', (e) => {
    if (!isQuitting && appSettings.minimizeToTrayOnClose !== false) {
      e.preventDefault();
      mainWindow.hide();

      // İlk gizlemede kullanıcıyı bilgilendir
      if (!mainWindow._trayHintShown && Notification.isSupported()) {
        mainWindow._trayHintShown = true;
        new Notification({
          title: 'DeepNode Download Manager',
          body: et('notif_tray_hint')
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'DeepNode Download Manager', enabled: false },
    { type: 'separator' },
    { label: et('tray_open'), click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    // Eskiden bu iki komut renderer'a executeJavaScript ile enjekte ediliyordu;
    // ana pencere KAPALIYKEN (tepsi menüsünün asıl işe yaradığı an) hiçbir şey
    // yapmıyorlardı. Artık istek doğrudan ana süreçten gider.
    { label: et('tray_start_all'), click: () => {
        fetch(appUrl('/api/download/start-all'), { method: 'POST' })
          .catch((err) => console.error('start-all başarısız:', err.message));
      }
    },
    { label: et('tray_pause_all'), click: () => {
        fetch(appUrl('/api/download/pause-all'), { method: 'POST' })
          .catch((err) => console.error('pause-all başarısız:', err.message));
      }
    },
    { type: 'separator' },
    { label: et('tray_quit'), click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);

      buildTrayMenu();
      tray.setToolTip('DeepNode Download Manager');

      // Tek tık: pencereyi geri getir
      tray.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      });

      tray.on('double-click', () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) mainWindow.hide();
          else { mainWindow.show(); mainWindow.focus(); }
        }
      });
    }
  } catch (e) {
    console.error('Tray creation error:', e);
  }
}

// ---- IDM-style update notification ----
// Pencere tepside gizliyken bile kullanıcı güncellemeden haberdar olsun:
// açılışta (15 sn sonra) ve 6 saatte bir backend'in /api/update/check ucunu sorgula;
// yeni sürüm varsa OS bildirimi + tepsi balonu göster. Aynı sürüm için bir kez.
let lastNotifiedUpdate = null;
async function checkUpdateNotify() {
  try {
    const resp = await fetch(appUrl('/api/update/check'));
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data || data.error || !data.updateAvailable || !data.latest) return;
    if (lastNotifiedUpdate === data.latest) return;
    lastNotifiedUpdate = data.latest;
    const title = et('notif_update_title');
    const body = et('notif_update_body').split('{v}').join(data.latest);
    if (Notification.isSupported()) {
      const n = new Notification({ title, body });
      n.on('click', () => {
        if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else { createWindow(); }
      });
      n.show();
    }
    if (tray) tray.displayBalloon({ title, content: body });
  } catch (e) { /* çevrimdışı vb. — sessiz geç */ }
}

async function isClipboardWatchEnabled() {
  try {
    const res = await fetch(appUrl('/api/settings'));
    const settings = await res.json();
    return settings.clipboardWatch !== false && settings.captureEnabled !== false;
  } catch (e) {
    return true; // ayar okunamazsa varsayılan olarak açık
  }
}

async function addDownloadFromUrl(url) {
  try {
    const res = await fetch(appUrl('/api/download/add'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function bringToFront() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.show();
  mainWindow.focus();
  mainWindow.flashFrame(true);

  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.flashFrame(false);
      mainWindow.focus();
    }
  }, 1000);
}

function startClipboardWatcher() {
  setInterval(async () => {
    try {
      const text = clipboard.readText();
      if (!text || text === lastClipboardText) return;
      lastClipboardText = text;

      const lower = text.toLowerCase();
      const mediaExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.zip', '.rar', '.7z', '.tar', '.gz', '.pdf', '.exe', '.msi', '.iso', '.mp3', '.flac', '.wav', '.apk', '.dmg', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg'];
      const isDownloadable = (lower.startsWith('http://') || lower.startsWith('https://')) && mediaExtensions.some(ext => lower.includes(ext));

      if (!isDownloadable) return;

      // Kullanıcı pano izlemeyi kapattıysa hiçbir şey yapma
      if (!(await isClipboardWatchEnabled())) return;

      // Pencereyi EN ÜSTE getir ve İndirme İletişim Kutusunu aç
      bringToFront();

      await fetch(appUrl('/api/download/prompt-add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text })
      });

      if (Notification.isSupported()) {
        const notif = new Notification({
          title: et('notif_link_title'),
          body: `${et('notif_link_body')}\n${text.substring(0, 60)}...`
        });
        notif.on('click', () => {
          bringToFront();
        });
        notif.show();
      }
    } catch (e) {
      // ignore
    }
  }, 2000);
}

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('deepnode', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('deepnode');
}

function handleProtocolUrl(urlStr) {
  try {
    const urlObj = new URL(urlStr);
    if (urlObj.hostname === 'add') {
      const targetUrl = urlObj.searchParams.get('url');
      // `deepnode://` şemasını herhangi bir web sayfası tetikleyebilir. Yalnız
      // http(s) hedefleri kabul edilir: `file:`/`javascript:` gibi şemalarla
      // onay penceresi açtırılamaz.
      if (targetUrl && /^https?:\/\//i.test(targetUrl)) {
        createAddDownloadWindow(targetUrl);
      } else if (targetUrl) {
        console.warn('deepnode:// protokolünde desteklenmeyen adres reddedildi.');
      }
    }
  } catch (err) {
    console.error('Invalid protocol url', err);
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    const protocolUrl = commandLine.find(arg => arg.startsWith('deepnode://'));
    if (protocolUrl) {
      handleProtocolUrl(protocolUrl);
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    const protocolUrl = process.argv.find(arg => arg.startsWith('deepnode://'));
    const launchedHidden = process.argv.includes('--hidden');

    await loadSettings();
    applyStartupSetting();

    // Tepside gizli başlatma yalnız otomatik açılışta (--hidden, Windows login item):
    // kullanıcı kısayoldan elle açtığında pencere her zaman görünür.
    const showWindow = !protocolUrl && !launchedHidden;
    createWindow(showWindow);
    createTray();
    startClipboardWatcher();

    // IDM-style update notification: startup (15s) + every 6 hours
    setTimeout(checkUpdateNotify, 15000);
    setInterval(checkUpdateNotify, 6 * 60 * 60 * 1000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

    if (protocolUrl) {
      setTimeout(() => handleProtocolUrl(protocolUrl), 500); // wait for express to initialize
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && isQuitting) {
      app.quit();
    }
  });
}
