import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import DownloadList from './components/DownloadList';
import SpeedChart from './components/SpeedChart';
import ChunkProgressModal from './components/ChunkProgressModal';
import AddDownloadModal from './components/AddDownloadModal';
import DownloadProgressWindow from './components/DownloadProgressWindow';
import MediaSnifferModal from './components/MediaSnifferModal';
import SettingsModal from './components/SettingsModal';
import AboutModal from './components/AboutModal';
import { I18nProvider, translate, resolveLanguage } from './i18n';

export default function App() {
  const [downloads, setDownloads] = useState([]);
  const [settings, setSettings] = useState(null);
  const [activeFilter, setActiveFilter] = useState('all');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [initialUrlForAdd, setInitialUrlForAdd] = useState('');
  const [initialQualityForAdd, setInitialQualityForAdd] = useState('');
  const [isSnifferModalOpen, setIsSnifferModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [selectedDownloadForChunks, setSelectedDownloadForChunks] = useState(null);
  const [propertiesItem, setPropertiesItem] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // { item, preferFile }
  const [deleteAlsoFile, setDeleteAlsoFile] = useState(false);
  const [extStatus, setExtStatus] = useState(null); // tarayıcı eklentisi sürüm durumu
  const [extWarnDismissed, setExtWarnDismissed] = useState(false);
  const [appUpdate, setAppUpdate] = useState(null); // uygulama güncelleme bilgisi
  const [appUpdateDismissed, setAppUpdateDismissed] = useState(false);
  const [isStandaloneAdd] = useState(() => {
    return new URLSearchParams(window.location.search).get('mode') === 'add';
  });
  // IDM tarzı bağımsız ilerleme penceresi (mode=progress&id=...)
  const [standaloneProgressId] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('mode') === 'progress' ? p.get('id') : null;
  });

  const wsRef = useRef(null);

  // Aktif arayüz dili (settings.language: 'auto' | 'tr' | 'en')
  const lang = resolveLanguage(settings?.language);
  const tt = (key, vars) => translate(lang, key, vars);

  useEffect(() => {
    if (isStandaloneAdd) {
      const params = new URLSearchParams(window.location.search);
      const urlParam = params.get('url');
      if (urlParam) {
        setInitialUrlForAdd(urlParam);
      }
      const qualityParam = params.get('quality'); // eklentide seçilen kalite
      if (qualityParam) {
        setInitialQualityForAdd(qualityParam);
      }
      setIsAddModalOpen(true);
    }

    // Initial fetch of downloads and settings
    fetch('/api/downloads')
      .then(res => res.json())
      .then(data => setDownloads(data || []))
      .catch(err => console.error('Failed to fetch downloads:', err));

    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setSettings(data || {}))
      .catch(err => console.error('Failed to fetch settings:', err));

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPort = window.location.port || 5000;
    const wsUrl = `${protocol}//${window.location.hostname}:${wsPort}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;

        if (type === 'INIT_STATE') {
          setDownloads(payload.downloads || []);
          setSettings(payload.settings || {});
        } else if (type === 'PROGRESS') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return {
                ...item,
                downloadedBytes: payload.downloadedBytes,
                totalSize: payload.totalSize,
                speed: payload.speed,
                eta: payload.eta,
                segments: payload.segments
              };
            }
            return item;
          }));
        } else if (type === 'STATUS_CHANGE') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return { ...item, status: payload.status };
            }
            return item;
          }));
        } else if (type === 'COMPLETED') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return { ...item, status: 'completed', checksum: payload.checksum, speed: 0, eta: 0 };
            }
            return item;
          }));
        } else if (type === 'DOWNLOAD_ADDED') {
          setDownloads(prev => [...prev.filter(d => d.id !== payload.id), payload]);
        } else if (type === 'DOWNLOAD_DELETED') {
          setDownloads(prev => prev.filter(d => d.id !== payload.id));
        } else if (type === 'PROMPT_ADD_DOWNLOAD') {
          if (payload && payload.url) {
            handleOpenAddModal(payload.url);
          }
        }
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Tarayıcıdaki eklenti eski sürümde mi? (eklenti 30 sn'de bir sunucuya
  // sürümünü bildirir; Chrome paketten yüklenen eklentiyi otomatik yenilemez)
  useEffect(() => {
    if (isStandaloneAdd || standaloneProgressId) return;
    const check = () =>
      fetch('/api/extension/status')
        .then(res => res.json())
        .then(data => setExtStatus(data || null))
        .catch(() => {});
    check();
    const timer = setInterval(check, 20000);
    return () => clearInterval(timer);
  }, [isStandaloneAdd]);

  // Uygulama güncellemesi var mı? (açılışta bir kez + 6 saatte bir kontrol)
  useEffect(() => {
    if (isStandaloneAdd || standaloneProgressId) return;
    const check = () =>
      fetch('/api/update/check')
        .then(res => res.json())
        .then(data => { if (data && !data.error) setAppUpdate(data); })
        .catch(() => {});
    check();
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isStandaloneAdd]);

  // Apply theme: 'system' follows OS preference (and live-updates), else forced.
  useEffect(() => {
    const mode = settings?.theme || 'system';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = mode === 'dark' || (mode === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    if (mode === 'system') {
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [settings?.theme]);

  // IDM ön indirmesi (preflight): onay penceresi açıkken arka planda inen gizli
  // öğeler ana listede/saygılarda görünmez — onaylanınca bayrak kalkar ve listelenir
  const visibleDownloads = downloads.filter(item => !item.preflight);

  // Filter downloads
  const filteredDownloads = visibleDownloads.filter(item => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'downloading') return item.status === 'downloading' || item.status === 'merging';
    if (activeFilter === 'completed') return item.status === 'completed';
    if (activeFilter === 'paused') return item.status === 'paused' || item.status === 'queued';
    return item.category === activeFilter;
  });

  // Calculate total speed across all active downloads
  const totalSpeed = visibleDownloads.reduce((acc, curr) => {
    return curr.status === 'downloading' ? acc + (curr.speed || 0) : acc;
  }, 0);

  const handleOpenAddModal = (url = '') => {
    setInitialUrlForAdd(typeof url === 'string' ? url : '');
    setIsAddModalOpen(true);

    // Uygulamayı en ön plana getir
    if (typeof window !== 'undefined' && window.require) {
      try {
        const electron = window.require('electron');
        if (electron && electron.ipcRenderer) {
          electron.ipcRenderer.send('bring-to-front');
        }
      } catch (e) {}
    }
  };

  const handleAddDownload = async (newDownloadData) => {
    try {
      const isVideo = newDownloadData.isVideo;
      const endpoint = isVideo ? '/api/download/video' : '/api/download/add';
      const body = isVideo
        ? {
            url: newDownloadData.url,
            filename: newDownloadData.filename,
            quality: newDownloadData.quality,
            saveDir: newDownloadData.saveDir,
            autoStart: newDownloadData.autoStart,
            confirmedByUser: true
          }
        : {
            ...newDownloadData,
            confirmedByUser: true
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (newDownloadData.autoStart === false && data.id) {
        await fetch(`/api/download/${data.id}/pause`, { method: 'POST' });
      }
      // Not: IDM tarzı ilerleme penceresini backend tetikler (serverEvents 'open-progress')
      // — ana pencerede nodeIntegration kapalı olduğundan renderer IPC'si güvenilmez.
      // Yakalanan link için arka planda ön indirme (preflight) varsa /api/download/add
      // onu sunucu tarafında devralıp KALDIĞI YERDEN devam ettirir (yeni kayıt açmaz).
    } catch (err) {
      alert(tt('alert_add_error', { msg: err.message }));
    }
  };

  const handleAddBatch = async (urls) => {
    try {
      const res = await fetch('/api/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      alert(tt('alert_batch_error', { msg: err.message }));
    }
  };

  const handleStart = (id) => fetch(`/api/download/${id}/start`, { method: 'POST' });
  const handlePause = (id) => fetch(`/api/download/${id}/pause`, { method: 'POST' });

  const doDelete = (id, deleteFile) =>
    fetch(`/api/download/${id}?deleteFile=${deleteFile ? 'true' : 'false'}`, { method: 'DELETE' });

  // Silme isteği: "diskten de silinsin mi?" onay penceresini açar
  const handleDelete = (id, deleteFile) => {
    const item = downloads.find(d => d.id === id);
    if (settings?.confirmOnDelete === false) {
      return doDelete(id, deleteFile === true);
    }
    setDeleteAlsoFile(deleteFile === true); // sağ tık > "Dosyayla Birlikte Sil" ise işaretli gelsin
    setDeleteTarget({ item, preferFile: deleteFile === true });
  };

  const handleRedownload = async (item) => {
    if (!window.confirm(tt('confirm_redownload', { name: item.filename }))) return;
    try {
      const res = await fetch(`/api/download/${item.id}/redownload`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } catch (err) {
      alert(tt('alert_redownload_failed', { msg: err.message }));
    }
  };

  const handleRename = async (item) => {
    const name = window.prompt(tt('prompt_rename'), item.filename || '');
    if (!name || !name.trim() || name === item.filename) return;
    try {
      const res = await fetch(`/api/download/${item.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name.trim() })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } catch (err) {
      alert(tt('alert_rename_failed', { msg: err.message }));
    }
  };

  const handleCopyUrl = async (item) => {
    try {
      await navigator.clipboard.writeText(item.url || '');
    } catch (e) {
      window.prompt(tt('prompt_copy_url'), item.url || '');
    }
  };

  const handleShowProperties = (item) => setPropertiesItem(item);

  const handleSetPriority = (id, priority) =>
    fetch(`/api/download/${id}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority })
    }).catch(() => {});

  const handleOpenFile = async (id) => {
    try {
      const res = await fetch(`/api/download/${id}/open`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } catch (err) {
      alert(tt('alert_open_failed', { msg: err.message }));
    }
  };

  const handleRevealFolder = async (id) => {
    try {
      const res = await fetch(`/api/download/${id}/reveal`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } catch (err) {
      alert(tt('alert_reveal_failed', { msg: err.message }));
    }
  };

  const handleStartAll = () => fetch('/api/download/start-all', { method: 'POST' });
  const handlePauseAll = () => fetch('/api/download/pause-all', { method: 'POST' });

  const handleSaveSettings = async (newSettings) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const updated = await res.json();
      setSettings(updated);
    } catch (err) {
      alert(tt('alert_settings_failed', { msg: err.message }));
    }
  };

  if (standaloneProgressId) {
    return (
      <I18nProvider languagePref={settings?.language}>
        <DownloadProgressWindow download={downloads.find(d => d.id === standaloneProgressId)} />
      </I18nProvider>
    );
  }

  if (isStandaloneAdd) {
    return (
      <I18nProvider languagePref={settings?.language}>
        <div className="standalone-add-container" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <AddDownloadModal
            isOpen={true}
            onClose={() => {
              if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('close-add-window');
              } else {
                window.close();
              }
            }}
            onAddDownload={async (data) => {
              await handleAddDownload(data);
              if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('close-add-window');
              } else {
                window.close();
              }
            }}
            onAddBatch={async (urls) => {
              await handleAddBatch(urls);
              if (window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('close-add-window');
              } else {
                window.close();
              }
            }}
            settings={settings}
            initialUrl={initialUrlForAdd}
            initialQuality={initialQualityForAdd}
            isStandalone={true}
          />
        </div>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider languagePref={settings?.language}>
      <div className="app-layout">
        <Navbar
          onOpenAddModal={handleOpenAddModal}
          onStartAll={handleStartAll}
          onPauseAll={handlePauseAll}
          onOpenSnifferModal={() => setIsSnifferModalOpen(true)}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onOpenAboutModal={() => setIsAboutModalOpen(true)}
        />

        {extStatus?.stale && !extWarnDismissed && (
          <div className="app-banner app-banner-warn">
            <span className="app-banner-icon">⚠</span>
            <span style={{ flex: 1 }}>
              {tt('ext_stale_msg', {
                old: extStatus.reported ? `v${extStatus.reported}` : (lang === 'tr' ? 'v1.1.1 veya öncesi' : 'v1.1.1 or older'),
                new: extStatus.expected
              })}{' '}
              {tt('ext_stale_hint_a')} <strong>chrome://extensions</strong> {tt('ext_stale_hint_b')} <strong>⟳</strong> {tt('ext_stale_hint_c')}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setExtWarnDismissed(true)}
              title={tt('tip_dismiss')}
            >
              ×
            </button>
          </div>
        )}

        {appUpdate?.updateAvailable && !appUpdateDismissed && (
          <div className="app-banner app-banner-info">
            <span className="app-banner-icon">🚀</span>
            <span style={{ flex: 1 }}>
              {tt('update_available')} <strong>v{appUpdate.latest}</strong>
              {' — '}
              <a
                href={`https://github.com/deepnodestudios/deepnode-download-manager/releases/tag/v${appUpdate.latest}`}
                onClick={(e) => {
                  e.preventDefault();
                  const url = e.currentTarget.href;
                  try {
                    const { shell } = window.require('electron');
                    shell.openExternal(url);
                  } catch (err) {
                    window.open(url, '_blank');
                  }
                }}
                style={{ color: 'var(--link)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                {tt('release_notes')}
              </a>
            </span>
            <button
              className="btn btn-primary btn-xs"
              onClick={() => {
                try {
                  const { shell } = window.require('electron');
                  shell.openExternal(appUpdate.downloadUrl);
                } catch (e) {
                  window.open(appUpdate.downloadUrl, '_blank');
                }
              }}
            >
              {tt('btn_download')}
            </button>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setAppUpdateDismissed(true)}
              title={tt('tip_dismiss')}
            >
              ×
            </button>
          </div>
        )}

        <div className="main-body">
          <Sidebar
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            downloads={visibleDownloads}
          />

          <main className="content-area">
            <SpeedChart
              currentSpeed={totalSpeed}
            />

            <DownloadList
              downloads={filteredDownloads}
              onStart={handleStart}
              onPause={handlePause}
              onDelete={handleDelete}
              onInspectChunks={(item) => setSelectedDownloadForChunks(item)}
              onOpenFile={handleOpenFile}
              onRevealFolder={handleRevealFolder}
              onRedownload={handleRedownload}
              onRename={handleRename}
              onCopyUrl={handleCopyUrl}
              onShowProperties={handleShowProperties}
              onSetPriority={handleSetPriority}
            />
          </main>
        </div>

        <AddDownloadModal
          isOpen={isAddModalOpen}
          onClose={() => { setIsAddModalOpen(false); setInitialUrlForAdd(''); }}
          onAddDownload={handleAddDownload}
          onAddBatch={handleAddBatch}
          settings={settings}
          initialUrl={initialUrlForAdd}
        />

        <MediaSnifferModal
          isOpen={isSnifferModalOpen}
          onClose={() => setIsSnifferModalOpen(false)}
          onAddBatch={handleAddBatch}
        />

        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          settings={settings}
          onSaveSettings={handleSaveSettings}
        />

        <AboutModal
          isOpen={isAboutModalOpen}
          onClose={() => setIsAboutModalOpen(false)}
        />

        {deleteTarget && (
          <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
            <div className="modal-box" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title"><span>{tt('delete_title')}</span></div>
                <button className="btn btn-ghost btn-icon" onClick={() => setDeleteTarget(null)}>×</button>
              </div>
              <div className="modal-body">
                <p style={{ marginBottom: '14px' }}>
                  <strong>{deleteTarget.item?.filename || tt('delete_this_download')}</strong> {tt('delete_will_remove')}
                </p>
                <label className="dn-check">
                  <input
                    type="checkbox"
                    checked={deleteAlsoFile}
                    onChange={(e) => setDeleteAlsoFile(e.target.checked)}
                  />
                  <span>{tt('delete_also_file')}</span>
                </label>
                {deleteAlsoFile && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--danger)', marginTop: '8px' }}>
                    {tt('delete_permanent')}
                  </div>
                )}
                {deleteTarget.item?.savePath && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '10px', wordBreak: 'break-all' }}>
                    {deleteTarget.item.savePath}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>{tt('btn_cancel')}</button>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    doDelete(deleteTarget.item.id, deleteAlsoFile);
                    setDeleteTarget(null);
                  }}
                >
                  {tt('btn_delete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {propertiesItem && (
          <div className="modal-overlay" onClick={() => setPropertiesItem(null)}>
            <div className="modal-box" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title"><span>{tt('props_title')}</span></div>
                <button className="btn btn-ghost btn-icon" onClick={() => setPropertiesItem(null)}>×</button>
              </div>
              <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                {(() => {
                  const it = downloads.find(d => d.id === propertiesItem.id) || propertiesItem;
                  const fmt = (b) => {
                    if (!b) return '-';
                    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
                    const i = Math.floor(Math.log(b) / Math.log(k));
                    return parseFloat((b / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
                  };
                  const statusKey = 'st_' + it.status;
                  const catKey = 'catName_' + it.category;
                  const statusLabel = tt(statusKey) !== statusKey ? tt(statusKey) : it.status;
                  const catLabel = tt(catKey) !== catKey ? tt(catKey) : it.category;
                  const rows = [
                    [tt('prop_filename'), it.filename],
                    [tt('prop_status'), statusLabel],
                    [tt('prop_size'), fmt(it.totalSize)],
                    [tt('prop_downloaded'), fmt(it.downloadedBytes)],
                    [tt('prop_category'), catLabel],
                    [tt('prop_saved_to'), it.savePath || it.saveDir],
                    [tt('prop_segments'), it.segmentsCount || 1],
                    [tt('prop_type'), it.kind === 'video' ? tt('prop_type_video') : tt('prop_type_file')],
                    ...(it.quality ? [[tt('prop_quality'), it.quality]] : []),
                    ...(it.checksum && it.checksum !== 'N/A' ? [['SHA-256', it.checksum]] : []),
                    ...(it.errorMsg ? [[tt('prop_error'), it.errorMsg]] : [])
                  ];
                  return (
                    <>
                      <div style={{ marginBottom: '10px', wordBreak: 'break-all' }}>
                        <div className="form-label">{tt('prop_url')}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{it.url}</div>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <tbody>
                          {rows.map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ padding: '5px 8px 5px 0', color: 'var(--text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                              <td style={{ padding: '5px 0', wordBreak: 'break-all' }}>{String(v ?? '-')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  );
                })()}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => handleCopyUrl(propertiesItem)}>{tt('btn_copy_url')}</button>
                <button className="btn btn-primary" onClick={() => setPropertiesItem(null)}>{tt('btn_close')}</button>
              </div>
            </div>
          </div>
        )}

        {selectedDownloadForChunks && (
          <ChunkProgressModal
            download={downloads.find(d => d.id === selectedDownloadForChunks.id) || selectedDownloadForChunks}
            onClose={() => setSelectedDownloadForChunks(null)}
            onStart={handleStart}
            onPause={handlePause}
          />
        )}
      </div>
    </I18nProvider>
  );
}
