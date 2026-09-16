# TamKobi Mobil

`npx create-expo-app@latest` (Expo SDK 58 beta, expo-router) üzerine TamKobi ERP istemcisi.

Web ile aynı hesaba bağlanır: `POST /api/auth/login` → `Authorization: Bearer`.

## Önizleme

```bash
cd mobile
npm install
npx expo start
```

Telefonda [Expo Go](https://expo.dev/go) ile QR’ı okutun. SDK 58 henüz mağaza Expo Go’da yok; CLI/`eas go` ile SDK 58 Expo Go kullanın. Farklı ağdaysanız:

```bash
npx expo start --tunnel
```

Giriş: TamKobi e-posta/şifre. API varsayılanı `https://tamkobi.com` (giriş ekranında **Sunucu** satırı).

## Ekranlar

Özet, saha sipariş, stok/barkod, Mesaim, Personelim, cariler, faturalar, siparişler, bildirimler, arama.

## Mağaza (EAS)

EAS proje ID: `7141c868-a97d-4fd6-80ac-62d4991e669b`

```bash
cd mobile
npm install
npx eas-cli login
npx eas-cli@latest init --id 7141c868-a97d-4fd6-80ac-62d4991e669b
npx eas-cli build --platform ios --profile production
```

`create-expo-app tamkobi` çalıştırmayın; uygulama zaten `mobile/` içinde.

Paket: `com.tamkobi.app`.
