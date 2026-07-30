import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, Link as LinkIcon, FileText, Film, Loader, Folder, Play, Clock, HardDrive, Home, Video, Music, Cpu, Archive } from 'lucide-react';
import { useT } from '../i18n';
import { selectFolder, minimizeWindow, resizeWindow } from '../native';

const VIDEO_SITE_RE = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|instagram\.com|facebook\.com|fb\.watch|twitter\.com|x\.com|reddit\.com|soundcloud\.com|bilibili\.com|ok\.ru|vk\.com)$/i;

function isVideoUrl(raw) {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && VIDEO_SITE_RE.test(u.hostname);
  } catch (e) {
    return false;
  }
}

// HLS/DASH manifestleri (m3u8/mpd) siteden bağımsız olarak video motoruyla indirilir
function isStreamManifestUrl(raw) {
  try {
    const u = new URL(raw);
    return /^https?:$/.test(u.protocol) && /\.(m3u8|mpd)(\?|$)/i.test(u.pathname + u.search);
  } catch (e) {
    return false;
  }
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function qualityLabel(h) {
  return h >= 2160 ? ' (4K)' : h >= 1440 ? ' (2K)' : h >= 1080 ? ' (Full HD)' : h >= 720 ? ' (HD)' : '';
}

// Varyant satırı etiketi: "1080p (Full HD) · MP4 · AV1 — ~124 MB"
function variantOptionLabel(v) {
  const parts = [v.height + 'p' + qualityLabel(v.height)];
  if (v.container) parts.push(v.container);
  if (v.vcodec) parts.push(v.vcodec);
  let s = parts.join(' · ');
  if (v.size) s += ` — ~${formatBytes(v.size)}`;
  return s;
}

// Dosya türünden kategori (klasör) tahmini — sunucudan cevap gelmeden anında uygulanır
const CATEGORY_BY_EXT = {
  Video: ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', 'ts'],
  Music: ['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus'],
  Compressed: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub', 'csv', 'rtf'],
  Programs: ['exe', 'msi', 'bat', 'cmd', 'dmg', 'apk', 'sh', 'deb', 'rpm'],
  Images: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff']
};

function categoryFromUrl(raw) {
  try {
    const u = new URL(raw);
    const name = decodeURIComponent((u.pathname.split('/').pop() || '').split('?')[0]);
    const dot = name.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = name.slice(dot + 1).toLowerCase();
    for (const [cat, list] of Object.entries(CATEGORY_BY_EXT)) {
      if (list.includes(ext)) return cat;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export default function AddDownloadModal({ isOpen, onClose, onAddDownload, onAddBatch, settings, initialUrl = '', initialQuality = '', initialReferer = '', initialIsVideo = false, initialFilename = '', isStandalone = false }) {
  const { t } = useT();
  const boxRef = useRef(null); // standalone: içerik yüksekliğini ölçüp pencereyi ona göre boyutlandır
  const submittingRef = useRef(false); // gönderim sürüyor — pencere kapanmadan ikinci tıklamayı engelle
  const [activeTab, setActiveTab] = useState('single');
  const [url, setUrl] = useState(initialUrl || '');
  const [batchUrls, setBatchUrls] = useState('');
  const [filename, setFilename] = useState('');
  const [category, setCategory] = useState('General');
  const [saveDir, setSaveDir] = useState(settings?.downloadDir || '');
  const [manualDir, setManualDir] = useState(false); // kullanıcı klasörü elle seçti mi?
  const [fileSizeStr, setFileSizeStr] = useState('');
  const [segmentsCount, setSegmentsCount] = useState(settings?.defaultSegments || 8);

  // Video state
  const [isVideo, setIsVideo] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [qualities, setQualities] = useState([]);
  const [variants, setVariants] = useState([]); // aynı çözünürlüğün format varyantları (fmt:ID)
  const [quality, setQuality] = useState(initialQuality || 'best');
  const [formatError, setFormatError] = useState('');

  // Auto-read clipboard URL when modal opens if empty
  useEffect(() => {
    if (isOpen) setManualDir(false); // her yeni pencerede otomatik klasör seçimi
    if (isOpen && !url && !initialUrl) {
      navigator.clipboard?.readText().then(text => {
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
          setUrl(text.trim());
        }
      }).catch(() => {});
    } else if (isOpen && initialUrl) {
      setUrl(initialUrl);
    }
  }, [isOpen, initialUrl]);

  // Eklentide seçilen kaliteyi GÜVENİLİR biçimde uygula. Eskiden kalite yalnızca
  // /api/video/formats çağrısının başarılı .then'inde senkronlanıyordu; çağrı
  // yavaş/başarısız olursa kalite mount değeri 'best'te kalıp arka plandaki ön
  // indirmenin kalitesinden (ör. "1080") sapıyor ve sunucudaki devralma başarısız
  // olup sıfırdan indirmeye düşüyordu. Artık initialQuality gelir gelmez uygulanır;
  // kullanıcı menüden dilediğinde değiştirebilir (bu efekt yalnız prop değişince çalışır).
  useEffect(() => {
    if (initialQuality) setQuality(initialQuality);
  }, [initialQuality]);

  // Klasörü dosya türüne (kategoriye) göre otomatik seç.
  // Kullanıcı elle klasör seçtiyse (Gözat / hızlı düğmeler / yazdıysa) ona dokunma.
  useEffect(() => {
    if (manualDir) return;
    if (settings?.downloadDir) {
      const useCats = settings.useCategoryFolders !== false;
      setSaveDir(useCats && category ? settings.downloadDir + '/' + category : settings.downloadDir);
    }
  }, [settings, category, manualDir]);

  // Inspect URL metadata & video formats when URL changes
  useEffect(() => {
    if (!url.trim()) {
      setIsVideo(false);
      setFileSizeStr('');
      setVideoTitle('');
      setQualities([]);
      setVariants([]);
      setFormatError('');
      return;
    }

    // initialIsVideo: eklentiden gelen video/manifest indirmesi (uzantısız .txt manifest de
    // URL'den anlaşılmaz; eklenti Content-Type ile doğruladı). Bu bayrak varsa daima video say.
    const video = initialIsVideo || isVideoUrl(url) || isStreamManifestUrl(url);
    setIsVideo(video);
    setFormatError('');
    setLoadingMetadata(true);
    setFileSizeStr(''); // URL değişti — eski boyut kalmasın, spinner görünsün

    // Klasörü hemen doğru kategoriye ayarla (sunucu cevabını beklemeden):
    // YouTube vb. -> Video, dosya uzantısı -> ilgili kategori
    if (video) {
      setCategory('Video');
    } else {
      const guessed = categoryFromUrl(url);
      if (guessed) setCategory(guessed);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (video) {
        // Fetch video metadata & formats
        fetch('/api/video/formats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim(), referer: initialReferer || undefined }),
          signal: controller.signal
        })
          .then(res => res.json())
          .then(data => {
            if (data.error) throw new Error(data.error);
            const q = data.qualities || (data.heights || []).map(h => ({ height: h, size: 0 }));
            setQualities(q);
            setVariants(data.variants || []);
            setVideoTitle(data.title || '');
            // Sayfa başlığını (initialFilename) yt-dlp'nin "master" gibi metadata başlığına
            // tercih et — HLS/.txt kaynaklarında anlamlı tek isim sayfa başlığıdır.
            if (!filename) {
              setFilename(initialFilename || data.title || '');
            }
            // Eklentide/kullanıcı tarafından seçilmiş kaliteyi EZME.
            // Yalnızca hiç seçim yoksa "en yüksek"e düş.
            setQuality((prev) => (prev && prev !== 'best' ? prev : (initialQuality || 'best')));
          })
          .catch(err => {
            if (err.name === 'AbortError') return;
            setQualities([]);
            setVariants([]);
            setFormatError(t('fmt_error'));
            // Format alınamasa da (ör. oturum korumalı HLS 404) sayfa başlığını ad olarak koy
            if (!filename) setFilename(initialFilename || '');
          })
          .finally(() => setLoadingMetadata(false));
      } else {
        // Fetch standard URL inspect metadata (file size, filename, category)
        fetch('/api/download/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
          signal: controller.signal
        })
          .then(res => res.json())
          .then(data => {
            if (data.filename && !filename) setFilename(data.filename);
            if (data.category) setCategory(data.category);
            if (data.totalSize) setFileSizeStr(formatBytes(data.totalSize));
          })
          .catch(() => {})
          .finally(() => setLoadingMetadata(false));
      }
    }, 600);

    return () => { clearTimeout(timer); controller.abort(); };
  }, [url]);

  if (!isOpen) return null;

  const handleCreateDownload = async (autoStart = true) => {
    if (submittingRef.current) return; // çift tıklama koruması
    submittingRef.current = true;
    try {
      if (activeTab === 'single') {
        if (!url.trim()) return;
        if (isVideo) {
          await onAddDownload({
            url: url.trim(),
            filename: filename.trim() || undefined,
            saveDir: saveDir.trim() || undefined,
            isVideo: true,
            quality,
            referer: initialReferer || undefined,
            autoStart
          });
        } else {
          await onAddDownload({
            url: url.trim(),
            filename: filename.trim() || undefined,
            category,
            saveDir: saveDir.trim() || undefined,
            segmentsCount: Number(segmentsCount),
            autoStart
          });
        }
      } else {
        const urls = batchUrls.split('\n').map(u => u.trim()).filter(u => u.length > 0);
        if (urls.length === 0) return;
        await onAddBatch(urls);
      }
      setUrl('');
      setBatchUrls('');
      setFilename('');
      setFileSizeStr('');
      // ÖNEMLİ: pencere ancak istek TAMAMLANINCA kapanır — erken kapanış,
      // Electron'un cancel-preflight'ını sunucudaki onayla yarıştırıyordu
      onClose();
    } finally {
      submittingRef.current = false;
    }
  };

  const handleBrowseFolder = async () => {
    try {
      // Yerel Electron klasör kutusu (tüm pencerelerde çalışır); köprü yoksa
      // backend'in PowerShell yedeğine düşülür.
      let selected = await selectFolder();

      if (!selected) {
        const res = await fetch('/api/select-folder', { method: 'POST' });
        const data = await res.json();
        if (data && data.folderPath) selected = data.folderPath;
      }

      if (selected) {
        setSaveDir(selected);
        setManualDir(true); // artık kategoriye göre otomatik değiştirme
      }
    } catch (err) {
      console.error('Folder browser error:', err);
    }
  };

  const handleQuickFolderSelect = (subDir) => {
    const base = settings?.downloadDir || 'C:/Users/Downloads';
    setSaveDir(base + (subDir ? '/' + subDir : ''));
    setManualDir(true);
  };

  const catLabel = (cat) => t('catName_' + cat);

  // Çerçevesiz standalone pencerede görev çubuğuna küçültme (Windows başlık çubuğu yok)
  const handleMinimize = () => minimizeWindow();

  // Standalone pencere: Electron penceresi her zaman içeriğin doğal yüksekliğine eşitlenir.
  // Kutu yükseklik kısıtı TAŞIMAZ (maxHeight/scroll yok) — böylece rect ölçümü daima
  // gerçek ihtiyacı verir; içerik büyüyünce pencere büyür, küçülünce küçülür.
  const sendWindowSize = () => {
    const el = boxRef.current;
    if (!el) return;
    const h = Math.ceil(el.getBoundingClientRect().height) + 16; // 8px üst+alt padding
    if (h > 60) resizeWindow(h);
  };

  // Her render sonrası ölç (state değişimleri içeriği büyütüp küçültebilir)
  useEffect(() => {
    if (isStandalone) sendWindowSize();
  });

  // Pencere genişliği değişince satır kırılmaları yüksekliği etkiler — yeniden ölç
  useEffect(() => {
    if (!isStandalone || !boxRef.current) return;
    const ro = new ResizeObserver(() => sendWindowSize());
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, [isStandalone]);

  return (
    <div className={isStandalone ? "standalone-add-container" : "modal-overlay"} style={isStandalone ? { padding: '8px' } : {}}>
      <div ref={boxRef} className={isStandalone ? "" : "modal-box"} style={isStandalone ? { width: '100%', display: 'flex', flexDirection: 'column' } : { maxWidth: '640px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <HardDrive size={20} color="var(--primary-2)" />
            <span>{t('add_title')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {isStandalone && (
              <button className="btn btn-ghost btn-icon" onClick={handleMinimize} title={t('btn_minimize')} aria-label={t('btn_minimize')}>
                <Minus size={18} />
              </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={isStandalone ? { overflow: 'visible' } : {}}>
          <div className="seg-tabs">
            <button
              type="button"
              className={`seg-tab ${activeTab === 'single' ? 'active' : ''}`}
              onClick={() => setActiveTab('single')}
            >
              <LinkIcon size={16} /> {t('tab_single')}
            </button>
            <button
              type="button"
              className={`seg-tab ${activeTab === 'batch' ? 'active' : ''}`}
              onClick={() => setActiveTab('batch')}
            >
              <FileText size={16} /> {t('tab_batch')}
            </button>
          </div>

          {activeTab === 'single' ? (
            <>
              {/* URL Input */}
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('lbl_url')}</span>
                  {loadingMetadata && <span style={{ fontSize: '0.75rem', color: 'var(--link)', display: 'flex', alignItems: 'center', gap: '4px' }}><Loader size={12} className="dn-spin" /> {t('loading_info')}</span>}
                </label>
                <input
                  type="url"
                  className="form-input"
                  placeholder={t('url_placeholder')}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {/* Detected File Info Strip — baştan yer tutar; boyut algılanana
                  kadar spinner gösterir (sonradan belirip pencereyi zıplatmasın) */}
              {url.trim() && !isVideo && (
                <div className="info-strip info-strip-success">
                  <span>{t('detected_size')}</span>
                  {fileSizeStr ? (
                    <strong>{fileSizeStr}</strong>
                  ) : loadingMetadata ? (
                    <Loader size={13} className="dn-spin" />
                  ) : (
                    <strong>—</strong>
                  )}
                </div>
              )}

              {/* Video Options */}
              {isVideo && (
                <div className="form-group panel-box">
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Film size={15} /> {t('lbl_quality')}
                    {loadingMetadata && <Loader size={13} className="dn-spin" style={{ marginLeft: '4px' }} />}
                  </label>
                  <select
                    className="form-select"
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                  >
                    <option value="best">{t('q_best')}</option>
                    {/* Seçili değer henüz listede yoksa (liste yükleniyorsa) yine de görünsün.
                        fmt:ID biçimindeki varyant seçimi için okunaklı bir etiket göster. */}
                    {quality !== 'best' && quality !== 'audio' &&
                      !variants.some(v => `fmt:${v.formatId}` === quality) &&
                      !qualities.some(q => String(q.height) === String(quality)) && (
                      <option value={quality}>
                        {String(quality).startsWith('fmt:') ? t('q_best') : `${quality}p${qualityLabel(Number(quality))}`}
                      </option>
                    )}
                    {variants.length > 0
                      ? variants.map(v => (
                          <option key={v.formatId} value={`fmt:${v.formatId}`}>
                            {variantOptionLabel(v)}
                          </option>
                        ))
                      : qualities.map(q => (
                          <option key={q.height} value={String(q.height)}>
                            {q.height}p{qualityLabel(q.height)}{q.size ? ` — ~${formatBytes(q.size)}` : ''}
                          </option>
                        ))}
                    <option value="audio">{t('q_audio')}</option>
                  </select>
                  {videoTitle && <div style={{ fontSize: '0.78rem', color: 'var(--link)', marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🎬 {videoTitle}</div>}
                  {formatError && <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: '6px' }}>{formatError}</div>}
                </div>
              )}

              {/* Filename & Category Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                <div className="form-group">
                  <label className="form-label">{t('lbl_filename')}</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder={t('ph_filename')}
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">{t('lbl_category')}</label>
                  <select
                    className="form-select"
                    value={category}
                    onChange={(e) => { setCategory(e.target.value); setManualDir(false); }}
                  >
                    <option value="General">{t('catName_General')}</option>
                    <option value="Video">{t('catName_Video')}</option>
                    <option value="Music">{t('catName_Music')}</option>
                    <option value="Compressed">{t('catName_Compressed')}</option>
                    <option value="Documents">{t('catName_Documents')}</option>
                    <option value="Programs">{t('catName_Programs')}</option>
                    <option value="Images">{t('catName_Images')}</option>
                  </select>
                </div>
              </div>

              {/* Save Directory Selection & Browse Button */}
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Folder size={15} color="var(--primary-2)" /> {t('lbl_save_dir')}
                </label>

                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ flex: 1 }}
                    value={saveDir}
                    onChange={(e) => { setSaveDir(e.target.value); setManualDir(true); }}
                    placeholder="C:\Users\...\Downloads"
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-accent-outline"
                    style={{ whiteSpace: 'nowrap', padding: '6px 12px' }}
                    onClick={handleBrowseFolder}
                  >
                    {t('btn_browse')}
                  </button>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '5px' }}>
                  {manualDir ? (
                    <>
                      {t('manual_dir_note')}{' '}
                      <a
                        href="#"
                        style={{ color: 'var(--primary-2)' }}
                        onClick={(e) => { e.preventDefault(); setManualDir(false); }}
                      >
                        {t('back_to_auto', { cat: catLabel(category) })}
                      </a>
                    </>
                  ) : settings?.useCategoryFolders === false ? (
                    <>{t('single_folder_note')}</>
                  ) : (
                    <>{t('auto_folder_note')} <b>{catLabel(category)}</b></>
                  )}
                </div>

                {/* Quick Folder Buttons */}
                <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-secondary btn-chip" onClick={() => handleQuickFolderSelect('')}>
                    <Home size={12} /> {t('qf_main')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-chip" onClick={() => handleQuickFolderSelect('Video')}>
                    <Video size={12} /> {t('qf_video')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-chip" onClick={() => handleQuickFolderSelect('Music')}>
                    <Music size={12} /> {t('qf_music')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-chip" onClick={() => handleQuickFolderSelect('Programs')}>
                    <Cpu size={12} /> {t('qf_programs')}
                  </button>
                  <button type="button" className="btn btn-secondary btn-chip" onClick={() => handleQuickFolderSelect('Compressed')}>
                    <Archive size={12} /> {t('qf_compressed')}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="form-group">
              <label className="form-label">{t('lbl_batch_urls')}</label>
              <textarea
                className="form-input"
                rows={8}
                placeholder="https://site.com/file1.mp4&#10;https://site.com/file2.zip&#10;https://site.com/file3.pdf"
                value={batchUrls}
                onChange={(e) => setBatchUrls(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
                required
              />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="modal-footer" style={{ justifyContent: 'space-between', flexShrink: 0, flexWrap: 'wrap', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('btn_cancel')}</button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary btn-warn-outline"
              onClick={() => handleCreateDownload(false)}
            >
              <Clock size={16} /> {t('btn_queue')}
            </button>

            <button
              type="button"
              className="btn btn-primary"
              style={{ background: 'linear-gradient(135deg, var(--success), #059669)', border: 'none' }}
              onClick={() => handleCreateDownload(true)}
            >
              <Play size={16} /> {t('btn_start_dl')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
