# TamKobi tarayıcı eklentisi

Chrome / Edge / Brave (Manifest V3) ve Firefox için panel hızlı erişim eklentisi.

## Uygulama içinden indir

Panelde **Ayarlar → Tarayıcı Eklentisi** sekmesinden `.zip` indirin:

`/downloads/tamkobi-browser-extension.zip`

(`yarn build` / `prebuild` bu paketi `frontend/public/downloads/` altına üretir.)

## Ne işe yarar?

- Panel, Hızlı Satış, Faturalar, Stok, Siparişler, Cariler, Raporlar, Ayarlar
- Sistem ve Web sayfalarına tek tıkla açılış
- Kurulum kök adresini kaydeder; açık sekmeyi tek tıkla kullanır

## Kurulum (geliştirici / unpacked)

### Chromium (Chrome, Edge, Brave)

1. `chrome://extensions` (veya `edge://extensions`) açın
2. **Geliştirici modu**nu açın
3. **Paketlenmemiş öğe yükle** → zip’ten çıkan `tamkobi-browser-extension` klasörünü seçin

### Firefox

1. `about:debugging#/runtime/this-firefox` açın
2. **Geçici eklenti yükle** → `manifest.json` seçin

## Notlar

- Adres `chrome.storage.sync` ile tutulur
- Varsayılan kök: `https://tamkobi.com`
- Yerel geliştirme: örn. `http://127.0.0.1` veya `http://localhost:3010`
