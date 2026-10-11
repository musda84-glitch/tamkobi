# TamKobi nginx kurulumu (Türkçe)

Bu klasör canlı `tamkobi.com` için önerilen nginx şablonlarını içerir.

| Dosya | Ne zaman |
|--------|----------|
| `security-headers.conf` | Her ortamda snippet olarak |
| `tamkobi.conf` | Sertifika yokken / HTTP; `nginx -t` her zaman geçer |
| `tamkobi-ssl.conf.example` | Sertifika sonrası HTTPS + www→apex referansı |
| `../nginx-vps.conf` | Geriye dönük HTTP-only + XFF notları |

## Hedefler (canlı, SSL sonrası)

1. Port **80** açık; HTTP → `https://tamkobi.com` **301**
2. `www.tamkobi.com` → `https://tamkobi.com` **301**
3. HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / CSP `frame-ancestors`, `server_tokens off`
4. JS/CSS/HTML/JSON/SVG **gzip** (brotli varsa açın)
5. `robots.txt` / `sitemap.xml` gerçek dosya (SPA HTML değil)

## Önemli: canlı vhost’u ezmeyin

Certbot’un yönettiği `/etc/nginx/sites-enabled/…` dosyasını `cp tamkobi.conf` ile **üzerine yazmayın** — sertifika satırları ve yenileme kancaları kaybolur. Yeni kurulumda şablonu kopyalayın; mevcut canlıda **snippet + location’ları birleştirin**.

## Adımlar

### A) Snippet (bir kez)

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/security-headers.conf /etc/nginx/snippets/tamkobi-security-headers.conf
```

### B) Sertifika yok (HTTP-only, `nginx -t` geçer)

```bash
# Yalnızca henüz sites-available yoksa / yeni sunucu
sudo cp deploy/nginx/tamkobi.conf /etc/nginx/sites-available/tamkobi.com
sudo ln -sf /etc/nginx/sites-available/tamkobi.com /etc/nginx/sites-enabled/tamkobi.com
sudo nginx -t && sudo systemctl reload nginx
```

`server_name` içine genel IP eklemeyin. API proxy’de `X-Forwarded-For` / `X-Real-IP` yalnızca `$remote_addr` olmalı (login kilidi).

### C) Sertifika (certbot) — mevcut vhost’u koruyarak

```bash
# Tercihen mevcut HTTP vhost üzerinde (certbot dosyayı kendisi günceller)
sudo certbot --nginx -d tamkobi.com -d www.tamkobi.com

# veya yalnızca sertifika:
# sudo certbot certonly --nginx -d tamkobi.com -d www.tamkobi.com
```

Sonra:

1. `:80` sunucusunu `return 301 https://tamkobi.com$request_uri;` yapın (apex).
2. `www` için 443’te apex’e 301 ekleyin — örnek: `tamkobi-ssl.conf.example`.
3. Her `add_header` içeren `location` bloğuna `include snippets/tamkobi-security-headers.conf;` koyun (üst bloktakiler miras alınmaz).
4. `sudo nginx -t && sudo systemctl reload nginx`

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

`http://tamkobi.com` zaman aşımı → genelde **80 kapalı** veya nginx dinlemiyor.

## Brotli (isteğe bağlı)

```bash
sudo apt install libnginx-mod-brotli   # paket adına göre değişir
# tamkobi.conf içindeki brotli satırlarının yorumunu kaldırın
sudo nginx -t && sudo systemctl reload nginx
```

## Notlar

- `deploy/update-native.sh` bu dosyaları otomatik kurmaz.
- API: `127.0.0.1:8000` · statik: `/var/www/tamkobi.com/frontend/build`
