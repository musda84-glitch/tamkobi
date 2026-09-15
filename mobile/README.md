# TamKobi Mobil (iOS + Android)

Yeni Expo (React Native) uygulaması. Web ERP ile **aynı TamKobi API**’ye Bearer JWT ile bağlanır (`POST /api/auth/login` → `Authorization: Bearer`).

## Ne işe yarar?

Sahada ve cepte kullanılan temel akışlar:

- Giriş, çoklu şirket, API adresi (varsayılan `https://tamkobi.com`)
- Özet: tahsilat / ödeme / KDV / bugünkü işler
- Saha sipariş: cari seç, barkod, sepet, `channel=saha`
- Stok ve barkod sorgusu
- Mesaim: konumlu giriş / çıkış (`/personnel/attendance/self`)
- Cariler, faturalar, siparişler, bildirimler, genel arama

Masaüstü modüllerinin tamamı (e-fatura kesme, banka eşleme, üretim reçetesi vb.) web uygulamasında kalır.

## Geliştirme

```bash
cd mobile
npm install
npx expo start
```

Telefonda [Expo Go](https://expo.dev/go) ile QR kodu okutun. iOS Simulator / Android Emulator:

```bash
npx expo start --ios
npx expo start --android
```

API adresi giriş ekranından veya `EXPO_PUBLIC_API_URL` ile verilir (ör. `http://127.0.0.1:8000`). Emülatörden host makineye Android’de `http://10.0.2.2:8000` kullanın.

## Mağaza derlemesi

[EAS Build](https://docs.expo.dev/build/setup/):

```bash
npm i -g eas-cli
eas login
eas build:configure
eas build --platform android
eas build --platform ios
```

`app.json` içinde `ios.bundleIdentifier` ve `android.package` = `com.tamkobi.app`.

## Test

```bash
cd mobile
npm test
```

Backend sözleşmesi: `GET /api/mobile/manifest` (oturum gerekmez), `GET /api/invoices/{id}`.
