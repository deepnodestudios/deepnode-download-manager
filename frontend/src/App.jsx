import React, { useState, useEffect, useRef } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import DownloadList from './components/DownloadList';
import SpeedChart from './components/SpeedChart';
import ChunkProgressModal from './components/ChunkProgressModal';
import AddDownloadModal from './components/AddDownloadModal';
import DownloadProgressWindow from './components/DownloadProgressWindow';
import DownloadCompleteWindow from './components/DownloadCompleteWindow';
import MediaSnifferModal from './components/MediaSnifferModal';
import SettingsModal from './components/SettingsModal';
import SchedulerModal from './components/SchedulerModal';
import BatchDownloadModal from './components/BatchDownloadModal';
import AboutModal from './components/AboutModal';
import UpdateModal from './components/UpdateModal';
import { I18nProvider, translate, resolveLanguage } from './i18n';
import { closeWindow, bringToFront, openExternal } from './native';
import { setAnonymousUser, setTelemetryEnabled } from './sentry';
import { ListOrdered } from 'lucide-react';

export default function App() {
  const [downloads, setDownloads] = useState([]);
  const [settings, setSettings] = useState(null);
  const [queues, setQueues] = useState([]);
  const [isNewQueueModalOpen, setIsNewQueueModalOpen] = useState(false);
  const [newQueueName, setNewQueueName] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('dn-sidebar-width');
    return saved ? parseInt(saved, 10) : 224;
  });

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [initialUrlForAdd, setInitialUrlForAdd] = useState('');
    const [initialQualityForAdd, setInitialQualityForAdd] = useState('');
    const [initialRefererForAdd, setInitialRefererForAdd] = useState('');
    const [initialIsVideoForAdd, setInitialIsVideoForAdd] = useState(false);
    const [initialFilenameForAdd, setInitialFilenameForAdd] = useState('');
  const [isSnifferModalOpen, setIsSnifferModalOpen] = useState(false);
  const [isSchedulerModalOpen, setIsSchedulerModalOpen] = useState(false);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [initialBatchUrls, setInitialBatchUrls] = useState([]);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const importInputRef = useRef(null);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [selectedDownloadForChunks, setSelectedDownloadForChunks] = useState(null);
  const [propertiesItem, setPropertiesItem] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null); // yeniden adlandırılacak indirme
  const [renameValue, setRenameValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null); // { item, preferFile }
  const [deleteAlsoFile, setDeleteAlsoFile] = useState(false);
  const [extStatus, setExtStatus] = useState(null); // tarayıcı eklentisi sürüm durumu
  const [extWarnDismissed, setExtWarnDismissed] = useState(false);
  const [appUpdate, setAppUpdate] = useState(null); // uygulama güncelleme bilgisi
  const [appUpdateDismissed, setAppUpdateDismissed] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [currentVersion, setCurrentVersion] = useState('');
  const [isStandaloneAdd] = useState(() => {
    return new URLSearchParams(window.location.search).get('mode') === 'add';
  });
  // Bağımsız ilerleme penceresi (mode=progress&id=...)
  const [standaloneProgressId] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('mode') === 'progress' ? p.get('id') : null;
  });
  // "İndirme Tamamlandı" diyaloğu (mode=complete&id=...)
  const [standaloneCompleteId] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get('mode') === 'complete' ? p.get('id') : null;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef(null);
  const wsRef = useRef(null);

  // Aktif arayüz dili (settings.language: 'auto' | 'tr' | 'en')
  const lang = resolveLanguage(settings?.language);
  const tt = (key, vars) => translate(lang, key, vars);
  // WebSocket efekti boş bağımlılıkla bir kez kurulur; dil değişince alert gibi
  // geri çağrıların eski dili kullanmaması için güncel çeviriciyi ref'te tut.
  const ttRef = useRef(tt);
  useEffect(() => { ttRef.current = tt; }, [lang]);

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
      const refererParam = params.get('referer'); // akış CDN'leri için sayfa adresi
      if (refererParam) {
        setInitialRefererForAdd(refererParam);
      }
      // video=1 -> eklentiden gelen video/manifest indirmesi (uzantısız .txt manifest dahil)
      if (params.get('video') === '1') {
        setInitialIsVideoForAdd(true);
      }
      // filename -> sayfa başlığından tahmin edilen dosya adı (HLS'te yt-dlp "master" derdi)
      const fnParam = params.get('filename');
      if (fnParam) {
        setInitialFilenameForAdd(fnParam);
      }
      setIsAddModalOpen(true);
    }

    // Initial fetch of downloads, settings and queues.
    // WS bağlantısı kurulup INIT_STATE geldikten sonra bu HTTP yanıtları
    // (daha eski bir anlık görüntü) yeni durumun üzerine yazmamalı.
    let wsStateReceived = false;
    const refreshState = () => {
      fetch('/api/downloads')
        .then(res => res.json())
        .then(data => { if (!wsStateReceived) setDownloads(data || []); })
        .catch(err => console.error('Failed to fetch downloads:', err));

      fetch('/api/settings')
        .then(res => res.json())
        .then(data => {
          if (wsStateReceived) return;
          setSettings(data || {});
          if (data) {
            setTelemetryEnabled(data.telemetryEnabled !== false);
            if (data.anonymousId) {
              setAnonymousUser(data.anonymousId);
            }
          }
        })
        .catch(err => console.error('Failed to fetch settings:', err));

      fetch('/api/queues')
        .then(res => res.json())
        .then(data => { if (!wsStateReceived) setQueues(data || []); })
        .catch(err => console.error('Failed to fetch queues:', err));

      fetch('/api/app/info')
        .then(res => res.json())
        .then(data => { if (data?.version) setCurrentVersion(data.version); })
        .catch(() => {});
    };
    refreshState();

    // WebSocket — YENİDEN BAĞLANMALI.
    // Eskiden tek bir bağlantı kuruluyor, `onclose`/`onerror` hiç dinlenmiyordu:
    // backend yeniden başladığında, bilgisayar uykudan döndüğünde veya bağlantı
    // düştüğünde arayüz son durumda DONUYOR ve kullanıcı uygulamayı kapatıp
    // açmak zorunda kalıyordu. Artık üstel geri çekilmeyle yeniden bağlanılır ve
    // her bağlantıda tam durum tazelenir.
    let reconnectDelay = 500;
    let reconnectTimer = null;
    let closedByUnmount = false;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsPort = window.location.port || 5000;
      const ws = new WebSocket(`${protocol}//${window.location.hostname}:${wsPort}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // Yeniden bağlanmada tam durum sunucudan INIT_STATE olarak gelir; ayrıca
        // HTTP ile tazeleme yapmak, arada gelen WS olaylarını eski veriyle ezebilir.
        reconnectDelay = 500;
      };

      ws.onclose = () => {
        if (closedByUnmount) return;
        reconnectTimer = setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 10000); // 0,5s → 10s
      };

      ws.onerror = () => {
        try { ws.close(); } catch (e) { /* onclose zaten tetiklenecek */ }
      };

      ws.onmessage = handleMessage;
    };

    const handleMessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const { type, payload } = msg;
        wsStateReceived = true;

        if (type === 'INIT_STATE') {
          setDownloads(payload.downloads || []);
          setSettings(payload.settings || {});
          if (payload.queues) setQueues(payload.queues);
          if (payload.settings) {
            setTelemetryEnabled(payload.settings.telemetryEnabled !== false);
            if (payload.settings.anonymousId) {
              setAnonymousUser(payload.settings.anonymousId);
            }
          }
        } else if (type === 'SETTINGS_CHANGED') {
          if (payload) {
            setSettings(prev => ({ ...(prev || {}), ...payload }));
            setTelemetryEnabled(payload.telemetryEnabled !== false);
            if (payload.anonymousId) setAnonymousUser(payload.anonymousId);
          }
        } else if (type === 'PROGRESS') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return {
                ...item,
                downloadedBytes: payload.downloadedBytes,
                totalSize: payload.totalSize,
                speed: payload.speed,
                eta: payload.eta,
                percent: payload.percent !== undefined ? payload.percent : item.percent,
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
        } else if (type === 'ERROR') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return { ...item, status: 'error', errorMsg: payload.error };
            }
            return item;
          }));
        } else if (type === 'COMPLETED') {
          setDownloads(prev => prev.map(item => {
            if (item.id === payload.id) {
              return {
                ...item,
                status: 'completed',
                checksum: payload.checksum,
                savePath: payload.savePath || item.savePath,
                speed: 0,
                eta: 0
              };
            }
            return item;
          }));
        } else if (type === 'DOWNLOAD_ADDED') {
          setDownloads(prev => {
            const index = prev.findIndex(d => d.id === payload.id);
            if (index !== -1) {
              const updated = [...prev];
              updated[index] = { ...updated[index], ...payload };
              return updated;
            }
            return [...prev, payload];
          });
        } else if (type === 'DOWNLOAD_DELETED') {
          setDownloads(prev => prev.filter(d => d.id !== payload.id));
        } else if (type === 'PROMPT_ADD_DOWNLOAD') {
          if (payload && payload.url) {
            handleOpenAddModal(payload.url);
          }
        } else if (type === 'PROMPT_BATCH') {
          if (payload && Array.isArray(payload.urls)) {
            setInitialBatchUrls(payload.urls);
            setIsBatchModalOpen(true);
            bringToFront();
          }
        } else if (type === 'VIRUS_ALERT') {
          if (payload && payload.id) {
            setDownloads(prev => prev.map(item => {
              if (item.id === payload.id) {
                return { ...item, virusAlert: true };
              }
              return item;
            }));
          }
          if (payload && payload.threat) {
            alert(ttRef.current('virus_alert_detected', { file: payload.filename || 'Dosya', threat: payload.threat }));
          }
        }
      } catch (err) {
        console.error('WS Parse Error:', err);
      }
    };

    connect();

    return () => {
      closedByUnmount = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (window.ddmNative?.onPromptBatch) {
      window.ddmNative.onPromptBatch((payload) => {
        if (payload?.urls) {
          setInitialBatchUrls(payload.urls);
          setIsBatchModalOpen(true);
        }
      });
    }
  }, []);

  // Tarayıcıdaki eklenti eski sürümde mi? (eklenti 30 sn'de bir sunucuya
  // sürümünü bildirir; Chrome paketten yüklenen eklentiyi otomatik yenilemez)
  useEffect(() => {
    if (isStandaloneAdd || standaloneProgressId || standaloneCompleteId) return;
    const check = () =>
      fetch('/api/extension/status')
        .then(res => res.json())
        .then(data => setExtStatus(data || null))
        .catch(() => {});
    check();
    const timer = setInterval(check, 20000);
    return () => clearInterval(timer);
  }, [isStandaloneAdd, standaloneProgressId, standaloneCompleteId]);

  // Uygulama güncellemesi var mı? (açılışta bir kez + 6 saatte bir kontrol)
  useEffect(() => {
    if (isStandaloneAdd || standaloneProgressId || standaloneCompleteId) return;
    const check = () =>
      fetch('/api/update/check')
        .then(res => res.json())
        .then(data => {
          if (data && !data.error) {
            setAppUpdate(data);
            if (data.current) setCurrentVersion(data.current);
            if (data.updateAvailable) {
              setIsUpdateModalOpen(true);
            }
          }
        })
        .catch(() => {});
    check();
    const timer = setInterval(check, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isStandaloneAdd, standaloneProgressId, standaloneCompleteId]);

  // Global klavye kısayolları: Insert/Ctrl+N ekle, Ctrl+L yakalayıcı,
  // Ctrl+, ayarlar, F1 hakkında. Liste kısayolları (Del, Ctrl+A, Enter) DownloadList'te.
  useEffect(() => {
    if (isStandaloneAdd || standaloneProgressId) return;
    const onKey = (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      const type = (e.target.type || '').toLowerCase();
      const editable = tag === 'textarea' || tag === 'select' || e.target.isContentEditable ||
        (tag === 'input' && !['checkbox', 'radio', 'button', 'range'].includes(type));
      if (editable) return;
      if (e.key === 'Insert' || ((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N'))) {
        e.preventDefault();
        handleOpenAddModal();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 40);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
        e.preventDefault();
        setIsSnifferModalOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setIsSettingsModalOpen(true);
      } else if (e.key === 'F1') {
        e.preventDefault();
        setIsAboutModalOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStandaloneAdd, standaloneProgressId]);

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

  // Arka plan ön indirmesi (preflight): onay penceresi açıkken arka planda inen gizli
  // öğeler ana listede/saygılarda görünmez — onaylanınca bayrak kalkar ve listelenir
  const visibleDownloads = downloads.filter(item => !item.preflight);

  // Filter downloads by activeFilter and searchQuery
  const filteredDownloads = visibleDownloads.filter(item => {
    let matchesCategory = true;
    if (activeFilter.startsWith('queue:')) {
      const qId = activeFilter.replace('queue:', '');
      matchesCategory = (item.queueId || 'main') === qId;
    } else if (activeFilter === 'downloading') {
      matchesCategory = item.status === 'downloading' || item.status === 'merging';
    } else if (activeFilter === 'completed') {
      matchesCategory = item.status === 'completed';
    } else if (activeFilter === 'paused') {
      matchesCategory = item.status === 'paused' || item.status === 'queued';
    } else if (activeFilter !== 'all') {
      matchesCategory = item.category === activeFilter;
    }

    if (!matchesCategory) return false;

    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    const nameMatch = (item.filename || '').toLowerCase().includes(q);
    const urlMatch = (item.url || '').toLowerCase().includes(q);
    const catMatch = (item.category || '').toLowerCase().includes(q);
    return nameMatch || urlMatch || catMatch;
  });

  // Calculate total speed across all active downloads
  const totalSpeed = visibleDownloads.reduce((acc, curr) => {
    return curr.status === 'downloading' ? acc + (curr.speed || 0) : acc;
  }, 0);

  const handleOpenAddModal = (url = '') => {
    setInitialUrlForAdd(typeof url === 'string' ? url : '');
    setIsAddModalOpen(true);
    bringToFront(); // uygulamayı en ön plana getir (Electron dışında no-op)
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
            referer: newDownloadData.referer,
            saveDir: newDownloadData.saveDir,
            autoStart: newDownloadData.autoStart,
            queueId: newDownloadData.queueId || 'main',
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
      // Not: İlerleme penceresini backend tetikler (serverEvents 'open-progress')
      // — ana pencerede nodeIntegration kapalı olduğundan renderer IPC'si güvenilmez.
      // Yakalanan link için arka planda ön indirme (preflight) varsa /api/download/add
      // onu sunucu tarafında devralıp KALDIĞI YERDEN devam ettirir (yeni kayıt açmaz).
    } catch (err) {
      alert(tt('alert_add_error', { msg: err.message }));
      throw err;
    }
  };

  const handleAddBatch = async (urls, saveDir, autoStart, queueId = 'main') => {
    try {
      const res = await fetch('/api/download/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, saveDir, autoStart, queueId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (err) {
      alert(tt('alert_batch_error', { msg: err.message }));
      throw err;
    }
  };

  const handleExportDownloads = () => {
    const link = document.createElement('a');
    link.href = '/api/downloads/export?format=txt';
    link.download = 'ddm-downloads.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportDownloads = () => {
    importInputRef.current?.click();
  };

  const handleImportFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        const res = await fetch('/api/downloads/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Array.isArray(data) ? { items: data } : data)
        });
        const resData = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(resData?.error || `HTTP ${res.status}`);
        }
        alert(tt('import_success', { count: resData.count || 0 }));
      } else {
        const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
        if (urls.length > 0) {
          setInitialBatchUrls(urls);
          setIsBatchModalOpen(true);
        } else {
          alert(tt('import_no_urls'));
        }
      }
    } catch (err) {
      alert(tt('alert_import_failed', { msg: err.message }));
    } finally {
      if (e.target) e.target.value = '';
    }
  };

  const handleStart = (id) => fetch(`/api/download/${id}/start`, { method: 'POST' }).then(async res => {
    if (!res.ok) { const d = await res.json(); console.error('Start error:', d.error); }
  }).catch(err => console.error('Start request failed:', err));

  const handlePause = (id) => fetch(`/api/download/${id}/pause`, { method: 'POST' }).then(async res => {
    if (!res.ok) { const d = await res.json(); console.error('Pause error:', d.error); }
  }).catch(err => console.error('Pause request failed:', err));

  const doDelete = (id, deleteFile) => {
    if (!id) return;
    return fetch(`/api/download/${id}?deleteFile=${deleteFile ? 'true' : 'false'}`, { method: 'DELETE' }).catch(() => {});
  };

  // Silme isteği: "diskten de silinsin mi?" onay penceresini açar
  const handleDelete = (target, deleteFile, skipConfirm) => {
    const rawId = typeof target === 'object' && target !== null ? target.id : target;
    if (!rawId) return;
    const item = typeof target === 'object' && target !== null && target.filename
      ? target
      : (downloads.find(d => d.id === rawId) || null);

    if (skipConfirm || settings?.confirmOnDelete === false) {
      return doDelete(rawId, deleteFile === true);
    }
    setDeleteAlsoFile(deleteFile === true);
    setDeleteTarget({ item, id: rawId, preferFile: deleteFile === true });
  };

  const handleBulkDelete = (ids) => {
    const validIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (validIds.length === 0) return;
    if (settings?.confirmOnDelete === false) {
      validIds.forEach(id => doDelete(id, false));
    } else {
      setDeleteAlsoFile(false);
      setDeleteTarget({ ids: validIds, count: validIds.length });
    }
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

  const handleRename = (item) => {
    // Electron window.prompt()'u desteklemez (null döner ve sessizce iptal olur) —
    // bu yüzden in-app modal kullanılır.
    setRenameValue(item.filename || '');
    setRenameTarget(item);
  };

  const submitRename = async () => {
    if (!renameTarget) return;
    const name = (renameValue || '').trim();
    if (!name || name === renameTarget.filename) { setRenameTarget(null); return; }
    try {
      const res = await fetch(`/api/download/${renameTarget.id}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name })
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      setRenameTarget(null);
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

  const handleOpenDownloadRootDir = async () => {
    try {
      const res = await fetch('/api/open-download-root', { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    } catch (err) {
      alert(tt('alert_reveal_failed', { msg: err.message }));
    }
  };

  const handleStartAll = () => fetch('/api/download/start-all', { method: 'POST' }).catch(err => console.error('Start-all error:', err));
  const handlePauseAll = () => fetch('/api/download/pause-all', { method: 'POST' }).catch(err => console.error('Pause-all error:', err));

  const handleSaveSettings = async (newSettings) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });
      const updated = await res.json();
      if (!res.ok) throw new Error(updated.detail || updated.error || 'Failed to save settings');
      setSettings(updated);
      // Sentry'yi yeniden başlatmadan da telemetri tercihi anında uygulansın
      setTelemetryEnabled(newSettings.telemetryEnabled !== false);
    } catch (err) {
      alert(tt('alert_settings_failed', { msg: err.message }));
      // Hatayı yutma: SettingsModal başarısız kayıtta kapanmamalı.
      throw err;
    }
  };

  const handleMoveToQueue = async (id, targetQueueId) => {
    try {
      const res = await fetch(`/api/download/${id}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: targetQueueId })
      });
      if (res.ok) {
        setDownloads(prev => prev.map(d => d.id === id ? { ...d, queueId: targetQueueId } : d));
      }
    } catch (err) {
      console.error('Failed to move download to queue:', err);
    }
  };

  const handleCreateQueue = async (name) => {
    if (!name || !name.trim()) return;
    try {
      const res = await fetch('/api/queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() })
      });
      if (res.ok) {
        const newQ = await res.json();
        setQueues(prev => [...prev, newQ]);
        setIsNewQueueModalOpen(false);
        setNewQueueName('');
      }
    } catch (err) {
      alert(tt('alert_add_error', { msg: err.message }));
    }
  };

  const handleDeleteQueue = async (id) => {
    if (!window.confirm(tt('confirm_delete_queue') || 'Bu kuyruğu silmek istediğinize emin misiniz? Kuyruktaki indirmeler Ana Kuyruğa aktarılacaktır.')) return;
    try {
      const res = await fetch(`/api/queues/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setQueues(prev => prev.filter(q => q.id !== id));
        setDownloads(prev => prev.map(d => d.queueId === id ? { ...d, queueId: 'main' } : d));
        if (activeFilter === `queue:${id}`) {
          setActiveFilter('all');
        }
      }
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUpdateQueue = async (id, data) => {
    try {
      const res = await fetch(`/api/queues/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const updated = await res.json().catch(() => null);
      if (!res.ok) throw new Error(updated?.error || `HTTP ${res.status}`);
      if (updated) setQueues(prev => prev.map(q => q.id === id ? updated : q));
      return updated;
    } catch (err) {
      console.error('Failed to update queue:', err);
      throw err;
    }
  };

  if (standaloneCompleteId) {
    return (
      <I18nProvider languagePref={settings?.language}>
        <DownloadCompleteWindow download={downloads.find(d => d.id === standaloneCompleteId)} />
      </I18nProvider>
    );
  }

  if (standaloneProgressId) {
    return (
      <I18nProvider languagePref={settings?.language}>
        <DownloadProgressWindow download={downloads.find(d => d.id === standaloneProgressId)} settings={settings} />
      </I18nProvider>
    );
  }

  if (isStandaloneAdd) {
    return (
      <I18nProvider languagePref={settings?.language}>
        <div className="standalone-add-container" style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
          <AddDownloadModal
            isOpen={true}
            onClose={closeWindow}
            onAddDownload={async (data) => {
              await handleAddDownload(data);
              closeWindow();
            }}
            onAddBatch={async (...args) => {
              await handleAddBatch(...args);
              closeWindow();
            }}
            settings={settings}
            queues={queues}
            initialUrl={initialUrlForAdd}
            initialQuality={initialQualityForAdd}
            initialReferer={initialRefererForAdd}
            initialIsVideo={initialIsVideoForAdd}
            initialFilename={initialFilenameForAdd}
            isStandalone={true}
          />
        </div>
      </I18nProvider>
    );
  }

  // Açık bir modal/onay penceresi varken liste kısayolları (özellikle Delete)
  // arka planda çalışmamalı.
  const listShortcutsDisabled = isAddModalOpen || isBatchModalOpen || isSettingsModalOpen ||
    isSnifferModalOpen || isSchedulerModalOpen || isNewQueueModalOpen || isAboutModalOpen ||
    isUpdateModalOpen || !!selectedDownloadForChunks || !!propertiesItem || !!renameTarget ||
    !!deleteTarget;

  return (
    <I18nProvider languagePref={settings?.language}>
      <div className="app-layout">
        <Navbar
          sidebarWidth={sidebarWidth}
          onOpenAddModal={handleOpenAddModal}
          onOpenBatchModal={() => { setInitialBatchUrls([]); setIsBatchModalOpen(true); }}
          onStartAll={handleStartAll}
          onPauseAll={handlePauseAll}
          onOpenSchedulerModal={() => setIsSchedulerModalOpen(true)}
          schedulerEnabled={!!settings?.schedulerEnabled}
          onOpenSnifferModal={() => setIsSnifferModalOpen(true)}
          onExportDownloads={handleExportDownloads}
          onImportDownloads={handleImportDownloads}
          onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
          onOpenAboutModal={() => setIsAboutModalOpen(true)}
          onOpenDownloadRootDir={handleOpenDownloadRootDir}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          isSearchOpen={isSearchOpen}
          onToggleSearch={setIsSearchOpen}
          searchInputRef={searchInputRef}
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
                  // Köprü yoksa window.open Electron İÇİNDE pencere açardı;
                  // openExternal daima sistem tarayıcısına yollar.
                  openExternal(e.currentTarget.href);
                }}
                style={{ color: 'var(--link)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                {tt('release_notes')}
              </a>
            </span>
            <button
              className="btn btn-primary btn-xs"
              onClick={() => openExternal(appUpdate.downloadUrl)}
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
            sidebarWidth={sidebarWidth}
            setSidebarWidth={setSidebarWidth}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            downloads={visibleDownloads}
            queues={queues}
            onOpenNewQueueModal={() => { setNewQueueName(''); setIsNewQueueModalOpen(true); }}
            onDeleteQueue={handleDeleteQueue}
          />

          <main className="content-area">
            <SpeedChart
              currentSpeed={totalSpeed}
            />

            <DownloadList
              downloads={filteredDownloads}
              searchQuery={searchQuery}
              onClearSearch={() => setSearchQuery('')}
              onStart={handleStart}
              onPause={handlePause}
              onDelete={handleDelete}
              onBulkDelete={handleBulkDelete}
              onInspectChunks={(item) => setSelectedDownloadForChunks(item)}
              onOpenFile={handleOpenFile}
              onRevealFolder={handleRevealFolder}
              onRedownload={handleRedownload}
              onRename={handleRename}
              onCopyUrl={handleCopyUrl}
              onShowProperties={handleShowProperties}
              onSetPriority={handleSetPriority}
              queues={queues}
              onMoveToQueue={handleMoveToQueue}
              shortcutsEnabled={!listShortcutsDisabled}
            />
          </main>
        </div>

        <AddDownloadModal
          isOpen={isAddModalOpen}
          onClose={() => { setIsAddModalOpen(false); setInitialUrlForAdd(''); }}
          onAddDownload={handleAddDownload}
          onAddBatch={handleAddBatch}
          settings={settings}
          queues={queues}
          initialUrl={initialUrlForAdd}
        />

        <BatchDownloadModal
          isOpen={isBatchModalOpen}
          onClose={() => { setIsBatchModalOpen(false); setInitialBatchUrls([]); }}
          onAddBatch={handleAddBatch}
          settings={settings}
          initialUrls={initialBatchUrls}
        />

        <input
          type="file"
          ref={importInputRef}
          style={{ display: 'none' }}
          accept=".txt,.json"
          onChange={handleImportFileChange}
        />

        <MediaSnifferModal
          isOpen={isSnifferModalOpen}
          onClose={() => setIsSnifferModalOpen(false)}
          onAddBatch={handleAddBatch}
          queues={queues}
          autoStartDownloads={settings?.autoStartDownloads ?? true}
        />

        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          settings={settings}
          onSaveSettings={handleSaveSettings}
        />

        <SchedulerModal
          isOpen={isSchedulerModalOpen}
          onClose={() => setIsSchedulerModalOpen(false)}
          settings={settings}
          onSaveSettings={handleSaveSettings}
          queues={queues}
          onUpdateQueue={handleUpdateQueue}
        />

        {isNewQueueModalOpen && (
          <div className="modal-overlay" onClick={() => setIsNewQueueModalOpen(false)}>
            <div className="modal-box" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ListOrdered size={20} color="var(--primary-2)" />
                  <span>{tt('btn_add_queue')}</span>
                </div>
                <button className="btn btn-ghost btn-icon" onClick={() => setIsNewQueueModalOpen(false)}>×</button>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); handleCreateQueue(newQueueName); }}>
                <div className="modal-body">
                  <div className="form-group">
                    <label className="form-label">{tt('prompt_queue_name')}</label>
                    <input
                      type="text"
                      className="form-input"
                      value={newQueueName}
                      onChange={e => setNewQueueName(e.target.value)}
                      placeholder={tt('prompt_queue_name')}
                      autoFocus
                      required
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setIsNewQueueModalOpen(false)}>
                    {tt('btn_cancel')}
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {tt('btn_save')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <AboutModal
          isOpen={isAboutModalOpen}
          onClose={() => setIsAboutModalOpen(false)}
        />

        <UpdateModal
          isOpen={isUpdateModalOpen}
          onClose={() => {
            setIsUpdateModalOpen(false);
            setAppUpdateDismissed(true);
          }}
          updateData={appUpdate}
          currentVersion={currentVersion}
        />

        {deleteTarget && (
          <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
            <div className="modal-box" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title"><span>{tt('delete_title')}</span></div>
                <button className="btn btn-ghost btn-icon" onClick={() => setDeleteTarget(null)}>×</button>
              </div>
              <div className="modal-body">
                {deleteTarget.ids ? (
                  <p style={{ marginBottom: '14px' }}>
                    {tt('confirm_bulk_delete', { n: deleteTarget.count })}
                  </p>
                ) : (
                  <p style={{ marginBottom: '14px' }}>
                    <strong>{deleteTarget.item?.filename || tt('delete_this_download')}</strong> {tt('delete_will_remove')}
                  </p>
                )}
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
                {!deleteTarget.ids && deleteTarget.item?.savePath && (
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
                    if (deleteTarget?.ids && Array.isArray(deleteTarget.ids)) {
                      deleteTarget.ids.forEach(id => {
                        if (id) doDelete(id, deleteAlsoFile);
                      });
                    } else {
                      const idToDelete = deleteTarget?.id || deleteTarget?.item?.id;
                      if (idToDelete) {
                        doDelete(idToDelete, deleteAlsoFile);
                      }
                    }
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
                    if (!b || b <= 0) return '-';
                    const k = 1024, s = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
                    // Birim dizisini AŞMA: 1 TB üstünde eskiden "NaN undefined" yazıyordu
                    const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1);
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

        {renameTarget && (
          <div className="modal-overlay" onClick={() => setRenameTarget(null)}>
            <div className="modal-box" style={{ maxWidth: '460px' }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div className="modal-title"><span>{tt('ctx_rename')}</span></div>
                <button className="btn btn-ghost btn-icon" onClick={() => setRenameTarget(null)}>×</button>
              </div>
              <div className="modal-body">
                <label className="form-label" style={{ display: 'block', marginBottom: '6px' }}>{tt('prompt_rename')}</label>
                <input
                  type="text"
                  className="form-input"
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
                  style={{ width: '100%' }}
                />
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setRenameTarget(null)}>{tt('btn_cancel')}</button>
                <button className="btn btn-primary" onClick={submitRename}>{tt('ctx_rename')}</button>
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
