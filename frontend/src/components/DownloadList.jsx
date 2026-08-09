import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, Trash2, Layers, Video, Music, Archive, FileText, Cpu, Image as ImageIcon, Folder, FolderOpen, ExternalLink, AlertCircle, CheckCircle2, Clock,
  RotateCcw, Link2, Edit3, Info, XCircle, CheckSquare, Square, DownloadCloud, RefreshCw
} from 'lucide-react';
import { useT } from '../i18n';
import { isElectron, popupDownloadMenu } from '../native';
import RefreshUrlModal from './RefreshUrlModal';

// Sabit sütun genişlikleri (px) — içerik değişse bile sütunlar yatay kaymaz.
// Kullanıcı ayraçları sürükleyerek değiştirebilir; tercihler localStorage'da saklanır.
const DEFAULT_COL_ORDER = ['select', 'name', 'size', 'progress', 'speed', 'eta', 'status', 'actions'];
const DEFAULT_COL_WIDTHS = { select: 36, size: 90, progress: 75, speed: 85, eta: 75, status: 130, actions: 170 }; // 'name' is fluid by default
const MIN_COL_WIDTH = 56;
const COL_WIDTHS_KEY = 'dn-col-widths-v2';
const COL_ORDER_KEY = 'dn-col-order';

export default function DownloadList({
  downloads,
  onStart,
  onPause,
  onDelete,
  onBulkDelete,
  onInspectChunks,
  onOpenFile,
  onRevealFolder,
  onRedownload,
  onRename,
  onCopyUrl,
  onShowProperties,
  onSetPriority
}) {
  const { t } = useT();
  const [menu, setMenu] = useState(null); // { x, y, item }
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dragBox, setDragBox] = useState(null); // { x1, y1, x2, y2 } in container coords
  const [refreshingItem, setRefreshingItem] = useState(null);

  const handleRefreshUrlSubmit = async (id, newUrl) => {
    try {
      const res = await fetch(`/api/download/${id}/update-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl })
      });
      if (res.ok && onStart) {
        onStart(id);
      }
    } catch (err) {
      console.error('Failed to update download URL:', err);
    }
  };
  const lastClickedIndex = useRef(-1);
  const containerRef = useRef(null);
  const dragState = useRef(null); // { startX, startY, ctrlHeld }

  // --- Sütun genişlikleri (sürüklenerek ayarlanabilir) ---
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY));
      if (saved && typeof saved === 'object') return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch (e) { }
    return DEFAULT_COL_WIDTHS;
  });
  
  const [colOrder, setColOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_ORDER_KEY));
      if (Array.isArray(saved) && saved.length === DEFAULT_COL_ORDER.length) return saved;
    } catch (e) { }
    return DEFAULT_COL_ORDER;
  });
  const resizeState = useRef(null);

  const handleDragStart = (e, colId) => {
    if (colId === 'select' || colId === 'actions') return;
    e.dataTransfer.setData('text/plain', colId);
  };
  const handleDrop = (e, targetColId) => {
    e.preventDefault();
    const sourceColId = e.dataTransfer.getData('text/plain');
    if (!sourceColId || sourceColId === targetColId) return;
    if (sourceColId === 'select' || targetColId === 'select' || sourceColId === 'actions' || targetColId === 'actions') return;

    setColOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(sourceColId);
      const toIdx = next.indexOf(targetColId);
      if (fromIdx > -1 && toIdx > -1) {
        next.splice(fromIdx, 1);
        next.splice(toIdx, 0, sourceColId);
        try { localStorage.setItem(COL_ORDER_KEY, JSON.stringify(next)); } catch (err) {}
      }
      return next;
    });
  };
  const handleDragOver = (e) => { e.preventDefault(); }; // { key, startX, startW }

  const startColResize = useCallback((e, key) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { key, startX: e.clientX, startW: colWidths[key] || e.target.closest('th').offsetWidth };
    const onMove = (ev) => {
      if (!resizeState.current) return;
      const { key: k, startX, startW } = resizeState.current;
      const w = Math.max(MIN_COL_WIDTH, Math.round(startW + (ev.clientX - startX)));
      setColWidths(prev => (prev[k] === w ? prev : { ...prev, [k]: w }));
    };
    const onUp = () => {
      resizeState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      setColWidths(prev => {
        try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(prev)); } catch (err) { /* kota dolu vb. */ }
        return prev;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  }, [colWidths]);

  const totalColWidth = Object.values(colWidths).reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) + (colWidths.name || 200);

  // --- Selection helpers ---
  const toggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectRange = useCallback((fromIdx, toIdx) => {
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    setSelectedIds(() => {
      const next = new Set();
      for (let i = start; i <= end; i++) {
        if (downloads[i]) next.add(downloads[i].id);
      }
      return next;
    });
  }, [downloads]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(downloads.map(d => d.id)));
  }, [downloads]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setFocusedIndex(-1);
    lastClickedIndex.current = -1;
  }, []);

  // --- Row click handler (Ctrl/Shift/Normal) ---
  const handleRowClick = useCallback((e, index, item) => {
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(item.id);
      lastClickedIndex.current = index;
      setFocusedIndex(index);
    } else if (e.shiftKey && lastClickedIndex.current >= 0) {
      selectRange(lastClickedIndex.current, index);
      setFocusedIndex(index);
    } else {
      setSelectedIds(new Set([item.id]));
      lastClickedIndex.current = index;
      setFocusedIndex(index);
    }
  }, [toggleSelect, selectRange]);

  // --- Bulk actions ---
  const bulkDelete = useCallback(() => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (ids.length > 1) {
      onBulkDelete(ids);
    } else {
      ids.forEach(id => onDelete(id));
    }
    clearSelection();
  }, [selectedIds, onDelete, onBulkDelete, clearSelection]);

  const bulkPause = useCallback(() => {
    selectedIds.forEach(id => {
      const item = downloads.find(d => d.id === id);
      if (item && item.status === 'downloading') onPause(id);
    });
  }, [selectedIds, downloads, onPause]);

  const bulkResume = useCallback(() => {
    selectedIds.forEach(id => {
      const item = downloads.find(d => d.id === id);
      if (item && (item.status === 'paused' || item.status === 'queued' || item.status === 'error')) onStart(id);
    });
  }, [selectedIds, downloads, onStart]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if typing in an input/textarea — but checkbox/radio/button focus
      // (row selection) must NOT swallow shortcuts like Delete
      const tag = e.target.tagName.toLowerCase();
      const type = (e.target.type || '').toLowerCase();
      const editable = tag === 'textarea' || tag === 'select' || e.target.isContentEditable ||
        (tag === 'input' && !['checkbox', 'radio', 'button', 'range'].includes(type));
      if (editable) return;
      if (downloads.length === 0) return;

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, downloads.length - 1);
          setFocusedIndex(next);
          if (e.shiftKey) {
            selectRange(lastClickedIndex.current >= 0 ? lastClickedIndex.current : next, next);
          } else if (!e.ctrlKey) {
            setSelectedIds(new Set([downloads[next].id]));
            lastClickedIndex.current = next;
          }
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          if (e.shiftKey) {
            selectRange(lastClickedIndex.current >= 0 ? lastClickedIndex.current : prev, prev);
          } else if (!e.ctrlKey) {
            setSelectedIds(new Set([downloads[prev].id]));
            lastClickedIndex.current = prev;
          }
          break;
        }
        case ' ':
        case 'Spacebar': {
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < downloads.length) {
            toggleSelect(downloads[focusedIndex].id);
          }
          break;
        }
        case 'a':
        case 'A': {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            selectAll();
          }
          break;
        }
        case 'Delete': {
          if (selectedIds.size > 0) {
            e.preventDefault();
            bulkDelete();
          }
          break;
        }
        case 'Enter': {
          if (selectedIds.size === 1 && focusedIndex >= 0) {
            e.preventDefault();
            const item = downloads[focusedIndex];
            if (item && item.status === 'completed') onOpenFile && onOpenFile(item.id);
            else if (item) onShowProperties && onShowProperties(item);
          }
          break;
        }
        case 'Escape': {
          clearSelection();
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [downloads, focusedIndex, selectedIds, toggleSelect, selectAll, selectRange, bulkDelete, clearSelection, onOpenFile, onShowProperties]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex < 0 || !containerRef.current) return;
    const rows = containerRef.current.querySelectorAll('tbody tr');
    if (rows[focusedIndex]) {
      rows[focusedIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedIndex]);

  // --- Drag (rubber-band) selection ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getRelPos = (e) => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left + container.scrollLeft, y: e.clientY - rect.top + container.scrollTop };
    };

    const hitTestRows = (box) => {
      const rows = container.querySelectorAll('tbody tr');
      const ids = new Set();
      const bx1 = Math.min(box.x1, box.x2);
      const bx2 = Math.max(box.x1, box.x2);
      const by1 = Math.min(box.y1, box.y2);
      const by2 = Math.max(box.y1, box.y2);
      rows.forEach((row, i) => {
        const rr = row.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        const ry1 = rr.top - cr.top + container.scrollTop;
        const ry2 = ry1 + rr.height;
        // Check vertical overlap
        if (ry2 >= by1 && ry1 <= by2) {
          if (downloads[i]) ids.add(downloads[i].id);
        }
      });
      return ids;
    };

    const onMouseDown = (e) => {
      // Only start drag on left button, not on a row/interactive element
      if (e.button !== 0) return;
      const target = e.target;
      if (target.closest('tr') || target.closest('button') || target.closest('a') || target.closest('.row-checkbox')) return;
      const pos = getRelPos(e);
      dragState.current = { startX: pos.x, startY: pos.y, ctrlHeld: e.ctrlKey || e.metaKey };
      setDragBox({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
      if (!dragState.current.ctrlHeld) {
        setSelectedIds(new Set());
      }
    };

    const onMouseMove = (e) => {
      if (!dragState.current) return;
      e.preventDefault();
      const pos = getRelPos(e);
      const box = { x1: dragState.current.startX, y1: dragState.current.startY, x2: pos.x, y2: pos.y };
      setDragBox(box);
      const hitIds = hitTestRows(box);
      if (dragState.current.ctrlHeld) {
        setSelectedIds(prev => {
          const next = new Set(prev);
          hitIds.forEach(id => next.add(id));
          return next;
        });
      } else {
        setSelectedIds(hitIds);
      }
    };

    const onMouseUp = () => {
      if (!dragState.current) return;
      dragState.current = null;
      setDragBox(null);
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [downloads]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    const onEsc = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onEsc);
    };
  }, [menu]);

  const openMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    // Menü daima tıklanan noktada açılır; viewport'a sığdırmak için kaydırılmaz
    // (gerekirse pencereden uzun olabilir — kullanıcı tercihi).
    setMenu({ x: e.clientX, y: e.clientY, item });
  };

  const run = (fn, ...args) => { setMenu(null); if (fn) fn(...args); };

  // --- Native (pencereden bağımsız) sağ tık menüsü ---
  // Electron'da DOM menüsü pencere sınırlarında kırpılıyor. Menü öğeleri main
  // sürecine gönderilir ve yerel OS menüsü olarak imleç konumunda açılır.
  const buildMenuItems = (item) => {
    const it = [];
    if (item.status === 'completed') it.push({ command: 'open', label: t('ctx_open') });
    it.push({ command: 'reveal', label: t('ctx_open_folder') });
    it.push({ type: 'separator' });
    if (item.status === 'downloading') it.push({ command: 'pause', label: t('ctx_pause') });
    else if (item.status !== 'completed') it.push({ command: 'start', label: t('ctx_start') });
    it.push({ command: 'redownload', label: t('ctx_redownload') });
    it.push({ command: 'refreshurl', label: t('ctx_refresh_url') });
    it.push({ command: 'rename', label: t('ctx_rename') });
    it.push({ type: 'separator' });
    const pr = item.priority || 'normal';
    it.push({ label: t('ctx_priority'), submenu: [
      { command: 'priority:high', label: t('pri_high'), type: 'radio', checked: pr === 'high' },
      { command: 'priority:normal', label: t('pri_normal'), type: 'radio', checked: pr === 'normal' },
      { command: 'priority:low', label: t('pri_low'), type: 'radio', checked: pr === 'low' }
    ] });
    it.push({ type: 'separator' });
    it.push({ command: 'copyurl', label: t('ctx_copy_url') });
    it.push({ command: 'chunks', label: t('ctx_chunks') });
    it.push({ command: 'properties', label: t('ctx_properties') });
    it.push({ type: 'separator' });
    it.push({ command: 'remove', label: t('ctx_remove') });
    it.push({ command: 'deletefile', label: t('ctx_delete_file') });
    return it;
  };

  const runCommand = (cmd, item) => {
    switch (cmd) {
      case 'open': onOpenFile && onOpenFile(item.id); break;
      case 'reveal': onRevealFolder && onRevealFolder(item.id); break;
      case 'start': onStart && onStart(item.id); break;
      case 'pause': onPause && onPause(item.id); break;
      case 'redownload': onRedownload && onRedownload(item); break;
      case 'refreshurl': setRefreshingItem(item); break;
      case 'rename': onRename && onRename(item); break;
      case 'copyurl': onCopyUrl && onCopyUrl(item); break;
      case 'chunks': onInspectChunks && onInspectChunks(item); break;
      case 'properties': onShowProperties && onShowProperties(item); break;
      case 'remove': onDelete && onDelete(item.id, false); break;
      case 'deletefile': onDelete && onDelete(item.id, true); break;
      case 'priority:high': onSetPriority && onSetPriority(item.id, 'high'); break;
      case 'priority:normal': onSetPriority && onSetPriority(item.id, 'normal'); break;
      case 'priority:low': onSetPriority && onSetPriority(item.id, 'low'); break;
      default: break;
    }
  };

  const showMenu = (e, item) => {
    const native = isElectron();
    if (!native) { openMenu(e, item); return; } // tarayıcı/dev: DOM menüsü
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    Promise.resolve(popupDownloadMenu(buildMenuItems(item)))
      .then((cmd) => { if (cmd) runCommand(cmd, item); })
      .catch(() => setMenu({ x, y, item }));
  };
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatSeconds = (sec) => {
    if (!sec || sec === Infinity || isNaN(sec)) return '--:--';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return t('fmt_eta', { m, s: (s < 10 ? '0' : '') + s });
  };

  const getCategoryIcon = (cat) => {
    switch (cat) {
      case 'Video': return Video;
      case 'Music': return Music;
      case 'Compressed': return Archive;
      case 'Documents': return FileText;
      case 'Programs': return Cpu;
      case 'Images': return ImageIcon;
      default: return Folder;
    }
  };

  const categoryLabel = (cat) => {
    const key = 'catName_' + (cat || 'General');
    const v = t(key);
    return v !== key ? v : (cat || 'General');
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'downloading':
        return <span className="status-pill status-downloading"><Play size={12} /> {t('st_downloading')}</span>;
      case 'merging':
        return <span className="status-pill status-merging"><Layers size={12} /> {t('st_merging')}</span>;
      case 'completed':
        return <span className="status-pill status-completed"><CheckCircle2 size={12} /> {t('st_completed')}</span>;
      case 'paused':
        return <span className="status-pill status-paused"><Pause size={12} /> {t('st_paused')}</span>;
      case 'queued':
        return <span className="status-pill status-queued"><Clock size={12} /> {t('st_queued')}</span>;
      case 'error':
        return <span className="status-pill status-error"><AlertCircle size={12} /> {t('st_error')}</span>;
      case 'canceled':
        return <span className="status-pill status-error" style={{background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-color)'}}><XCircle size={12} /> {t('st_canceled')}</span>;
      default:
        return <span className="status-pill status-queued">{status}</span>;
    }
  };

  if (downloads.length === 0) {
    return (
      <div className="table-container empty-state">
        <div className="empty-icon"><DownloadCloud size={44} /></div>
        <h3 className="empty-title">{t('empty_title')}</h3>
        <p className="empty-desc">{t('empty_desc')}</p>
      </div>
    );
  }

  return (
    <>
      {/* Bulk Action Toolbar — çoklu seçimde header altından kayarak inen kalıcı çubuk */}
      {selectedIds.size > 0 && (
        <div className="bulk-toolbar">
          <span className="bulk-count">{t('bulk_selected', { n: selectedIds.size })}</span>
          <button className="btn btn-success" onClick={bulkResume} title={t('tip_bulk_start')}>
            <Play size={14} /> {t('bulk_start')}
          </button>
          <button className="btn btn-warning" onClick={bulkPause} title={t('tip_bulk_pause')}>
            <Pause size={14} /> {t('bulk_pause')}
          </button>
          <button className="btn btn-danger" onClick={bulkDelete} title={t('tip_bulk_delete')}>
            <Trash2 size={14} /> {t('bulk_delete')}
          </button>
          <button className="btn btn-secondary" onClick={clearSelection} title={t('tip_bulk_clear')}>
            <XCircle size={14} /> {t('bulk_clear')}
          </button>
        </div>
      )}

    <div className="table-container" ref={containerRef} tabIndex={0} style={{ outline: 'none', position: 'relative', userSelect: dragBox ? 'none' : undefined }}>
      {/* Rubber-band drag selection rectangle */}
      {dragBox && (
        <div
          className="drag-select-box"
          style={{
            position: 'absolute',
            left: Math.min(dragBox.x1, dragBox.x2),
            top: Math.min(dragBox.y1, dragBox.y2),
            width: Math.abs(dragBox.x2 - dragBox.x1),
            height: Math.abs(dragBox.y2 - dragBox.y1),
            pointerEvents: 'none',
            zIndex: 50,
          }}
        />
      )}

      <table
        className="dl-table"
        style={{ tableLayout: 'fixed', width: `max(100%, ${totalColWidth}px)` }}
      >
        <colgroup>
          {colOrder.map(colId => (
            <col key={colId} style={{ width: colWidths[colId] }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {colOrder.map(colId => {
              if (colId === 'select') return (
                <th key="select" style={{ textAlign: 'center' }}>
                  <button
                    className="select-all-btn"
                    title={t('tip_select_all')}
                    onClick={() => selectedIds.size === downloads.length ? clearSelection() : selectAll()}
                  >
                    {selectedIds.size === downloads.length ? <CheckSquare size={15} /> : <Square size={15} />}
                  </button>
                </th>
              );
              
              const isDrag = colId !== 'actions';
              return (
                <th
                  key={colId}
                  style={{ textAlign: colId === 'name' ? 'left' : 'center', cursor: isDrag ? 'grab' : 'default' }}
                  draggable={isDrag}
                  onDragStart={isDrag ? (e) => handleDragStart(e, colId) : undefined}
                  onDragOver={isDrag ? handleDragOver : undefined}
                  onDrop={isDrag ? (e) => handleDrop(e, colId) : undefined}
                >
                  {t('th_' + (colId === 'name' ? 'filename' : colId))}
                  {isDrag && <span className="col-resizer" onMouseDown={(e) => startColResize(e, colId)} />}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {downloads.map((item, index) => {
            const Icon = getCategoryIcon(item.category);
            const percent = item.status === 'completed'
              ? 100
              : (item.totalSize > 0
                  ? Math.min(100, Math.round((item.downloadedBytes / item.totalSize) * 100))
                  : 0);
            const isSelected = selectedIds.has(item.id);
            const isFocused = focusedIndex === index;

            return (
              <tr
                key={item.id}
                className={`${isSelected ? 'row-selected' : ''} ${isFocused ? 'row-focused' : ''}`}
                onClick={(e) => handleRowClick(e, index, item)}
                onContextMenu={(e) => { if (!isSelected) { handleRowClick(e, index, item); } showMenu(e, item); }}
                onDoubleClick={() => { if (item.status === 'completed') onOpenFile && onOpenFile(item.id); }}
                style={{ cursor: 'pointer' }}
                title={item.status === 'completed' ? t('tip_dblclick_open') : undefined}
              >
                {colOrder.map(colId => {
                  switch(colId) {
                    case 'select': return (
                      <td key="select" style={{ textAlign: 'center' }}>
                        <span className="row-checkbox" onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); setFocusedIndex(index); lastClickedIndex.current = index; }}>
                          {isSelected ? <CheckSquare size={15} color="var(--primary-2)" /> : <Square size={15} color="var(--text-dark)" />}
                        </span>
                      </td>
                    );
                    case 'name': return (
                      <td key="name">
                        <div className="filename-cell">
                          <div className={`file-icon-box cat-${item.category || 'General'}`}>
                            <Icon size={18} />
                          </div>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            <div className="filename-main">{item.filename}</div>
                            <div className="filename-sub">
                              {categoryLabel(item.category)} • {t('seg_parts', { n: item.segmentsCount || 8 })}
                            </div>
                          </div>
                        </div>
                      </td>
                    );
                    case 'size': return (
                      <td key="size" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        <div className="cell-strong">{formatBytes(item.downloadedBytes)}</div>
                        <div style={{ color: 'var(--text-dark)', fontSize: '0.75rem' }}>{formatBytes(item.totalSize)}</div>
                      </td>
                    );
                    case 'progress': return (
                      <td key="progress" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {item.preflight && item.status === 'downloading' ? `${t('st_scanning')} ` : ''}{t('pct', { n: percent })}
                      </td>
                    );
                    case 'speed': return (
                      <td key="speed" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--link)', fontWeight: '600', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {item.status === 'downloading' ? `${formatBytes(item.speed)}/s` : '-'}
                      </td>
                    );
                    case 'eta': return (
                      <td key="eta" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', textAlign: 'center' }}>
                        {item.status === 'downloading' ? formatSeconds(item.eta) : '-'}
                      </td>
                    );
                    case 'status': return (
                      <td key="status" style={{ textAlign: 'center' }}>
                        {getStatusBadge(item.status)}
                      </td>
                    );
                    case 'actions': return (
                      <td
                        key="actions"
                        style={{ textAlign: 'center' }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                          {item.status === 'completed' && (
                            <button
                              className="btn btn-success btn-icon"
                              title={t('tip_open_file')}
                              onClick={() => onOpenFile && onOpenFile(item.id)}
                            >
                              <ExternalLink size={14} />
                            </button>
                          )}

                          <button
                            className="btn btn-secondary btn-icon"
                            title={t('tip_open_folder')}
                            onClick={() => onRevealFolder && onRevealFolder(item.id)}
                          >
                            <FolderOpen size={14} color="var(--link)" />
                          </button>

                          <button
                            className="btn btn-secondary btn-icon"
                            title={t('tip_chunks')}
                            onClick={() => onInspectChunks(item)}
                          >
                            <Layers size={14} color="var(--link)" />
                          </button>

                          {item.status === 'downloading' ? (
                            <button
                              className="btn btn-warning btn-icon"
                              title={t('tip_pause')}
                              onClick={() => onPause(item.id)}
                            >
                              <Pause size={14} />
                            </button>
                          ) : (item.status !== 'completed' && item.status !== 'canceled') ? (
                            <button
                              className="btn btn-success btn-icon"
                              title={t('tip_start')}
                              onClick={() => onStart(item.id)}
                            >
                              <Play size={14} />
                            </button>
                          ) : null}

                          <button
                            className="btn btn-danger btn-icon"
                            title={t('tip_delete')}
                            onClick={() => onDelete(item.id)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    );
                    default: return null;
                  }
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {menu && createPortal((
        <div
          className="dn-ctx"
          style={{ position: 'fixed', top: menu.y, left: menu.x, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.item.status === 'completed' && (
            <div className="dn-ctx-item" onClick={() => run(onOpenFile, menu.item.id)}>
              <ExternalLink size={14} /> {t('ctx_open')}
            </div>
          )}
          <div className="dn-ctx-item" onClick={() => run(onRevealFolder, menu.item.id)}>
            <FolderOpen size={14} /> {t('ctx_open_folder')}
          </div>

          <div className="dn-ctx-sep" />

          {menu.item.status === 'downloading' ? (
            <div className="dn-ctx-item" onClick={() => run(onPause, menu.item.id)}>
              <Pause size={14} /> {t('ctx_pause')}
            </div>
          ) : menu.item.status !== 'completed' ? (
            <div className="dn-ctx-item" onClick={() => run(onStart, menu.item.id)}>
              <Play size={14} /> {t('ctx_start')}
            </div>
          ) : null}

          <div className="dn-ctx-item" onClick={() => run(onRedownload, menu.item)}>
            <RotateCcw size={14} /> {t('ctx_redownload')}
          </div>
          <div className="dn-ctx-item" onClick={() => run(() => setRefreshingItem(menu.item))}>
            <RefreshCw size={14} /> {t('ctx_refresh_url')}
          </div>
          <div className="dn-ctx-item" onClick={() => run(onRename, menu.item)}>
            <Edit3 size={14} /> {t('ctx_rename')}
          </div>

          <div className="dn-ctx-sep" />

          <div className="dn-ctx-item" style={{ cursor: 'default', opacity: 0.7, fontSize: '11px', padding: '4px 14px' }}>
            {t('ctx_priority')}
          </div>
          <div style={{ display: 'flex', gap: '4px', padding: '0 14px 6px' }}>
            {[['high', t('pri_high')], ['normal', t('pri_normal')], ['low', t('pri_low')]].map(([val, label]) => (
              <button
                key={val}
                className={`btn ${(menu.item.priority || 'normal') === val ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '3px 8px', fontSize: '11px', flex: 1 }}
                onClick={() => run(onSetPriority, menu.item.id, val)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="dn-ctx-sep" />

          <div className="dn-ctx-item" onClick={() => run(onCopyUrl, menu.item)}>
            <Link2 size={14} /> {t('ctx_copy_url')}
          </div>
          <div className="dn-ctx-item" onClick={() => run(onInspectChunks, menu.item)}>
            <Layers size={14} /> {t('ctx_chunks')}
          </div>
          <div className="dn-ctx-item" onClick={() => run(onShowProperties, menu.item)}>
            <Info size={14} /> {t('ctx_properties')}
          </div>

          <div className="dn-ctx-sep" />

          <div className="dn-ctx-item dn-ctx-danger" onClick={() => run(onDelete, menu.item.id, false)}>
            <XCircle size={14} /> {t('ctx_remove')}
          </div>
          <div className="dn-ctx-item dn-ctx-danger" onClick={() => run(onDelete, menu.item.id, true)}>
            <Trash2 size={14} /> {t('ctx_delete_file')}
          </div>
        </div>
      ), document.body)}

      <RefreshUrlModal
        isOpen={!!refreshingItem}
        onClose={() => setRefreshingItem(null)}
        download={refreshingItem}
        onRefreshUrl={handleRefreshUrlSubmit}
      />
    </div>
    </>
  );
}
