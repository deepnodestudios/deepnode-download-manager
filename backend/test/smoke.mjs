// DDM backend duman testi (AI_Guidelines §3).
//
// Tek süreçte: sahte kaynak sunucusu + backend + senaryolar. Harici bağımlılık yok.
//   node backend/test/smoke.mjs
//
// Kapsanan regresyonlar:
//   R1  302 yönlendirme takibi (inspect + çok parçalı indirme)
//   R2  Accept-Ranges yalanı söyleyen sunucuda tek parçaya düşüş (bozuk dosya yok)
//   R3  HEAD'i reddeden sunucuda GET+Range ile boyut tespiti
//   R4  Origin muhafızı: web sayfası engellenir, eklenti ve uygulama çalışır
//   R5  Çerezler API/WebSocket yanıtına sızmaz ama diske (devam için) yazılır
//   R6  Duraklat/devam yarışında yarım dosya "tamamlandı" sayılmaz
//   R7  safeName: yol bileşenli dosya adı klasör dışına yazamaz
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ENTRY = path.join(__dirname, '..', 'src', 'server.js');

const ORIGIN_SRC = 5999;
const SIZE = 4 * 1000 * 1000;
const BODY = Buffer.alloc(SIZE, 0x41);

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Sahte kaynak sunucusu ------------------------------------------------
function startOriginServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = new URL(req.url, 'http://x').pathname;
      const isHead = req.method === 'HEAD';

      const serveRanged = () => {
        const range = req.headers.range;
        if (range) {
          const m = /bytes=(\d+)-(\d*)/.exec(range);
          const start = Number(m[1]);
          const end = m[2] ? Number(m[2]) : SIZE - 1;
          res.writeHead(206, {
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${SIZE}`,
            'Accept-Ranges': 'bytes',
            'Content-Type': 'application/zip'
          });
          return res.end(isHead ? undefined : BODY.subarray(start, end + 1));
        }
        res.writeHead(200, { 'Content-Length': SIZE, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/zip' });
        res.end(isHead ? undefined : BODY);
      };

      if (p === '/good.zip') { res.writeHead(302, { Location: '/real.zip' }); return res.end(); }
      if (p === '/real.zip') return serveRanged();

      // Accept-Ranges: bytes DER ama Range'i yok sayar (yaygın bozuk sunucu)
      if (p === '/liar.zip') {
        res.writeHead(200, { 'Content-Length': SIZE, 'Accept-Ranges': 'bytes', 'Content-Type': 'application/zip' });
        return res.end(isHead ? undefined : BODY);
      }

      // HEAD'i reddeder — boyut yalnız GET+Range ile öğrenilebilir
      if (p === '/nohead.zip') {
        if (isHead) { res.writeHead(405); return res.end(); }
        return serveRanged();
      }

      // Content-Disposition ile yol bileşenli ad gönderir (path traversal denemesi)
      if (p === '/evil') {
        res.writeHead(200, {
          'Content-Length': SIZE,
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="../../../../pwned.exe"'
        });
        return res.end(isHead ? undefined : BODY);
      }

      // Yavaş akış: duraklat/devam senaryosu için.
      // /sloppy.zip aynı davranışı gösterir ama Range'in BİTİŞİNİ yok sayar
      // (gerçekte yaygın): motor fazlasını kırpmazsa segmentler taşar.
      if (p === '/slow.zip' || p === '/sloppy.zip') {
        const sloppy = p === '/sloppy.zip';
        const range = req.headers.range;
        let start = 0;
        let end = SIZE - 1;
        if (range) {
          const m = /bytes=(\d+)-(\d*)/.exec(range);
          start = Number(m[1]);
          if (!sloppy && m[2]) end = Number(m[2]);
        }
        if (isHead) {
          res.writeHead(200, { 'Content-Length': SIZE, 'Accept-Ranges': 'bytes' });
          return res.end();
        }
        res.writeHead(range ? 206 : 200, {
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${SIZE}` } : {})
        });
        // Bilerek yavaş: duraklat/devam gerçekten indirme SÜRERKEN olmalı,
        // yoksa senaryo bitmiş bir indirmeyi test eder.
        let sent = start;
        const tick = setInterval(() => {
          if (sent > end || res.writableEnded) { clearInterval(tick); res.end(); return; }
          const n = Math.min(8 * 1024, end - sent + 1);
          res.write(BODY.subarray(sent, sent + n));
          sent += n;
        }, 50);
        req.on('close', () => clearInterval(tick));
        return;
      }

      res.writeHead(404);
      res.end();
    });
    srv.listen(ORIGIN_SRC, '127.0.0.1', () => resolve(srv));
  });
}

