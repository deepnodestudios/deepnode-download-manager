// Tarayıcı eklentisi — indirme yakalama davranışı testi.
//
// browser-extension/background.js sahte bir Chrome API'si ve sahte bir DDM
// sunucusu (fetch) ile çalıştırılır. Doğrulanan IDM davranışı:
//   - DDM indirmeyi alıyorsa tarayıcı indirmesi ANINDA iptal edilip listeden silinir
//   - Yok sayılan türler (ör. .torrent) ve uygulama kapalıyken tarayıcı indirir
//   - Uzantısız dosyada önce uygulamaya sorulur, alırsa iptal edilir
//   - DDM alamazsa iptal edilen indirme tarayıcıda yeniden başlatılır (tekrar yakalanmaz)
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.join(__dirname, '../../browser-extension');

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
};

function makeEnv({ appUp = true, addStatus = 'prompted', filter = { enableFileFiltering: true, capturedExtensions: 'ZIP EXE APK PDF', ignoredExtensions: 'TORRENT CSS' } } = {}) {
  const calls = { cancel: [], erase: [], download: [], add: [], settingsHeaders: [] };
  const listeners = {};
  const ev = (name) => ({ addListener: (fn) => { (listeners[name] = listeners[name] || []).push(fn); }, removeListener() {} });
  const store = {};
  const chrome = {
    runtime: { lastError: undefined, getManifest: () => ({ version: '9.9.9' }), onInstalled: ev('installed'), onMessage: ev('message'), onConnect: ev('connect') },
    i18n: { getUILanguage: () => 'tr' },
    storage: {
      local: {
        get: (defs, cb) => cb({ ...(typeof defs === 'object' ? defs : {}), ...store }),
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
        remove: () => {}
      },
      session: { get: async () => ({}), set: async () => {}, remove: () => {} },
      onChanged: ev('storageChanged')
    },
    alarms: { create: () => {}, onAlarm: ev('alarm') },
    contextMenus: { removeAll: (cb) => cb && cb(), create: () => {}, onClicked: ev('ctx') },
    tabs: { onUpdated: ev('tabUpd'), onRemoved: ev('tabRem'), create: () => {}, remove: () => {}, get: () => {} },
    webRequest: { onCompleted: ev('web') },
    webNavigation: { onCommitted: ev('nav') },
    notifications: { create: () => {} },
    downloads: {
      onDeterminingFilename: ev('determine'),
      cancel: (id, cb) => { calls.cancel.push(id); if (cb) cb(); },
      search: (q, cb) => cb([{ id: q.id, state: 'interrupted' }]),
      erase: (q) => { calls.erase.push(q.id); return Promise.resolve(); },
      removeFile: () => Promise.resolve(),
      download: (opts, cb) => { calls.download.push(opts.url); if (cb) cb(1); }
    }
  };
  const json = (obj) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => obj });
  const fetch = async (url, opts = {}) => {
    if (!appUp) throw new Error('ECONNREFUSED');
    if (url.includes('/api/handshake')) return json({ app: 'deepnode', apiVersion: 1 });
    if (url.includes('/api/settings')) {
      calls.settingsHeaders.push(opts.headers || {});
      return json({ app: 'deepnode', captureEnabled: true, ...filter });
    }
    if (url.includes('/api/download/add')) {
      const body = JSON.parse(opts.body || '{}');
      calls.add.push(body);
      return json({ status: typeof addStatus === 'function' ? addStatus(body) : addStatus });
    }
    return json({});
  };
  const ctx = {
    chrome, fetch, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, URL, Date, Promise, Map, Set, JSON, Math, String, Number, Array, Object, RegExp, Error,
    navigator: { userAgent: 'test' }, encodeURIComponent, decodeURIComponent
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(extDir, 'strings.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(extDir, 'background.js'), 'utf8'), ctx);
  return { ctx, calls, listeners, store };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function capture(env, item) {
  let suggested = 0;
  const fn = env.listeners.determine[0];
  fn({ id: item.id, url: item.url, finalUrl: item.finalUrl || item.url, filename: item.filename || '', state: 'in_progress', mime: item.mime || '', referrer: 'https://site.example/page' }, () => { suggested++; });
  // handleDownloadItem async; iptal/finalize zamanlayıcıları için bekle
  for (let i = 0; i < 40; i++) await tick(10);
  await tick(150);
  return { suggested };
}

async function main() {
  console.log('Eklenti indirme yakalama testi:');

  // 1) Bilinen uzantı, DDM onay penceresi açar -> tarayıcı indirmesi hemen iptal + silinir
  {
    const env = makeEnv();
    await tick(20); // ayar senkronu
    check('Ayar senkronu X-DDM-Ext başlığı gönderir',
      env.calls.settingsHeaders.some((h) => h['X-DDM-Ext'] === '1'));
    check('captureFilter storage.local ile senkronlandı',
      !!(env.store.captureFilter && env.store.captureFilter.captured.includes('EXE')));
    await capture(env, { id: 11, url: 'https://cdn.example.com/app.apk', filename: 'app.apk' });
    check('APK: DDM\'ye gönderildi', env.calls.add.some((b) => b.url === 'https://cdn.example.com/app.apk'));
    check('APK: tarayıcı indirmesi iptal edildi', env.calls.cancel.includes(11));
    check('APK: tarayıcı listesinden silindi', env.calls.erase.includes(11));
    check('APK: tarayıcıda yeniden başlatılmadı', env.calls.download.length === 0);
  }

  // 2) Yok sayılan tür (.torrent) -> tarayıcı indirir, DDM'ye hiç sorulmaz
  {
    const env = makeEnv();
    await tick(20);
    const r = await capture(env, { id: 12, url: 'https://t.example.com/file.torrent', filename: 'file.torrent' });
    check('TORRENT: iptal edilmedi', !env.calls.cancel.includes(12));
    check('TORRENT: DDM\'ye gönderilmedi', env.calls.add.length === 0);
    check('TORRENT: tarayıcı devam etti (suggest)', r.suggested === 1);
  }

  // 3) Uygulama kapalı -> tarayıcı indirir
  {
    const env = makeEnv({ appUp: false });
    await tick(20);
    const r = await capture(env, { id: 13, url: 'https://cdn.example.com/setup.exe', filename: 'setup.exe' });
    check('Uygulama kapalı: iptal edilmedi', !env.calls.cancel.includes(13));
    check('Uygulama kapalı: tarayıcı devam etti', r.suggested === 1);
  }

  // 4) Uzantısız dosya, DDM alıyor -> önce sorulur, sonra iptal
  {
    const env = makeEnv();
    await tick(20);
    await capture(env, { id: 14, url: 'https://site.example/get?id=5', filename: '' });
    check('Uzantısız + DDM aldı: iptal edildi', env.calls.cancel.includes(14) && env.calls.add.length === 1);
    // "download.php?id=" adı gerçek türü söylemez: yerel filtre reddetmemeli, uygulamaya sorulmalı
    await capture(env, { id: 18, url: 'https://site.example/download.php?id=7', filename: '' });
    check('download.php: karar uygulamaya bırakıldı ve iptal edildi', env.calls.add.some((b) => b.url === 'https://site.example/download.php?id=7') && env.calls.cancel.includes(18));
  }

  // 5) SourceForge geri sayım + /download URL senaryoları (filename boş olsa bile yakalanmalı)
  {
    const env = makeEnv();
    await tick(20);
    const sfMirror = 'https://netix.dl.sourceforge.net/project/qbittorrent/qbittorrent-win32/qbittorrent-5.3.0/qbittorrent_5.3.0_x64_setup.exe?viasf=1&fid=a47477e94168b617';
    const sfCountdown = 'https://downloads.sourceforge.net/project/qbittorrent/qbittorrent-win32/qbittorrent-5.3.0/qbittorrent_5.3.0_x64_setup.exe?ts=gAAAAABn&use_mirror=netix';
    await capture(env, { id: 19, url: sfCountdown, finalUrl: sfMirror, filename: '', mime: 'application/x-msdownload' });
    const req19 = env.calls.add.find((b) => b.url === sfMirror);
    check('SourceForge mirror: DDM\'ye gönderildi', !!req19 && req19.filename === 'qbittorrent_5.3.0_x64_setup.exe');
    check('SourceForge mirror: tarayıcı indirmesi iptal ve silindi', env.calls.cancel.includes(19) && env.calls.erase.includes(19));

    const sfDownloadPath = 'https://sourceforge.net/projects/qbittorrent/files/qbittorrent-win32/qbittorrent-5.3.0/qbittorrent_5.3.0_x64_setup.exe/download?use_mirror=netix';
    await capture(env, { id: 20, url: sfDownloadPath, filename: '' });
    const req20 = env.calls.add.find((b) => b.url === sfDownloadPath);
    check('SourceForge /download yolu: gerçek dosya adı çıkarıldı', !!req20 && req20.filename === 'qbittorrent_5.3.0_x64_setup.exe');
    check('SourceForge /download yolu: tarayıcı indirmesi iptal edildi', env.calls.cancel.includes(20) && env.calls.download.length === 0);
  }

  // 6) Uzantısız dosya, DDM yok sayıyor -> tarayıcı devam eder, yeniden başlatma yok
  {
    const env = makeEnv({ addStatus: 'ignored' });
    await tick(20);
    const r = await capture(env, { id: 15, url: 'https://site.example/get?f=9', filename: '' });
    check('Uzantısız + DDM yok saydı: iptal edilmedi', !env.calls.cancel.includes(15) && r.suggested === 1);
    check('Uzantısız + DDM yok saydı: yeniden başlatma yok', env.calls.download.length === 0);
  }

  // 7) Bilinen uzantı ama DDM isteği başarısız -> iptal edilen indirme tarayıcıda yeniden başlar
  {
    const env = makeEnv({ addStatus: 'weird' });
    await tick(20);
    await capture(env, { id: 16, url: 'https://cdn.example.com/doc.pdf', filename: 'doc.pdf' });
    check('DDM başarısız: önce iptal edildi', env.calls.cancel.includes(16));
    check('DDM başarısız: tarayıcıda yeniden başlatıldı', env.calls.download.includes('https://cdn.example.com/doc.pdf'));
    // Yeniden başlatılan indirme tekrar yakalanmamalı
    const before = env.calls.add.length;
    const r = await capture(env, { id: 17, url: 'https://cdn.example.com/doc.pdf', filename: 'doc.pdf' });
    check('Yeniden başlatılan indirme tekrar yakalanmadı', env.calls.add.length === before && !env.calls.cancel.includes(17) && r.suggested === 1);
  }

  console.log(`\n✅ ${passed} geçti, ${failed} kaldı\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error('Test error:', e); process.exit(1); });
