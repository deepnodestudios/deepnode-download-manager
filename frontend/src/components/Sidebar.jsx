import React, { useRef, useState, useEffect } from 'react';
import {
  DownloadCloud, PlayCircle, CheckCircle, PauseCircle,
  Video, Music, Archive, FileText, Cpu, Image as ImageIcon, Folder
} from 'lucide-react';
import { useT } from '../i18n';

export default function Sidebar({ activeFilter, setActiveFilter, downloads, sidebarWidth, setSidebarWidth }) {
  const { t } = useT();
  const sidebarRef = useRef(null);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      let newWidth = e.clientX;
      if (newWidth < 180) newWidth = 180;
      if (newWidth > 400) newWidth = 400;
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        if (sidebarRef.current) {
          localStorage.setItem('dn-sidebar-width', sidebarRef.current.style.width.replace('px', ''));
        }
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, setSidebarWidth]);

  const getCount = (filterType) => {
    if (filterType === 'all') return downloads.length;
    if (filterType === 'downloading') return downloads.filter(d => d.status === 'downloading' || d.status === 'merging').length;
    if (filterType === 'completed') return downloads.filter(d => d.status === 'completed').length;
    if (filterType === 'paused') return downloads.filter(d => d.status === 'paused' || d.status === 'queued').length;

    // Categories
    return downloads.filter(d => d.category === filterType).length;
  };

  const statusNavs = [
    { id: 'all', label: t('f_all'), icon: DownloadCloud },
    { id: 'downloading', label: t('f_downloading'), icon: PlayCircle },
    { id: 'completed', label: t('f_completed'), icon: CheckCircle },
    { id: 'paused', label: t('f_paused'), icon: PauseCircle },
  ];

  const categoryNavs = [
    { id: 'Video', label: t('cat_Video'), icon: Video },
    { id: 'Music', label: t('cat_Music'), icon: Music },
    { id: 'Compressed', label: t('cat_Compressed'), icon: Archive },
    { id: 'Documents', label: t('cat_Documents'), icon: FileText },
    { id: 'Programs', label: t('cat_Programs'), icon: Cpu },
    { id: 'Images', label: t('cat_Images'), icon: ImageIcon },
    { id: 'General', label: t('cat_General'), icon: Folder },
  ];

  return (
    <aside 
      className="sidebar" 
      ref={sidebarRef}
      style={{ width: `${sidebarWidth}px`, position: 'relative' }}
    >
      <div 
        className="sidebar-resizer"
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizing(true);
        }}
      />
      <div>
        <div className="nav-section-title">{t('side_status_filters')}</div>
        <ul className="nav-list">
          {statusNavs.map((item) => {
            const Icon = item.icon;
            const count = getCount(item.id);
            return (
              <li
                key={item.id}
                className={`nav-item ${activeFilter === item.id ? 'active' : ''}`}
                onClick={() => setActiveFilter(item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
                <span className="nav-count">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="nav-section-title">{t('side_categories')}</div>
        <ul className="nav-list">
          {categoryNavs.map((item) => {
            const Icon = item.icon;
            const count = getCount(item.id);
            return (
              <li
                key={item.id}
                className={`nav-item ${activeFilter === item.id ? 'active' : ''}`}
                onClick={() => setActiveFilter(item.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon size={18} />
                  <span>{item.label}</span>
                </div>
                <span className="nav-count">{count}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
