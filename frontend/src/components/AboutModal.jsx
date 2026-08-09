import React, { useState, useEffect, useRef } from 'react';
import { Mail, User, RefreshCw, CheckCircle, HardDriveDownload, Loader } from 'lucide-react';
import { useT, formatReleaseNotes } from '../i18n';

// "Hakkında" ekranı: sürüm bilgisi backend'den (/api/app/info) dinamik alınır,
// böylece her yeni derlemede elle güncelleme gerekmez.
// Güncelleme kontrolü: /api/update/check → uzak sürüm karşılaştırması.
// Otomatik güncelleme: /api/update/download + /api/update/install → uygulama içi indir & kur.
export default function AboutModal({ isOpen, onClose }) {
  const { t, lang } = useT();
  const [info, setInfo] = useState(null);
  const [updateState, setUpdateState] = useState('idle'); // idle | checking | available | upToDate | error
  const [updateData, setUpdateData] = useState(null);
  // Download progress state
  const [dlStatus, setDlStatus] = useState('idle'); // idle | downloading | ready | error
  const [dlProgress, setDlProgress] = useState(0);
  const [dlError, setDlError] = useState(null);
  const [installing, setInstalling] = useState(false);
  const wsRef = useRef(null);
  const installTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/app/info')
      .then(res => res.json())
      .then(data => setInfo(data || null))
      .catch(() => setInfo(null));
    // Otomatik kontrol: "Güncellemeleri Kontrol Et" düğmesini bekleme
    setUpdateState('checking');
    fetch('/api/update/check')
      .then(res => res.json())
      .then(data => {
        setUpdateData(data);
        if (data.error) setUpdateState('error');
        else if (data.updateAvailable) setUpdateState('available');
        else setUpdateState('upToDate');
      })
      .catch(() => { setUpdateState('error'); });
  }, [isOpen]);

  // Listen to WebSocket for UPDATE_PROGRESS events
  useEffect(() => {
    if (!isOpen) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}`);
    wsRef.current = ws;
    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'UPDATE_PROGRESS' && msg.payload) {
          const p = msg.payload;
          setDlStatus(p.status);
          setDlProgress(p.progress || 0);
          if (p.error) setDlError(p.error);
          // Auto-install when download completes (guard: only once per session,
          // "ready" birden fazla yayınlanırsa kurulum iki kez başlamasın)
          if (p.status === 'ready' && !installTriggeredRef.current) {
            installTriggeredRef.current = true;
            triggerInstall();
          }
        }
      } catch (e) { /* ignore */ }
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [isOpen]);

  const checkUpdate = async () => {
    setUpdateState('checking');
    setUpdateData(null);
    try {
      const res = await fetch('/api/update/check');
      const data = await res.json();
      setUpdateData(data);
      if (data.error) setUpdateState('error');
      else if (data.updateAvailable) setUpdateState('available');
      else setUpdateState('upToDate');
    } catch (e) {
      setUpdateState('error');
      setUpdateData({ error: t('err_conn') });
    }
  };

  const startDownload = async () => {
    if (!updateData?.downloadUrl) return;
    setDlStatus('downloading');
    setDlProgress(0);
    setDlError(null);
    try {
      const res = await fetch('/api/update/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: updateData.downloadUrl })
      });
      const data = await res.json();
      if (data.error) {
        setDlStatus('error');
        setDlError(data.error);
      }
    } catch (e) {
      setDlStatus('error');
      setDlError(t('err_dl_start'));
    }
  };

  const triggerInstall = async () => {
    setInstalling(true);
    try {
      await fetch('/api/update/install', { method: 'POST' });
    } catch (e) { /* app will quit anyway */ }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title"><span>{t('about_title')}</span></div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>×</button>
        </div>
        <div className="modal-body" style={{ textAlign: 'center' }}>
          <div
            className="brand-icon brand-icon-large"
            style={{ width: '72px', height: '72px', margin: '4px auto 12px' }}
          >
            <img src="/branding/deepnode-app-icon.png" alt="DeepNode Download Manager" />
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>
            {info?.name || 'DeepNode Download Manager'}
          </div>
          <div style={{ color: 'var(--text-muted)', marginTop: '4px', marginBottom: '18px' }}>
            {t('version')} {info?.version || '—'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', fontSize: '0.88rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <User size={15} />
              <span>{info?.developer || 'DeepNode Studios'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Mail size={15} />
              <a href={`mailto:${info?.email || 'deepnodestudios@gmail.com'}`} style={{ color: 'var(--primary-2)' }}>
                {info?.email || 'deepnodestudios@gmail.com'}
              </a>
            </div>
          </div>

          {/* Güncelleme kontrolü */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
            <button
              className="btn btn-secondary"
              onClick={checkUpdate}
              disabled={updateState === 'checking' || dlStatus === 'downloading' || installing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem' }}
            >
              <RefreshCw size={14} className={updateState === 'checking' ? 'dn-spin' : ''} />
              {updateState === 'checking' ? t('checking') : t('btn_check_update')}
            </button>

            {updateState === 'upToDate' && (
              <div style={{ marginTop: '10px', fontSize: '0.82rem', color: 'var(--success-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <CheckCircle size={14} /> {t('up_to_date')}
              </div>
            )}

            {updateState === 'available' && updateData && (
              <div className="panel-box" style={{ marginTop: '10px', fontSize: '0.82rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  {t('new_version')} <span style={{ color: 'var(--primary-2)' }}>v{updateData.latest}</span>
                </div>
                {updateData.notes && (
                  <ul style={{ color: 'var(--text-muted)', margin: '0 0 8px', paddingLeft: '18px', maxHeight: '96px', overflow: 'auto' }}>
                    {formatReleaseNotes(updateData.notes, lang).map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}

                {/* Download / Install states */}
                {dlStatus === 'idle' && (
                  <button className="btn btn-primary" onClick={startDownload} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}>
                    <HardDriveDownload size={14} /> {t('btn_download_install')}
                  </button>
                )}

                {dlStatus === 'downloading' && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: 'var(--text-muted)' }}>
                      <Loader size={13} className="dn-spin" /> {t('downloading_pct', { n: dlProgress })}
                    </div>
                    <div className="progress-bar-wrap">
                      <div className="progress-bar-fill" style={{ width: `${dlProgress}%` }} />
                    </div>
                  </div>
                )}

                {dlStatus === 'ready' && (
                  <div style={{ marginTop: '6px', color: 'var(--success-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <Loader size={13} className="dn-spin" /> {t('will_install')}
                  </div>
                )}

                {installing && (
                  <div style={{ marginTop: '6px', color: 'var(--warning)', fontSize: '0.8rem' }}>
                    {t('install_started')}
                  </div>
                )}

                {dlStatus === 'error' && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ color: 'var(--danger)', marginBottom: '6px' }}>{dlError || t('err_download')}</div>
                    <button className="btn btn-secondary" onClick={startDownload} style={{ fontSize: '0.78rem', padding: '4px 10px' }}>
                      {t('btn_retry')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {updateState === 'error' && (
              <div style={{ marginTop: '10px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                {updateData?.error || t('err_update_check')}
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>{t('btn_close')}</button>
        </div>
      </div>
    </div>
  );
}
