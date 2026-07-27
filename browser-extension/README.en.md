# DeepNode Download Manager – Browser Integration

**[English](README.en.md) · [Türkçe](README.md)**

Manifest V3 extension for Chrome / Edge / Brave. It captures downloads started in the
browser and forwards them to DeepNode Download Manager, shows a **Download** button in the
corner of media (video/audio/image), and offers a **Grabber** panel that collects every
downloadable link on the page.

## Features
- **Download button on media** – appears in the top-right corner when you hover a video/image.
- **Browser download capture** – when the browser starts downloading a file, the extension cancels it and adds it to the DeepNode queue (can be toggled off).
- **Context menu** – "Download with DeepNode" on links, images and videos.
- **Grabber** – "Scan this page for media" lists all media on the page; download individually or all at once.
- **YouTube & similar sites** – on YouTube, Vimeo, TikTok, Twitch etc., the corner button (or right-click → "Download this video") sends the page URL to the app; the app downloads the video with `yt-dlp` (merging audio+video when needed).
- **Stream (HLS/blob) fallback** – on other sites where blob videos can't be fetched directly, it uses the .m3u8/.mp4 stream URL captured from the network.

## How YouTube / video sites work
The app downloads videos from sites like YouTube with **yt-dlp**. On your first video
download, the app automatically fetches `yt-dlp` (`%USERPROFILE%\.deepnode\yt-dlp.exe`).
For highest-quality audio+video merging, having **ffmpeg** installed on the system is
recommended; otherwise the app picks an mp4 format that doesn't require merging
(usually up to 720p). If ffmpeg is in your PATH, yt-dlp uses it automatically.

## Installation (developer mode)
First, run the **DeepNode Download Manager** app (`localhost:5000` must be running in the background). Then, depending on your browser:

### Chrome / Edge / Brave / Opera
1. Go to `chrome://extensions` (`edge://extensions` on Edge).
2. Enable **Developer mode** (top right).
3. **Load unpacked** → select this `browser-extension` folder.
4. The DeepNode icon appears in the toolbar. Click it to see the status (connected/offline) and change settings.

### Firefox (version 121+)
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** → select the `manifest.json` file in this folder.
3. Note: temporary add-ons are removed when Firefox closes; you need to reload it on every start (unsigned extension limitation). Permanent installation requires the extension to be signed by Mozilla (AMO).

> Why not "automatic during setup"? Browsers (Chrome, Firefox) don't allow an application to silently install extensions for security reasons. One-click permanent installation requires publishing the extension on the Chrome Web Store / Edge Add-ons / Firefox AMO.

## Notes
- The extension talks to the app via `http://localhost:5000/api/download/add`. If you change the port in the app, update it from the extension popup.
- When the app is not running, browser downloads are never cancelled — the file is sent to the app first and only cancelled on success, so no data is lost.
- On DRM-protected/segmented streams like YouTube, the video is often a `blob:`; the button tries the best stream URL captured from the network. Some protected content may not be downloadable.
