import React, { useState, useEffect } from 'react';
import { Clock, X, Power, Moon, LogOut, CheckCircle2, Calendar, Play, Pause, AlertTriangle } from 'lucide-react';
import { useT } from '../i18n';

export default function SchedulerModal({ isOpen, onClose, settings, onSaveSettings, queues = [], onUpdateQueue }) {
  const { t } = useT();

  const [selectedQueueId, setSelectedQueueId] = useState('main');
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [scheduleStartTime, setScheduleStartTime] = useState('02:00');
  const [scheduleStopTime, setScheduleStopTime] = useState('08:00');
  const [scheduleDays, setScheduleDays] = useState([1, 2, 3, 4, 5, 6, 0]);
  const [schedulerAfterStop, setSchedulerAfterStop] = useState('nothing');
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState(3);

  const currentQ = (queues || []).find(q => q.id === selectedQueueId) || queues[0] || null;

  useEffect(() => {
    if (!isOpen) return;
    if (currentQ) {
      const sch = currentQ.scheduler || {};
      setSchedulerEnabled(sch.enabled ?? false);
      setScheduleStartTime(sch.startTime || '02:00');
      setScheduleStopTime(sch.stopTime || '08:00');
      setScheduleDays(sch.days || [1, 2, 3, 4, 5, 6, 0]);
      setSchedulerAfterStop(sch.afterStop || 'nothing');
      setMaxConcurrentDownloads(currentQ.maxConcurrent ?? 3);
    } else if (settings) {
      setSchedulerEnabled(settings.schedulerEnabled ?? false);
      setScheduleStartTime(settings.scheduleStartTime || '02:00');
      setScheduleStopTime(settings.scheduleStopTime || '08:00');
      setScheduleDays(settings.scheduleDays || [1, 2, 3, 4, 5, 6, 0]);
      setSchedulerAfterStop(settings.schedulerAfterStop || settings.afterAllComplete || 'nothing');
      setMaxConcurrentDownloads(settings.maxConcurrentDownloads ?? 3);
    }
  }, [isOpen, selectedQueueId, queues, settings]);

  if (!isOpen) return null;

  const dayKeys = [
    [1, 'day_1'],
    [2, 'day_2'],
    [3, 'day_3'],
    [4, 'day_4'],
    [5, 'day_5'],
    [6, 'day_6'],
    [0, 'day_0']
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (onUpdateQueue && currentQ) {
      onUpdateQueue(currentQ.id, {
        maxConcurrent: Number(maxConcurrentDownloads),
        scheduler: {
          enabled: schedulerEnabled,
          startTime: scheduleStartTime,
          stopTime: scheduleStopTime,
          days: scheduleDays,
          afterStop: schedulerAfterStop
        }
      });
    }
    if ((selectedQueueId === 'main' || !currentQ) && onSaveSettings) {
      onSaveSettings({
        schedulerEnabled,
        scheduleStartTime,
        scheduleStopTime,
        scheduleDays,
        schedulerAfterStop,
        afterAllComplete: schedulerAfterStop,
        maxConcurrentDownloads: Number(maxConcurrentDownloads)
      });
    }
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', width: '92%' }}>
        <div className="modal-header">
          <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={20} className="text-accent" />
            <span>{t('net_scheduler')} — {t('scheduler_queue_title') || 'Kuyruk & Zamanlayıcı'}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>

            {/* Queue Selector Tabs */}
            {queues && queues.length > 0 && (
              <div>
                <label className="form-label" style={{ marginBottom: '6px' }}>{t('side_queues') || 'Kuyruklar'}</label>
                <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '2px' }}>
                  {queues.map((q) => {
                    const isActive = (selectedQueueId || 'main') === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        className={`btn ${isActive ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '6px 14px', fontSize: '13px', whiteSpace: 'nowrap' }}
                        onClick={() => setSelectedQueueId(q.id)}
                      >
                        {q.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Master Switch Panel */}
            <div style={{
              background: schedulerEnabled ? 'rgba(34,197,94,0.08)' : 'var(--bg-secondary, rgba(255,255,255,0.04))',
              border: `1px solid ${schedulerEnabled ? 'rgba(34,197,94,0.3)' : 'var(--border-color, rgba(255,255,255,0.08))'}`,
              borderRadius: '8px',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 0.2s ease'
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: schedulerEnabled ? '#4ade80' : 'var(--text-main, #f1f5f9)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Clock size={16} />
                  <span>{t('chk_scheduler')}</span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '3px' }}>
                  {t('scheduler_note')}
                </div>
              </div>

              <label className="dn-switch" style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={schedulerEnabled}
                  onChange={(e) => setSchedulerEnabled(e.target.checked)}
                />
                <span className="dn-slider" />
              </label>
            </div>

            {/* Time Settings */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              opacity: schedulerEnabled ? 1 : 0.5,
              pointerEvents: schedulerEnabled ? 'auto' : 'none'
            }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Play size={13} style={{ color: '#22c55e' }} />
                  <span>{t('lbl_start_time')}</span>
                </label>
                <input
                  type="time"
                  className="form-input"
                  value={scheduleStartTime}
                  onChange={(e) => setScheduleStartTime(e.target.value)}
                  disabled={!schedulerEnabled}
                  style={{ width: '100%', fontSize: '14px' }}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Pause size={13} style={{ color: '#eab308' }} />
                  <span>{t('lbl_stop_time')}</span>
                </label>
                <input
                  type="time"
                  className="form-input"
                  value={scheduleStopTime}
                  onChange={(e) => setScheduleStopTime(e.target.value)}
                  disabled={!schedulerEnabled}
                  style={{ width: '100%', fontSize: '14px' }}
                />
              </div>
            </div>

            {/* Days Selection */}
            <div style={{
              opacity: schedulerEnabled ? 1 : 0.5,
              pointerEvents: schedulerEnabled ? 'auto' : 'none'
            }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
                <Calendar size={13} />
                <span>{t('lbl_days')}</span>
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {dayKeys.map(([d, key]) => {
                  const on = scheduleDays.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      className={`btn ${on ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '5px 12px', fontSize: '12px' }}
                      disabled={!schedulerEnabled}
                      onClick={() => setScheduleDays(on ? scheduleDays.filter(x => x !== d) : [...scheduleDays, d])}
                    >
                      {t(key)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Post-Queue Action & Concurrency */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
              paddingTop: '8px',
              borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))'
            }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Power size={13} style={{ color: '#ef4444' }} />
                  <span>{t('lbl_after_all')}</span>
                </label>
                <select
                  className="form-select"
                  value={schedulerAfterStop}
                  onChange={(e) => setSchedulerAfterStop(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="nothing">{t('after_nothing')}</option>
                  <option value="shutdown">{t('after_shutdown')}</option>
                  <option value="sleep">{t('after_sleep') || 'Uyku moduna al'}</option>
                  <option value="exit">{t('after_exit')}</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">
                  <span>{t('lbl_max_concurrent')}</span>
                </label>
                <select
                  className="form-select"
                  value={maxConcurrentDownloads}
                  onChange={(e) => setMaxConcurrentDownloads(e.target.value)}
                  style={{ width: '100%' }}
                >
                  <option value="1">{t('opt_file_1')}</option>
                  <option value="2">{t('opt_file_2')}</option>
                  <option value="3">{t('opt_file_3')}</option>
                  <option value="5">{t('opt_file_5')}</option>
                </select>
              </div>
            </div>

          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 20px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t('btn_cancel')}
            </button>
            <button type="submit" className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <CheckCircle2 size={15} />
              <span>{t('btn_save')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
