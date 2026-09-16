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

Özet, saha sipariş, stok/barkod, Mesaim, Personelim, cariler, faturalar, siparişler, bildirimler, arama.

## Mağaza (EAS)

EAS proje ID: `af1abb42-dd0a-4e13-8453-ad3224e2044d`

```bash
cd mobile
npm install
npx eas-cli login
npx eas-cli@latest init --id af1abb42-dd0a-4e13-8453-ad3224e2044d
npx eas-cli build --platform ios --profile production
```

`create-expo-app tamkobi` çalıştırmayın; uygulama zaten `mobile/` içinde.

Paket: `com.tamkobi.app`.
