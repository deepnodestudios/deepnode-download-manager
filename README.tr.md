<div align="center">
  <img src="https://deepnodestudios.net/DDM/assets/deepnode-app-icon.png" width="96" alt="DeepNode Download Manager">
  <h1>DeepNode Download Manager</h1>
  <p><strong>Windows için hızlı, akıllı ve düzenli indirme yöneticisi — ücretsiz ve açık kaynak bir IDM alternatifi.</strong></p>
  <p><a href="README.md">English</a> · <a href="README.tr.md"><strong>Türkçe</strong></a></p>
  <p>
    <a href="https://github.com/deepnodestudios/deepnode-download-manager/releases/latest"><img src="https://img.shields.io/github/v/release/deepnodestudios/deepnode-download-manager?label=s%C3%BCr%C3%BCm" alt="Sürüm"></a>
    <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20(64--bit)-2979FF" alt="Platform">
    <a href="https://deepnodestudios.net/DDM/"><img src="https://img.shields.io/badge/site-deepnodestudios.net%2FDDM-2DE1C2" alt="Web sitesi"></a>
    <img src="https://img.shields.io/badge/reklam%20%2F%20izleyici-yok-success" alt="Reklam ve izleyici yok">
  </p>
</div>

---

<p align="center">
  <img src="https://deepnodestudios.net/DDM/assets/screen-main.png" alt="DeepNode Download Manager — ana ekran" width="85%">
</p>

## Özellikler

- **Çok parçalı indirme motoru** — dosyalar 8/16 parçaya bölünüp paralel bağlantılarla indirilir; bağlantınızın tamamı kullanılır.
- **Duraklat / devam ettir / yeniden başlat** — yarım kalan indirmeler veri kaybı olmadan sürdürülür.
- **Video yakalama** — YouTube, Vimeo, TikTok, Twitch ve benzeri platformlardan `yt-dlp` altyapısıyla video/ses indirme (en yüksek kalite için isteğe bağlı `ffmpeg` birleştirme).
- **Tarayıcı entegrasyonu** — Chrome / Edge / Brave / Firefox için Manifest V3 eklentisi: medya üzerinde yüzen indirme butonu, sağ tık ile "DeepNode ile indir" ve sayfa medya tarayıcısı (Grabber). Bkz. [`browser-extension/`](browser-extension/README.md).
- **Kuyruk ve zamanlayıcı** — eşzamanlı indirme limitleri, toplu indirme listeleri ve gece saatlerine planlanmış indirmeler.
- **Akıllı kategoriler** — indirmeler Video, Müzik, Belgeler, Programlar, Arşiv ve Görseller klasörlerine otomatik ayrılır.
- **Gerçek zamanlı istatistik** — canlı hız grafiği ve parça (chunk) bazında ilerleme göstergesi.
- **Karanlık / aydınlık tema** — sistem tercihinizi takip eden modern arayüz.
- **Yerleşik güncelleme kontrolü** — yeni sürüm çıktığında haberdar olun.
- **Tasarımı gereği özel** — reklam yok, telemetri yok; tüm veriler bilgisayarınızda kalır.

## İndirme

En güncel kurulum dosyasını [**GitHub Releases**](https://github.com/deepnodestudios/deepnode-download-manager/releases/latest) sayfasından veya ürün sayfasından indirin: **[deepnodestudios.net/DDM](https://deepnodestudios.net/DDM/)**

- Windows 10/11 (64-bit) · ~118 MB kurulum dosyası
- İlk video indirmenizde uygulama `yt-dlp`'yi otomatik indirir. En yüksek kalitede ses+görüntü birleştirme için sisteminizde **ffmpeg** kurulu olması (`PATH`'e ekli) önerilir.

## Teknoloji Altyapısı

| Katman | Teknoloji |
| --- | --- |
| Masaüstü kabuğu | Electron |
| Arayüz | React 18, Vite, Chart.js (canlı hız grafiği) |
| Yerel sunucu | Node.js, Express, WebSocket (`localhost:5000`) |
| Video motoru | yt-dlp (+ isteğe bağlı ffmpeg) |
| Paketleme | electron-builder (NSIS) |

## Kaynaktan Derleme

Gereksinimler: **Node.js 18+** (en iyi video kalitesi için isteğe bağlı olarak `PATH`'te **ffmpeg**).

```bash
# 1. Bağımlılıkları kur
npm install
cd frontend && npm install && cd ..

# 2. Geliştirme modunda çalıştır
npm start

# 3. Arayüzü derle + Windows kurulum dosyası üret (dist_exe/)
npm run build:exe
```

## Proje Yapısı

```
├── electron/           # Electron ana süreci (pencere, tepsi, IPC)
├── backend/            # Express + WebSocket sunucusu: indirme motoru, kuyruk, zamanlayıcı, video
├── frontend/           # React arayüzü (src → dist)
├── browser-extension/  # Manifest V3 tarayıcı eklentisi (Chrome/Edge/Brave/Firefox)
└── bin/                # Pakete dahil yardımcı bileşenler
```

## Bağlantılar

- Web sitesi: [deepnodestudios.net/DDM](https://deepnodestudios.net/DDM/)
- Sürümler: [github.com/deepnodestudios/deepnode-download-manager/releases](https://github.com/deepnodestudios/deepnode-download-manager/releases)
- İletişim: [deepnodestudios@gmail.com](mailto:deepnodestudios@gmail.com)

---

<div align="center"><a href="https://deepnodestudios.net">DeepNode Studios</a> tarafından geliştirildi</div>
