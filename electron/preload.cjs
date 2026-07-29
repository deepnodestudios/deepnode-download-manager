// Renderer ↔ ana süreç köprüsü.
//
// TÜM pencereler (ana pencere, ekleme penceresi, ilerleme penceresi) artık
// `contextIsolation: true` + `nodeIntegration: false` ile çalışır. Eskiden
// ekleme/ilerleme pencereleri `nodeIntegration: true` + `contextIsolation: false`
// ile açılıyordu: bu pencerelerde oluşacak herhangi bir XSS doğrudan
// `require('child_process')` demekti (AI_Guidelines §5'in de yasakladığı yapı).
//
// Renderer artık Node'a hiç dokunmaz; yalnız aşağıdaki adı belli, dar API'yi
// kullanır. `.cjs` uzantısı zorunlu — kök package.json `"type": "module"`.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ddmNative', {
  // Liste sağ tık menüsü: pencereden BAĞIMSIZ yerel (native) OS menüsü açar.
  // items: [{ command, label, type?, checked?, enabled?, submenu? }]
  // Kullanıcının seçtiği "command" string'ini döndürür (seçmezse null).
  popupDownloadMenu: (items) => ipcRenderer.invoke('popup-download-menu', items),

  // Klasör seçme (yerel Windows 10/11 klasör iletişim kutusu)
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Çerçevesiz standalone pencere denetimleri
  closeWindow: () => ipcRenderer.send('close-add-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-add-window'),
  resizeWindow: (height) => ipcRenderer.send('resize-add-window', height),

  // Ana pencereyi öne getir
  bringToFront: () => ipcRenderer.send('bring-to-front'),

  // Harici bağlantıyı SİSTEM tarayıcısında aç (Electron penceresinde değil)
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Bu köprünün var olduğunu anlamak için (tarayıcıda çalışırken undefined)
  isElectron: true
});
