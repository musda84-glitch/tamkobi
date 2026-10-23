# TamKobi nginx kurulumu (Türkçe)

Bu klasör canlı `tamkobi.com` için önerilen nginx şablonlarını içerir.

| Dosya | Ne zaman |
|--------|----------|
| `security-headers.conf` | Her ortamda snippet olarak |
| `tamkobi-upstream.conf` | API blue/green (`upstream tamkobi_api`) — `conf.d/` |
| `tamkobi.conf` | Sertifika yokken / HTTP; `nginx -t` her zaman geçer |
| `tamkobi-ssl.conf.example` | Sertifika sonrası HTTPS + www→apex (tam location’lı); **listen 85.95.240.184:443** |
| `tamkobi-subdomains.conf.example` | app / b2b / ik vhost’ları (IP bind + noindex) |
| `tamkobi-site-redirects.conf` | Apex’te panel/b2b/ik → 301 (snippet) |
| `ynt-taiyazilim.conf.example` | Platform Yönetimi vhost (ynt.taiyazilim.com) |
| `tamkobi-sistem-redirect.conf` | `/sistem` → ynt 301 (bayrak sonrası snippet) |
| `spa-routes.map.conf` | Bilinen SPA URI’leri (alt alan adları dahil) |
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
- Web birimleri (`tamkobi-backend@8000` / `@8001`) `TAMKOBI_BACKGROUND_JOBS=0` ile çalışır. Arka plan işleri tek `tamkobi-worker` birimindedir (`127.0.0.1:8099`, nginx upstream'e eklenmez). Blue/green bu birimi yerinde yeniden başlatır; ikinci kopya açılmaz. `platform_locks` kirası yine tek sahip bırakır.
- Düşük bellek: `TAMKOBI_WORKERS=1`

---

## Alt alan adları (app / b2b / ik) — kopyala-yapıştır

Kesintisiz dağıtım düzenine dokunulmaz (`update-native.sh`, `migrate-zero-downtime.sh`,
`rollback.sh`, `status.sh`, `deploy/lib/*.sh`, `platform_lease`). Yalnızca nginx şablonları eklenir.

### 1) Yedek

```bash
sudo cp -a /etc/bind/zones/db.tamkobi.com /root/db.tamkobi.com.bak.$(date +%Y%m%d)
sudo cp -a /etc/nginx/sites-available/tamkobi.com /root/nginx-tamkobi.com.bak.$(date +%Y%m%d)
```

### 2) DNS

`/etc/bind/zones/db.tamkobi.com` zone dosyasına (app zaten `.184` ise atlayın):

```
b2b     IN A     85.95.240.184
ik      IN A     85.95.240.184
```

Serial artırın, ardından:

```bash
sudo named-checkzone tamkobi.com /etc/bind/zones/db.tamkobi.com
sudo rndc reload tamkobi.com
dig +short b2b.tamkobi.com A @127.0.0.1
dig +short ik.tamkobi.com A @127.0.0.1
# beklenen: 85.95.240.184
```

### 3) Sertifika

Tek SAN (app + b2b + ik); nginx üç blok da `live/app.tamkobi.com` yolunu kullanır:

```bash
sudo certbot certonly --nginx -d app.tamkobi.com -d b2b.tamkobi.com -d ik.tamkobi.com
sudo certbot renew --dry-run
```

### 4) nginx

```bash
cd /var/www/tamkobi.com
sudo cp deploy/nginx/tamkobi-site-redirects.conf /etc/nginx/snippets/tamkobi-site-redirects.conf
sudo cp deploy/nginx/spa-routes.map.conf /etc/nginx/conf.d/tamkobi-spa-routes.map.conf
sudo cp deploy/nginx/tamkobi-subdomains.conf.example /etc/nginx/sites-available/tamkobi-subdomains.conf
sudo ln -sf /etc/nginx/sites-available/tamkobi-subdomains.conf /etc/nginx/sites-enabled/tamkobi-subdomains.conf
```

**ZORUNLU — tamkobi.com ve www 443 bloklarına IP bind ekleyin** (egress ile aynı):

```nginx
listen 85.95.240.184:443 ssl http2;
```

Ayrıca apex `server_name tamkobi.com` bloğuna (location /api’den **önce**):

```nginx
include /etc/nginx/snippets/tamkobi-site-redirects.conf;
```

Şablon referansı: `deploy/nginx/tamkobi-ssl.conf.example`.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 5) Env + dağıtım

`backend/.env` (veya systemd EnvironmentFile):

```
CORS_ORIGINS=https://tamkobi.com,https://www.tamkobi.com,https://app.tamkobi.com,https://b2b.tamkobi.com,https://ik.tamkobi.com
PUBLIC_APP_URL=https://tamkobi.com
PUBLIC_APP_HOST_URL=https://app.tamkobi.com
PUBLIC_B2B_URL=https://b2b.tamkobi.com
PUBLIC_IK_URL=https://ik.tamkobi.com
REACT_APP_BACKEND_URL=
```

```bash
sudo sh deploy/update-native.sh
```

### 6) Kontroller

```bash
# Yönlendirmeler (query korunur)
curl -sI 'https://tamkobi.com/panel?x=1' | grep -i location
# Location: https://app.tamkobi.com/panel?x=1
curl -sI 'https://tamkobi.com/portal/T' | grep -i location
curl -sI 'https://tamkobi.com/personelim' | grep -i location
# Yönlendirilmez
curl -sI 'https://tamkobi.com/api/version' | head -1   # 200
curl -sI 'https://tamkobi.com/sistem/giris' | head -1
curl -sI 'https://tamkobi.com/yasal/kvkk' | head -1
curl -sI 'https://tamkobi.com/web' | head -1
# noindex
curl -sI 'https://app.tamkobi.com/' | grep -i x-robots
curl -sI 'https://b2b.tamkobi.com/' | grep -i x-robots
curl -sI 'https://ik.tamkobi.com/' | grep -i x-robots

ip route get 1.1.1.1
# src 85.95.240.184 olmalı — add-production-ip.sh'a dokunmayın
```

