# TamKobi Masaüstü

`app.tamkobi.com` için Windows kabuğu. Atölye, depo sevkiyatı, stok sayımı ve hızlı satış ekranlarını açar; sipariş, stok ve satış kuralları sunucuda kalır.

## Ne yapar

- Açılışta, oturumdaki rolün görebildiği modları listeler. Son seçim bu bilgisayarda hatırlanır. İzni `none` olan veya lisansı kapalı mod menüde görünmez.
- Kiosk / tam ekran. Çıkış (`Ctrl+Shift+L` veya pencereyi kapatma) `POST /api/desktop/kiosk-exit` ile doğrulanır. PIN 4-6 rakamdır; karar Hızlı Satış kasiyer kilidindeki `can_approve` kapısıyla aynıdır. Kasiyer kendi kilitli çıkışını onaylayamaz.
- USB barkod okuyucu klavye gibi yazar. Kabuk yalnızca kiosk çıkış kısayolunu yakalar.
- Fiş ve etiket için sessiz yazdırma. Listeden bir Windows yazıcısı seçilir; boş bırakılırsa Windows varsayılan yazıcısı kullanılır.
- Oturum çerezi WebView2 profilinde, `%LOCALAPPDATA%\com.tamkobi.desktop\webview` altında kalır. Kabuk PIN veya erişim jetonu yazmaz.
- Yalnızca `https://tamkobi.com` ve `https://*.tamkobi.com` kabukta açılır. Diğer `http(s)` adresler sistem tarayıcısına gider.

## Geliştirme

```bash
cd desktop
npm install
npm test
npm run dev
```

`npm test` mod yönlendirmesini, alan adı kısıtını ve kiosk çıkış PIN’ini çalıştırır.

## İmzası olmayan .exe ve .msi

Bu depoda yayınlama iş akışı yoktur. Kurulum dosyasını Windows’ta yerelde üretin.

Gerekli olanlar: [Rust](https://rustup.rs/) 1.83 veya üzeri, Node.js 20+, Visual Studio C++ derleme araçları ve WebView2. NSIS/MSI paketinde WebView2 önyükleyicisi indirilir; makinede yoksa kurulum onu ister.

`Cargo.lock` kasaları Rust 1.83 ile derlenecek sürümlere sabitler. Daha yeni Tauri ve bazı geçişli kasalar edition 2024 istediği için `cargo update` bu dosyayı bozabilir; kilit dosyasını silmeyin.

```powershell
cd desktop
npm install
npm run build
```

`npm run build`, `tauri build --bundles nsis,msi` çalıştırır. `TAURI_SIGNING_PRIVATE_KEY` tanımlamayın. Çıktılar:

- `src-tauri\target\release\bundle\nsis\TamKobi_0.1.0_x64-setup.exe`
- `src-tauri\target\release\bundle\msi\TamKobi_0.1.0_x64_en-US.msi`

Dosya adındaki sürüm `tauri.conf.json` içindeki `version` alanıdır. Bu komut Authenticode ile imzalamaz (`--no-sign` ayrıca gerekmez; sertifika başparmak izi tanımlı değildir).

Güncelleme imzası (`.sig`) ancak `TAURI_SIGNING_PRIVATE_KEY` doluysa üretilir. Anahtar yokken imza adımı hata verirse kurulum dosyaları yine `bundle\nsis` ve `bundle\msi` altındadır; imzasız dağıtım için onlar yeterlidir.

## Güncelleme altyapısı

`tauri.conf.json` içindeki updater eklentisi şu adresi okur:

`https://github.com/musda84-glitch/tamkobi/releases/latest/download/latest.json`

Repodaki açık anahtar yer tutucudur; özel anahtarı yoktur. Yayınlamadan önce kendi çiftinizi üretin ve açık anahtarı `plugins.updater.pubkey` alanına yazın:

```powershell
npm run tauri -- signer generate -w $env:USERPROFILE\.tauri\tamkobi.key
```

Özel anahtarı depoya koymayın. İmzalı kurulum için aynı PowerShell oturumunda:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $env:USERPROFILE\.tauri\tamkobi.key -Raw
npm run build
```

Bu, `.exe` / `.msi` yanında updater’ın beklediği `.sig` dosyalarını da üretir. `latest.json` ve bu dosyalar GitHub Release’e elle konur. Yayınlama iş akışı bu depoya eklenmez.

Örnek `latest.json`:

```json
{
  "version": "0.1.1",
  "notes": "Kiosk kabuğu",
  "pub_date": "2026-10-14T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "İÇERİK .sig DOSYASINDAN",
      "url": "https://github.com/musda84-glitch/tamkobi/releases/download/desktop-v0.1.1/TamKobi_0.1.1_x64-setup.exe"
    }
  }
}
```

Kabuk açılınca bu adresi yoklar. Sürüm varsa mod ekranında **Güncelle** görünür. Adres henüz yoksa veya imza açık anahtarla uyuşmuyorsa kabuk normal açılır.
