// Uygulama güncelleme uçları (kontrol / indirme / kurulum).
//
// server.js'ten ayrıldı: hem dosya 1000 satır sınırına yaklaşmıştı (AI_Guidelines §2)
// hem de bu üç uç uygulamanın en ayrıcalıklı işlemini yapıyor — indirilen dosyayı
// ÇALIŞTIRIYOR. Sertleştirme:
//   - Kaynak adres beyaz listesi (yalnız GitHub Releases / deepnodestudios.net).
//   - Dosya adı `path.basename` + `.exe` kısıtı → UPDATE_DIR dışına yazılamaz.
//   - Uçlar yalnız uygulamanın kendi penceresinden çağrılabilir (appOnly).
//   - Kurulumdan önce dosyanın gerçekten bu oturumda indirilmiş, doğrulanmış
//     kurulum dosyası olduğu kontrol edilir.
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { isAllowedUpdateUrl } from '../security.js';
import { safeName, isInsideDir } from '../utils/paths.js';

const GITHUB_RELEASES_API = 'https://api.github.com/repos/deepnodestudios/deepnode-download-manager/releases/latest';
const UPDATE_MANIFEST_FALLBACK = 'https://deepnodestudios.net/DDM/updates/ddm-latest.json';
const UPDATE_DIR = path.join(os.homedir(), '.deepnode', 'updates');

export function compareVersions(a, b) {
  // "1.3.6-beta.1" gibi ön sürüm etiketleri sayı kısmına indirgenir; eskiden
  // Number('6-beta') -> NaN olduğu için karşılaştırma sessizce "eşit" dönüyordu.
  const parse = (v) => String(v || '')
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) ? n : 0;
    });

  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Güncelleme paketinin adı: yol bileşeni taşıyamaz, yalnız kurulum dosyası olabilir.
function installerNameFrom(rawUrl) {
  let candidate = 'DeepNodeSetup.exe';
  try {
    candidate = decodeURIComponent(new URL(rawUrl).pathname.split('/').pop() || '');
  } catch (err) {
    candidate = '';
  }
  const clean = safeName(candidate, 'DeepNodeSetup.exe');
  return /\.exe$/i.test(clean) ? clean : 'DeepNodeSetup.exe';
}

