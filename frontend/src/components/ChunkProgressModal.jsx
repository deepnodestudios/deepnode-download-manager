import React from 'react';
import { X, Layers, Cpu, CheckCircle2, Play, Pause } from 'lucide-react';
import { useT } from '../i18n';

export default function ChunkProgressModal({ download, onClose, onStart, onPause }) {
  const { t } = useT();
  if (!download) return null;

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const percentTotal = download.totalSize > 0
    ? Math.round((download.downloadedBytes / download.totalSize) * 100)
    : 0;

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <Layers size={20} color="var(--link)" />
            <span>{t('chunk_title', { name: download.filename })}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Summary Panel */}
          <div className="panel-box" style={{ padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '0.85rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>{t('lbl_downloaded')} </span>
                <strong className="cell-strong">{formatBytes(download.downloadedBytes)} / {formatBytes(download.totalSize)}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>{t('lbl_speed')} </span>
                <strong style={{ color: 'var(--link)' }}>{formatBytes(download.speed)}/s</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>{t('lbl_segments')} </span>
                <strong style={{ color: 'var(--accent-2)' }}>{t('seg_threads', { n: download.segmentsCount || 8 })}</strong>
              </div>
            </div>

            <div style={{ marginTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '4px' }}>
                <span style={{ fontWeight: '600' }}>{t('total_progress')}</span>
                <span style={{ fontWeight: '700', color: 'var(--link)' }}>{t('pct', { n: percentTotal })}</span>
              </div>
              <div className="progress-bar-wrap" style={{ height: '10px' }}>
                <div className="progress-bar-fill" style={{ width: `${percentTotal}%` }}></div>
              </div>
            </div>
          </div>

          {/* Segment Chunks Grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Cpu size={16} color="var(--success-2)" />
              <span>{t('seg_section')}</span>
            </div>

            <div className="chunk-grid">
              {(download.segments || []).map((seg, idx) => {
                const segPercent = seg.total > 0 ? Math.round((seg.downloaded / seg.total) * 100) : 0;
                return (
                  <div key={idx} className="chunk-card">
                    <div className="chunk-title">
                      <span>{t('seg_n', { n: idx + 1 })}</span>
                      {seg.completed ? (
                        <span style={{ color: 'var(--success-2)', display: 'flex', alignItems: 'center', gap: '2px' }}>
                          <CheckCircle2 size={12} /> {t('seg_done')}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--link)' }}>{t('pct', { n: segPercent })}</span>
                      )}
                    </div>

                    <div className="progress-bar-wrap" style={{ height: '6px' }}>
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${segPercent}%`,
                          background: seg.completed
                            ? 'var(--success)'
                            : 'linear-gradient(90deg, var(--primary), var(--teal))'
                        }}
                      ></div>
                    </div>

                    <div style={{ fontSize: '0.68rem', color: 'var(--text-dark)', fontFamily: 'var(--font-mono)' }}>
                      {formatBytes(seg.downloaded)} / {formatBytes(seg.total)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {download.checksum && download.checksum !== 'N/A' && (
            <div className="info-strip info-strip-success" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', display: 'block' }}>
              <span style={{ color: 'var(--success-2)', fontWeight: '700' }}>{t('checksum')} </span>
              <span style={{ wordBreak: 'break-all' }}>{download.checksum}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {download.status === 'downloading' ? (
            <button className="btn btn-warning" onClick={() => onPause(download.id)}>
              <Pause size={16} /> {t('ctx_pause')}
            </button>
          ) : (
            <button className="btn btn-success" onClick={() => onStart(download.id)}>
              <Play size={16} /> {t('ctx_start')}
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>{t('btn_close')}</button>
        </div>
      </div>
    </div>
  );
}
