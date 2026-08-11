import { execSync } from 'child_process';
import fs from 'fs';

if (fs.existsSync('deepnode_signing.pfx')) {
    process.env.CSC_LINK = 'deepnode_signing.pfx';
    process.env.CSC_KEY_PASSWORD = 'DeepNodeSign2026!';
    console.log('Signing certificate found. Proceeding with signed build...');
} else {
    console.log('Signing certificate NOT found. Proceeding with unsigned build...');
}

execSync('npx electron-builder', { stdio: 'inherit' });
