# Firefox Eklentisi — İmzalama ve Güncelleme Rehberi (AMO)

Bu dosya, eklentinin **yeni bir sürümünü** herhangi bir bilgisayardan (veya herhangi bir
AI asistanla) imzalatıp yayınlamak için gereken her şeyi içerir. `*.md` dosyaları xpi
paketine girmez (`scripts/build-xpi.mjs` hariç tutar).

## Değişmez kurallar

- **Eklenti ID'si ASLA değiştirilmez:** `manifest.json` → `browser_specific_settings.gecko.id`
  = `ddm@deepnodestudios.com`. Bu ID, ilk imzada Mozilla (AMO) hesabına kalıcı olarak
  kilitlenmiştir. ID değişirse AMO onu **yeni bir eklenti** sayar ve eski kurulumlar güncellenmez.
- **Aynı sürüm numarası iki kez imzalatılamaz.** Her imza için `manifest.json` içindeki
  `version` artırılmalıdır (kök `package.json` sürümüyle eşit tutulur).
- **API anahtarları hiçbir dosyaya, commit'e veya log'a yazılmaz.** Sadece komut satırında
  bir kez kullanılır; iş bitince AMO'dan iptal edilip (revoke) yenilenmesi önerilir.
- İmza **kullanıcının AMO hesabıyla** yapılır. Başka PC'de anahtar yoksa kullanıcı
  https://addons.mozilla.org/developers/addon/api/key/ adresinden yeni anahtar üretir
  (JWT issuer `user:XXXXXXXX:X` + JWT secret). Hesap aynı olduğu sürece makine fark etmez.

## Dosya düzeni

| Dosya | Ne |
|---|---|
| `browser-extension/deepnode-extension-firefox.xpi` | **İmzalı dağıtım kopyası** — depoya GİRER, installer'la dağıtılır. Uygulamadaki kurulum adımları bu dosya adına referans verir; adı değiştirme. |
| `dist_exe/deepnode-extension-unsigned.xpi` | `node scripts/build-xpi.mjs` çıktısı — AMO'ya gönderilen imzasız girdi. Depoya girmez. |
| `browser-extension/.amo-upload-uuid` | `web-ext`'in bıraktığı durum dosyası — gitignore'da. |

## Yeni sürüm yayınlama adımları

1. **Sürümü artır:** `browser-extension/manifest.json` → `version` (kök `package.json` ile aynı yap).
2. **Kullanıcıdan API anahtarını iste** (issuer + secret; yukarıdaki adresten üretir).
3. **İmzalat** (depo kökünden, unlisted kanal dakikalar içinde otomatik imzalar; "listed"
   kanal inceleme kuyruğuna girer — kullanma):

   ```powershell
   npx web-ext sign --channel=unlisted `
     --source-dir=browser-extension `
     --artifacts-dir=dist_exe/web-ext-artifacts `
     --ignore-files "*.md" "*.xpi" ".amo-upload-uuid" `
     --api-key=<JWT_ISSUER> --api-secret=<JWT_SECRET>
   ```

4. **Yerine koy:** `dist_exe/web-ext-artifacts/` içine inen imzalı `.xpi` dosyasını
   `browser-extension/deepnode-extension-firefox.xpi` olarak (üzerine yazarak) kopyala.
5. **Doğrula:** dosya boyutu makul mü (~75 KB), zip içindeki `manifest.json` sürümü doğru mu,
   `META-INF/` klasörü (Mozilla imzası) var mı.
6. **Commit et:** imzalı xpi + manifest sürüm değişikliği birlikte. Sonra normal sürüm akışı
   (`npm test` → `npm run build:exe` → GitHub Release).
7. **Kullanıcıya hatırlat:** AMO API anahtarını revoke etsin.

### Alternatif: Web arayüzünden (API anahtarı gerekmez)

Kullanıcı https://addons.mozilla.org/developers/ → Eklentilerim → DeepNode →
**"Yeni sürüm gönder"** ile de imzalatabilir:
1. Kanal: **"Kendim dağıtacağım"** (self-distribution/unlisted) — mağaza kanalını SEÇME.
2. Dosya: `dist_exe/deepnode-extension-unsigned.xpi` (önce `node scripts/build-xpi.mjs` ile üret).
3. Veri toplama sorusuna "veri toplamıyor" de (manifest'teki `data_collection_permissions: none` ile tutarlı).
4. Sürüm sayfasındaki **"İmzalı dosyayı indir"** linkinden imzalı xpi'yi al → adım 4-6 aynı.

⚠️ Developer Hub'daki "Eklentiyi sil" butonu ID'yi kalıcı olarak kullanılamaz yapar — asla kullanma.

## Kurulum (son kullanıcı, normal Firefox 140+)

1. Uygulamada "Eklenti Klasörünü Aç" → `deepnode-extension-firefox.xpi`
2. Dosyayı Firefox penceresine sürükle → "Ekle" ile onayla (kurulum kalıcıdır)
3. `about:addons` → DeepNode → İzinler → tüm sitelere erişime izin ver