// --- Backend'i başlat -----------------------------------------------------
// DİKKAT: 5000 KULLANILMAZ — geliştirici makinesinde gerçek DDM uygulaması
// çoğu zaman 5000'de çalışır; oraya konuşmak testleri GERÇEK uygulamaya
// yöneltir (yanlış sonuç + kullanıcının indirme listesine çöp kayıt).
// Ayrı bir port istenir ve backend'in GERÇEKTEN dinlediği port log'dan okunur
// (istenen port doluysa backend bir sonrakine kaçabilir).
const TEST_PORT = 5210;
function startBackend(home) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BACKEND_ENTRY], {
      env: { ...process.env, HOME: home, USERPROFILE: home, DN_PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const onData = (d) => {
      log += d.toString();
      const m = log.match(/Backend running on http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        setApiPort(Number(m[1]));
        resolve({ child, getLog: () => log });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        console.error(`\n### Backend beklenmedik şekilde kapandı (kod ${code}, sinyal ${signal}):\n${log}`);
      }
    });
    setTimeout(() => reject(new Error('Backend başlamadı:\n' + log)), 20000);
  });
}

// --- İstemci yardımcıları -------------------------------------------------
let APP_ORIGIN = `http://localhost:${TEST_PORT}`;
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
let API = `http://127.0.0.1:${TEST_PORT}`;
function setApiPort(port) {
  APP_ORIGIN = `http://localhost:${port}`;
  API = `http://127.0.0.1:${port}`;
}

async function call(pathname, { origin, method = 'GET', body } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (err) { /* gövdesiz yanıt */ }
  return { status: res.status, json };
}

const addDownload = (url, extra = {}) =>
  call('/api/download/add', { origin: APP_ORIGIN, method: 'POST', body: { url, confirmedByUser: true, ...extra } });

async function waitForStatus(id, wanted, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const { json } = await call('/api/downloads', { origin: APP_ORIGIN });
    last = (json || []).find((d) => d.id === id);
    if (last && wanted.includes(last.status)) return last;
    await sleep(300);
  }
  return last;
}

