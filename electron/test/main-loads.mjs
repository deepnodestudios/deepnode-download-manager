// Electron ana süreci YÜKLENME testi.
//
// NEDEN VAR: v1.3.6'da `SECURE_WEB_PREFERENCES` üst düzey sabiti `__dirname`'i
// modül yüklenirken kullanıyordu, ama `const __dirname` dosyanın aşağısındaydı.
// Sonuç: "ReferenceError: Cannot access '__dirname' before initialization" —
// uygulama HİÇ AÇILMIYORDU. `node --check` bunu yakalayamaz (sözdizimi doğru),
// sandbox'ta Electron çalıştırılamadığı için de fark edilmemişti.
//
// Bu test `electron` modülünü sahteleyip main.js'i GERÇEKTEN yükler:
// modül gövdesi + `app.whenReady()` sonrası kurulum kodu çalışır. TDZ, yanlış
// sıralama, tanımsız değişken gibi çalışma anı hataları burada yakalanır.
//
//   node electron/test/main-loads.mjs
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.join(__dirname, '..');
const PROJECT_DIR = path.join(ELECTRON_DIR, '..');

// --- Electron sahtesi -----------------------------------------------------
const STUB = `
const noop = () => {};
const handlers = new Map();

class FakeWebContents {
  setWindowOpenHandler() {}
  on() {}
  executeJavaScript() { return Promise.resolve(); }
  send() {}
}
class FakeBrowserWindow {
  constructor(opts = {}) {
    FakeBrowserWindow.created.push(opts);
    this.webContents = new FakeWebContents();
  }
  static created = [];
  static fromWebContents() { return null; }
  static getAllWindows() { return []; }
  loadURL(u) { FakeBrowserWindow.loaded.push(u); }
  static loaded = [];
  on() {} once() {} show() {} hide() {} focus() {} minimize() {} restore() {}
  isMinimized() { return false; } isVisible() { return true; } isDestroyed() { return false; }
  getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
  setBounds() {} getContentSize() { return [800, 600]; } setContentSize() {}
  setAlwaysOnTop() {} flashFrame() {} setProgressBar() {} close() {}
}

export const app = {
  whenReady: () => Promise.resolve(),
  on: noop,
  quit: noop,
  getLocale: () => 'tr-TR',
  setLoginItemSettings: noop,
  setAsDefaultProtocolClient: noop,
  requestSingleInstanceLock: () => true
};
export const BrowserWindow = FakeBrowserWindow;
export class Tray {
  constructor() {}
  setContextMenu() {} setToolTip() {} on() {}
}
export const Menu = { buildFromTemplate: (t) => ({ popup: noop, template: t }) };
export const clipboard = { readText: () => '' };
export const Notification = Object.assign(
  class { constructor() {} on() {} show() {} },
  { isSupported: () => false }
);
export const ipcMain = {
  handle: (ch) => handlers.set(ch, 'handle'),
  on: (ch) => handlers.set(ch, 'on'),
  registered: handlers
};
export const dialog = { showOpenDialog: async () => ({ canceled: true }), showErrorBox: noop };
export const shell = { openExternal: async () => {}, openPath: async () => {}, showItemInFolder: noop, beep: noop };
export const screen = { getDisplayMatching: () => ({ workAreaSize: { height: 1080 } }) };
export const nativeImage = {
  createFromPath: () => ({
    isEmpty: () => false,
    resize: () => ({})
  })
};

export default { app, BrowserWindow, Tray, Menu, clipboard, Notification, ipcMain, dialog, shell, screen, nativeImage };
export const __stub = { FakeBrowserWindow, handlers };
`;

// --- Geçici çalışma alanı --------------------------------------------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ddm-main-'));
const workElectron = path.join(work, 'electron');
fs.mkdirSync(workElectron, { recursive: true });

for (const f of fs.readdirSync(ELECTRON_DIR)) {
  const src = path.join(ELECTRON_DIR, f);
  if (fs.statSync(src).isDirectory()) continue;
  fs.copyFileSync(src, path.join(workElectron, f));
}
fs.writeFileSync(path.join(workElectron, 'electron-stub.mjs'), STUB);

// backend gerçekten çalışsın (serverEvents bağlantıları da test edilsin)
// NOT: node_modules KOPYALANMAZ — Windows/OneDrive'da fs.cpSync bu dev ağaçta
// sessizce çökebiliyor (0xC0000409); symlink hem hızlı hem güvenli.
fs.cpSync(path.join(PROJECT_DIR, 'backend'), path.join(work, 'backend'), {
  recursive: true,
  filter: (src) => !src.includes('node_modules')
});
const backendNm = path.join(PROJECT_DIR, 'backend', 'node_modules');
if (fs.existsSync(backendNm)) {
  fs.symlinkSync(backendNm, path.join(work, 'backend', 'node_modules'), 'dir');
}
fs.symlinkSync(path.join(PROJECT_DIR, 'node_modules'), path.join(work, 'node_modules'), 'dir');

