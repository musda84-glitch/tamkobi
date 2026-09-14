# TamKobi tarayıcı eklentisi

Chrome / Edge / Brave (Manifest V3) ve Firefox için hızlı erişim eklentisi.

## Ne işe yarar?

- Panel, Hızlı Satış, Faturalar, Stok, Sistem ve Web sayfalarını tek tıkla açar
- Kurulum kök adresini (`https://sizin-domain.com`) kaydeder

## Kurulum (geliştirici / unpacked)

### Chromium (Chrome, Edge, Brave)

1. `chrome://extensions` (veya `edge://extensions`) açın
2. **Geliştirici modu**nu açın
3. **Paketlenmemiş öğe yükle** → bu klasörü (`browser-extension`) seçin

### Firefox

1. `about:debugging#/runtime/this-firefox` açın
2. **Geçici eklenti yükle** → `manifest.json` seçin

## Notlar

- Adres kaydı `chrome.storage.sync` ile tutulur (hesabınıza senkron olabilir)
- Varsayılan kök: `https://tamkobi.com`
- Yerel geliştirme için örn. `http://localhost:3000` yazabilirsiniz
