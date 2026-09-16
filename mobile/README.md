# TamKobi Mobil

`npx create-expo-app@latest` (Expo SDK 57, expo-router) üzerine TamKobi ERP istemcisi.

Web ile aynı hesaba bağlanır: `POST /api/auth/login` → `Authorization: Bearer`.

## Önizleme

```bash
cd mobile
npm install
npx expo start
```

Telefonda [Expo Go](https://expo.dev/go) ile QR’ı okutun. Farklı ağdaysanız:

```bash
npx expo start --tunnel
```

Giriş: TamKobi e-posta/şifre. API varsayılanı `https://tamkobi.com` (giriş ekranında **Sunucu** satırı).

## Ekranlar

Özet, saha sipariş, stok/barkod, Mesaim, cariler, faturalar, siparişler, bildirimler, arama.

## Mağaza

```bash
eas build --platform android
eas build --platform ios
```

Paket: `com.tamkobi.app`.
