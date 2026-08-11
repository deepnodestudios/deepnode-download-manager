import React, { useEffect, useRef, useState } from 'react';
import { X, Minus, FolderOpen, FileText, Loader, CheckCircle2, GripHorizontal } from 'lucide-react';
import { useT } from '../i18n';
import { closeWindow, minimizeWindow, resizeWindow } from '../native';

// IDM tarzı "İndirme Tamamlandı" diyaloğu (mode=complete&id=...).
// İndirme bitince Electron tarafı bu pencereyi açar: dosya bilgisi, adres,
// kaydedilen yol ve Aç / Klasörü Aç / Kapat butonları — IDM'in klasik
// "Download complete" penceresinin birebir karşılığı.
export default function DownloadCompleteWindow({ download }) {
  const { t } = useT();
  const boxRef = useRef(null);
  const [dontShow, setDontShow] = useState(false);

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // İçeriğin doğal yüksekliğini Electron'a bildir (ilerleme penceresiyle aynı desen)
  const sendWindowSize = () => {
    const el = boxRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height) + 16;
    if (h > 60) resizeWindow(h);
  };
  useEffect(() => { sendWindowSize(); });
  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(() => sendWindowSize());
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (download) document.title = '✓ ' + (download.filename || '');
  }, [download]);

  // IDM davranışı: dosyayı/klasörü açma işlemi işletim sistemine devredildiğinde
  // diyalog kapanır (Firefox/Chrome'daki "Open/Reveal kapatır" deseni).
  const act = (action) =>
    fetch(`/api/download/${download.id}/${action}`, { method: 'POST' })
      .then((res) => { if (res.ok) closeWindow(); })
      .catch(() => {});

  // "Bu pencereyi bir daha gösterme" — ayara yazılır, sonraki indirmelerde diyalog açılmaz
  const toggleDontShow = (checked) => {
    setDontShow(checked);
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showCompleteDialog: !checked })
    }).catch(() => {});
  };

  const bytesNum = download && download.totalSize > 0 ? download.totalSize : 0;

  return (
    <div className="standalone-add-container" style={{ padding: '8px' }}>
      <div ref={boxRef} style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ minWidth: 0 }}>
            <CheckCircle2 size={18} color="var(--success-2)" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t('prog_done_title')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn btn-ghost btn-icon" onClick={minimizeWindow} title={t('btn_minimize')} aria-label={t('btn_minimize')}>
              <Minus size={18} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={closeWindow} title={t('btn_close')} aria-label={t('btn_close')}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ overflow: 'visible' }}>
          {!download ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
              <Loader size={16} className="dn-spin" /> {t('prog_loading')}
            </div>
          ) : (
            <>
              {/* Üst blok: yeşil onay + "İndirme Tamamlandı" + indirilen boyut (IDM üst satırı) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div className="dl-complete-check" style={{ width: '44px', height: '44px', flexShrink: 0 }}>
                  <CheckCircle2 size={26} />
                </div>
                <div style={{ minWidth: 0 }}>
                  {/* Üst satır: dosya adı (başlıkta zaten "İndirme Tamamlandı" var, burada tekrar etme) */}
                  <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={download.filename || ''}>
                    {download.filename || t('prog_done_title')}
                  </div>
                  {bytesNum > 0 && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--success-2)' }}>
                      {t('done_downloaded', { size: formatBytes(bytesNum), bytes: bytesNum.toLocaleString() })}
                    </div>
                  )}
                </div>
              </div>

              {/* Adres (IDM "Address") */}
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{t('done_address')}</label>
                <input className="form-input" type="text" readOnly value={download.url || ''} title={download.url || ''}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }} onFocus={(e) => e.target.select()} />
              </div>

              {/* Kaydedilen yol (IDM "The file saved as") */}
              <div className="form-group">
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{t('done_saved_as')}</label>
                <input className="form-input" type="text" readOnly value={download.savePath || ''} title={download.savePath || ''}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }} onFocus={(e) => e.target.select()} />
              </div>

              {/* "Bu pencereyi bir daha gösterme" (IDM "Don't show this dialog again") */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={dontShow} onChange={(e) => toggleDontShow(e.target.checked)} />
                {t('done_dont_show')}
              </label>
            </>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
        </div>
      </div>
    </div>
  );
}
