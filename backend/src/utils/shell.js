// Dosya/klasör açma — KABUK (shell) KULLANMADAN.
//
// Eskiden bu işler `exec()` ile string birleştirerek yapılıyordu:
//   exec(`explorer.exe /select,"${savePath}"`)
//   exec(`start "" "${savePath}"`)
// `savePath` sunucunun Content-Disposition başlığından veya kullanıcının
// "Yeniden Adlandır" girdisinden türediği için, içinde tırnak + `&` bulunan bir
// dosya adı KOMUT ENJEKSİYONUNA yol açıyordu (ör: `a" & calc.exe & ".zip`).
//
// Artık iki yol var:
//   1. Electron varsa `shell` API'si (kabuk yok, en güvenli). Backend Electron ana
//      süreci içinde çalıştığı için normal kullanımda daima bu yol seçilir.
//   2. Electron yoksa (backend tek başına `node src/server.js`) argümanları DİZİ
//      olarak alan `execFile` — kabuk ayrıştırması devrede olmadığından enjeksiyon
//      yine mümkün değildir.
import { execFile } from 'child_process';
import path from 'path';

let electronShell;
let electronChecked = false;

async function getElectronShell() {
  if (electronChecked) return electronShell;
  electronChecked = true;
  try {
    const electron = await import('electron');
    electronShell = electron.shell || (electron.default && electron.default.shell) || null;
  } catch (err) {
    electronShell = null; // Electron dışında çalışıyoruz
  }
  return electronShell;
}

function run(file, args) {
  // Windows Gezgini başarıda bile 1 dönebildiği için hata yalnız loglanır.
  execFile(file, args, { windowsHide: false }, (err) => {
    if (err && err.code === 'ENOENT') {
      console.error(`[shell] Komut bulunamadı: ${file}`);
    }
  });
}

/** Dosyayı içeren klasörü açar ve dosyayı seçili gösterir. */
export async function showItemInFolder(targetPath) {
  if (!targetPath) return;
  const shell = await getElectronShell();
  if (shell) return shell.showItemInFolder(path.normalize(targetPath));

  if (process.platform === 'win32') {
    return run('explorer.exe', [`/select,${path.win32.normalize(targetPath)}`]);
  }
  return openPath(path.dirname(targetPath));
}

/** Klasörü veya dosyayı varsayılan uygulamayla açar. */
export async function openPath(targetPath) {
  if (!targetPath) return;
  const shell = await getElectronShell();
  if (shell) return shell.openPath(path.normalize(targetPath));

  if (process.platform === 'win32') {
    return run('explorer.exe', [path.win32.normalize(targetPath)]);
  }
  if (process.platform === 'darwin') {
    return run('open', [targetPath]);
  }
  return run('xdg-open', [targetPath]);
}
