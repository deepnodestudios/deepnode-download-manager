import React, { useState, useEffect } from 'react';
import { RefreshCw, X, Link } from 'lucide-react';
import { useT } from '../i18n';

export default function RefreshUrlModal({ isOpen, onClose, download, onRefreshUrl }) {
  const { t } = useT();
  const [newUrl, setNewUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && download) {
      setNewUrl(download.url || '');
    } else {
      setNewUrl('');
    }
  }, [isOpen, download]);

  if (!isOpen || !download) return null;

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
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '580px' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <RefreshCw size={18} className="spin-slow" />
            <span>{t('refresh_modal_title')}</span>
          </div>
          <button className="btn-close" onClick={onClose}><X size={16} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted, #94a3b8)', lineHeight: '1.5' }}>
            {t('refresh_modal_desc')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary, #cbd5e1)' }}>
              {t('refresh_modal_label')}
            </label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Link size={15} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted, #64748b)' }} />
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
                required
                style={{
                  width: '100%',
                  padding: '9px 12px 9px 36px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.15))',
                  background: 'var(--bg-input, rgba(0,0,0,0.25))',
                  color: '#fff',
                  fontSize: '13px',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'transparent',
                color: '#cbd5e1',
                cursor: 'pointer',
                fontSize: '13px'
              }}
            >
              {t('bulk_clear') || 'İptal'}
            </button>

            <button
              type="submit"
              disabled={!newUrl.trim() || submitting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: '#fff',
                fontWeight: 600,
                cursor: newUrl.trim() && !submitting ? 'pointer' : 'not-allowed',
                opacity: newUrl.trim() && !submitting ? 1 : 0.6,
                fontSize: '13px'
              }}
            >
              <RefreshCw size={14} />
              <span>{t('refresh_modal_btn')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
