# TamKobi nginx kurulumu (Türkçe)

Bu klasör canlı `tamkobi.com` için önerilen nginx şablonlarını içerir.

| Dosya | Ne zaman |
|--------|----------|
| `security-headers.conf` | Her ortamda snippet olarak |
| `tamkobi.conf` | Sertifika yokken / HTTP; `nginx -t` her zaman geçer |
| `tamkobi-ssl.conf.example` | Sertifika sonrası HTTPS + www→apex (tam location’lı) |
| `../nginx-vps.conf` | Geriye dönük HTTP-only + XFF notları |

## Hedefler (canlı, SSL sonrası)

1. Port **80** açık; HTTP → `https://tamkobi.com` **301**
2. `www.tamkobi.com` → `https://tamkobi.com` **301**
3. HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / CSP `frame-ancestors`, `server_tokens off`
4. JS/CSS/HTML/JSON/SVG **gzip** (brotli varsa açın)
5. `robots.txt` / `sitemap.xml` gerçek dosya (SPA HTML değil)

## Önemli: canlı vhost’u ezmeyin

Certbot’un yönettiği `/etc/nginx/sites-enabled/…` dosyasını `cp tamkobi.conf` ile **üzerine yazmayın**. Yeni kurulumda şablonu kopyalayın; mevcut canlıda **snippet + blokları birleştirin**.

## Adımlar

### A) Snippet (bir kez)

```bash
sudo mkdir -p /etc/nginx/snippets
sudo cp deploy/nginx/security-headers.conf /etc/nginx/snippets/tamkobi-security-headers.conf
```

### B) Sertifika yok (HTTP-only, `nginx -t` geçer)

```bash
sudo cp deploy/nginx/tamkobi.conf /etc/nginx/sites-available/tamkobi.com
sudo ln -sf /etc/nginx/sites-available/tamkobi.com /etc/nginx/sites-enabled/tamkobi.com
sudo nginx -t && sudo systemctl reload nginx
```

`server_name` içine genel IP eklemeyin. API proxy’de `X-Forwarded-For` / `X-Real-IP` yalnızca `$remote_addr`.

### C) Sertifika sonrası — :80’i yönlendirmeye çevirin

```bash
sudo certbot --nginx -d tamkobi.com -d www.tamkobi.com
# veya: sudo certbot certonly --nginx -d tamkobi.com -d www.tamkobi.com
```

**`tamkobi.conf` içindeki mevcut `:80` server bloğunu şöyle değiştirin:**

1. Bloktaki `root`, `gzip`, tüm `location` ve `include` satırlarını **silin**.
2. Yalnızca şunu bırakın:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name tamkobi.com www.tamkobi.com;
    return 301 https://tamkobi.com$request_uri;
}
```

3. `deploy/nginx/tamkobi-ssl.conf.example` içindeki **443** bloklarını (www→apex + ana site + tüm location’lar) aynı vhost dosyasına ekleyin.
   - Dinleme: `listen 443 ssl;` ve ayrı satırda `http2 on;` (eski `listen 443 ssl http2` yerine).
4. `sudo nginx -t && sudo systemctl reload nginx`

Özet: HTTP içeriği artık yalnızca 443’te; 80 her zaman apex HTTPS’e 301 atar.

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

## Brotli (isteğe bağlı)

```bash
sudo apt install libnginx-mod-brotli
# conf içindeki brotli satırlarının yorumunu kaldırın
sudo nginx -t && sudo systemctl reload nginx
```

## Notlar

- `deploy/update-native.sh` bu dosyaları otomatik kurmaz.
- API: `127.0.0.1:8000` · statik: `/var/www/tamkobi.com/frontend/build`
