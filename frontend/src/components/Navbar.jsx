import React, { useLayoutEffect, useRef } from 'react';
import {
  Plus, Play, Pause, Globe, FolderOpen, Settings, Info
} from 'lucide-react';
import { useT } from '../i18n';
import { openExternal } from '../native';

export default function Navbar({
  sidebarWidth,
  onOpenAddModal,
  onStartAll,
  onPauseAll,
  onOpenSnifferModal,
  onOpenSettingsModal,
  onOpenAboutModal,
  onOpenDownloadRootDir
}) {
  const { t } = useT();
  const rowRef = useRef(null);
  const subRef = useRef(null);

  const handleBrandClick = () => {
    openExternal('https://deepnodestudios.net/DDM/');
  };

  // Tagline'ı üst satırla (DeepNode + ULTRA) birebir aynı noktada bitir:
  // gerçek metin genişliğini ölç, font boyutu + harf aralığıyla tam sığdır.
  useLayoutEffect(() => {
    const fitTagline = () => {
      const row = rowRef.current;
      const sub = subRef.current;
      if (!row || !sub) return;
      sub.style.fontSize = '';
      sub.style.letterSpacing = '';
      // Hedef genişlik: satır başından ULTRA rozetinin GERÇEK sağ kenarına kadar.
      // (.brand-row kutusu grid içinde esneyebildiği için row genişliği kullanılamaz)
      const rowLeft = row.getBoundingClientRect().left;
      const badge = row.querySelector('.brand-badge');
      const targetW = (badge ? badge.getBoundingClientRect().right : row.getBoundingClientRect().right) - rowLeft;
      const w0 = sub.getBoundingClientRect().width;
      if (!targetW || !w0) return;
      const base = parseFloat(getComputedStyle(sub).fontSize);
      const size = Math.min(base, base * (targetW / w0));
      sub.style.fontSize = size.toFixed(2) + 'px';
      const w1 = sub.getBoundingClientRect().width;
      const chars = (sub.textContent || '').length;
      // letter-spacing son karakterden SONRA da boşluk ekler; görünen son glifin
      // rozetle aynı noktada bitmesi için (chars - 1) aralığa bölünür.
      if (chars > 1) sub.style.letterSpacing = ((targetW - w1) / (chars - 1)).toFixed(3) + 'px';
    };
    fitTagline();
    // Web fontu geç yüklenirse ölçüm değişir — tekrar hesapla
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(fitTagline).catch(() => {});
    }
  }, [t]);

  return (
    <header className="top-navbar">
      <div className="brand-section" style={{ flexBasis: `${sidebarWidth - 16}px`, width: `${sidebarWidth - 16}px` }}>
        <div
          className="brand-clickable"
          onClick={handleBrandClick}
          title="https://deepnodestudios.net/DDM/"
        >
          <div className="brand-icon">
            <img src="/branding/deepnode-app-icon.png" alt="" />
          </div>
          <div className="brand-text">
            <div className="brand-row" ref={rowRef}>
              <span className="brand-title">DeepNode</span>
              <span className="brand-badge">ULTRA</span>
            </div>
            <div className="brand-sub" ref={subRef}>{t('nav_tagline')}</div>
          </div>
        </div>
      </div>

      <div className="action-toolbar">
        <button className="btn-add" onClick={onOpenAddModal} title={`${t('nav_add')} (Insert)`}>
          <span className="btn-add-plus"><Plus size={15} /></span>
          <span className="btn-label">{t('nav_add')}</span>
        </button>

        <button className="btn-sniff" onClick={onOpenSnifferModal} title={`${t('nav_sniffer')} (Ctrl+L)`}>
          <Globe size={16} /> <span className="btn-label">{t('nav_sniffer')}</span>
        </button>

        <span className="toolbar-sep" />

        <div className="seg-actions">
          <button className="seg-action seg-start" onClick={onStartAll} title={t('nav_start_all')}>
            <Play size={15} /> <span className="btn-label">{t('nav_start_all')}</span>
          </button>
          <span className="seg-divider" />
          <button className="seg-action seg-pause" onClick={onPauseAll} title={t('nav_pause_all')}>
            <Pause size={15} /> <span className="btn-label">{t('nav_pause_all')}</span>
          </button>
        </div>

        <span className="toolbar-sep" />

        <button className="tb-btn" onClick={onOpenDownloadRootDir} title={t('nav_open_download_folder')}>
          <FolderOpen size={18} />
        </button>

        <button className="tb-btn" onClick={onOpenSettingsModal} title={t('nav_settings')}>
          <Settings size={18} />
        </button>

        <button className="tb-btn" onClick={onOpenAboutModal} title={t('nav_about')}>
          <Info size={18} />
        </button>
      </div>
    </header>
  );
}
