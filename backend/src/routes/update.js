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
const UPDATE_DIR = path.join(os.tmpdir(), 'DeepNodeUpdate');

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
      res.json({
        current,
        latest,
        updateAvailable: !!(latest && compareVersions(latest, current) > 0),
        downloadUrl: asset ? asset.browser_download_url : '',
        notes: data.body || ''
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
        res.json({
          current,
          latest,
          updateAvailable: !!(latest && compareVersions(latest, current) > 0),
          downloadUrl: data.downloadUrl || '',
          notes: data.notes || ''
        });
      } catch (fallbackErr) {
        res.json({
          current,
          latest: null,
          updateAvailable: false,
          downloadUrl: '',
          notes: '',
          error: 'Could not reach the update server'
        });
      }
    }
  });

  router.get('/status', appOnly, (req, res) => res.json(state));

  router.post('/download', appOnly, async (req, res) => {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Rastgele bir adresten çalıştırılabilir dosya indirilmesini engelle
    if (!isAllowedUpdateUrl(url)) {
      return res.status(400).json({ error: 'Update source is not allowed' });
    }
    if (state.status === 'downloading') {
      return res.status(409).json({ error: 'A download is already in progress' });
    }

    if (!fs.existsSync(UPDATE_DIR)) fs.mkdirSync(UPDATE_DIR, { recursive: true });
    const filePath = path.join(UPDATE_DIR, installerNameFrom(url));
    if (!isInsideDir(UPDATE_DIR, filePath)) {
      return res.status(400).json({ error: 'Invalid installer name' });
    }
    const partPath = filePath + '.part';

    // Daha önce tamamlanmış indirmeyi yeniden kullan: kurulum dosyası .part olarak
    // yazılır ve yalnız başarıda son adına taşınır, dolayısıyla filePath varsa
    // indirme bitmiştir. Boyut yine de sunucuyla doğrulanır (antivirüs karantinası).
    if (fs.existsSync(filePath)) {
      try {
        const head = await fetch(url, {
          method: 'HEAD',
          headers: { 'User-Agent': `DeepNode/${appVersion()}` },
          redirect: 'follow'
        });
        const remoteSize = parseInt(head.headers.get('content-length') || '0', 10);
        const localSize = fs.statSync(filePath).size;
        if (head.ok && remoteSize > 0 && localSize === remoteSize) {
          state = { status: 'ready', progress: 100, file: filePath, error: null, verified: true };
          emit();
          return res.json({ started: true, reused: true, file: filePath });
        }
      } catch (err) {
        // doğrulama yapılamadı → yeniden indir
      }
      try { fs.unlinkSync(filePath); } catch (err) { /* dosya kilitli olabilir */ }
    }

    state = { status: 'downloading', progress: 0, file: filePath, error: null, verified: false };
    emit();
    res.json({ started: true, file: filePath });

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': `DeepNode/${appVersion()}` },
        redirect: 'follow'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
      const fileStream = fs.createWriteStream(partPath);
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

      await new Promise((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
        fileStream.end();
      });

      if (totalSize > 0 && downloaded !== totalSize) {
        throw new Error(`Incomplete download (${downloaded}/${totalSize})`);
      }

      fs.renameSync(partPath, filePath);
      state = { status: 'ready', progress: 100, file: filePath, error: null, verified: true };
      emit();
    } catch (err) {
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
    installer.unref();

    setTimeout(() => serverEvents.emit('quit-and-install'), 1500);
  });

  return router;
}