Tarayıcı: `/sistem` + 2FA, «şirkete gir» (SSO), bayi `/portal/…`, ik çalışan girişi,
mobil giriş (`api_base` = `https://tamkobi.com/api`), SMS/e-posta linkleri.

### 7) Geri alma

```bash
# apex bloğundan include satırını kaldırın; subdomain linkini kaldırın
sudo rm -f /etc/nginx/sites-enabled/tamkobi-subdomains.conf
sudo nginx -t && sudo systemctl reload nginx
```

---

## Platform Yönetimi (ynt.taiyazilim.com)

Aynı repo / aynı backend / aynı frontend build. Ayrı servis yok.

**Uyarı:** Merge → Actions otomatik deploy eder. `SUPERADMIN_YNT_ONLY` varsayılan `0` olduğu için merge güvenlidir, ancak **sunucu hazırlığı (DNS, sertifika, nginx vhost, .env) merge’den ÖNCE** yapılmalıdır.

### Bayrak stratejisi

| `SUPERADMIN_YNT_ONLY` | Davranış |
|-----------------------|----------|
| `0` (varsayılan) | Süper admin uçları hem ynt (`aud=ynt`) hem site (`aud` None/site) üzerinde çalışır. |
| `1` | Süper admin uçları yalnızca ynt + `aud=ynt`. Site’ta `/api/system/*` → 403. nginx `tamkobi-sistem-redirect.conf` include edilir. |

### Sıra (canlı)

1. **Yedek:** `/etc/nginx`, `/etc/letsencrypt`, `backend/.env`, `/etc/bind/zones/db.taiyazilim.com`. `git status --porcelain` boş ve branch `main` olmalı.
2. **DNS:**
   ```bash
   named-checkzone taiyazilim.com /etc/bind/zones/db.taiyazilim.com
   dig NS taiyazilim.com @8.8.8.8
   dig ynt.taiyazilim.com @8.8.8.8 +short   # → 85.95.240.184
   dig ynt.taiyazilim.com @1.1.1.1 +short
   dig CAA taiyazilim.com @8.8.8.8
   ```
3. **Sertifika:**
   ```bash
   # Geçici ACME bloğu → reload → certbot → bloğu sil → dry-run
   sudo certbot certonly --webroot -w /var/www/letsencrypt \
     --cert-name ynt.taiyazilim.com -d ynt.taiyazilim.com
   sudo certbot renew --dry-run
   ```
4. **nginx (merge öncesi):**
   ```bash
   git fetch origin cursor/platform-ynt
   git show origin/cursor/platform-ynt:deploy/nginx/ynt-taiyazilim.conf.example \
     | sudo tee /etc/nginx/sites-available/ynt-taiyazilim.conf >/dev/null
   sudo ln -sf /etc/nginx/sites-available/ynt-taiyazilim.conf \
     /etc/nginx/sites-enabled/ynt-taiyazilim.conf
   sudo nginx -t && sudo systemctl reload nginx
   # tamkobi.com / app.tamkobi.com değişmemiş olmalı
   echo | openssl s_client -connect 85.95.240.184:443 -servername ynt.taiyazilim.com 2>/dev/null | openssl x509 -noout -subject -dates
   ```
5. **`.env`:**
   ```bash
   # CORS_ORIGINS listesine https://ynt.taiyazilim.com ekleyin
   PUBLIC_YNT_URL=https://ynt.taiyazilim.com
   YNT_HOST=ynt.taiyazilim.com
   SUPERADMIN_YNT_ONLY=0
   # CREDENTIAL_ENCRYPTION_KEY satırına DOKUNMAYIN
   ```
6. **Merge** (kullanıcı) → Actions izlenir → `/api/version` sha kontrolü.
7. **ynt’de dene:** giriş + 2FA, şirkete gir/çık, ürünler, API anahtarı create/rotate/revoke, imzalı curl verify/heartbeat (`docs/platform-api.md`).
8. **Bayrağı aç:**
   ```bash
   # SUPERADMIN_YNT_ONLY=1
   # Apex, www, app, b2b, ik bloklarına:
   #   include /etc/nginx/snippets/tamkobi-sistem-redirect.conf;
   sudo cp deploy/nginx/tamkobi-sistem-redirect.conf \
     /etc/nginx/snippets/tamkobi-sistem-redirect.conf
   sudo nginx -t && sudo systemctl reload nginx
   sudo sh deploy/update-native.sh
   ```
9. **Doğrulama:**
   - `tamkobi.com/sistem` → 301 ynt (query korunur)
   - site’tan `/api/system/*` → 403; ynt’den → 200
   - mobil token ile `/api/license/me` → 200
   - ynt’de `aud=app` token → 401
10. **Geri alma:**
    - `SUPERADMIN_YNT_ONLY=0`, sistem-redirect include’larını kaldır, `nginx -t && reload`, `update-native`
    - ynt symlink’ini kaldır
    - kod: `sh deploy/rollback.sh`
    - yeni tablolar (`platform_*`) zararsız, kalabilir

Dosyalar: `ynt-taiyazilim.conf.example`, `tamkobi-sistem-redirect.conf`, `docs/platform-api.md`.
