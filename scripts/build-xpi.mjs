// browser-extension klasörünü Firefox için İMZASIZ .xpi (zip) paketine çevirir.
// Çıktı: dist_exe/deepnode-extension-unsigned.xpi — AMO'ya imzalatmak için girdi.
// DİKKAT: browser-extension/deepnode-extension-firefox.xpi İMZALI dağıtım
// kopyasıdır (web-ext sign çıktısı), bu script onu EZMEZ.
// Not: Zip girişleri MUTLAKA ileri eğik çizgi (/) kullanmalı — Firefox
// ters eğik çizgili (\) girişleri reddedebilir (Compress-Archive tuzağı).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// archiver CJS paketi — ESM default interop'u sürüme göre bozulabiliyor, require ile yükle
const require = createRequire(import.meta.url);
const archiver = require('archiver');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(scriptDir, '..', 'browser-extension');
const outDir = path.join(scriptDir, '..', 'dist_exe');
const outFile = path.join(outDir, 'deepnode-extension-unsigned.xpi');
fs.mkdirSync(outDir, { recursive: true });

// README'ler, imzalı xpi ve gizli dosyalar (.amo-upload-uuid vb.) pakete girmez
const EXCLUDE = /^\.|\.(xpi|md)$/i;

function collectFiles(dir, base = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), rel));
    } else if (!EXCLUDE.test(entry.name)) {
      files.push(rel);
    }
  }
  return files;
}

const files = collectFiles(srcDir);
if (!files.includes('manifest.json')) {
  console.error('build-xpi: manifest.json bulunamadı, iptal.');
  process.exit(1);
}

const output = fs.createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

// Firefox paketi için manifest dönüşümü: background.service_worker Chrome içindir,
// Firefox yok sayıp AMO linter'ında uyarı üretir — xpi'ye girmeden çıkarılır.
const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
if (manifest.background) {
  delete manifest.background.service_worker;
  manifest.background.scripts = ['strings.js', 'background.js'];
}
if (manifest.browser_specific_settings && manifest.browser_specific_settings.gecko) {
  delete manifest.browser_specific_settings.gecko.update_url;
}

output.on('close', () => {
  console.log(`build-xpi: ${path.basename(outFile)} (v${manifest.version}, ${files.length} dosya, ${archive.pointer()} bayt)`);
});
archive.on('error', (err) => { throw err; });

archive.pipe(output);
for (const rel of files) {
  if (rel === 'manifest.json') {
    archive.append(JSON.stringify(manifest, null, 2) + '\n', { name: rel });
  } else {
    archive.file(path.join(srcDir, rel), { name: rel });
  }
}
archive.finalize();

// Create Chrome .zip
const chromeOutFile = path.join(outDir, 'deepnode-extension-chrome.zip');
const chromeOutput = fs.createWriteStream(chromeOutFile);
const chromeArchive = archiver('zip', { zlib: { level: 9 } });
chromeOutput.on('close', () => {
  console.log(`build-xpi: ${path.basename(chromeOutFile)} (${files.length} dosya, ${chromeArchive.pointer()} bayt)`);
});
chromeArchive.on('error', (err) => { throw err; });
chromeArchive.pipe(chromeOutput);
for (const rel of files) {
  chromeArchive.file(path.join(srcDir, rel), { name: rel });
}
chromeArchive.finalize();
