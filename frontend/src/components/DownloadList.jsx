import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play, Pause, Trash2, Layers, Video, Music, Archive, FileText, Cpu, Image as ImageIcon, Folder, FolderOpen, ExternalLink, AlertCircle, CheckCircle2, Clock,
  RotateCcw, Link2, Edit3, Info, XCircle, CheckSquare, Square, DownloadCloud
} from 'lucide-react';
import { useT } from '../i18n';

// Sabit sütun genişlikleri (px) — içerik değişse bile sütunlar yatay kaymaz.
// Kullanıcı ayraçları sürükleyerek değiştirebilir; tercihler localStorage'da saklanır.
const DEFAULT_COL_WIDTHS = { select: 36, name: 280, size: 110, progress: 160, speed: 105, eta: 85, status: 130, actions: 175 };
const MIN_COL_WIDTH = 56;
const COL_WIDTHS_KEY = 'dn-col-widths';

export default function DownloadList({
  downloads,
  onStart,
  onPause,
  onDelete,
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
  const lastClickedIndex = useRef(-1);
  const containerRef = useRef(null);
  const dragState = useRef(null); // { startX, startY, ctrlHeld }

  // --- Sütun genişlikleri (sürüklenerek ayarlanabilir) ---
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY));
      if (saved && typeof saved === 'object') return { ...DEFAULT_COL_WIDTHS, ...saved };
    } catch (e) { /* bozuk kayıt yok sayılır */ }
    return DEFAULT_COL_WIDTHS;
  });
  const resizeState = useRef(null); // { key, startX, startW }

  const startColResize = useCallback((e, key) => {
    e.preventDefault();
    e.stopPropagation();
    resizeState.current = { key, startX: e.clientX, startW: colWidths[key] };
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

  const totalColWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

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
    selectedIds.forEach(id => onDelete(id));
    clearSelection();
  }, [selectedIds, onDelete, clearSelection]);

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
      // Skip if typing in an input/textarea
      const tag = e.target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
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
    const W = 230, H = 330;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - W - 8),
      y: Math.min(e.clientY, window.innerHeight - H - 8),
      item
    });
  };

  const run = (fn, ...args) => { setMenu(null); if (fn) fn(...args); };
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
          <col style={{ width: colWidths.select }} />
          <col style={{ width: colWidths.name }} />
          <col style={{ width: colWidths.size }} />
          <col style={{ width: colWidths.progress }} />
          <col style={{ width: colWidths.speed }} />
          <col style={{ width: colWidths.eta }} />
          <col style={{ width: colWidths.status }} />
          <col style={{ width: colWidths.actions }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'center' }}>
              <button
                className="select-all-btn"
                title={t('tip_select_all')}
                onClick={() => selectedIds.size === downloads.length ? clearSelection() : selectAll()}
              >
                {selectedIds.size === downloads.length ? <CheckSquare size={15} /> : <Square size={15} />}
              </button>
            </th>
            <th>{t('th_filename')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'name')} /></th>
            <th>{t('th_size')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'size')} /></th>
            <th>{t('th_progress')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'progress')} /></th>
            <th>{t('th_speed')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'speed')} /></th>
            <th>{t('th_eta')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'eta')} /></th>
            <th>{t('th_status')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'status')} /></th>
            <th style={{ textAlign: 'right' }}>{t('th_actions')}<span className="col-resizer" onMouseDown={(e) => startColResize(e, 'actions')} /></th>
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
                onContextMenu={(e) => { if (!isSelected) { handleRowClick(e, index, item); } openMenu(e, item); }}
                onDoubleClick={() => { if (item.status === 'completed') onOpenFile && onOpenFile(item.id); }}
                style={{ cursor: 'pointer' }}
                title={item.status === 'completed' ? t('tip_dblclick_open') : undefined}
              >
                <td style={{ textAlign: 'center' }}>
                  <span className="row-checkbox" onClick={(e) => { e.stopPropagation(); toggleSelect(item.id); setFocusedIndex(index); lastClickedIndex.current = index; }}>
                    {isSelected ? <CheckSquare size={15} color="var(--primary-2)" /> : <Square size={15} color="var(--text-dark)" />}
                  </span>
                </td>
                <td>
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

                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                  <div className="cell-strong">{formatBytes(item.downloadedBytes)}</div>
                  <div style={{ color: 'var(--text-dark)', fontSize: '0.75rem' }}>{formatBytes(item.totalSize)}</div>
                </td>

                <td>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                    <span>{t('pct', { n: percent })}</span>
                  </div>
                  <div className="progress-bar-wrap">
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${percent}%`,
                        background: item.status === 'completed'
                          ? 'var(--success)'
                          : item.status === 'paused'
                          ? 'var(--warning)'
                          : 'linear-gradient(90deg, var(--primary), var(--teal))'
                      }}
                    ></div>
                  </div>
                </td>

                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--link)', fontWeight: '600', whiteSpace: 'nowrap' }}>
                  {item.status === 'downloading' ? `${formatBytes(item.speed)}/s` : '-'}
                </td>

                <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {item.status === 'downloading' ? formatSeconds(item.eta) : '-'}
                </td>

                <td>
                  {getStatusBadge(item.status)}
                </td>

                {/* Buton tıklamaları satır seçimini tetiklemesin (bulk toolbar açılmaz) */}
                <td
                  style={{ textAlign: 'right' }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
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
                    ) : item.status !== 'completed' ? (
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
              </tr>
            );
          })}
        </tbody>
      </table>

      {menu && (
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
      )}
    </div>
    </>
  );
}
