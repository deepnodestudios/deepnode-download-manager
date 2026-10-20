import React, { useState, useEffect, useRef } from 'react';
import { X, Layers, Plus, Folder, Play, Pause, CheckSquare, Square, Wand2, FileText, CheckCircle2, AlertCircle } from 'lucide-react';
import { useT } from '../i18n';
import { selectFolder } from '../native';

export default function BatchDownloadModal({ isOpen, onClose, onAddBatch, settings, initialUrls = [] }) {
  const { t } = useT();

  const [mode, setMode] = useState('paste'); // 'paste' | 'pattern'
  const [pasteText, setPasteText] = useState('');
  
  // Pattern fields
  const [patternUrl, setPatternUrl] = useState('https://example.com/files/item_[01-20].zip');
  const [fromNum, setFromNum] = useState(1);
  const [toNum, setToNum] = useState(10);
  const [wildcardDigits, setWildcardDigits] = useState(2); // 01, 02...

  // Parsed / Generated URL items: [{ url, selected: true, filename: '' }]
  const [items, setItems] = useState([]);
  const [saveDir, setSaveDir] = useState('');
  // Kullanıcı klasörü elle değiştirmediyse saveDir gönderilmez; böylece
  // "kategori klasörleri" ayarı toplu indirmelerde de uygulanır.
  const [manualDir, setManualDir] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true;
      const defaultDir = settings?.downloadDir || '';
      setSaveDir(defaultDir);
      setManualDir(false);
      setAutoStart(settings?.autoStartDownloads ?? true);

      if (Array.isArray(initialUrls) && initialUrls.length > 0) {
        setPasteText(initialUrls.join('\n'));
        parseUrlsFromText(initialUrls.join('\n'));
        setMode('paste');
      } else {
        setPasteText('');
        setItems([]);
      }
    }
  }, [isOpen, initialUrls, settings]);

  if (!isOpen) return null;

  const extractFilename = (url) => {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/');
      const last = parts[parts.length - 1];
      return decodeURIComponent(last) || 'file';
    } catch (e) {
      return 'file';
    }
  };

  const parseUrlsFromText = (text) => {
    if (!text) {
      setItems([]);
      return;
    }
    const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
    const unique = [...new Set(matches)];
    setItems(unique.map((url) => ({
      url,
      selected: true,
      filename: extractFilename(url)
    })));
  };

  const handlePasteChange = (e) => {
    const val = e.target.value;
    setPasteText(val);
    parseUrlsFromText(val);
  };

  const generateFromPattern = () => {
    const url = patternUrl.trim();
    if (!url) return;

    // Check if pattern has [from-to] syntax e.g. [01-20] or [1-50]
    const bracketMatch = url.match(/\[(\d+)-(\d+)\]/);
    let start = fromNum;
    let end = toNum;
    let digits = wildcardDigits;
    let template = url;

    if (bracketMatch) {
      const rawStart = bracketMatch[1];
      const rawEnd = bracketMatch[2];
      digits = rawStart.length;
      start = parseInt(rawStart, 10);
      end = parseInt(rawEnd, 10);
      template = url.replace(bracketMatch[0], '{{NUM}}');
    } else if (url.includes('*')) {
      template = url.replace('*', '{{NUM}}');
    } else {
      template = url + '{{NUM}}';
    }

    if (start > end) {
      const temp = start;
      start = end;
      end = temp;
    }

    // Limit maximum generated links to 500 to protect browser memory
    const count = Math.min(500, end - start + 1);
    const generated = [];

    for (let i = 0; i < count; i++) {
      const cur = start + i;
      const numStr = String(cur).padStart(digits, '0');
      const genUrl = template.replace('{{NUM}}', numStr);
      generated.push({
        url: genUrl,
        selected: true,
        filename: extractFilename(genUrl)
      });
    }

    setItems(generated);
  };

  const toggleAll = (select) => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: select })));
  };

  const toggleItem = (index) => {
    setItems((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, selected: !item.selected } : item))
    );
  };

  const browseFolder = async () => {
    try {
      let selected = await selectFolder();
      if (!selected) {
        const res = await fetch('/api/select-folder', { method: 'POST' });
        const data = await res.json();
        if (data && data.folderPath) selected = data.folderPath;
      }
      if (selected) { setSaveDir(selected); setManualDir(true); }
    } catch (e) {
      console.error(e);
    }
  };

  const selectedCount = items.filter((x) => x.selected).length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const selectedUrls = items.filter((x) => x.selected).map((x) => x.url);
    if (!selectedUrls.length || submitting) return;

    setSubmitting(true);
    try {
      const dirToSend = manualDir ? (saveDir.trim() || undefined) : undefined;
      if (onAddBatch) {
        await onAddBatch(selectedUrls, dirToSend, autoStart);
      } else {
        await fetch('/api/download/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            urls: selectedUrls,
            saveDir: dirToSend,
            autoStart
          })
        });
      }
      onClose();
    } catch (err) {
      console.error('Batch download failed:', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '680px', width: '94%' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={20} className="text-accent" />
            <span>{t('batch_title') || 'Toplu İndirme & Adres Şablonu'}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '18px 20px' }}>
            {/* Mode selection tabs */}
            <div className="seg-tabs seg-tabs-2" style={{ marginBottom: '4px' }}>
              <button
                type="button"
                className={`seg-tab ${mode === 'paste' ? 'active' : ''}`}
                onClick={() => setMode('paste')}
              >
                <FileText size={14} /> {t('batch_tab_paste') || 'Çoklu Link Yapıştır'}
              </button>
              <button
                type="button"
                className={`seg-tab ${mode === 'pattern' ? 'active' : ''}`}
                onClick={() => setMode('pattern')}
              >
                <Wand2 size={14} /> {t('batch_tab_pattern') || 'Adres Şablonu (Sayı Aralığı)'}
              </button>
            </div>

            {mode === 'paste' ? (
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{t('batch_paste_label') || 'İndirilecek bağlantıları buraya yapıştırın (her satıra bir link):'}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {items.length} {t('batch_links_found') || 'bağlantı algılandı'}
                  </span>
                </label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder={`https://example.com/files/archive1.zip\nhttps://example.com/files/archive2.zip\nhttps://example.com/files/photo.jpg`}
                  value={pasteText}
                  onChange={handlePasteChange}
                  style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '12px' }}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">
                    {t('batch_pattern_label') || 'Adres Şablonu (Örn: https://site.com/file_[01-50].zip veya * kullanın):'}
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: 1, fontFamily: 'var(--font-mono, monospace)', fontSize: '13px' }}
                      value={patternUrl}
                      onChange={(e) => setPatternUrl(e.target.value)}
                      placeholder="https://example.com/file_[01-50].zip"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-accent-outline"
                      onClick={generateFromPattern}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      <Wand2 size={14} /> {t('batch_btn_generate') || 'Linkleri Üret'}
                    </button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('batch_from') || 'Başlangıç'}</label>
                    <input
                      type="number"
                      className="form-input"
                      value={fromNum}
                      onChange={(e) => setFromNum(Number(e.target.value))}
                      min={0}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('batch_to') || 'Bitiş'}</label>
                    <input
                      type="number"
                      className="form-input"
                      value={toNum}
                      onChange={(e) => setToNum(Number(e.target.value))}
                      min={1}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('batch_digits') || 'Basamak (Sıfır Doldur)'}</label>
                    <select
                      className="form-select"
                      value={wildcardDigits}
                      onChange={(e) => setWildcardDigits(Number(e.target.value))}
                    >
                      <option value={1}>1 (1, 2, 3...)</option>
                      <option value={2}>2 (01, 02, 03...)</option>
                      <option value={3}>3 (001, 002, 003...)</option>
                      <option value={4}>4 (0001, 0002...)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Generated / Parsed items list */}
            {items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {t('batch_items_preview') || 'İndirilecek Dosyalar'} ({selectedCount} / {items.length} {t('selected') || 'seçili'})
                  </span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px', fontSize: '11px' }}
                      onClick={() => toggleAll(true)}
                    >
                      <CheckSquare size={12} /> {t('btn_select_all') || 'Tümünü Seç'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '2px 6px', fontSize: '11px' }}
                      onClick={() => toggleAll(false)}
                    >
                      <Square size={12} /> {t('btn_deselect_all') || 'Temizle'}
                    </button>
                  </div>
                </div>

                <div style={{
                  maxHeight: '170px',
                  overflowY: 'auto',
                  border: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary, rgba(0,0,0,0.15))',
                  padding: '4px'
                }}>
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => toggleItem(idx)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '5px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: item.selected ? 'rgba(59,130,246,0.08)' : 'transparent',
                        borderBottom: '1px solid rgba(255,255,255,0.03)'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => {}}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontWeight: 600, minWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.filename}
                      </span>
                      <span style={{ flex: 1, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' }}>
                        {item.url}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Save Directory & Auto-start toggle */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '10px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))'
            }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" style={{ fontSize: '12px' }}>
                  {t('lbl_download_dir') || 'Kaydedilecek Klasör'}
                </label>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={saveDir}
                    onChange={(e) => { setSaveDir(e.target.value); setManualDir(true); }}
                    style={{ fontSize: '12px' }}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-accent-outline"
                    onClick={browseFolder}
                    style={{ padding: '4px 10px', fontSize: '12px', whiteSpace: 'nowrap' }}
                  >
                    {t('btn_browse') || 'Gözat'}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '4px' }}>
                <label className="dn-check" style={{ fontSize: '12px', margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                  />
                  <span>{t('chk_auto_start_batch') || 'Hemen Başlat'}</span>
                </label>
              </div>
            </div>

          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('btn_cancel')}
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={selectedCount === 0 || submitting}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <CheckCircle2 size={15} />
              <span>
                {t('batch_btn_add', { n: selectedCount }) || `${selectedCount} İndirmeyi Ekle`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
