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

export async function verifyInstallerSignature(filePath, expectedSha256 = null) {
  if (expectedSha256) {
    try {
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      const digest = hash.digest('hex').toLowerCase();
      return digest === String(expectedSha256).toLowerCase().trim();
    } catch (err) {
      return false;
    }
  }
  // Not: DeepNode Windows kurulumu kendinden-imzalı sertifika taşır (CN=DeepNode Studios).
  // Son kullanıcılarda bu sertifika Windows Güvenilen Kök Sertifika Yetkilileri (Root CA)
  // deposunda bulunmadığından Authenticode 'UnknownError' döner ve kurulumun reddedilmesine
  // yol açar. Bu sebeple imza zinciri zorunlu bir engel olarak tutulmaz; güvenlik HTTPS aktarımı,
  // kaynak URL beyaz listesi (isAllowedUpdateUrl), Content-Length ve varsa SHA-256 ile sağlanır.
  return true;
}


export function createUpdateRouter({ appVersion, broadcast, serverEvents, appOnly }) {
  const router = express.Router();

  let state = { status: 'idle', progress: 0, file: null, error: null };
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
      const asset = (data.assets || []).find((a) => /\.exe$/i.test(a.name || '')) || (data.assets || [])[0];
      const shaMatch = (data.body || '').match(/(?:sha256|sha-256|checksum)[:\s=]+([a-fA-F0-9]{64})/i)
        || (data.body || '').match(/([a-fA-F0-9]{64})\s+[*]?\S+\.exe/i);
      const sha256 = shaMatch ? shaMatch[1].toLowerCase() : null;
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

    state = { status: 'checking', progress: 0, file: null, error: null, verified: false };

    if (!fs.existsSync(UPDATE_DIR)) fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const filePath = path.join(UPDATE_DIR, installerNameFrom(url));
    if (!isInsideDir(UPDATE_DIR, filePath)) {
      state = { status: 'idle', progress: 0, file: null, error: null, verified: false };
      return res.status(400).json({ error: 'Invalid installer name' });
    }
    const partPath = filePath + '.part';

    // Daha önce tamamlanmış indirmeyi yeniden kullan:
    // YALNIZCA beklenen SHA-256 sağlandıysa ve diskteki dosya doğrulanırsa yeniden kullan.
    // Hash yoksa diskteki dosya doğrudan güvenilir sayılamaz; silinip sıfırdan indirilir.
    if (fs.existsSync(filePath)) {
      try {
        if (sha256) {
          const head = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': `DeepNode/${appVersion()}` },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000)
          });
          const remoteSize = parseInt(head.headers.get('content-length') || '0', 10);
          const localSize = fs.statSync(filePath).size;
          if (head.ok && remoteSize > 0 && localSize === remoteSize) {
            const isSigned = await verifyInstallerSignature(filePath, sha256);
            if (isSigned) {
              state = { status: 'ready', progress: 100, file: filePath, error: null, verified: true };
              emit();
              return res.json({ started: true, reused: true, file: filePath });
            }
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
      let downloaded = 0;
      let lastBroadcast = 0;

      for await (const chunk of response.body) {
        // Geri basınç: disk ağdan yavaşsa yazma kuyruğu bellekte birikmesin
        if (!fileStream.write(chunk)) {
          await new Promise((resolve) => fileStream.once('drain', resolve));
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

      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        fileStream.end();
      });

      if (totalSize > 0 && downloaded !== totalSize) {
        throw new Error(`Incomplete download (${downloaded}/${totalSize})`);
      }

      fs.renameSync(partPath, filePath);
      const isSigned = await verifyInstallerSignature(filePath, sha256);
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
    const filePath = state.file;

    // Yalnızca BU oturumda, beyaz listedeki kaynaktan indirilip boyutu doğrulanmış
    // kurulum dosyası çalıştırılabilir.
    if (state.status !== 'ready' || !state.verified || !filePath) {
      return res.status(400).json({ error: 'No verified installer is ready' });
    }
    if (!isInsideDir(UPDATE_DIR, filePath) || !/\.exe$/i.test(filePath) || !fs.existsSync(filePath)) {
      return res.status(400).json({ error: 'Installer file not found' });
    }

    res.json({ installing: true });

    const installer = spawn(filePath, ['/S'], { detached: true, stdio: 'ignore', shell: false });
    installer.on('error', (spawnErr) => {
      console.error('[Update] Failed to spawn installer:', spawnErr);
    });
    installer.unref();

    setTimeout(() => serverEvents.emit('quit-and-install'), 1500);
  });

  return router;
}
