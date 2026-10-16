import React, { useState, useEffect } from 'react';
import { RefreshCw, X, Link, ExternalLink, Clipboard, AlertCircle, File, CheckCircle2 } from 'lucide-react';
import { useT } from '../i18n';
import { openExternal } from '../native';

function fmtBytes(b) {
  if (!b || b <= 0) return '0 B';
  const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1);
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
}

export default function RefreshUrlModal({ isOpen, onClose, download, onRefreshUrl }) {
  const { t } = useT();
  const [newUrl, setNewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedSuccess, setCopiedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen && download) {
      setNewUrl(download.url || '');
    } else {
      setNewUrl('');
      setCopiedSuccess(false);
    }
  }, [isOpen, download]);

  if (!isOpen || !download) return null;

  const percent = download.status === 'completed'
    ? 100
    : (typeof download.percent === 'number' && !isNaN(download.percent)
        ? Math.min(100, Math.max(0, Math.round(download.percent)))
        : (download.totalSize > 0 
            ? Math.min(100, Math.round((download.downloadedBytes / download.totalSize) * 100)) 
            : 0));

  const originUrl = download.referer || (download.headers && (download.headers.Referer || download.headers.referer)) || download.url;

  const handleOpenInBrowser = () => {
    if (originUrl) {
      openExternal(originUrl);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && /^https?:/i.test(text.trim())) {
        setNewUrl(text.trim());
        setCopiedSuccess(true);
        setTimeout(() => setCopiedSuccess(false), 2000);
      }
    } catch (e) { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = newUrl.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onRefreshUrl(download.id, trimmed);
      onClose();
    } catch (err) {
      console.error('Refresh URL failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', width: '92%' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={18} className="spin-slow text-accent" />
            <span>{t('refresh_modal_title')}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
          
          {/* File Card Info */}
          <div style={{
            background: 'var(--bg-secondary, rgba(255,255,255,0.04))',
            border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
            borderRadius: '8px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '34px',
                height: '34px',
                borderRadius: '6px',
                background: 'rgba(59,130,246,0.15)',
                color: '#60a5fa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <File size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-main, #f1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={download.filename}>
                  {download.filename}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted, #94a3b8)', display: 'flex', gap: '10px', marginTop: '2px' }}>
                  <span>{fmtBytes(download.downloadedBytes)} / {fmtBytes(download.totalSize)}</span>
                  <span>%{percent} {t('f_completed')}</span>
                  {download.status === 'error' && (
                    <span style={{ color: '#ef4444', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <AlertCircle size={11} /> {download.errorMsg || '403 / Süresi doldu'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div style={{
              width: '100%',
              height: '5px',
              borderRadius: '3px',
              background: 'rgba(255,255,255,0.08)',
              overflow: 'hidden',
              marginTop: '4px'
            }}>
              <div style={{
                width: `${percent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                transition: 'width 0.3s ease'
              }} />
            </div>
          </div>

          {/* 1. Yöntem: Tarayıcıda Aç */}
          {originUrl && (
            <div style={{
              background: 'rgba(59,130,246,0.06)',
              border: '1px solid rgba(59,130,246,0.2)',
              borderRadius: '8px',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#93c5fd' }}>
                  {t('refresh_browser_way_title') || '1. Yöntem: Tarayıcıda Sayfayı Açın'}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{
                    padding: '5px 12px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(59,130,246,0.2)',
                    borderColor: 'rgba(59,130,246,0.4)',
                    color: '#93c5fd'
                  }}
                  onClick={handleOpenInBrowser}
                >
                  <ExternalLink size={13} />
                  <span>{t('refresh_open_browser_btn') || 'Tarayıcıda Aç'}</span>
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted, #94a3b8)', lineHeight: '1.4' }}>
                {t('refresh_browser_hint') || 'Sayfayı tarayıcıda açıp indirmeyi tekrar başlattığınızda, DDM tarayıcı eklentisi yeni bağlantıyı otomatik yakalar ve indirmeyi kaldığı yerden devam ettirir.'}
              </p>
            </div>
          )}

          {/* 2. Yöntem: Manuel URL Girişi */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #cbd5e1)' }}>
                {originUrl ? (t('refresh_manual_way_title') || '2. Yöntem: Yeni Bağlantıyı Yapıştırın') : t('refresh_modal_label')}
              </label>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handlePasteClipboard}
                style={{ padding: '2px 6px', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', color: copiedSuccess ? '#22c55e' : 'var(--text-muted)' }}
              >
                {copiedSuccess ? <CheckCircle2 size={12} /> : <Clipboard size={12} />}
                <span>{copiedSuccess ? (t('copied') || 'Yapıştırıldı') : (t('paste_from_clipboard') || 'Panodan Yapıştır')}</span>
              </button>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Link size={15} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted, #64748b)' }} />
              <input
                type="text"
                className="form-input"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: '6px',
                  fontSize: '13px'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
            >
              {t('btn_cancel')}
            </button>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!newUrl.trim() || submitting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={14} className={submitting ? 'spin-slow' : ''} />
              <span>{t('refresh_modal_btn')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