// `from 'electron'` -> sahte modül
const mainPath = path.join(workElectron, 'main.js');
let main = fs.readFileSync(mainPath, 'utf8');
main = main.replace(/from ['"]electron['"]/g, "from './electron-stub.mjs'");
// Yükleme testi bitince süreç kapansın (pano izleyici setInterval'i tutuyor)
// Ekleme ve ilerleme pencereleri normalde eklenti/backend olayıyla açılır;
// testte doğrudan çağrılır (ikisi de main.js modül kapsamındaki fonksiyonlar).
main += `
setTimeout(async () => {
  const { __stub } = await import('./electron-stub.mjs');
  const before = __stub.FakeBrowserWindow.created.length;
  createAddDownloadWindow('https://example.com/dosya.zip');
  createProgressWindow('dl_test_1');
  handleProtocolUrl('deepnode://add?url=' + encodeURIComponent('https://example.com/a.zip'));
  handleProtocolUrl('deepnode://add?url=' + encodeURIComponent('file:///C:/Windows/System32/calc.exe'));
  const after = __stub.FakeBrowserWindow.created.slice(before);
  console.log('READY_OK ' + JSON.stringify({
    windows: before,
    loaded: __stub.FakeBrowserWindow.loaded,
    ipc: [...__stub.handlers.keys()],
    preload: (__stub.FakeBrowserWindow.created[0] || {}).webPreferences || null,
    childPrefs: after.map((w) => w.webPreferences),
    childCount: after.length
  }));
  process.exit(0);
}, 2500);
`;
fs.writeFileSync(mainPath, main);

// --- Çalıştır --------------------------------------------------------------
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddm-main-home-'));
const child = spawn(process.execPath, [mainPath], {
  env: { ...process.env, HOME: home, USERPROFILE: home, DN_PORT: '5123' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

const code = await new Promise((resolve) => {
  child.on('exit', resolve);
  setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 15000);
});

fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });

// --- Değerlendir -----------------------------------------------------------
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
};

const readyLine = (out.match(/READY_OK (\{.*\})/) || [])[1];
const info = readyLine ? JSON.parse(readyLine) : null;

console.log('\nElectron ana süreci — yükleme testi');
check('main.js hatasız yüklendi', code === 0 && !!info,
  code === 'timeout' ? 'zaman aşımı' : (out.match(/(ReferenceError|TypeError|SyntaxError)[^\n]*/) || ['çıkış kodu ' + code])[0]);

if (info) {
  check('ana pencere oluşturuldu', info.windows >= 1, String(info.windows));
  check('arayüz yerel sunucudan yükleniyor', (info.loaded[0] || '').startsWith('http://localhost:'), info.loaded[0]);
  check('nodeIntegration kapalı', info.preload && info.preload.nodeIntegration === false);
  check('contextIsolation açık', info.preload && info.preload.contextIsolation === true);
  check('preload bağlı', !!(info.preload && info.preload.preload && info.preload.preload.endsWith('preload.cjs')),
    info.preload && info.preload.preload);
  for (const ch of ['select-folder', 'bring-to-front', 'open-external', 'popup-download-menu',
                    'close-add-window', 'minimize-add-window', 'resize-add-window']) {
    check(`IPC kanalı kayıtlı: ${ch}`, info.ipc.includes(ch));
  }

  // Ekleme + ilerleme + protokolden gelen http(s) = 3 pencere.
  // `file://` hedefi REDDEDİLMELİ (4. pencere açılmamalı).
  check('ekleme/ilerleme pencereleri açıldı, file:// reddedildi', info.childCount === 3,
    `${info.childCount} pencere`);
  check('alt pencerelerde de nodeIntegration kapalı',
    info.childPrefs.length > 0 && info.childPrefs.every((p) => p && p.nodeIntegration === false));
  check('alt pencerelerde de contextIsolation açık',
    info.childPrefs.length > 0 && info.childPrefs.every((p) => p && p.contextIsolation === true));
  check('alt pencerelerde de preload bağlı',
    info.childPrefs.length > 0 && info.childPrefs.every((p) => p && String(p.preload).endsWith('preload.cjs')));
}

if (fail > 0) console.log('\n--- süreç çıktısı ---\n' + out.slice(-2000));
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} geçti, ${fail} kaldı\n`);
process.exit(fail === 0 ? 0 : 1);
