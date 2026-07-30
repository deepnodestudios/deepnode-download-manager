import React, { useState, useEffect } from 'react';
import { X, Settings, Save, Filter, Sliders, RotateCcw, CheckCircle2, Puzzle, FolderOpen, Globe, Clock, Lock, Plus, Trash2, Languages } from 'lucide-react';
import { useT } from '../i18n';
import { selectFolder } from '../native';

const DEFAULT_CAPTURED = 'ZIP RAR 7Z TAR GZ ISO EXE MSI APK PDF DOCX XLSX PPTX MP4 MKV AVI MOV WEBM MP3 FLAC WAV';
const DEFAULT_IGNORED = 'JS CSS HTML PHP TS JSON WOFF WOFF2 PNG JPG GIF SVG ICO XML TORRENT';

export default function SettingsModal({ isOpen, onClose, settings, onSaveSettings }) {
  const { t } = useT();
  const [activeTab, setActiveTab] = useState('general');

  // General settings
  const [downloadDir, setDownloadDir] = useState(settings?.downloadDir || '');
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(settings?.maxConcurrentDownloads || 3);
  const [defaultSegments, setDefaultSegments] = useState(settings?.defaultSegments || 8);
  const [globalSpeedLimitKbps, setGlobalSpeedLimitKbps] = useState(settings?.globalSpeedLimitKbps || 0);
  const [theme, setTheme] = useState(settings?.theme || 'system');
  const [language, setLanguage] = useState(settings?.language || 'auto');
  const [captureEnabled, setCaptureEnabled] = useState(settings?.captureEnabled ?? true);
  const [captureBypassKey, setCaptureBypassKey] = useState(settings?.captureBypassKey || 'Alt');

  // Başlangıç / davranış
  const [launchOnStartup, setLaunchOnStartup] = useState(settings?.launchOnStartup ?? false);
  const [startMinimized, setStartMinimized] = useState(settings?.startMinimized ?? false);
  const [minimizeToTrayOnClose, setMinimizeToTrayOnClose] = useState(settings?.minimizeToTrayOnClose ?? true);
  const [useCategoryFolders, setUseCategoryFolders] = useState(settings?.useCategoryFolders ?? true);
  const [autoStartDownloads, setAutoStartDownloads] = useState(settings?.autoStartDownloads ?? true);
  const [duplicateAction, setDuplicateAction] = useState(settings?.duplicateAction || 'rename');
  const [maxRetries, setMaxRetries] = useState(settings?.maxRetries ?? 5);
  const [connectionTimeoutSec, setConnectionTimeoutSec] = useState(settings?.connectionTimeoutSec ?? 30);
  const [notifyOnComplete, setNotifyOnComplete] = useState(settings?.notifyOnComplete ?? true);
  const [soundNotifications, setSoundNotifications] = useState(settings?.soundNotifications ?? true);
  const [confirmOnDelete, setConfirmOnDelete] = useState(settings?.confirmOnDelete ?? true);
  const [afterAllComplete, setAfterAllComplete] = useState(settings?.afterAllComplete || 'nothing');
  const [clipboardWatch, setClipboardWatch] = useState(settings?.clipboardWatch ?? true);
  const [autoUpdateYtDlp, setAutoUpdateYtDlp] = useState(settings?.autoUpdateYtDlp ?? true);

  // Proxy
  const [proxyEnabled, setProxyEnabled] = useState(settings?.proxyEnabled ?? false);
  const [proxyHost, setProxyHost] = useState(settings?.proxyHost || '');
  const [proxyPort, setProxyPort] = useState(settings?.proxyPort ?? 8080);
  const [proxyUser, setProxyUser] = useState(settings?.proxyUser || '');
  const [proxyPass, setProxyPass] = useState(settings?.proxyPass || '');

  // Site girişleri
  const [siteLogins, setSiteLogins] = useState(settings?.siteLogins || []);
  const [newLogin, setNewLogin] = useState({ host: '', user: '', pass: '' });

  // Zamanlayıcı
  const [schedulerEnabled, setSchedulerEnabled] = useState(settings?.schedulerEnabled ?? false);
  const [scheduleStartTime, setScheduleStartTime] = useState(settings?.scheduleStartTime || '02:00');
  const [scheduleStopTime, setScheduleStopTime] = useState(settings?.scheduleStopTime || '');
  const [scheduleDays, setScheduleDays] = useState(settings?.scheduleDays || [0, 1, 2, 3, 4, 5, 6]);

  // File types / filtering settings
  const [enableFileFiltering, setEnableFileFiltering] = useState(settings?.enableFileFiltering ?? true);
  const [capturedExtensions, setCapturedExtensions] = useState(settings?.capturedExtensions || DEFAULT_CAPTURED);
  const [ignoredExtensions, setIgnoredExtensions] = useState(settings?.ignoredExtensions || DEFAULT_IGNORED);

  // KRİTİK: Modal her zaman mount durumda; useState başlangıç değerleri yalnızca
  // İLK render'da (settings henüz backend'den gelmeden) okunur. Bu yüzden modal
  // her açıldığında kayıtlı ayarları state'lere yeniden yükle — aksi halde boş/
  // varsayılan değerler kayıtlı ayarların ÜZERİNE yazılır (ayar sıfırlanma hatası).
  useEffect(() => {
    if (!isOpen || !settings) return;
    setDownloadDir(settings.downloadDir || '');
    setMaxConcurrentDownloads(settings.maxConcurrentDownloads ?? 3);
    setDefaultSegments(settings.defaultSegments ?? 8);
    setGlobalSpeedLimitKbps(settings.globalSpeedLimitKbps ?? 0);
    setTheme(settings.theme || 'system');
    setLanguage(settings.language || 'auto');
    setCaptureEnabled(settings.captureEnabled ?? true);
    setCaptureBypassKey(settings.captureBypassKey || 'Alt');
    setLaunchOnStartup(settings.launchOnStartup ?? false);
    setStartMinimized(settings.startMinimized ?? false);
    setMinimizeToTrayOnClose(settings.minimizeToTrayOnClose ?? true);
    setUseCategoryFolders(settings.useCategoryFolders ?? true);
    setAutoStartDownloads(settings.autoStartDownloads ?? true);
    setDuplicateAction(settings.duplicateAction || 'rename');
    setMaxRetries(settings.maxRetries ?? 5);
    setConnectionTimeoutSec(settings.connectionTimeoutSec ?? 30);
    setNotifyOnComplete(settings.notifyOnComplete ?? true);
    setSoundNotifications(settings.soundNotifications ?? true);
    setConfirmOnDelete(settings.confirmOnDelete ?? true);
    setAfterAllComplete(settings.afterAllComplete || 'nothing');
    setClipboardWatch(settings.clipboardWatch ?? true);
    setAutoUpdateYtDlp(settings.autoUpdateYtDlp ?? true);
    setProxyEnabled(settings.proxyEnabled ?? false);
    setProxyHost(settings.proxyHost || '');
    setProxyPort(settings.proxyPort ?? 8080);
    setProxyUser(settings.proxyUser || '');
    setProxyPass(settings.proxyPass || '');
    setSiteLogins(settings.siteLogins || []);
    setSchedulerEnabled(settings.schedulerEnabled ?? false);
    setScheduleStartTime(settings.scheduleStartTime || '02:00');
    setScheduleStopTime(settings.scheduleStopTime || '');
    setScheduleDays(settings.scheduleDays || [0, 1, 2, 3, 4, 5, 6]);
    setEnableFileFiltering(settings.enableFileFiltering ?? true);
    setCapturedExtensions(settings.capturedExtensions || DEFAULT_CAPTURED);
    setIgnoredExtensions(settings.ignoredExtensions || DEFAULT_IGNORED);
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveSettings({
      downloadDir: downloadDir.trim(),
      maxConcurrentDownloads: Number(maxConcurrentDownloads),
      defaultSegments: Number(defaultSegments),
      globalSpeedLimitKbps: Number(globalSpeedLimitKbps),
      theme,
      language,
      captureEnabled,
      captureBypassKey,
      launchOnStartup,
      startMinimized,
      minimizeToTrayOnClose,
      useCategoryFolders,
      autoStartDownloads,
      duplicateAction,
      maxRetries: Number(maxRetries),
      connectionTimeoutSec: Number(connectionTimeoutSec),
      notifyOnComplete,
      soundNotifications,
      confirmOnDelete,
      afterAllComplete,
      clipboardWatch,
      autoUpdateYtDlp,
      proxyEnabled,
      proxyHost: proxyHost.trim(),
      proxyPort: Number(proxyPort) || 8080,
      proxyUser: proxyUser.trim(),
      proxyPass,
      siteLogins,
      schedulerEnabled,
      scheduleStartTime,
      scheduleStopTime,
      scheduleDays,
      enableFileFiltering,
      capturedExtensions: capturedExtensions.trim().toUpperCase(),
      ignoredExtensions: ignoredExtensions.trim().toUpperCase()
    });
    onClose();
  };

  const browseDownloadDir = async () => {
    try {
      let selected = await selectFolder();
      if (!selected) {
        const res = await fetch('/api/select-folder', { method: 'POST' });
        const data = await res.json();
        if (data && data.folderPath) selected = data.folderPath;
      }
      if (selected) setDownloadDir(selected);
    } catch (err) {
      console.error('Folder browser error:', err);
    }
  };

  const openExtensionFolder = async () => {
    try {
      const res = await fetch('/api/open-extension-folder', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      alert(t('alert_ext_folder', { msg: err.message }));
    }
  };

  const handleResetDefaults = () => {
    setCapturedExtensions(DEFAULT_CAPTURED);
    setIgnoredExtensions(DEFAULT_IGNORED);
    setEnableFileFiltering(true);
  };

  const dayKeys = [[1, 'day_1'], [2, 'day_2'], [3, 'day_3'], [4, 'day_4'], [5, 'day_5'], [6, 'day_6'], [0, 'day_0']];

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '680px' }}>
        <div className="modal-header">
          <div className="modal-title">
            <Settings size={20} color="var(--accent)" />
            <span>{t('set_title')}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* Tab Navigation */}
            <div className="seg-tabs seg-tabs-4">
              <button
                type="button"
                className={`seg-tab ${activeTab === 'general' ? 'active' : ''}`}
                onClick={() => setActiveTab('general')}
              >
                <Sliders size={15} /> {t('tab_general')}
              </button>
              <button
                type="button"
                className={`seg-tab ${activeTab === 'filetypes' ? 'active' : ''}`}
                onClick={() => setActiveTab('filetypes')}
              >
                <Filter size={15} /> {t('tab_filetypes')}
              </button>
              <button
                type="button"
                className={`seg-tab ${activeTab === 'extension' ? 'active' : ''}`}
                onClick={() => setActiveTab('extension')}
              >
                <Puzzle size={15} /> {t('tab_extension')}
              </button>
              <button
                type="button"
                className={`seg-tab ${activeTab === 'network' ? 'active' : ''}`}
                onClick={() => setActiveTab('network')}
              >
                <Globe size={15} /> {t('tab_network')}
              </button>
            </div>

            {activeTab === 'general' && (
              <>
                <div className="form-group">
                  <label className="form-label">{t('lbl_download_dir')}</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ flex: 1 }}
                      value={downloadDir}
                      onChange={(e) => setDownloadDir(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-secondary btn-accent-outline"
                      style={{ whiteSpace: 'nowrap' }}
                      onClick={browseDownloadDir}
                    >
                      {t('btn_browse')}
                    </button>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    {useCategoryFolders ? t('dir_note_cats') : t('dir_note_single')}
                  </span>
                </div>

                <label className="dn-check">
                  <input
                    type="checkbox"
                    checked={useCategoryFolders}
                    onChange={(e) => setUseCategoryFolders(e.target.checked)}
                  />
                  <span>{t('chk_category_folders')}</span>
                </label>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginLeft: '25px', marginBottom: '8px' }}>
                  {t('category_folders_note')}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_max_concurrent')}</label>
                    <select
                      className="form-select"
                      value={maxConcurrentDownloads}
                      onChange={(e) => setMaxConcurrentDownloads(e.target.value)}
                    >
                      <option value="1">{t('opt_file_1')}</option>
                      <option value="2">{t('opt_file_2')}</option>
                      <option value="3">{t('opt_file_3')}</option>
                      <option value="5">{t('opt_file_5')}</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t('lbl_segments')}</label>
                    <select
                      className="form-select"
                      value={defaultSegments}
                      onChange={(e) => setDefaultSegments(e.target.value)}
                    >
                      <option value="4">{t('opt_seg_4')}</option>
                      <option value="8">{t('opt_seg_8')}</option>
                      <option value="16">{t('opt_seg_16')}</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_theme')}</label>
                    <select
                      className="form-select"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value)}
                    >
                      <option value="system">{t('theme_system')}</option>
                      <option value="light">{t('theme_light')}</option>
                      <option value="dark">{t('theme_dark')}</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                      {t('theme_note')}
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Languages size={14} /> {t('lbl_language')}
                    </label>
                    <select
                      className="form-select"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    >
                      <option value="auto">{t('lang_auto')}</option>
                      <option value="tr">Türkçe</option>
                      <option value="en">English</option>
                      <option value="es">Español</option>
                      <option value="pt-BR">Português (Brasil)</option>
                      <option value="ru">Русский</option>
                      <option value="de">Deutsch</option>
                      <option value="fr">Français</option>
                      <option value="zh-CN">简体中文</option>
                      <option value="ar">العربية</option>
                      <option value="hi">हिन्दी</option>
                      <option value="id">Bahasa Indonesia</option>
                      <option value="vi">Tiếng Việt</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </select>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                      {t('language_note')}
                    </span>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{t('lbl_speed_limit')}</label>
                  <input
                    type="number"
                    className="form-input"
                    placeholder={t('ph_unlimited')}
                    value={globalSpeedLimitKbps}
                    onChange={(e) => setGlobalSpeedLimitKbps(e.target.value)}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    {t('speed_limit_note')}
                  </span>
                </div>

                {/* --- Windows / Başlangıç --- */}
                <div className="section-sep" />
                <div className="form-label section-label">{t('sec_startup')}</div>

                <label className="dn-check">
                  <input type="checkbox" checked={launchOnStartup} onChange={(e) => setLaunchOnStartup(e.target.checked)} />
                  <span>{t('chk_launch_startup')}</span>
                </label>
                <label className="dn-check">
                  <input type="checkbox" checked={startMinimized} onChange={(e) => setStartMinimized(e.target.checked)} />
                  <span>{t('chk_start_minimized')}</span>
                </label>
                <label className="dn-check">
                  <input type="checkbox" checked={minimizeToTrayOnClose} onChange={(e) => setMinimizeToTrayOnClose(e.target.checked)} />
                  <span>{t('chk_tray_close')}</span>
                </label>

                {/* --- İndirme davranışı --- */}
                <div className="section-sep" />
                <div className="form-label section-label">{t('sec_behavior')}</div>

                <label className="dn-check">
                  <input type="checkbox" checked={autoStartDownloads} onChange={(e) => setAutoStartDownloads(e.target.checked)} />
                  <span>{t('chk_auto_start')}</span>
                </label>
                <label className="dn-check">
                  <input type="checkbox" checked={clipboardWatch} onChange={(e) => setClipboardWatch(e.target.checked)} />
                  <span>{t('chk_clipboard')}</span>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '8px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_duplicate')}</label>
                    <select className="form-select" value={duplicateAction} onChange={(e) => setDuplicateAction(e.target.value)}>
                      <option value="rename">{t('dup_rename')}</option>
                      <option value="overwrite">{t('dup_overwrite')}</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_retries')}</label>
                    <select className="form-select" value={maxRetries} onChange={(e) => setMaxRetries(e.target.value)}>
                      <option value="0">{t('opt_retry_0')}</option>
                      <option value="3">{t('opt_retry_3')}</option>
                      <option value="5">{t('opt_retry_5')}</option>
                      <option value="10">{t('opt_retry_10')}</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{t('lbl_timeout')}</label>
                  <input type="number" className="form-input" min="5" max="300" value={connectionTimeoutSec}
                         onChange={(e) => setConnectionTimeoutSec(e.target.value)} />
                </div>

                {/* --- Bildirimler --- */}
                <div className="section-sep" />
                <div className="form-label section-label">{t('sec_notifications')}</div>

                <label className="dn-check">
                  <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} />
                  <span>{t('chk_notify')}</span>
                </label>
                <label className="dn-check">
                  <input type="checkbox" checked={soundNotifications} onChange={(e) => setSoundNotifications(e.target.checked)} />
                  <span>{t('chk_sound')}</span>
                </label>
                <label className="dn-check">
                  <input type="checkbox" checked={confirmOnDelete} onChange={(e) => setConfirmOnDelete(e.target.checked)} />
                  <span>{t('chk_confirm_delete')}</span>
                </label>

                <div className="form-group" style={{ marginTop: '8px' }}>
                  <label className="form-label">{t('lbl_after_all')}</label>
                  <select className="form-select" value={afterAllComplete} onChange={(e) => setAfterAllComplete(e.target.value)}>
                    <option value="nothing">{t('after_nothing')}</option>
                    <option value="exit">{t('after_exit')}</option>
                    <option value="shutdown">{t('after_shutdown')}</option>
                  </select>
                </div>

                <label className="dn-check" style={{ marginTop: '8px' }}>
                  <input type="checkbox" checked={autoUpdateYtDlp} onChange={(e) => setAutoUpdateYtDlp(e.target.checked)} />
                  <span>{t('chk_ytdlp_update')}</span>
                </label>
              </>
            )}

            {activeTab === 'filetypes' && (
              <>
                <div className="form-group panel-box" style={{ marginBottom: '16px' }}>
                  <label className="dn-check" style={{ fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={enableFileFiltering}
                      onChange={(e) => setEnableFileFiltering(e.target.checked)}
                    />
                    <span>{t('ft_enable')}</span>
                  </label>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '24px' }}>
                    {t('ft_enable_note')}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={15} /> {t('lbl_captured')}
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="ZIP RAR EXE MSI PDF MP4 MKV MP3 ISO APK 7Z DOCX XLSX PPTX"
                    value={capturedExtensions}
                    onChange={(e) => setCapturedExtensions(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', textTransform: 'uppercase' }}
                    disabled={!enableFileFiltering}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    {t('captured_note')}
                  </span>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <X size={15} /> {t('lbl_ignored')}
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="JS CSS HTML PHP TS JSON WOFF WOFF2 PNG JPG GIF SVG ICO XML"
                    value={ignoredExtensions}
                    onChange={(e) => setIgnoredExtensions(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', textTransform: 'uppercase' }}
                    disabled={!enableFileFiltering}
                  />
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    {t('ignored_note')}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleResetDefaults}
                    style={{ fontSize: '0.8rem', padding: '6px 12px' }}
                  >
                    <RotateCcw size={14} /> {t('btn_reset_types')}
                  </button>
                </div>
              </>
            )}

            {activeTab === 'network' && (
              <>
                {/* PROXY */}
                <div className="form-label section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Globe size={15} /> {t('net_proxy')}
                </div>
                <label className="dn-check">
                  <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} />
                  <span>{t('chk_proxy')}</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginTop: '6px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_host')}</label>
                    <input type="text" className="form-input" placeholder="proxy.company.com" value={proxyHost}
                           onChange={(e) => setProxyHost(e.target.value)} disabled={!proxyEnabled} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Port</label>
                    <input type="number" className="form-input" value={proxyPort}
                           onChange={(e) => setProxyPort(e.target.value)} disabled={!proxyEnabled} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_proxy_user')}</label>
                    <input type="text" className="form-input" value={proxyUser}
                           onChange={(e) => setProxyUser(e.target.value)} disabled={!proxyEnabled} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_password')}</label>
                    <input type="password" className="form-input" value={proxyPass}
                           onChange={(e) => setProxyPass(e.target.value)} disabled={!proxyEnabled} />
                  </div>
                </div>

                {/* SITE LOGINS */}
                <div className="section-sep" />
                <div className="form-label section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Lock size={15} /> {t('net_logins')}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginBottom: '8px' }}>
                  {t('logins_note')}
                </div>

                {siteLogins.length > 0 && (
                  <div style={{ marginBottom: '8px' }}>
                    {siteLogins.map((l, i) => (
                      <div key={i} className="login-row">
                        <span style={{ flex: 1, fontWeight: 600 }}>{l.host}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{l.user}</span>
                        <button type="button" className="btn btn-danger btn-icon"
                                onClick={() => setSiteLogins(siteLogins.filter((_, x) => x !== i))}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1.4fr auto', gap: '6px', alignItems: 'end' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_site_host')}</label>
                    <input type="text" className="form-input" placeholder="example.com" value={newLogin.host}
                           onChange={(e) => setNewLogin({ ...newLogin, host: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_user')}</label>
                    <input type="text" className="form-input" value={newLogin.user}
                           onChange={(e) => setNewLogin({ ...newLogin, user: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_password')}</label>
                    <input type="password" className="form-input" value={newLogin.pass}
                           onChange={(e) => setNewLogin({ ...newLogin, pass: e.target.value })} />
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ marginBottom: '2px' }}
                    onClick={() => {
                      const host = newLogin.host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
                      if (!host || !newLogin.user.trim()) return;
                      setSiteLogins([...siteLogins.filter(l => l.host !== host), { host, user: newLogin.user.trim(), pass: newLogin.pass }]);
                      setNewLogin({ host: '', user: '', pass: '' });
                    }}
                  >
                    <Plus size={14} /> {t('btn_add')}
                  </button>
                </div>

                {/* SCHEDULER */}
                <div className="section-sep" />
                <div className="form-label section-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={15} /> {t('net_scheduler')}
                </div>
                <label className="dn-check">
                  <input type="checkbox" checked={schedulerEnabled} onChange={(e) => setSchedulerEnabled(e.target.checked)} />
                  <span>{t('chk_scheduler')}</span>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '6px' }}>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_start_time')}</label>
                    <input type="time" className="form-input" value={scheduleStartTime}
                           onChange={(e) => setScheduleStartTime(e.target.value)} disabled={!schedulerEnabled} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">{t('lbl_stop_time')}</label>
                    <input type="time" className="form-input" value={scheduleStopTime}
                           onChange={(e) => setScheduleStopTime(e.target.value)} disabled={!schedulerEnabled} />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">{t('lbl_days')}</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {dayKeys.map(([d, key]) => {
                      const on = scheduleDays.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`btn ${on ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                          disabled={!schedulerEnabled}
                          onClick={() => setScheduleDays(on ? scheduleDays.filter(x => x !== d) : [...scheduleDays, d])}
                        >
                          {t(key)}
                        </button>
                      );
                    })}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-dark)' }}>
                    {t('scheduler_note')}
                  </span>
                </div>
              </>
            )}

            {activeTab === 'extension' && (
              <>
                <div className="form-group panel-box" style={{ marginBottom: '14px' }}>
                  <label className="dn-check" style={{ fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={captureEnabled}
                      onChange={(e) => setCaptureEnabled(e.target.checked)}
                    />
                    <span>{t('ext_capture_enable')}</span>
                  </label>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px', marginLeft: '24px' }}>
                    {t('ext_capture_note')}
                  </div>

                  <div style={{ marginTop: '12px' }}>
                    <label className="form-label">{t('lbl_bypass_key')}</label>
                    <select className="form-select" value={captureBypassKey} onChange={(e) => setCaptureBypassKey(e.target.value)}>
                      <option value="Alt">{t('opt_alt_default')}</option>
                      <option value="Control">Ctrl</option>
                      <option value="Shift">Shift</option>
                      <option value="None">{t('opt_off')}</option>
                    </select>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '4px' }}>
                      {t('bypass_note')}
                    </div>
                  </div>
                </div>

                <div className="panel-box" style={{ marginBottom: '14px', fontSize: '0.85rem', lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 700, color: 'var(--link)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <Puzzle size={16} /> {t('ext_what_title')}
                  </div>
                  {t('ext_what_body_1')} <b>{t('ext_what_body_2')}</b> {t('ext_what_body_3')} <b>{t('ext_what_body_4')}</b> {t('ext_what_body_5')} <b>{t('ext_what_body_6')}</b>{t('ext_what_body_7')}
                </div>

                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                  <button type="button" className="btn btn-primary" onClick={openExtensionFolder}>
                    <FolderOpen size={16} /> {t('btn_open_ext_folder')}
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={15} /> Chrome / Edge / Brave / Opera
                  </label>
                  <ol style={{ margin: '4px 0 0 18px', padding: 0, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    <li>{t('ext_step1')}</li>
                    <li>{t('ext_step2')}</li>
                    <li>{t('ext_step3')}</li>
                    <li>{t('ext_step4')}</li>
                    <li>{t('ext_step5')}</li>
                  </ol>
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={15} /> Firefox (121+)
                  </label>
                  <ol style={{ margin: '4px 0 0 18px', padding: 0, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    <li>{t('ff_step1')}</li>
                    <li>{t('ff_step2')}</li>
                    <li>{t('ff_step3')}</li>
                  </ol>
                </div>

                <div className="info-strip info-strip-warn">
                  ℹ {t('ext_why_note')}
                </div>
              </>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{t('btn_cancel')}</button>
            <button type="submit" className="btn btn-primary">
              <Save size={16} /> {t('btn_save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
