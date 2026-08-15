// HLS/DASH varyantlarında vcodec 'none' gelir; bunlar kalite menüsünden düşmemeli.
import { summarizeVideoInfo } from '../src/services/VideoDownloader.js';

const check = (name, ok, detail = '') => {
  if (!ok) {
    console.error(`✗ ${name}${detail ? ' → ' + detail : ''}`);
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
};

const info = summarizeVideoInfo({
  title: 'Sample',
  duration: 120,
  formats: [
    { format_id: '18', height: 360, width: 640, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', ext: 'mp4', filesize: 1000 },
    { format_id: 'hls-720', height: 720, width: 1280, vcodec: 'none', acodec: 'none', ext: 'mp4', tbr: 2000 },
    { format_id: 'hls-1080', format_note: '1080p', vcodec: 'none', acodec: 'none', ext: 'mp4', width: 1920, tbr: 4000 },
    { format_id: '251', vcodec: 'none', acodec: 'opus', ext: 'webm' }
  ]
});

check('360p progressive duruyor', info.heights.includes(360), String(info.heights));
check('HLS 720p (vcodec none) listeleniyor', info.heights.includes(720), String(info.heights));
check('HLS 1080p format_id/note ile listeleniyor', info.heights.includes(1080), String(info.heights));
check('saf ses satırı video sayılmıyor', !info.heights.includes(0) && info.heights.length === 3, String(info.heights));
check('1080p varyantı var', info.variants.some((v) => v.height === 1080), JSON.stringify(info.variants));

console.log('video-formats ok');
