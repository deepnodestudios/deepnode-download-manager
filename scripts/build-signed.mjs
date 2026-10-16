import { execSync } from 'child_process';
import fs from 'fs';

if (fs.existsSync('deepnode_signing.pfx')) {
    process.env.CSC_LINK = 'deepnode_signing.pfx';
    // Şifre kökteki gitignore'lı dosyadan okunur; asla commit edilmez.
    if (fs.existsSync('imza_sifresi.txt')) {
        process.env.CSC_KEY_PASSWORD = fs.readFileSync('imza_sifresi.txt', 'utf8').trim();
    }
    if (!process.env.CSC_KEY_PASSWORD) {
        throw new Error('Signing password missing: put it in imza_sifresi.txt (repo root) or CSC_KEY_PASSWORD.');
    }
    console.log('Signing certificate found. Proceeding with signed build...');
} else {
    console.log('Signing certificate NOT found. Proceeding with unsigned build...');
}

execSync('npx electron-builder', { stdio: 'inherit' });

// Compute SHA-256 for produced installers and write SHA256SUMS.txt
import path from 'path';
import crypto from 'crypto';

const distDir = 'dist_exe';
if (fs.existsSync(distDir)) {
  const exes = fs.readdirSync(distDir).filter((f) => /\.exe$/i.test(f));
  const lines = [];
  for (const exe of exes) {
    const full = path.join(distDir, exe);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').toLowerCase();
    lines.push(`${hash}  ${exe}`);
    console.log(`sha256: ${hash} ${exe}`);
  }
  if (lines.length > 0) {
    fs.writeFileSync(path.join(distDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n', 'utf8');
    console.log(`[SHA256] Checksums saved to ${path.join(distDir, 'SHA256SUMS.txt')}`);
  }
}
