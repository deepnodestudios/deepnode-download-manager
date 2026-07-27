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

### Firefox (sürüm 121+)
1. Adres çubuğuna `about:debugging#/runtime/this-firefox` yaz.
2. **Geçici Eklenti Yükle** (Load Temporary Add-on) → bu klasördeki `manifest.json` dosyasını seç.
3. Not: Firefox'ta geçici eklentiler tarayıcı kapanınca kaldırılır; her açılışta tekrar yüklemen gerekir (imzasız eklenti sınırı). Kalıcı kurulum için eklentinin Mozilla (AMO) tarafından imzalanması gerekir.

> Neden "kurulum sırasında otomatik" değil? Tarayıcılar (Chrome, Firefox) güvenlik nedeniyle bir uygulamanın kendilerine sessizce eklenti kurmasına izin vermez. Kalıcı ve tek-tık kurulum için eklentiyi Chrome Web Mağazası / Edge Add-ons / Firefox AMO'da yayınlamak gerekir.

## Notlar
- Eklenti uygulamayla `http://localhost:5000/api/download/add` üzerinden konuşur. Uygulamada portu değiştirirsen, eklenti açılır penceresinden portu güncelle.
- Uygulama kapalıyken "yakala" seçeneği açık olsa bile tarayıcı indirmesi iptal edilmez (veri kaybı olmaması için önce uygulamaya gönderilir, ancak başarılıysa iptal edilir).
- YouTube gibi DRM/parçalı akışlarda video çoğu zaman `blob:` olur; buton ağdan yakaladığı en iyi akış adresini dener. Bazı korumalı içerikler indirilemeyebilir.
