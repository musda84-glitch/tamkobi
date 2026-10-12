# TamKobi nginx kurulumu (Türkçe)

Bu klasör canlı `tamkobi.com` için önerilen nginx şablonlarını içerir.

| Dosya | Ne zaman |
|--------|----------|
| `security-headers.conf` | Her ortamda snippet olarak |
| `tamkobi-upstream.conf` | API blue/green (`upstream tamkobi_api`) — `conf.d/` |
| `tamkobi.conf` | Sertifika yokken / HTTP; `nginx -t` her zaman geçer |
| `tamkobi-ssl.conf.example` | Sertifika sonrası HTTPS + www→apex (tam location’lı) |
| `../nginx-vps.conf` | Geriye dönük HTTP-only + XFF notları |

## Kesintisiz dağıtım (faz 1)

Statik kök: `/var/www/tamkobi.com/frontend-current` (symlink → `frontend-releases/<sha>`).  
API: `proxy_pass http://tamkobi_api;` — port `deploy` betikleri tarafından `/etc/nginx/conf.d/tamkobi-upstream.conf` içinde 8000↔8001 değişir.

**Tek seferlik geçiş (canlı):** `sudo sh deploy/migrate-zero-downtime.sh`  
**Sonraki güncellemeler:** `sudo sh deploy/update-native.sh`  
**Durum / geri alma:** `deploy/status.sh`, `deploy/rollback.sh`

### DB şema kuralı (blue/green)

Alan **silme** veya **yeniden adlandırma** iki sürüme yayılmalıdır: önce yeni alanı ekleyin ve kodu her iki şekilde okuyacak hale getirin; bir sonraki dağıtımda eski alanı kaldırın. Aksi halde eski ve yeni API anlık olarak aynı DB’yi paylaşırken kırılır.

## Hedefler (canlı, SSL sonrası)

1. Port **80** açık; HTTP → `https://tamkobi.com` **301**
2. `www.tamkobi.com` → `https://tamkobi.com` **301**
3. HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` / CSP `frame-ancestors`, `server_tokens off`
4. JS/CSS/HTML/JSON/SVG **gzip** (brotli varsa açın)
5. `robots.txt` / `sitemap.xml` gerçek dosya (SPA HTML değil)
6. `index.html` → `Cache-Control: no-cache`; `/static/` → `immutable`

## Önemli: canlı vhost’u ezmeyin

Certbot’un yönettiği `/etc/nginx/sites-enabled/…` dosyasını `cp tamkobi.conf` ile **üzerine yazmayın**. Yeni kurulumda şablonu kopyalayın; mevcut canlıda **snippet + blokları birleştirin** veya `migrate-zero-downtime.sh` kullanın (yalnızca `root` ve `proxy_pass` satırlarını değiştirir).

## Adımlar

### A) Snippet / map / upstream (bir kez)

```bash
sudo mkdir -p /etc/nginx/snippets /etc/nginx/conf.d
sudo cp deploy/nginx/security-headers.conf /etc/nginx/snippets/tamkobi-security-headers.conf
sudo cp deploy/nginx/spa-routes.map.conf /etc/nginx/conf.d/tamkobi-spa-routes.map.conf
sudo cp deploy/nginx/tamkobi-upstream.conf /etc/nginx/conf.d/tamkobi-upstream.conf
```

İsteğe bağlı alternatif: map’i `snippets/` altına koyup `nginx.conf` → `http { include …; }` ile yüklemek. `server` bloğunda `map` kullanılamaz.

### B) Sertifika yok (HTTP-only, `nginx -t` geçer)

```bash
sudo cp deploy/nginx/tamkobi.conf /etc/nginx/sites-available/tamkobi.com
sudo ln -sf /etc/nginx/sites-available/tamkobi.com /etc/nginx/sites-enabled/tamkobi.com
sudo nginx -t && sudo systemctl reload nginx
```

### C) Sertifika sonrası — :80’i yönlendirmeye çevirin

```bash
sudo certbot --nginx -d tamkobi.com -d www.tamkobi.com
```

`deploy/nginx/tamkobi-ssl.conf.example` içindeki **443** bloklarını birleştirin. Canlı **nginx 1.24**: `listen 443 ssl http2;`.

## MySQL yedek / geri yükleme

```bash
# Yedek (mysqldump | gzip akışı; bellek dostu)
cd /var/www/tamkobi.com/backend && venv/bin/python -m mysql_backup backup --keep 14

# JSON snapshot geri yükleme
venv/bin/python -m mysql_backup restore backups/mysql/tamkobi-….json.gz --yes

# SQL.gz (mysqldump) geri yükleme
venv/bin/python -m mysql_backup restore backups/mysql/tamkobi-….sql.gz --yes
# veya: gunzip -c dosya.sql.gz | mysql --defaults-extra-file=… tamkobi
```

Dağıtım sırasında isteğe bağlı: `sudo sh deploy/update-native.sh --backup`

## Firewall

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

## Notlar

- `deploy/update-native.sh` nginx şablonlarını otomatik kurmaz; migrate sonrası yalnızca upstream portunu yazar ve `nginx -t && reload` yapar (**restart yok**).
- API: `upstream tamkobi_api` (8000/8001) · statik: `/var/www/tamkobi.com/frontend-current`
- Arka plan işleri: `TAMKOBI_BACKGROUND_JOBS=0` ile kapatılabilir; açıkken DB `platform_locks` ile tek process çalışır.
- Düşük bellek: `TAMKOBI_WORKERS=1`
