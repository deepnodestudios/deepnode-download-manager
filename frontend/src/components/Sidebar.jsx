import React from 'react';
import {
  DownloadCloud, PlayCircle, CheckCircle, PauseCircle,
  Video, Music, Archive, FileText, Cpu, Image as ImageIcon, Folder
} from 'lucide-react';
import { useT } from '../i18n';

export default function Sidebar({ activeFilter, setActiveFilter, downloads }) {
  const { t } = useT();

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
    <aside className="sidebar">
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