// --- Senaryolar -----------------------------------------------------------
async function run() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ddm-smoke-'));
  const origin = await startOriginServer();
  const backend = await startBackend(home);
  const dlRoot = path.join(home, 'Downloads');

  try {
    console.log('\nR4 — Origin muhafızı');
    check('web sayfası /api/downloads okuyamaz',
      (await call('/api/downloads', { origin: 'https://evil.example.com' })).status === 403);
    check('web sayfası /api/settings okuyamaz',
      (await call('/api/settings', { origin: 'https://evil.example.com' })).status === 403);
    check('web sayfası güncelleyiciyi tetikleyemez',
      (await call('/api/update/download', { origin: 'https://evil.example.com', method: 'POST', body: { url: 'https://x/y.exe' } })).status === 403);
    check('web sayfası indirme ekleyemez',
      (await call('/api/download/add', { origin: 'https://evil.example.com', method: 'POST', body: { url: 'http://x/y.zip', confirmedByUser: true } })).status === 403);
    check('güncelleyici beyaz liste dışı adresi reddeder',
      (await call('/api/update/download', { origin: APP_ORIGIN, method: 'POST', body: { url: 'http://127.0.0.1:5999/real.zip' } })).status === 400);

    const extSettings = await call('/api/settings?extVersion=1.3.6', { origin: EXT_ORIGIN });
    check('eklenti ayarları okuyabilir', extSettings.status === 200);
    check('eklentiye şifre alanları gönderilmez',
      extSettings.json && extSettings.json.proxyPass === undefined && extSettings.json.siteLogins === undefined);
    check('eklenti capture ayarlarını görebilir',
      extSettings.json && extSettings.json.captureBypassKey === 'Alt' && extSettings.json.captureEnabled === true);
    check('eklenti indirme listesine erişemez',
      (await call('/api/downloads', { origin: EXT_ORIGIN })).status === 403);
    check('uygulama penceresi tam erişimli',
      (await call('/api/downloads', { origin: APP_ORIGIN })).status === 200);

    console.log('\nR1 — 302 yönlendirme takibi');
    const inspect = await call('/api/download/inspect', {
      origin: APP_ORIGIN, method: 'POST', body: { url: `http://127.0.0.1:${ORIGIN_SRC}/good.zip` }
    });
    check('inspect yönlendirme ardındaki boyutu buluyor', inspect.json && inspect.json.totalSize === SIZE,
      `totalSize=${inspect.json && inspect.json.totalSize}`);
    check('inspect Range desteğini görüyor', inspect.json && inspect.json.acceptRanges === true);
    check('inspect çözülen adresi bildiriyor', inspect.json && /real\.zip$/.test(inspect.json.finalUrl || ''));

    const good = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/good.zip`, { headers: { Cookie: 'SESSIONID=supersecret' } });
    const goodDone = await waitForStatus(good.json.id, ['completed', 'error']);
    check('302 linki tamamlanıyor', goodDone && goodDone.status === 'completed',
      goodDone && (goodDone.errorMsg || goodDone.status));
    check('çok parçalı indi', goodDone && goodDone.segments && goodDone.segments.length > 1);
    const goodFile = path.join(dlRoot, 'Compressed', 'real.zip');
    check('dosya boyutu doğru', fs.existsSync(goodFile) && fs.statSync(goodFile).size === SIZE,
      fs.existsSync(goodFile) ? String(fs.statSync(goodFile).size) : 'dosya yok');

    console.log('\nR5 — Çerez sızıntısı');
    check('API yanıtı çerez taşımıyor', goodDone && goodDone.headers === undefined);
    const persisted = fs.readFileSync(path.join(home, '.deepnode', 'downloads.json'), 'utf8');
    check('çerez diske yazılıyor (devam ettirme için gerekli)', persisted.includes('SESSIONID=supersecret'));

    console.log('\nR2 — Accept-Ranges yalanı');
    const liar = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/liar.zip`);
    const liarDone = await waitForStatus(liar.json.id, ['completed', 'error']);
    check('bozuk sunucuda indirme yine de tamamlanıyor', liarDone && liarDone.status === 'completed',
      liarDone && (liarDone.errorMsg || liarDone.status));
    check('tek parçaya düşüldü', liarDone && liarDone.segments && liarDone.segments.length === 1);
    const liarFile = path.join(dlRoot, 'Compressed', 'liar.zip');
    check('dosya BOZUK DEĞİL (8× şişmedi)', fs.existsSync(liarFile) && fs.statSync(liarFile).size === SIZE,
      fs.existsSync(liarFile) ? String(fs.statSync(liarFile).size) : 'dosya yok');

    console.log('\nR3 — HEAD reddeden sunucu');
    const nh = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/nohead.zip`);
    const nhDone = await waitForStatus(nh.json.id, ['completed', 'error']);
    check('HEAD 405 dönse de boyut bulundu', nhDone && nhDone.totalSize === SIZE, String(nhDone && nhDone.totalSize));
    check('indirme tamamlandı', nhDone && nhDone.status === 'completed', nhDone && (nhDone.errorMsg || nhDone.status));

    console.log('\nR7 — Yol bileşenli dosya adı (path traversal)');
    const evil = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/evil`);
    check('dosya adı temizlendi', evil.json && !String(evil.json.filename).includes('..'),
      evil.json && evil.json.filename);
    check('kayıt yolu indirme klasörünün içinde',
      evil.json && path.resolve(evil.json.savePath).startsWith(path.resolve(dlRoot)),
      evil.json && evil.json.savePath);
    await waitForStatus(evil.json.id, ['completed', 'error']);
    check('klasör dışına dosya yazılmadı', !fs.existsSync(path.join(home, '..', 'pwned.exe')));

    console.log('\nR6 — Duraklat / devam ettir yarışı');
    const slow = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/slow.zip`);
    const slowId = slow.json.id;
    await sleep(900);
    // Hızlı duraklat→başlat dizisi: eski çalışmanın Promise.all'ı geç çözülüp
    // yarım parçaları birleştirmemeli.
    for (let i = 0; i < 4; i++) {
      await call(`/api/download/${slowId}/pause`, { origin: APP_ORIGIN, method: 'POST' });
      await sleep(120);
      await call(`/api/download/${slowId}/start`, { origin: APP_ORIGIN, method: 'POST' });
      await sleep(400);
    }
    const slowDone = await waitForStatus(slowId, ['completed', 'error'], 30000);
    check('duraklat/devam sonrası tamamlandı', slowDone && slowDone.status === 'completed',
      slowDone && (slowDone.errorMsg || slowDone.status));
    const slowFile = slowDone && slowDone.savePath;
    check('dosya tam ve bozulmamış',
      slowFile && fs.existsSync(slowFile) && fs.statSync(slowFile).size === SIZE,
      slowFile && fs.existsSync(slowFile) ? String(fs.statSync(slowFile).size) : 'dosya yok');
    check('ilerleme %100\'ü aşmadı', slowDone && slowDone.downloadedBytes <= slowDone.totalSize,
      slowDone && `${slowDone.downloadedBytes}/${slowDone.totalSize}`);

    console.log('\nR8 — Range bitişini yok sayan sunucu (segment taşması)');
    const sloppy = await addDownload(`http://127.0.0.1:${ORIGIN_SRC}/sloppy.zip`);
    const sloppyDone = await waitForStatus(sloppy.json.id, ['completed', 'error'], 30000);
    check('indirme tamamlandı', sloppyDone && sloppyDone.status === 'completed',
      sloppyDone && (sloppyDone.errorMsg || sloppyDone.status));
    check('dosya tam boyutta (segmentler taşmadı)',
      sloppyDone && sloppyDone.savePath && fs.existsSync(sloppyDone.savePath) &&
      fs.statSync(sloppyDone.savePath).size === SIZE,
      sloppyDone && sloppyDone.savePath && fs.existsSync(sloppyDone.savePath)
        ? String(fs.statSync(sloppyDone.savePath).size) : 'dosya yok');
  } finally {
    backend.child.kill('SIGKILL');
    origin.close();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch (err) { /* geçici klasör */ }
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} geçti, ${failed} kaldı\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('Test koşusu çöktü:', err);
  process.exit(1);
});
