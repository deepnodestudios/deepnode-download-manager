import React, { useEffect, useRef } from 'react';
import { X, Minus, Download, Pause, Play, FolderOpen, FileText, Loader, Check } from 'lucide-react';
import { useT } from '../i18n';
import { closeWindow, minimizeWindow, resizeWindow } from '../native';

// IDM tarzı bağımsız indirme ilerleme penceresi (mode=progress&id=...).
// İndirme verisi App'in WS aboneliğinden prop olarak gelir; pencere içeriğe göre
// otomatik boyutlanır (AddDownloadModal ile aynı resize-add-window IPC deseni).
export default function DownloadProgressWindow({ download, settings }) {
  const { t } = useT();
  const boxRef = useRef(null);

  const formatBytes = (bytes) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatEta = (sec) => {
    if (!sec || sec <= 0 || !Number.isFinite(sec)) return '-';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return t('fmt_eta', { m, s: (s < 10 ? '0' : '') + s });
  };

  const handleClose = () => closeWindow();
  const handleMinimize = () => minimizeWindow();

  // İçeriğin doğal yüksekliğini Electron'a bildir (kutu yükseklik kısıtı taşımaz)
  const sendWindowSize = () => {
    const el = boxRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height) + 16; // 8px üst+alt padding
    if (h > 60) resizeWindow(h);
  };
  useEffect(() => { sendWindowSize(); });
  useEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(() => sendWindowSize());
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  const percent = download
    ? (download.status === 'completed'
        ? 100
        : (download.totalSize > 0
            ? Math.min(100, Math.round((download.downloadedBytes / download.totalSize) * 100))
            : 0))
    : 0;

  // Görev çubuğunda ilerleme görünsün: "45% - dosya.zip"
  useEffect(() => {
    if (download) {
      document.title = (download.status === 'completed' ? '✓ ' : percent + '% - ') + (download.filename || '');
    }
  }, [download, percent]);

  const isActive = download && (download.status === 'downloading' || download.status === 'merging');
  const isDone = download && download.status === 'completed';

  // IDM davranışı: tamamlanınca ayrı "İndirme Tamamlandı" diyaloğu açılır
  // (Electron download-completed ile). Diyalog etkinse bu pencere kendini kapatır;
  // diyalog kapatılmışsa ("bir daha gösterme") burada tamamlanma paneli kalır.
  useEffect(() => {
    if (isDone && settings && settings.showCompleteDialog !== false) {
      const timer = setTimeout(() => closeWindow(), 600);
      return () => clearTimeout(timer);
    }
  }, [isDone, settings]);

  const act = (action) => fetch(`/api/download/${download.id}/${action}`, { method: 'POST' }).catch(() => {});

  // Tamamlanma panelindeki Aç / Klasörü Aç: işletim sistemine devredince pencere kapanır (IDM davranışı).
  const actAndClose = (action) =>
    fetch(`/api/download/${download.id}/${action}`, { method: 'POST' })
      .then((res) => { if (res.ok) closeWindow(); })
      .catch(() => {});

  const rows = download ? [
    [t('lbl_status'), t('st_' + download.status) , download.status === 'error' ? 'var(--danger)' : (isDone ? 'var(--success-2)' : 'var(--link)')],
    [t('lbl_file_size'), download.totalSize > 0 ? formatBytes(download.totalSize) : '-'],
    [t('lbl_downloaded'), `${formatBytes(download.downloadedBytes)} (${t('pct', { n: percent })})`],
    [t('lbl_transfer_rate'), isActive ? formatBytes(download.speed) + '/s' : '-'],
    [t('lbl_time_left'), isActive ? formatEta(download.eta) : '-']
  ] : [];

  return (
    <div className="standalone-add-container" style={{ padding: '8px' }}>
      <div ref={boxRef} style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ minWidth: 0 }}>
            <Download size={18} color="var(--primary-2)" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {download ? download.filename : t('prog_title')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="btn btn-ghost btn-icon" onClick={handleMinimize} title={t('btn_minimize')} aria-label={t('btn_minimize')}>
              <Minus size={18} />
            </button>
            <button className="btn btn-ghost btn-icon" onClick={handleClose} title={t('btn_close')} aria-label={t('btn_close')}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ overflow: 'visible' }}>
          {!download ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '12px 0' }}>
              <Loader size={16} className="dn-spin" /> {t('prog_loading')}
            </div>
          ) : isDone ? (
            /* IDM tarzı tamamlanma görünümü: animasyonlu onay işareti + dosya bilgisi */
            <div className="dl-complete-panel">
              <div className="dl-complete-check">
                <Check size={30} strokeWidth={3} />
              </div>
              <div className="dl-complete-title">{t('prog_done_title')}</div>
              <div className="dl-complete-file" title={download.filename}>{download.filename}</div>
              {download.totalSize > 0 && (
                <div className="dl-complete-size">{formatBytes(download.totalSize)}</div>
              )}
            </div>
          ) : (
            <>
              {/* URL satırı */}
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem', alignItems: 'baseline', minWidth: 0 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: '600', flexShrink: 0 }}>URL:</span>
                <span style={{ color: 'var(--text-dark)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={download.url}>
                  {download.url}
                </span>
              </div>

              {/* Bilgi satırları (IDM benzeri etiket/değer) */}
              <div className="panel-box" style={{ padding: '8px 12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '14px', rowGap: '4px', fontSize: '0.8rem' }}>
                  {rows.map(([label, value, color], i) => (
                    <React.Fragment key={i}>
                      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', color: color || 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</strong>
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Toplam ilerleme çubuğu */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '4px' }}>
                  <span style={{ fontWeight: '600' }}>{t('total_progress')}</span>
                  <span style={{ fontWeight: '700', color: isDone ? 'var(--success-2)' : 'var(--link)' }}>{t('pct', { n: percent })}</span>
                </div>
                <div className="progress-bar-wrap" style={{ height: '12px' }}>
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${percent}%`, background: isDone ? 'var(--success)' : undefined }}
                  ></div>
                </div>
              </div>

              {/* Segment mini şeridi (çok parçalı indirmede) */}
              {Array.isArray(download.segments) && download.segments.length > 1 && (
                <div style={{ display: 'flex', gap: '3px' }}>
                  {download.segments.map((seg, i) => {
                    const p = seg.total > 0 ? Math.min(100, Math.round((seg.downloaded / seg.total) * 100)) : 0;
                    return (
                      <div key={i} className="progress-bar-wrap" style={{ height: '5px', flex: 1 }}>
                        <div className="progress-bar-fill" style={{ width: `${p}%`, background: seg.completed ? 'var(--success)' : undefined }}></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          {download && isDone && (
            <>
              <button className="btn btn-success" onClick={() => actAndClose('open')}>
                <FileText size={15} /> {t('ctx_open')}
              </button>
              <button className="btn btn-secondary" onClick={() => actAndClose('reveal')}>
                <FolderOpen size={15} /> {t('ctx_open_folder')}
              </button>
            </>
          )}
          {download && !isDone && download.status !== 'error' && (
            isActive || download.status === 'queued' ? (
              <button className="btn btn-warning" onClick={() => act('pause')}>
                <Pause size={15} /> {t('ctx_pause')}
              </button>
            ) : (
              <button className="btn btn-success" onClick={() => act('start')}>
                <Play size={15} /> {t('ctx_start')}
              </button>
            )
          )}
          <button className="btn btn-secondary" onClick={handleClose}>{t('btn_close')}</button>
        </div>
      </div>
    </div>
  );
}
