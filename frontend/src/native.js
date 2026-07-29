// Electron köprüsü (preload.cjs → window.ddmNative) için tek erişim noktası.
//
// Eskiden bileşenler doğrudan `window.require('electron')` çağırıyordu; bu
// yalnızca `nodeIntegration: true` olan pencerelerde çalışıyor, ana pencerede
// sessizce başarısız oluyordu (ör. klasör seçme PowerShell yedeğine düşüyordu).
// Artık tüm pencereler contextIsolation ile açıldığı için tek köprü var.
//
// Tarayıcıda (vite dev / normal sekme) köprü yoktur; fonksiyonlar `false`/`null`
// döndürür ve çağıran taraf web yedeğine düşer.

function bridge() {
  return (typeof window !== 'undefined' && window.ddmNative) || null;
}

export const isElectron = () => Boolean(bridge());

/** Yerel (native) OS sağ tık menüsü; seçilen komutu döndürür. */
export async function popupDownloadMenu(items) {
  const b = bridge();
  if (!b || !b.popupDownloadMenu) return null;
  return b.popupDownloadMenu(items);
}

/** Yerel klasör seçme kutusu. Köprü yoksa null → çağıran /api/select-folder'a düşer. */
export async function selectFolder() {
  const b = bridge();
  if (!b || !b.selectFolder) return null;
  try {
    return await b.selectFolder();
  } catch (err) {
    console.error('selectFolder failed:', err);
    return null;
  }
}

/** Çerçevesiz standalone pencereyi kapatır. Köprü yoksa window.close() denenir. */
export function closeWindow() {
  const b = bridge();
  if (b && b.closeWindow) { b.closeWindow(); return true; }
  if (typeof window !== 'undefined') window.close();
  return false;
}

export function minimizeWindow() {
  const b = bridge();
  if (!b || !b.minimizeWindow) return false;
  b.minimizeWindow();
  return true;
}

/** İçerik yüksekliğini ana sürece bildirir (pencere içeriğe göre boyutlanır). */
export function resizeWindow(height) {
  const b = bridge();
  if (!b || !b.resizeWindow || !Number.isFinite(height)) return false;
  b.resizeWindow(height);
  return true;
}

export function bringToFront() {
  const b = bridge();
  if (!b || !b.bringToFront) return false;
  b.bringToFront();
  return true;
}

/** Bağlantıyı sistem tarayıcısında açar (Electron penceresinde değil). */
export function openExternal(url) {
  const b = bridge();
  if (b && b.openExternal) { b.openExternal(url); return true; }
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
  return false;
}
