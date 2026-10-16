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

export default function MediaSnifferModal({ isOpen, onClose, onAddBatch, queues = [], autoStartDownloads = true }) {
  const { t } = useT();
  const [pageUrl, setPageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [foundLinks, setFoundLinks] = useState([]);
  const [selectedUrls, setSelectedUrls] = useState({});
  const [errorMsg, setErrorMsg] = useState('');
  const [depth, setDepth] = useState(0);
  const [sameDomainOnly, setSameDomainOnly] = useState(true);
  const [scanInfo, setScanInfo] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedQueue, setSelectedQueue] = useState('main');
  const [fileTypes, setFileTypes] = useState(
    Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, true]))
  );

  if (!isOpen) return null;

  const typeLabel = (key) => t('type_' + key);

  const toggleFileType = (key) => {
    setFileTypes(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const applyPreset = (preset) => {
    if (preset === 'all') {
      setFileTypes(Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, true])));
    } else if (preset === 'images') {
      setFileTypes(Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, o.key === 'image'])));
    } else if (preset === 'media') {
      setFileTypes(Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, o.key === 'video' || o.key === 'audio'])));
    } else if (preset === 'docs') {
      setFileTypes(Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, o.key === 'document'])));
    } else if (preset === 'archives') {
      setFileTypes(Object.fromEntries(FILE_TYPE_OPTIONS.map(o => [o.key, o.key === 'archive'])));
    }
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
    setFilterQuery('');

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

  const displayedLinks = foundLinks.filter(l => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (l.filename || '').toLowerCase().includes(q) || (l.url || '').toLowerCase().includes(q);
  });

  const toggleSelect = (url) => {
    setSelectedUrls(prev => ({ ...prev, [url]: !prev[url] }));
  };

  const toggleAll = () => {
    const allSelected = displayedLinks.every(l => selectedUrls[l.url]);
    const nextState = { ...selectedUrls };
    displayedLinks.forEach(l => { nextState[l.url] = !allSelected; });
    setSelectedUrls(nextState);
  };

  const handleDownloadSelected = () => {
    const urlsToDownload = displayedLinks.filter(l => selectedUrls[l.url]).map(l => l.url);
    if (urlsToDownload.length > 0) {
      onAddBatch(urlsToDownload, null, autoStartDownloads, selectedQueue);
      onClose();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '750px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <Globe size={20} color="var(--teal)" />
            <span>{t('site_grabber') || 'Site Grabber'} — {t('sn_title')}</span>
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

          {/* Preset Project Templates */}
          <div style={{ marginTop: '10px' }}>
            <div className="form-label" style={{ marginBottom: '6px' }}>{t('site_grabber_title')}</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-chip" onClick={() => applyPreset('all')}>
                {t('preset_all')}
              </button>
              <button type="button" className="btn btn-secondary btn-chip" onClick={() => applyPreset('images')}>
                {t('preset_images')}
              </button>
              <button type="button" className="btn btn-secondary btn-chip" onClick={() => applyPreset('media')}>
                {t('preset_media')}
              </button>
              <button type="button" className="btn btn-secondary btn-chip" onClick={() => applyPreset('docs')}>
                {t('preset_docs')}
              </button>
              <button type="button" className="btn btn-secondary btn-chip" onClick={() => applyPreset('archives')}>
                {t('preset_archives')}
              </button>
            </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('detected_files', { n: displayedLinks.length })}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {queues && queues.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>{t('target_queue')}</label>
                      <select
                        className="form-select"
                        value={selectedQueue}
                        onChange={(e) => setSelectedQueue(e.target.value)}
                        style={{ width: 'auto', padding: '3px 8px', fontSize: '0.78rem' }}
                      >
                        {queues.map(q => (
                          <option key={q.id} value={q.id}>{q.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={toggleAll} style={{ padding: '4px 10px', fontSize: '0.75rem' }}>
                    {t('btn_toggle_all')}
                  </button>
                </div>
              </div>

              {/* Live search filter */}
              <input
                type="text"
                className="form-input"
                placeholder={t('ph_search') || 'Ara...'}
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                style={{ fontSize: '0.82rem', padding: '6px 12px' }}
              />

              <div style={{ maxHeight: '300px', overflowY: 'auto', background: 'var(--bg-inset)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
                {displayedLinks.map((item, idx) => (
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
