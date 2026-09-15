# TamKobi tarayıcı eklentisi

Chrome / Edge / Brave (Manifest V3) ve Firefox için hızlı erişim eklentisi.

## Uygulama içinden indir

Panelde **Ayarlar → Tarayıcı Eklentisi** sekmesinden `.zip` indirin:

`/downloads/tamkobi-browser-extension.zip`

(Üretim derlemesinde `yarn build` / `prebuild` bu paketi otomatik üretir.)

## Ne işe yarar?

- Panel, Hızlı Satış, Faturalar, Stok, Sistem ve Web sayfalarını tek tıkla açar
- Kurulum kök adresini (`https://sizin-domain.com`) kaydeder

## Kurulum (geliştirici / unpacked)

### Chromium (Chrome, Edge, Brave)

1. `chrome://extensions` (veya `edge://extensions`) açın
2. **Geliştirici modu**nu açın
3. **Paketlenmemiş öğe yükle** → bu klasörü (`browser-extension`) veya zip’ten çıkan klasörü seçin

### Firefox

1. `about:debugging#/runtime/this-firefox` açın
2. **Geçici eklenti yükle** → `manifest.json` seçin

## Notlar

- Adres kaydı `chrome.storage.sync` ile tutulur (hesabınıza senkron olabilir)
- Varsayılan kök: `https://tamkobi.com`
- Yerel geliştirme için örn. `http://localhost:3000` yazabilirsiniz
