# taiyazilim.com — örnek nginx bloğu

Bu dosya örnektir. Sunucuya kopyalamaz; `deploy/` altındaki betikler ve canlı vhost’lar bu dosyayı include etmez. Kurulumu siz yaparsınız.

Aynı uygulama hem TamKobi vitrinini hem TAI Yazılım sitesini sunar. Ayrım `Host` başlığındadır:

| Host | Ne açılır |
| --- | --- |
| `tamkobi.com`, `www.tamkobi.com` | Mevcut paket vitrini |
| `taiyazilim.com`, `www.taiyazilim.com` | TAI Yazılım kurumsal sitesi |
| `ynt.taiyazilim.com` | Platform paneli (bu blok onu değiştirmez) |

`robots.txt` ve `sitemap.xml` host’a göre API’den gelir. Statik dosyaya düşmesinler.

Aşağıdaki blok, mevcut TamKobi upstream’inin (`tamkobi_api`) ve frontend kökünün (`/var/www/tamkobi.com/frontend-current`) yanına eklenmek üzere yazıldı. Sertifika yolunu kendi kurulumunuza göre değiştirin. `ynt.taiyazilim.com` için ayrı vhost durur; `server_name` satırına eklemeyin.

```nginx
# HTTP → HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name taiyazilim.com www.taiyazilim.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name taiyazilim.com www.taiyazilim.com;

    ssl_certificate     /etc/letsencrypt/live/taiyazilim.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/taiyazilim.com/privkey.pem;

    server_tokens off;
    client_max_body_size 25m;

    root /var/www/tamkobi.com/frontend-current;
    index index.html;

    location = /robots.txt {
        proxy_pass http://tamkobi_api/robots.txt;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        access_log off;
    }

    location = /sitemap.xml {
        proxy_pass http://tamkobi_api/sitemap.xml;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        access_log off;
    }

    location /api/ {
        proxy_pass http://tamkobi_api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Panel (`ynt.taiyazilim.com`) bu bloğun dışındadır. Önizleme paneli aynı uygulamadan `?site=tai&onizleme=1` ile açılır; canlı ziyaretçi yalnız `taiyazilim.com` / `www.taiyazilim.com` üzerinde TAI sitesini görür.