// Güncelleme bütünlüğü: kurulum dosyası YALNIZCA beklenen SHA-256 ile eşleşirse
// doğrulanmış sayılır. Authenticode zinciri kendinden imzalı sertifika yüzünden
// kullanılamıyor; bu yüzden hash zorunludur ve hash yoksa fail-closed davranılır.
export async function verifyInstallerSignature(filePath, expectedSha256 = null) {
  const expected = String(expectedSha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  try {
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest('hex').toLowerCase() === expected;
  } catch (err) {
    return false;
  }
}


export function createUpdateRouter({ appVersion, broadcast, serverEvents, appOnly }) {
  const router = express.Router();

  let state = { status: 'idle', progress: 0, file: null, error: null };
  // Çift tıklama / iki pencere aynı anda kurulum başlatmasın: aksi halde iki
  // installer süreci yarışır ve uygulama iki kez kapanma sinyali alabilir.
  let installing = false;
  const emit = () => broadcast({ type: 'UPDATE_PROGRESS', payload: state });

  router.get('/check', async (req, res) => {
    const current = appVersion();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(GITHUB_RELEASES_API, {
        signal: controller.signal,
        headers: { 'User-Agent': `DeepNode/${current}`, Accept: 'application/vnd.github+json' }
      });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`GitHub HTTP ${resp.status}`);
      const data = await resp.json();
      const latest = (data.tag_name || '').replace(/^v/, '');
      const asset = (data.assets || []).find((a) => /\.exe$/i.test(a.name || ''));
      const shaMatch = (data.body || '').match(/(?:sha256|sha-256|checksum)[:\s=]+([a-fA-F0-9]{64})/i)
        || (data.body || '').match(/([a-fA-F0-9]{64})\s+[*]?\S+\.exe/i);
      let sha256 = shaMatch ? shaMatch[1].toLowerCase() : null;
      // Release notlarında hash yoksa sürümle birlikte yüklenen SHA256SUMS.txt
      // varlığından oku. Böylece güncelleme, release notu biçimine bağımlı kalmaz;
      // iki kaynak da aynı GitHub release'ine ait olduğu için güven seviyesi aynı.
      if (!sha256 && asset) {
        const sumsAsset = (data.assets || []).find((a) => /^SHA256SUMS(\.txt)?$/i.test(a.name || ''));
        if (sumsAsset && isAllowedUpdateUrl(sumsAsset.browser_download_url)) {
          try {
            const sumsResp = await fetch(sumsAsset.browser_download_url, {
              headers: { 'User-Agent': `DeepNode/${current}` },
              signal: AbortSignal.timeout(5000)
            });
            if (sumsResp.ok) {
              const text = await sumsResp.text();
              const want = asset.name.toLowerCase();
              const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => {
                const m = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(l);
                return m && m[2].trim().toLowerCase() === want;
              });
              const m = line ? /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line) : null;
              if (m) sha256 = m[1].toLowerCase();
            }
          } catch (e) { /* hash yoksa indirme yolu yine fail-closed kalır */ }
        }
      }
      res.json({
        current,
        latest,
        updateAvailable: !!(latest && compareVersions(latest, current) > 0),
        downloadUrl: asset ? asset.browser_download_url : '',
        notes: data.body || '',
        sha256
      });
    } catch (githubErr) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(UPDATE_MANIFEST_FALLBACK, {
          signal: controller.signal,
          headers: { 'User-Agent': `DeepNode/${current}` }
        });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const latest = data.version || '';
        const shaMatch = data.sha256 || data.checksum
          || ((data.body || data.notes || '').match(/(?:sha256|sha-256|checksum)[:\s=]+([a-fA-F0-9]{64})/i)
          || (data.body || data.notes || '').match(/([a-fA-F0-9]{64})\s+[*]?\S+\.exe/i))?.[1] || null;
        res.json({
          current,
          latest,
          updateAvailable: !!(latest && compareVersions(latest, current) > 0),
          downloadUrl: data.downloadUrl || '',
          notes: data.notes || '',
          sha256: shaMatch ? String(shaMatch).toLowerCase() : null
        });
      } catch (fallbackErr) {
        res.json({
          current,
          latest: null,
          updateAvailable: false,
          downloadUrl: '',
          notes: '',
          sha256: null,
          error: 'Could not reach the update server'
        });
      }
    }
  });

  router.get('/status', appOnly, (req, res) => res.json(state));

  router.post('/download', appOnly, async (req, res) => {
    const { url, sha256 } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Rastgele bir adresten çalıştırılabilir dosya indirilmesini engelle
    if (!isAllowedUpdateUrl(url)) {
      return res.status(400).json({ error: 'Update source is not allowed' });
    }
    if (state.status === 'downloading' || state.status === 'checking') {
      return res.status(409).json({ error: 'A download is already in progress' });
    }

    // Fail-closed: hash yoksa/geçersizse indirilen dosya asla "doğrulanmış"
    // sayılmaz. Aksi halde release notlarında hash bulunmayan her sürüm,
    // doğrulanmamış bir .exe'nin çalıştırılmasına izin verirdi.
    const expectedSha256 = typeof sha256 === 'string' ? sha256.trim().toLowerCase() : '';
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      const error = 'SHA-256 checksum is missing or invalid; refusing to download an unverified installer.';
      if (state.status !== 'ready') {
        state = { status: 'error', progress: 0, file: null, error, verified: false };
        emit();
      }
      return res.status(400).json({ error });
    }

    state = { status: 'checking', progress: 0, file: null, error: null, verified: false };

    if (!fs.existsSync(UPDATE_DIR)) fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const filePath = path.join(UPDATE_DIR, installerNameFrom(url));
    if (!isInsideDir(UPDATE_DIR, filePath)) {
      state = { status: 'idle', progress: 0, file: null, error: null, verified: false };
      return res.status(400).json({ error: 'Invalid installer name' });
    }
    const partPath = filePath + '.part';

    // Daha önce tamamlanmış indirmeyi yeniden kullan:
    // YALNIZCA diskteki dosya beklenen SHA-256 ile doğrulanırsa yeniden kullan.
    if (fs.existsSync(filePath)) {
      try {
        const head = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': `DeepNode/${appVersion()}` },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000)
        });
        const remoteSize = parseInt(head.headers.get('content-length') || '0', 10);
        const localSize = fs.statSync(filePath).size;
        if (head.ok && remoteSize > 0 && localSize === remoteSize) {
          const isSigned = await verifyInstallerSignature(filePath, expectedSha256);
          if (isSigned) {
            state = { status: 'ready', progress: 100, file: filePath, error: null, verified: true };
            emit();
            return res.json({ started: true, reused: true, file: filePath });
          }
        }
      } catch (err) {
        // doğrulama yapılamadı → yeniden indir
      }
      try { fs.unlinkSync(filePath); } catch (err) { /* dosya kilitli olabilir */ }
    }

    state = { status: 'downloading', progress: 0, file: filePath, error: null, verified: false };
    emit();
    res.json({ started: true, file: filePath });

    let fileStream = null;
    try {
      const controller = new AbortController();
      const downloadTimeout = setTimeout(() => controller.abort(), 10 * 60 * 1000);

      const response = await fetch(url, {
        headers: { 'User-Agent': `DeepNode/${appVersion()}` },
        redirect: 'follow',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
      fileStream = fs.createWriteStream(partPath);
      let streamError = null;
      // Yazma hatası döngü sürerken de gelebilir. Listener'ı döngüden ÖNCE bağla;
      // aksi halde dinleyicisiz 'error' süreci düşürür veya drain bekleyen route
      // sonsuza kadar asılı kalır ve uygulama yeniden başlatılana dek 409 döner.
      const streamFailed = new Promise((_, reject) => {
        fileStream.once('error', (err) => {
          streamError = err || new Error('Write stream failed');
          reject(streamError);
        });
      });
      streamFailed.catch(() => { /* aşağıdaki yarışlardan biri zaten yakalar */ });
      let downloaded = 0;
      let lastBroadcast = 0;

      for await (const chunk of response.body) {
        if (streamError) throw streamError;
        // Geri basınç: disk ağdan yavaşsa yazma kuyruğu bellekte birikmesin
        if (!fileStream.write(chunk)) {
          await Promise.race([
            new Promise((resolve) => fileStream.once('drain', resolve)),
            streamFailed
          ]);
        }
        downloaded += chunk.length;
        const progress = totalSize > 0 ? Math.round((downloaded / totalSize) * 100) : 0;
        const now = Date.now();
        if (progress !== state.progress && (now - lastBroadcast > 500 || progress === 100)) {
          state.progress = progress;
          emit();
          lastBroadcast = now;
        }
      }
      clearTimeout(downloadTimeout);

      await Promise.race([
        new Promise((resolve) => {
          fileStream.once('finish', resolve);
          fileStream.end();
        }),
        streamFailed
      ]);

      if (totalSize > 0 && downloaded !== totalSize) {
        throw new Error(`Incomplete download (${downloaded}/${totalSize})`);
      }

      fs.renameSync(partPath, filePath);
      const isSigned = await verifyInstallerSignature(filePath, expectedSha256);
      if (!isSigned) {
        try { fs.unlinkSync(filePath); } catch (e) {}
        throw new Error('Installer checksum or verification failed');
      }
      state = { status: 'ready', progress: 100, file: filePath, error: null, verified: true };
      emit();
    } catch (err) {
      if (fileStream && !fileStream.destroyed) {
        try { fileStream.destroy(); } catch (e) {}
      }
      try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch (e) { /* zaten yok */ }
      state = { status: 'error', progress: 0, file: null, error: err.message, verified: false };
      emit();
    }
  });

  router.post('/install', appOnly, (req, res) => {
    if (installing) {
      return res.status(409).json({ error: 'Installation is already in progress' });
    }
    const filePath = state.file;

    // Yalnızca BU oturumda, beyaz listedeki kaynaktan indirilip boyutu doğrulanmış
    // kurulum dosyası çalıştırılabilir.
    if (state.status !== 'ready' || !state.verified || !filePath) {
      return res.status(400).json({ error: 'No verified installer is ready' });
    }
    if (!isInsideDir(UPDATE_DIR, filePath) || !/\.exe$/i.test(filePath) || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Installer file not found' });
    }

    installing = true;
    res.json({ installing: true });

    const installer = spawn(filePath, ['/S'], { detached: true, stdio: 'ignore', shell: false });
    // Uygulamayı yalnız kurulum GERÇEKTEN başladıysa kapat. spawn hatasında
    // kapanmak kullanıcıyı kurulumsuz bırakıyordu.
    installer.once('spawn', () => {
      setTimeout(() => serverEvents.emit('quit-and-install'), 1500);
    });
    installer.once('error', (spawnErr) => {
      console.error('[Update] Failed to spawn installer:', spawnErr);
      installing = false; // kullanıcı tekrar deneyebilsin
    });
    installer.unref();
  });

  return router;
}
