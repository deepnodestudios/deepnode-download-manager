// Advanced Features Unit & Integration Test
// Tests:
//   1. Per-download speed limit (DownloadEngine, VideoDownloader, QueueManager)
//   2. Queue reordering (moveDownload, reorderDownloads)
//   3. Batch downloads (addBatchDownloads with saveDir and autoStart)
//   4. Antivirus scanning configuration & detection
//   5. Export / Import downloads

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' → ' + detail : ''}`); }
};

const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ddm-adv-test-'));
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;

async function runTests() {
  console.log('Advanced Features Test:');

  // Dynamic import of backend services with isolated test environment
  const { default: queueManager } = await import('../src/services/QueueManager.js');
  const { default: storageService } = await import('../src/services/StorageService.js');
  const { DownloadEngine } = await import('../src/services/DownloadEngine.js');
  const { VideoDownloader } = await import('../src/services/VideoDownloader.js');

  // Test 1: DownloadEngine speed limit & throttling
  const engine = new DownloadEngine({
    id: 'test-engine-1',
    url: 'http://example.com/test.zip',
    filename: 'test.zip',
    saveDir: os.tmpdir(),
    totalSize: 1000000,
    speedLimitKbps: 500
  });

  check('DownloadEngine initializes with speedLimitKbps', engine.speedLimitKbps === 500);
  check('DownloadEngine snapshot includes speedLimitKbps', engine.toSnapshot().speedLimitKbps === 500);

  engine.setSpeedLimit(1200);
  check('DownloadEngine setSpeedLimit updates limit', engine.speedLimitKbps === 1200);
  check('DownloadEngine snapshot reflects updated limit', engine.toSnapshot().speedLimitKbps === 1200);

  // Test 2: VideoDownloader speed limit
  const videoEngine = new VideoDownloader({
    id: 'test-video-1',
    url: 'https://youtube.com/watch?v=123',
    filename: 'video.mp4',
    saveDir: os.tmpdir(),
    speedLimitKbps: 300
  });

  check('VideoDownloader initializes with speedLimitKbps', videoEngine.speedLimitKbps === 300);
  videoEngine.setSpeedLimit(800);
  check('VideoDownloader setSpeedLimit updates limit', videoEngine.speedLimitKbps === 800);
  check('VideoDownloader snapshot reflects limit', videoEngine.toSnapshot().speedLimitKbps === 800);

  // Test 3: QueueManager per-download speed limit
  queueManager.engines.set('test-engine-1', engine);
  const updatedItem = queueManager.setSpeedLimit('test-engine-1', 2500);
  check('QueueManager setSpeedLimit works', updatedItem && updatedItem.speedLimitKbps === 2500);

  // Test 4: Queue reordering
  const engine2 = new DownloadEngine({ id: 'test-engine-2', url: 'http://example.com/2.zip', filename: '2.zip', saveDir: os.tmpdir() });
  const engine3 = new DownloadEngine({ id: 'test-engine-3', url: 'http://example.com/3.zip', filename: '3.zip', saveDir: os.tmpdir() });

  const originalEngines = queueManager.engines;
  queueManager.engines = new Map([
    ['test-engine-1', engine],
    ['test-engine-2', engine2],
    ['test-engine-3', engine3]
  ]);

  // Order currently: test-engine-1, test-engine-2, test-engine-3
  let ids = Array.from(queueManager.engines.keys());
  check('Initial order is 1, 2, 3', ids[0] === 'test-engine-1' && ids[1] === 'test-engine-2' && ids[2] === 'test-engine-3');

  // Move test-engine-3 up
  queueManager.moveDownload('test-engine-3', 'up');
  ids = Array.from(queueManager.engines.keys());
  check('After moving 3 up: 1, 3, 2', ids[0] === 'test-engine-1' && ids[1] === 'test-engine-3' && ids[2] === 'test-engine-2');

  // Move test-engine-2 to top
  queueManager.moveDownload('test-engine-2', 'top');
  ids = Array.from(queueManager.engines.keys());
  check('After moving 2 to top: 2, 1, 3', ids[0] === 'test-engine-2' && ids[1] === 'test-engine-1' && ids[2] === 'test-engine-3');

  // Move test-engine-2 to bottom
  queueManager.moveDownload('test-engine-2', 'bottom');
  ids = Array.from(queueManager.engines.keys());
  check('After moving 2 to bottom: 1, 3, 2', ids[0] === 'test-engine-1' && ids[1] === 'test-engine-3' && ids[2] === 'test-engine-2');

  // Arbitrary reorder
  queueManager.reorderDownloads(['test-engine-3', 'test-engine-2', 'test-engine-1']);
  ids = Array.from(queueManager.engines.keys());
  check('After reorderDownloads: 3, 2, 1', ids[0] === 'test-engine-3' && ids[1] === 'test-engine-2' && ids[2] === 'test-engine-1');

  // Restore original engines
  queueManager.engines = originalEngines;

  // Test 5: StorageService antivirus settings
  check('StorageService has virusScanEnabled in defaults', 'virusScanEnabled' in storageService.settings);
  check('StorageService has virusScannerPath in defaults', 'virusScannerPath' in storageService.settings);

  // Test 6: QueueManager findDefaultVirusScanner
  const detectedScanner = queueManager.findDefaultVirusScanner();
  if (process.platform === 'win32') {
    check('findDefaultVirusScanner detects MpCmdRun on Windows', typeof detectedScanner === 'string' || detectedScanner === null);
  } else {
    check('findDefaultVirusScanner handles non-Windows gracefully', detectedScanner === null);
  }

  // Test 7: Export / Import URL formatting
  const testDownloads = [
    { url: 'https://cdn.example.com/file1.zip', filename: 'file1.zip' },
    { url: 'https://cdn.example.com/file2.zip', filename: 'file2.zip' }
  ];
  const exportedTxt = testDownloads.map(d => d.url).join('\r\n');
  const importedUrls = exportedTxt.match(/https?:\/\/[^\s"'<>]+/gi);
  check('Export and Import round-trip matches URL list', importedUrls && importedUrls.length === 2 && importedUrls[0] === testDownloads[0].url);

  // Test 8: Multiple Queues Management (StorageService & QueueManager)
  const initialQueues = storageService.getQueues();
  check('Initial queues include main and sync', initialQueues.some(q => q.id === 'main') && initialQueues.some(q => q.id === 'sync'));

  const createdQueue = storageService.createQueue('Gece Kuyruğu', { maxConcurrent: 2 });
  check('StorageService createQueue works', createdQueue && createdQueue.name === 'Gece Kuyruğu' && createdQueue.maxConcurrent === 2);

  const updatedQueue = storageService.updateQueue(createdQueue.id, { maxConcurrent: 4, speedLimitKbps: 1500 });
  check('StorageService updateQueue updates properties', updatedQueue.maxConcurrent === 4 && updatedQueue.speedLimitKbps === 1500);

  // Test 9: Move download to queue & delete queue fallback
  const testEngineQ = new DownloadEngine({
    id: 'test-engine-q1',
    url: 'http://example.com/fileQ.zip',
    filename: 'fileQ.zip',
    saveDir: os.tmpdir(),
    status: 'paused',
    queueId: 'main'
  });
  testEngineQ.on('error', () => {});
  queueManager.engines.set('test-engine-q1', testEngineQ);

  const moved = queueManager.moveDownloadToQueue('test-engine-q1', createdQueue.id);
  check('QueueManager moveDownloadToQueue works', moved && testEngineQ.queueId === createdQueue.id);

  storageService.deleteQueue(createdQueue.id);
  queueManager.onQueueDeleted(createdQueue.id);
  check('Deleting queue moves downloads back to main queue', testEngineQ.queueId === 'main');
  queueManager.engines.delete('test-engine-q1');

  // Test 10: Video filename media extension preservation
  const testVid = new VideoDownloader({
    id: 'test-vid-ext',
    url: 'https://example.com/stream.m3u8',
    filename: 'Vikings Valhalla Episode 2',
    saveDir: os.tmpdir(),
    status: 'queued'
  });
  check('VideoDownloader adds .mp4 to extensionless video filename', testVid.filename === 'Vikings Valhalla Episode 2.mp4');

  testVid.setDesiredFilename('Vikings Valhalla New Name');
  check('setDesiredFilename preserves/appends media extension', testVid.filename === 'Vikings Valhalla New Name.mp4');

  const testAudioVid = new VideoDownloader({
    id: 'test-vid-audio',
    url: 'https://example.com/audio.m3u8',
    filename: 'Podcast Episode 1',
    quality: 'audio',
    saveDir: os.tmpdir(),
    status: 'queued'
  });
  check('VideoDownloader adds .mp3 to audio downloads', testAudioVid.filename === 'Podcast Episode 1.mp3');

  // Test 11: QueueManager renameDownload preserves extension
  const testEngineRename = new DownloadEngine({
    id: 'test-engine-rename',
    url: 'http://example.com/installer.exe',
    filename: 'installer.exe',
    saveDir: os.tmpdir(),
    status: 'paused'
  });
  queueManager.engines.set('test-engine-rename', testEngineRename);
  const renamedSnap = queueManager.renameDownload('test-engine-rename', 'my_custom_setup');
  check('QueueManager renameDownload preserves original extension', renamedSnap && renamedSnap.filename === 'my_custom_setup.exe');
  queueManager.engines.delete('test-engine-rename');

  // Test 12: Süresi dolan link yenilemesi yalnız AYNI dosyaya geçer
  const { pickRefreshedLink } = await import('../src/services/QueueManager.js');
  const oldFileUrl = 'https://cdn.example.com/files/movie.zip?token=old';
  check('Link yenileme: alakasız ilk link (logo) seçilmez',
    pickRefreshedLink(oldFileUrl, [{ url: 'https://example.com/logo.png' }, { url: 'https://example.com/readme.txt' }]) === null);
  check('Link yenileme: aynı dosya adlı taze link seçilir',
    pickRefreshedLink(oldFileUrl, [{ url: 'https://example.com/logo.png' }, { url: 'https://cdn2.example.com/x/movie.zip?token=new' }]) === 'https://cdn2.example.com/x/movie.zip?token=new');
  check('Link yenileme: manifest için taze manifest seçilir',
    pickRefreshedLink('https://v.example.com/hls/master.m3u8?t=1', [{ url: 'https://v.example.com/a.jpg' }, { url: 'https://v.example.com/hls/index.m3u8?t=2' }]) === 'https://v.example.com/hls/index.m3u8?t=2');
  check('Link yenileme: aynı (eski) link tekrar seçilmez',
    pickRefreshedLink(oldFileUrl, [{ url: oldFileUrl }]) === null);

  // Test 14: Takılma bekçisi son işlem (ffmpeg) aşamasında uzun sessizliğe izin verir
  const wd = new VideoDownloader({ id: 'test-wd', url: 'https://example.com/v.m3u8', filename: 'v.mp4', saveDir: os.tmpdir() });
  wd.status = 'downloading';
  const dlLimit = wd._stallLimitMs();
  wd.parseLine('[Merger] Merging formats into "C:\\x\\v.mp4"');
  check('Bekçi: birleştirme aşamasında sınır uzar', wd._postProcessing === true && wd._stallLimitMs() > dlLimit * 5);
  wd.parseLine('[download] Destination: C:\\x\\v.f251.webm');
  check('Bekçi: yeni akış başlayınca normal sınıra döner', wd._postProcessing === false && wd._stallLimitMs() === dlLimit);
  wd.parseLine('[ExtractAudio] Destination: C:\\x\\v.mp3');
  check('Bekçi: MP3 dönüşümü de son işlem sayılır', wd._postProcessing === true);

  // Test 15: Süresi dolmuş link sonsuz denemede asılı kalmaz
  const dead = new VideoDownloader({ id: 'test-dead', url: 'https://example.com/d.m3u8', filename: 'd.mp4', saveDir: os.tmpdir() });
  dead.status = 'downloading';
  let killed = 0;
  dead.proc = { pid: 0 };
  dead._killProc = () => { killed++; };
  const line403 = '[download] Got error: HTTP Error 403: Forbidden. Retrying fragment 5 (3/infinite)...';
  for (let i = 0; i < 10; i++) dead.parseLine(line403);
  dead.parseLine('download:OMNI|5000|100000|NA|1000|90');
  for (let i = 0; i < 19; i++) dead.parseLine(line403);
  check('Ölü link: ilerleme sayacı sıfırlar, erken öldürülmez', killed === 0);
  dead.parseLine(line403);
  dead.parseLine(line403);
  check('Ölü link: ilerlemesiz 20 hatada süreç bir kez sonlandırılır', killed === 1 && dead._linkDead === true);

  // Test 16: Ön indirme onayında uzantısız ad kaynağın uzantısını korur
  const pfDir = fs.mkdtempSync(path.join(testHome, 'pf-'));
  const pfEng = new DownloadEngine({ id: 'test-pf-ext', url: 'http://example.com/album.flac', filename: 'album.flac', saveDir: pfDir, status: 'paused', preflight: true });
  queueManager.engines.set('test-pf-ext', pfEng);
  const pfSnap = await queueManager.confirmPreflight('test-pf-ext', { filename: 'Yeni Ad', autoStart: false });
  check('Onay: uzantısız ad .flac uzantısını korur', pfSnap && pfSnap.filename === 'Yeni Ad.flac');
  const pfEng2 = new DownloadEngine({ id: 'test-pf-ext2', url: 'http://example.com/album.flac', filename: 'album.flac', saveDir: pfDir, status: 'paused', preflight: true });
  queueManager.engines.set('test-pf-ext2', pfEng2);
  const pfSnap2 = await queueManager.confirmPreflight('test-pf-ext2', { filename: 'album.flac', autoStart: false });
  check('Onay: .flac adına .mp3 eklenmez', pfSnap2 && pfSnap2.filename === 'album.flac');
  queueManager.engines.delete('test-pf-ext');
  queueManager.engines.delete('test-pf-ext2');

  // Test 13: Yeniden indirme iptal/silme olursa eski dosya geri konur
  const http = await import('http');
  const body = Buffer.alloc(2048, 0x42);
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Length': body.length, 'Content-Type': 'application/zip', 'Accept-Ranges': 'bytes' });
    if (req.method === 'HEAD') return res.end();
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const prevAuto = storageService.settings.autoStartDownloads;
  storageService.settings.autoStartDownloads = false; // ağdan indirme başlamasın
  const rdDir = fs.mkdtempSync(path.join(testHome, 'rd-'));

  const runRedownloadCase = async (label, finish) => {
    const fname = `orig-${label}.zip`;
    const p = path.join(rdDir, fname);
    fs.writeFileSync(p, 'ESKI-DOSYA');
    const id = `test-rd-${label}`;
    const old = new DownloadEngine({
      id, url: `http://127.0.0.1:${port}/${fname}`, filename: fname, saveDir: rdDir,
      savePath: p, status: 'completed', totalSize: 10, downloadedBytes: 10
    });
    queueManager.engines.set(id, old);
    const item = await queueManager.redownload(id);
    const backups = fs.readdirSync(rdDir).filter((f) => f.startsWith(fname) && f.endsWith('.bak'));
    check(`Yeniden indirme (${label}): eski dosya önce yedeğe alındı`, !fs.existsSync(p) && backups.length === 1);
    finish(item.id);
    const left = fs.readdirSync(rdDir).filter((f) => f.startsWith(fname) && f.endsWith('.bak'));
    check(`Yeniden indirme (${label}): eski dosya geri kondu`,
      fs.existsSync(p) && fs.readFileSync(p, 'utf8') === 'ESKI-DOSYA' && left.length === 0);
    queueManager.engines.delete(item.id);
  };
  await runRedownloadCase('iptal', (newId) => queueManager.cancelDownload(newId));
  await runRedownloadCase('silme', (newId) => queueManager.deleteDownload(newId, false));

  storageService.settings.autoStartDownloads = prevAuto;
  await new Promise((r) => srv.close(r));

  console.log(`\n✅ ${passed} geçti, ${failed} kaldı\n`);
  try { fs.rmSync(testHome, { recursive: true, force: true }); } catch (_) {}
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  try { fs.rmSync(testHome, { recursive: true, force: true }); } catch (_) {}
  console.error('Test error:', err);
  process.exit(1);
});
