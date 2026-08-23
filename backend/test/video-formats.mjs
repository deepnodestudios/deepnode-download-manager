// HLS/DASH varyantlarında vcodec 'none' gelir; bunlar kalite menüsünden düşmemeli.
// URL'siz satırlar menüde görünmemeli (YouTube SABR / boş itag).
import { summarizeVideoInfo, formatIsDownloadable } from '../src/services/VideoDownloader.js';

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
    { format_id: '18', height: 360, width: 640, vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', ext: 'mp4', filesize: 1000, url: 'https://x/18' },
    { format_id: 'hls-720', height: 720, width: 1280, vcodec: 'none', acodec: 'none', ext: 'mp4', tbr: 2000, url: 'https://x/hls720.m3u8', protocol: 'm3u8_native' },
    { format_id: 'hls-1080', format_note: '1080p', vcodec: 'none', acodec: 'none', ext: 'mp4', width: 1920, tbr: 4000, url: 'https://x/hls1080.m3u8', protocol: 'm3u8_native' },
    { format_id: '251', vcodec: 'none', acodec: 'opus', ext: 'webm', url: 'https://x/251' }
  ]
});

check('360p progressive duruyor', info.heights.includes(360), String(info.heights));
check('HLS 720p (vcodec none) listeleniyor', info.heights.includes(720), String(info.heights));
check('HLS 1080p format_id/note ile listeleniyor', info.heights.includes(1080), String(info.heights));
check('saf ses satırı video sayılmıyor', !info.heights.includes(0) && info.heights.length === 3, String(info.heights));
check('1080p varyantı var', info.variants.some((v) => v.height === 1080), JSON.stringify(info.variants));

check('url yoksa indirilemez', !formatIsDownloadable({ format_id: '999', height: 1080, vcodec: 'avc1', ext: 'mp4' }));
check('url varsa indirilebilir', formatIsDownloadable({ format_id: '137', height: 1080, vcodec: 'avc1', ext: 'mp4', url: 'https://x' }));

const ytInfo = summarizeVideoInfo({
  extractor_key: 'Youtube',
  webpage_url: 'https://www.youtube.com/watch?v=abc',
  duration: 120,
  formats: [
    { format_id: '137', height: 1080, width: 1920, vcodec: 'avc1', acodec: 'none', ext: 'mp4', filesize: 80_000_000, url: 'https://x/137', protocol: 'https' },
    { format_id: '96', height: 1080, width: 1920, vcodec: 'none', acodec: 'none', ext: 'mp4', protocol: 'm3u8_native', url: 'https://x/96.m3u8', tbr: 4000 },
    { format_id: 'sabr-1080', height: 1080, width: 1920, vcodec: 'avc1', acodec: 'none', ext: 'mp4' },
    { format_id: 'sb2', format_note: 'storyboard', ext: 'mhtml', protocol: 'mhtml', height: 90, width: 160 }
  ]
});
check('YouTube URL’siz / SABR menüde yok', !ytInfo.variants.some((v) => v.formatId === 'sabr-1080'), JSON.stringify(ytInfo.variants));
check('YouTube storyboard yok', !ytInfo.heights.includes(90), String(ytInfo.heights));
check('YouTube DASH varken HLS 1080 gizlenir', !ytInfo.variants.some((v) => v.formatId === '96'), JSON.stringify(ytInfo.variants));
check('YouTube https 1080 duruyor', ytInfo.variants.some((v) => v.formatId === '137'), JSON.stringify(ytInfo.variants));

console.log('video-formats ok');
