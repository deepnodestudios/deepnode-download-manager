# DeepNode Download Manager – Tarayıcı Entegrasyonu

**[English](README.en.md) · [Türkçe](README.md)**

Chrome / Edge / Brave için Manifest V3 eklentisi. Tarayıcıdaki indirmeleri yakalayıp
DeepNode Download Manager'a yönlendirir, medyanın (video/ses/resim) köşesinde bir **İndir**
butonu gösterir ve sayfadaki tüm indirilebilir bağlantıları toplayan bir **Grabber** paneli sunar.

## Özellikler
- **Medya köşesinde İndir butonu** – bir video/resmin üzerine gelince sağ üst köşede beliren buton.
- **Tarayıcı indirmelerini yakalama** – tarayıcı bir dosya indirmeye başladığında iptal edip DeepNode kuyruğuna ekler (açılıp kapatılabilir).
- **Sağ tık menüsü** – bağlantı/resim/video üzerinde "DeepNode ile indir".
- **Grabber** – "Bu sayfadaki medyayı tara" ile tüm medyayı listeler; tek tek veya tümünü indir.
- **YouTube ve benzeri siteler** – YouTube, Vimeo, TikTok, Twitch vb. sitelerde köşedeki buton (veya sağ tık → "Bu videoyu indir") sayfa adresini uygulamaya gönderir; uygulama videoyu `yt-dlp` ile (gerekirse ses+görüntüyü birleştirerek) indirir.
- **Akış (HLS/blob) yedeği** – diğer sitelerde blob video doğrudan indirilemezse, ağdan yakalanan .m3u8/.mp4 akış adresini kullanır.

## YouTube / video siteleri nasıl çalışır
Uygulama, YouTube gibi sitelerin videolarını **yt-dlp** ile indirir. İlk video indirmende
uygulama `yt-dlp`'yi otomatik olarak indirir (`%USERPROFILE%\.deepnode\yt-dlp.exe`). En yüksek kalitede
ses+görüntü birleştirme için sistemde **ffmpeg** kurulu olması önerilir; yoksa uygulama birleştirme gerektirmeyen
(genelde 720p'ye kadar) mp4 formatını indirir. ffmpeg'i PATH'e eklersen yt-dlp otomatik kullanır.

## Kurulum (geliştirici modu)
Önce **DeepNode Download Manager** uygulamasını çalıştır (arka planda `localhost:5000` çalışmalı). Sonra tarayıcına göre:

### Chrome / Edge / Brave / Opera
1. Adres çubuğuna `chrome://extensions` yaz (Edge'de `edge://extensions`).
2. Sağ üstten **Geliştirici modu**'nu (Developer mode) aç.
3. **Paketlenmemiş öğe yükle** (Load unpacked) → bu `browser-extension` klasörünü seç.
4. Araç çubuğunda DeepNode simgesi çıkar. Simgeye tıklayıp durumu (bağlı/kapalı) görebilir, ayarları değiştirebilirsin.

### Firefox (140+)
1. Bu klasördeki `deepnode-extension-firefox.xpi` dosyasını Firefox penceresine sürükle (veya `about:addons` → dişli simgesi → **Eklentiyi dosyadan kur…**) ve **Ekle** ile onayla.
2. `about:addons` → DeepNode → **İzinler** sekmesinden tüm sitelere erişime izin ver.
3. Eklenti Mozilla (AMO) imzalıdır; kurulum **kalıcıdır**. Yeni sürüm imzalatma süreci için bkz. [SIGNING.md](SIGNING.md).

> Neden "kurulum sırasında otomatik" değil? Tarayıcılar (Chrome, Firefox) güvenlik nedeniyle bir uygulamanın kendilerine sessizce eklenti kurmasına izin vermez. Firefox paketi Mozilla imzalı olduğu için sürükle-bırak ile kalıcı kurulur; Chrome/Edge'de tek-tık kalıcı kurulum için eklentiyi Chrome Web Mağazası / Edge Add-ons'ta yayınlamak gerekir.

## Notlar
- Eklenti uygulamayla `http://localhost:5000/api/download/add` üzerinden konuşur. Uygulamada portu değiştirirsen, eklenti açılır penceresinden portu güncelle.
- Uygulama kapalıyken "yakala" seçeneği açık olsa bile tarayıcı indirmesi iptal edilmez (veri kaybı olmaması için önce uygulamaya gönderilir, ancak başarılıysa iptal edilir).
- YouTube gibi DRM/parçalı akışlarda video çoğu zaman `blob:` olur; buton ağdan yakaladığı en iyi akış adresini dener. Bazı korumalı içerikler indirilemeyebilir.
