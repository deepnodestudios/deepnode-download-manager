import re
with open('browser-extension/content.js', 'r', encoding='utf-8') as f:
    code = f.read()

mask_code = '''
// --- Bypass Tuşu Maskeleme ---
// Kullanıcı Alt tuşuna basılı tutarak DDM\\'yi atlamak istediğinde, Alt+Tık
// kombinasyonu tarayıcının yerleşik davranışlarını tetikler (href indirmesi gibi)
// veya sitenin JS tabanlı tıklama olaylarını (event.altKey) bozar.
// Bunu önlemek için Alt tuşuna basılarak yapılan tıklamaları yakalayıp,
// sanki Alt tuşuna basılmamış gibi (maskeleyerek) siteye normal bir tıklama gönderiyoruz.
let bypassKeySettings = 'Alt';
if (dnCtxValid()) {
  chrome.storage.local.get({ bypassKey: 'Alt' }, (v) => { bypassKeySettings = v.bypassKey; });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.bypassKey) bypassKeySettings = changes.bypassKey.newValue;
});

function maskBypassClick(e) {
  if (!e.isTrusted || e.type !== 'click' || e.button !== 0) return;
  if (!bypassKeySettings || bypassKeySettings === 'None') return;
  
  // Sadece Alt tuşunu maskeliyoruz (Ctrl veya Shift tarayıcı sekme davranışlarını bozmamak için)
  if (bypassKeySettings === 'Alt' && e.altKey) {
    // Tıklanabilir bir eleman mı kontrol et
    const path = e.composedPath ? e.composedPath() : [];
    const isClickable = path.some(el => el.tagName === 'A' || el.tagName === 'BUTTON' || el.role === 'button');
    if (!isClickable) return;

    // Orijinal Alt+Tık olayını iptal et (Tarayıcının yerleşik indirme tepkisini ve sitenin JS'ini durdur)
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Siteye, Alt tuşunun olmadığı sahte (ama birebir aynı) bir tıklama olayı gönder
    const fake = new MouseEvent('click', {
      bubbles: e.bubbles, cancelable: e.cancelable, view: e.view, detail: e.detail,
      screenX: e.screenX, screenY: e.screenY, clientX: e.clientX, clientY: e.clientY,
      ctrlKey: e.ctrlKey, altKey: false, shiftKey: e.shiftKey, metaKey: e.metaKey,
      button: e.button, buttons: e.buttons
    });
    e.target.dispatchEvent(fake);
  }
}
window.addEventListener('click', maskBypassClick, true);
// -----------------------------
'''

if 'maskBypassClick' not in code:
    # Insert after window.addEventListener('blur', ...)
    match = re.search(r'window\.addEventListener\(\\'blur\\', \(\) => \{[^\}]+\}\);\s*', code)
    if match:
        new_code = code[:match.end()] + '\n' + mask_code + '\n' + code[match.end():]
        with open('browser-extension/content.js', 'w', encoding='utf-8') as f:
            f.write(new_code)
        print('Injected successfully!')
    else:
        print('Could not find injection point.')
else:
    print('Already injected.')

