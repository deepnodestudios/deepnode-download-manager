import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, ArrowRight, Download, RefreshCw, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { useT, formatReleaseNotes } from '../i18n';
import { openExternal } from '../native';

export default function UpdateModal({ isOpen, onClose, updateData, currentVersion }) {
  const { t, lang } = useT();
  const [dlStatus, setDlStatus] = useState('idle'); // idle | downloading | ready | error
  const [dlProgress, setDlProgress] = useState(0);
  const [dlError, setDlError] = useState(null);
  const [installing, setInstalling] = useState(false);
  const wsRef = useRef(null);
  const installTriggeredRef = useRef(false);

  const dlStatusRef = useRef(dlStatus);
  useEffect(() => { dlStatusRef.current = dlStatus; }, [dlStatus]);

  // WebSocket ve Polling ile indirme ilerlemesini dinle
  useEffect(() => {
    if (!isOpen) return;

    // 1. İlk durumu ve periyodik durumu yokla
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/update/status');
        if (res.ok) {
          const p = await res.json();
          if (p.status && p.status !== 'idle') {
            setDlStatus(p.status);
            setDlProgress(p.progress || 0);
            if (p.error) {
              setDlError(p.error);
              installTriggeredRef.current = false;
            }
            if (p.status === 'ready' && !installTriggeredRef.current) {
              installTriggeredRef.current = true;
              triggerInstall();
            }
          }
        }
      } catch (e) {}
    };

    checkStatus();
    const pollInterval = setInterval(() => {
      if (dlStatusRef.current === 'downloading') {
        checkStatus();
      }
    }, 1000);

    // 2. Canlı WebSocket dinleyicisi
    let ws = null;
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${protocol}://${window.location.host}`);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'UPDATE_PROGRESS' && msg.payload) {
            const p = msg.payload;
            setDlStatus(p.status);
            setDlProgress(p.progress || 0);
            if (p.error) {
              setDlError(p.error);
              installTriggeredRef.current = false;
            }
            if (p.status === 'ready' && !installTriggeredRef.current) {
              installTriggeredRef.current = true;
              triggerInstall();
            }
          }
        } catch (e) { /* ignore */ }
      };
    } catch (e) {}

    return () => {
      clearInterval(pollInterval);
      if (ws) {
        try { ws.close(); } catch (e) {}
      }
      wsRef.current = null;
    };
  }, [isOpen]);

  const startDownload = async () => {
    if (!updateData?.downloadUrl) return;
    setDlStatus('downloading');
    setDlProgress(0);
    setDlError(null);
    installTriggeredRef.current = false;
    try {
      const res = await fetch('/api/update/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: updateData.downloadUrl, sha256: updateData.sha256 || undefined })
      });
      const data = await res.json();
      if (data.error) {
        setDlStatus('error');
        setDlError(data.error);
        installTriggeredRef.current = false;
      }
    } catch (e) {
      setDlStatus('error');
      setDlError(t('err_download'));
      installTriggeredRef.current = false;
    }
  };

  const triggerInstall = async () => {
    setInstalling(true);
    try {
      await fetch('/api/update/install', { method: 'POST' });
    } catch (e) {
      // Backend kapandığı için ağ kopması normaldir
    }
  };

  if (!isOpen || !updateData) return null;

  const rawNotes = updateData.notes || updateData.releaseNotes || '';
  const notes = formatReleaseNotes(rawNotes, lang);

  return (
    <div className="modal-overlay" onClick={installing ? undefined : onClose}>
      <div
        className="modal-box update-modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '520px', width: '92%' }}
      >
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} className="text-accent" color="var(--primary)" />
            <span>{t('update_modal_title') || 'DeepNode Download Manager Güncellemesi'}</span>
          </div>
          {!installing && (
            <button className="btn btn-ghost btn-icon" onClick={onClose} title={t('btn_close')}>
              <X size={18} />
            </button>
          )}
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Sürüm Bilgi Kartı */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(41, 121, 255, 0.12), rgba(45, 225, 194, 0.08))',
              border: '1px solid rgba(41, 121, 255, 0.25)',
              borderRadius: '12px',
              padding: '12px 16px'
            }}
          >
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {t('update_available') || 'Yeni sürüm mevcut:'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>
                  v{currentVersion || updateData.current || '—'}
                </span>
                <ArrowRight size={14} color="var(--primary)" />
                <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-strong)' }}>
                  v{updateData.latest}
                </span>
              </div>
            </div>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                background: 'rgba(41, 121, 255, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Download size={22} color="var(--primary)" />
            </div>
          </div>

          {/* Sürüm Notları (Neler Yeni?) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-muted)' }}>
                {t('whats_new') || 'Neler Yeni?'}
              </span>
              {updateData.latest && (
                <a
                  href={`https://github.com/deepnodestudios/deepnode-download-manager/releases/tag/v${updateData.latest}`}
                  onClick={(e) => {
                    e.preventDefault();
                    openExternal(e.currentTarget.href);
                  }}
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--link)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    textDecoration: 'none'
                  }}
                >
                  {t('release_notes') || 'Sürüm Notları'} <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div
              className="about-notes"
              style={{
                maxHeight: '160px',
                overflowY: 'auto',
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '0.8rem',
                lineHeight: '1.5',
                color: 'var(--text-muted)'
              }}
            >
              {Array.isArray(notes) && notes.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: '18px' }}>
                  {notes.map((line, i) => (
                    <li key={i} style={{ marginBottom: '4px' }}>{line}</li>
                  ))}
                </ul>
              ) : (
                <div>{typeof notes === 'string' && notes ? notes : (t('up_to_date') || 'Hata düzeltmeleri ve performans iyileştirmeleri.')}</div>
              )}
            </div>
          </div>

          {/* İndirme & Kurulum İlerleme Çubuğu */}
          {dlStatus === 'downloading' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text)' }}>
                <span>{t('downloading_pct', { n: dlProgress }) || `İndiriliyor... %${dlProgress}`}</span>
                <span>{t('pct', { n: dlProgress }) || `${dlProgress}%`}</span>
              </div>
              <div className="progress-bar-wrap" style={{ height: '8px' }}>
                <div
                  className="progress-bar-fill"
                  style={{ width: `${dlProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Kuruluma Hazır / Kuruluyor Durumu */}
          {(dlStatus === 'ready' || installing) && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                padding: '10px 12px',
                borderRadius: '8px',
                color: 'var(--success-2)',
                fontSize: '0.82rem'
              }}
            >
              <CheckCircle2 size={16} />
              <span>{t('install_started') || 'Kurulum başlatıldı. Uygulama güncellenip yeniden başlatılacak...'}</span>
            </div>
          )}

          {/* Hata Durumu */}
          {dlStatus === 'error' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '10px 12px',
                borderRadius: '8px',
                color: 'var(--danger)',
                fontSize: '0.82rem'
              }}
            >
              <AlertCircle size={16} />
              <span>{dlError || t('err_download')}</span>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {dlStatus === 'error' ? (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                {t('btn_close')}
              </button>
              <button className="btn btn-primary" onClick={startDownload}>
                <RefreshCw size={14} /> {t('btn_retry')}
              </button>
            </>
          ) : dlStatus === 'downloading' || installing ? (
            <button className="btn btn-primary" disabled style={{ opacity: 0.7 }}>
              <RefreshCw size={14} className="dn-spin" /> {t('checking') || 'İşleniyor...'}
            </button>
          ) : (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                {t('remind_later') || 'Daha Sonra'}
              </button>
              <button className="btn btn-primary" onClick={startDownload} autoFocus>
                <Download size={15} /> {t('btn_update_now') || 'Şimdi Güncelle'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
