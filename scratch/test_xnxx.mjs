import { getVideoInfo } from '../backend/src/services/VideoDownloader.js';

async function test() {
  try {
    const info = await getVideoInfo('https://www.xnxx.com/', 'https://www.xnxx.com/');
    console.log('Result:', JSON.stringify(info, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
