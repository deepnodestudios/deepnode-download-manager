import React, { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler
} from 'chart.js';
import { Gauge } from 'lucide-react';
import { useT } from '../i18n';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler
);

function fmtSpeed(bytesPerSec) {
  const b = bytesPerSec || 0;
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB/s';
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB/s';
  if (b >= 1024) return (b / 1024).toFixed(0) + ' KB/s';
  return b.toFixed(0) + ' B/s';
}

export default function SpeedChart({ currentSpeed }) {
  const { t } = useT();
  const [speedHistory, setSpeedHistory] = useState(new Array(24).fill(0));

  useEffect(() => {
    const speedInMB = currentSpeed / (1024 * 1024); // Convert Bytes/s to MB/s
    setSpeedHistory((prev) => [...prev.slice(1), parseFloat(speedInMB.toFixed(2))]);
  }, [currentSpeed]);

  const data = {
    labels: new Array(24).fill(''),
    datasets: [
      {
        fill: true,
        label: t('chart_label'),
        data: speedHistory,
        borderColor: '#2de1c2',
        backgroundColor: (context) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, 64);
          gradient.addColorStop(0, 'rgba(45, 225, 194, 0.35)');
          gradient.addColorStop(1, 'rgba(41, 121, 255, 0.0)');
          return gradient;
        },
        borderWidth: 2,
        tension: 0.45,
        pointRadius: 0,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context) => `${context.parsed.y} MB/s`
        }
      }
    },
    scales: {
      x: { display: false },
      y: {
        min: 0,
        grid: { color: 'rgba(128, 150, 190, 0.08)' },
        ticks: { color: '#8ca3c7', font: { size: 9 } }
      }
    }
  };

  return (
    <div className="speed-bar-panel">
      <div className="stat-item">
        <div className="stat-icon"><Gauge size={17} /></div>
        <div>
          <div className="stat-val">{fmtSpeed(currentSpeed)}</div>
          <div className="stat-lbl">{t('chart_label')}</div>
        </div>
      </div>
      <div className="speed-chart-box">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
