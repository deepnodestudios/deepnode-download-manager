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
