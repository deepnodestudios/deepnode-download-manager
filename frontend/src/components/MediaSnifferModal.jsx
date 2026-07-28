import React, { useState } from 'react';
import { X, Globe, Search, Download, CheckSquare, Square, Video, FileText, Music, Image, Archive, Package } from 'lucide-react';
import { useT } from '../i18n';

// Backend'deki LinkSniffer.FILE_TYPE_GROUPS anahtarlarıyla birebir aynı
const FILE_TYPE_OPTIONS = [
  { key: 'video', Icon: Video },
  { key: 'audio', Icon: Music },
  { key: 'image', Icon: Image },
  { key: 'document', Icon: FileText },
  { key: 'archive', Icon: Archive },
  { key: 'program', Icon: Package }
];

export default function MediaSnifferModal({ isOpen, onClose, onAddBatch }) {
  const { t } = useT();
  const [pageUrl, setPageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundLinks, setFoundLinks] = useState([]);
  const [selectedUrls, setSelectedUrls] = useState({});
  const [errorMsg, setErrorMsg] = useState('');
  const [depth, setDepth] = useState(0);
  const [sameDomainOnly, setSameDomainOnly] = useState(true);
  const [scanInfo, setScanInfo] = useState('');
  const [fileTypes, setFileTypes] = useState(
    Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, true]))
  );

  if (!isOpen) return null;

  const typeLabel = (key) => t('type_' + key);

  const toggleFileType = (key) => {
    setFileTypes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSniff = async (e) => {
    e.preventDefault();
    if (!pageUrl.trim()) return;

    const selectedTypes = FILE_TYPE_OPTIONS.filter(o => fileTypes[o.key]).map(o => o.key);
    if (selectedTypes.length === 0) {
      setErrorMsg(t('err_no_type'));
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setFoundLinks([]);
    setSelectedUrls({});

    try {
      const res = await fetch('/api/sniffer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: pageUrl.trim(),
          depth: Number(depth),
          sameDomainOnly,
          fileTypes: selectedTypes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('err_scan_failed'));

      setScanInfo(t('scan_result', { pages: data.pagesScanned || 1, count: (data.links || []).length }));
      setFoundLinks(data.links || []);
      const initialSel = {};
      (data.links || []).forEach(l => { initialSel[l.url] = true; });
      setSelectedUrls(initialSel);
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (url) => {
    setSelectedUrls(prev => ({ ...prev, [url]: !prev[url] }));
  };

  const toggleAll = () => {
    const allSelected = foundLinks.every(l => selectedUrls[l.url]);
    const nextState = {};
    foundLinks.forEach(l => { nextState[l.url] = !allSelected; });
    setSelectedUrls(nextState);
  };

  const handleDownloadSelected = () => {
    const urlsToDownload = foundLinks.filter(l => selectedUrls[l.url]).map(l => l.url);
    if (urlsToDownload.length > 0) {
      onAddBatch(urlsToDownload);
      onClose();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '720px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <Globe size={20} color="var(--teal)" />
            <span>{t('sn_title')}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <form onSubmit={handleSniff} style={{ display: 'flex', gap: '10px' }}>
            <input
              type="url"
              className="form-input"
              style={{ flex: 1 }}
              placeholder={t('ph_sn_url')}
              value={pageUrl}
              onChange={(e) => setPageUrl(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              <Search size={16} /> {loading ? t('btn_scanning') : t('btn_scan')}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <label className="form-label" style={{ margin: 0 }}>{t('lbl_depth')}</label>
              <select className="form-select" style={{ width: 'auto' }} value={depth} onChange={(e) => setDepth(e.target.value)}>
                <option value="0">{t('depth_0')}</option>
                <option value="1">{t('depth_1')}</option>
                <option value="2">{t('depth_2')}</option>
                <option value="3">{t('depth_3')}</option>
              </select>
            </div>
            <label className="dn-check" style={{ margin: 0 }}>
              <input type="checkbox" checked={sameDomainOnly} onChange={(e) => setSameDomainOnly(e.target.checked)} />
              <span>{t('same_domain')}</span>
            </label>
          </div>

          {/* Dosya türü filtresi: yalnızca seçilen kategoriler taranır */}
          <div style={{ marginTop: '10px' }}>
            <div className="form-label" style={{ marginBottom: '6px' }}>{t('lbl_file_types')}</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {FILE_TYPE_OPTIONS.map(({ key, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`btn ${fileTypes[key] ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ padding: '5px 10px', fontSize: '0.78rem', opacity: fileTypes[key] ? 1 : 0.6 }}
                  onClick={() => toggleFileType(key)}
                  aria-pressed={fileTypes[key]}
                >
                  <Icon size={14} /> {typeLabel(key)}
                </button>
              ))}
            </div>
          </div>

          {scanInfo && !errorMsg && (
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '8px' }}>{scanInfo}</div>
          )}

          {errorMsg && (
            <div style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger-2)', borderRadius: '8px', fontSize: '0.85rem' }}>
              {errorMsg}
            </div>
          )}

          {foundLinks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('detected_files', { n: foundLinks.length })}</span>
                <button type="button" className="btn btn-secondary" onClick={toggleAll} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                  {t('btn_toggle_all')}
                </button>
              </div>

              <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--bg-inset)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                {foundLinks.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => toggleSelect(item.url)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      background: selectedUrls[item.url] ? 'var(--primary-soft)' : 'transparent'
                    }}
                  >
                    {selectedUrls[item.url] ? <CheckSquare size={18} color="var(--link)" /> : <Square size={18} color="var(--text-dark)" />}
                    <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <div style={{ fontWeight: '600', fontSize: '0.85rem' }}>{item.filename}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>{item.url}</div>
                    </div>
                    {item.fileType && (
                      <span className="status-pill status-paused">{typeLabel(item.fileType)}</span>
                    )}
                    <span className="status-pill status-queued">{item.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('btn_close')}</button>
          {foundLinks.length > 0 && (
            <button type="button" className="btn btn-success" onClick={handleDownloadSelected}>
              <Download size={16} /> {t('btn_add_selected')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
