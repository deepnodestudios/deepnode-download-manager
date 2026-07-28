# External Binaries

This folder must contain two external tools that DeepNode Download Manager
uses for video downloading and merging. They are **not** included in the
repository because of their size — download them before running or building
the app:

| File | Source |
| --- | --- |
| `yt-dlp.exe` | https://github.com/yt-dlp/yt-dlp/releases/latest (asset: `yt-dlp.exe`) |
| `ffmpeg.exe` | https://www.gyan.dev/ffmpeg/builds/ (release essentials build — copy `bin/ffmpeg.exe` from the archive) |

After downloading, the folder should look like:

```
bin/
├── ffmpeg.exe
└── yt-dlp.exe
```

Both tools are distributed under their own licenses (yt-dlp: Unlicense,
FFmpeg: GPL/LGPL depending on build) and are independent programs invoked as
external processes — they are not part of this project's MIT-licensed source.
