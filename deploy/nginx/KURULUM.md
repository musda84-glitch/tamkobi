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
sudo cp deploy/nginx/spa-routes.map.conf /etc/nginx/snippets/tamkobi-spa-routes.map.conf
```

**http {} bloğuna** (ör. `/etc/nginx/nginx.conf` veya `conf.d/tamkobi-map.conf` — `server` içinde değil):

```nginx
include /etc/nginx/snippets/tamkobi-spa-routes.map.conf;
```

Bu map, bilinmeyen adreslerde gerçek **HTTP 404** (`404.html`) döndürmek için gerekir. Bilinen vitrin/ERP yolları `index.html` alır.

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
   - Canlı **nginx 1.24**: `listen 443 ssl http2;` (örnek dosyadaki gibi).
   - **nginx 1.25.1+**: `listen 443 ssl;` + ayrı satırda `http2 on;` tercih edilir (`listen … http2` uyarı verebilir).
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

## Canlı vhost’a soft-404 düzeltmesi (elle)

Canlı nginx elle yönetiliyor; şablonu ezmeden şu satırları ekleyin:

1. Snippet kopyalayın (yukarı §A) ve **http {}** içine map include ekleyin.
2. Ana `server` bloğunda `error_page 404 /404.html;` ve `location = /404.html { internal; … }` olduğundan emin olun.
3. SPA fallback named location’ını şöyle güncelleyin:

```nginx
location @spa_or_404 {
    include snippets/tamkobi-security-headers.conf;
    if ($tamkobi_spa = 0) { return 404; }
    rewrite ^ /index.html last;
}
```

4. `sudo nginx -t && sudo systemctl reload nginx`
5. Doğrulama: `curl -sI https://tamkobi.com/bu-yol-yok` → `404`; `curl -sI https://tamkobi.com/panel` → `200` (SPA).

Yeni ERP yolu eklerseniz `spa-routes.map.conf` regex listesine ekleyin.

## Notlar

- `deploy/update-native.sh` bu dosyaları otomatik kurmaz.
- API: `127.0.0.1:8000` · statik: `/var/www/tamkobi.com/frontend/build`
