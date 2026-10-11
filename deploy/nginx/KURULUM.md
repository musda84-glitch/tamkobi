# TamKobi nginx kurulumu (Türkçe)

Bu klasör canlı `tamkobi.com` için önerilen nginx şablonunu içerir.

## Hedefler

1. **Port 80 açık** olmalı; HTTP istekleri `https://tamkobi.com` adresine **301** yönlenir.
2. `www.tamkobi.com` → `https://tamkobi.com` **301**.
3. HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / CSP `frame-ancestors`, `server_tokens off`.
4. JS/CSS/HTML/JSON/SVG için **gzip** (brotli modülü varsa açın).
5. `robots.txt` ve `sitemap.xml` gerçek dosya olarak sunulur (SPA HTML’i değil).

## Adımlar (VPS)

```bash
# 1) Şablonu kopyalayın (mevcut certbot vhost’unu ezmeyin; birleştirin)
sudo mkdir -p /etc/nginx/sites-available
sudo cp deploy/nginx/tamkobi.conf /etc/nginx/sites-available/tamkobi.com

# 2) SSL — yoksa önce certbot
sudo certbot --nginx -d tamkobi.com -d www.tamkobi.com
# Sonra tamkobi.conf içindeki ssl_certificate satırlarının yorumunu kaldırın
# veya certbot’un yazdığı yolları kullanın.

# 3) Etkinleştir
sudo ln -sf /etc/nginx/sites-available/tamkobi.com /etc/nginx/sites-enabled/tamkobi.com
sudo nginx -t && sudo systemctl reload nginx
```

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

`http://tamkobi.com` zaman aşımına düşüyorsa genelde **80 kapalı** veya nginx dinlemiyordur.

## Brotli (isteğe bağlı)

```bash
# Debian/Ubuntu örneği (paket adına göre değişir)
sudo apt install libnginx-mod-brotli   # veya nginx-module-brotli
# tamkobi.conf içindeki brotli satırlarının yorumunu kaldırın
sudo nginx -t && sudo systemctl reload nginx
```

## Notlar

- `deploy/update-native.sh` bu dosyayı otomatik kurmaz; canlıda elle uygulayın.
- Eski şablon: `deploy/nginx-vps.conf` (HTTP-only referans). Canlı için `deploy/nginx/tamkobi.conf` tercih edin.
- Uygulama API’si `127.0.0.1:8000`, statik build `/var/www/tamkobi.com/frontend/build`.
