import re
import os

# 1. Update electron/main.js
with open("electron/main.js", "r", encoding="utf-8") as f:
    main_content = f.read()

if "ipcMain.on('start-drag'" not in main_content:
    # Need to add nativeImage to imports if not there
    if "nativeImage" not in main_content:
        main_content = main_content.replace(
            "import { app, BrowserWindow, Tray, Menu, clipboard, Notification, ipcMain, dialog, shell, screen } from 'electron';",
            "import { app, BrowserWindow, Tray, Menu, clipboard, Notification, ipcMain, dialog, shell, screen, nativeImage } from 'electron';"
        )
    
    drag_code = """
ipcMain.on('start-drag', (e, filePath) => {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    let dragIcon = nativeImage.createFromPath(iconPath);
    if (!dragIcon.isEmpty()) {
      dragIcon = dragIcon.resize({ width: 32, height: 32 });
    }
    e.sender.startDrag({
      file: filePath,
      icon: dragIcon
    });
  } catch (err) {
    console.error('Drag failed:', err);
  }
});
"""
    # Insert before last line
    main_content += drag_code
    with open("electron/main.js", "w", encoding="utf-8") as f:
        f.write(main_content)
    print("Updated main.js")

# 2. Update electron/preload.cjs
with open("electron/preload.cjs", "r", encoding="utf-8") as f:
    preload_content = f.read()

if "startDrag:" not in preload_content:
    preload_content = preload_content.replace(
        "isElectron: true",
        "startDrag: (filePath) => ipcRenderer.send('start-drag', filePath),\n  isElectron: true"
    )
    with open("electron/preload.cjs", "w", encoding="utf-8") as f:
        f.write(preload_content)
    print("Updated preload.cjs")

# 3. Update frontend/src/components/DownloadList.jsx
with open("frontend/src/components/DownloadList.jsx", "r", encoding="utf-8") as f:
    list_content = f.read()

old_tr = """<tr
                key={item.id}
                className={`${isSelected ? 'row-selected' : ''} ${isFocused ? 'row-focused' : ''}`}
                onClick={(e) => handleRowClick(e, index, item)}
                onContextMenu={(e) => { if (!isSelected) { handleRowClick(e, index, item); } showMenu(e, item); }}
                onDoubleClick={() => { if (item.status === 'completed') onOpenFile && onOpenFile(item.id); }}
                style={{ cursor: 'pointer' }}
                title={item.status === 'completed' ? t('tip_dblclick_open') : undefined}
              >"""

new_tr = """<tr
                key={item.id}
                className={`${isSelected ? 'row-selected' : ''} ${isFocused ? 'row-focused' : ''}`}
                onClick={(e) => handleRowClick(e, index, item)}
                onContextMenu={(e) => { if (!isSelected) { handleRowClick(e, index, item); } showMenu(e, item); }}
                onDoubleClick={() => { if (item.status === 'completed') onOpenFile && onOpenFile(item.id); }}
                style={{ cursor: 'pointer' }}
                title={item.status === 'completed' ? t('tip_dblclick_open') : undefined}
                draggable={item.status === 'completed'}
                onDragStart={(e) => {
                  if (item.status === 'completed' && window.ddmNative && window.ddmNative.startDrag && item.savePath) {
                    e.preventDefault();
                    window.ddmNative.startDrag(item.savePath);
                  }
                }}
              >"""

list_content = list_content.replace(old_tr, new_tr)
with open("frontend/src/components/DownloadList.jsx", "w", encoding="utf-8") as f:
    f.write(list_content)
print("Updated DownloadList.jsx")

# 4. Update frontend/src/components/DownloadCompleteWindow.jsx
with open("frontend/src/components/DownloadCompleteWindow.jsx", "r", encoding="utf-8") as f:
    comp_content = f.read()

if "GripHorizontal" not in comp_content:
    comp_content = comp_content.replace(
        "from 'lucide-react';",
        ", GripHorizontal } from 'lucide-react';"
    )
    
    old_footer = """<div className="modal-footer">
          {download && (
            <>
              <button className="btn btn-success" onClick={() => act('open')}>
                <FileText size={15} /> {t('ctx_open')}
              </button>
              <button className="btn btn-secondary" onClick={() => act('reveal')}>
                <FolderOpen size={15} /> {t('ctx_open_folder')}
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={closeWindow}>{t('btn_close')}</button>
        </div>"""
        
    new_footer = """<div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {download && (
              <>
                <button className="btn btn-success" onClick={() => act('open')}>
                  <FileText size={15} /> {t('ctx_open')}
                </button>
                <button className="btn btn-secondary" onClick={() => act('reveal')}>
                  <FolderOpen size={15} /> {t('ctx_open_folder')}
                </button>
              </>
            )}
            <button className="btn btn-secondary" onClick={closeWindow}>{t('btn_close')}</button>
          </div>
          
          {download && download.savePath && (
            <div
              draggable
              onDragStart={(e) => {
                if (window.ddmNative && window.ddmNative.startDrag) {
                  e.preventDefault();
                  window.ddmNative.startDrag(download.savePath);
                }
              }}
              title={t('tip_drag_file') || 'Sürükleyip bırak'}
              style={{
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '32px',
                height: '32px',
                background: 'var(--bg-hover)',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                marginLeft: 'auto'
              }}
            >
              <GripHorizontal size={18} color="var(--text-muted)" />
            </div>
          )}
        </div>"""
    comp_content = comp_content.replace(old_footer, new_footer)
    with open("frontend/src/components/DownloadCompleteWindow.jsx", "w", encoding="utf-8") as f:
        f.write(comp_content)
    print("Updated DownloadCompleteWindow.jsx")
