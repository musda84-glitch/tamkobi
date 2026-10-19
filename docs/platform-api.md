# Platform API v1 (HMAC)

Sunucudan sunucuya lisans doğrulama, heartbeat ve kullanım yazımı.
**Çerez, JWT ve CORS yok.** İmza zorunlu.

Base path: `/api/platform/v1/` (her host üzerinden çağrılabilir).

## Başlıklar

| Başlık | Değer |
|--------|--------|
| `X-Platform-Key` | Anahtar kimliği (`pk_…`) |
| `X-Platform-Timestamp` | Unix saniye |
| `X-Platform-Nonce` | Rastgele (tekrar kullanılamaz, ~10 dk) |
| `X-Platform-Signature` | `hex(HMAC-SHA256(secret, "{ts}\\n{nonce}\\n{METHOD}\\n{path}\\n{sha256_hex(body)}"))` |

## Doğrulama sırası (401 / 403 / 429)

1. Eksik başlıklar → **401**
2. Timestamp kayması (±300 sn dışı) → **401**
3. Anahtar yok / iptal / süresi dolmuş / grace geçmiş → **401**
4. IP başına dakika limiti (300) → **429** *(imza öncesi)*
5. IP izin listesi (anahtarda tanımlıysa) → **403** *(imza öncesi)*
6. İmza hatalı / hex değil / yanlış uzunluk → **401**
7. Scope eksik → **403**
8. Tekrarlanan nonce → **401**
9. Anahtar başına dakika limiti (120) → **429** *(yalnızca geçerli imzadan sonra)*

Geçersiz imzalı istekler anahtar kotasını yakmaz; IP kotası yine de artar. İzin listesi reddi de imzadan önce olur: nonce tüketilmez, anahtar kotası artmaz.

## Anahtar kapsamı

Varsayılan scope’lar: `license:verify`, `heartbeat`, `usage:write`. Boş scope ile anahtar oluşturulamaz.

`ip_allowlist`: isteğe bağlı IP veya CIDR listesi. Boş ya da alan yoksa her adres kabul edilir. Doluysa istek IP’si listedeki bir ağda olmalıdır; aksi halde **403**. Oluşturma isteğinde verilir, rotasyon yeni anahtara kopyalanır. Tek adres `/32` (IPv4) veya `/128` (IPv6) olarak saklanır.

| Anahtar | Erişim |
|---------|--------|
| `instance_id` dolu | Yalnızca o instance (TamKobi’de o `company_id`) |
| `instance_id` boş | Çözülen hedefin `product_id`’si anahtarınkiyle eşleşmeli |
| TamKobi + `instance_id` boş | Ek olarak `platform:all` scope’u gerekir; aksi halde **403** |

Ürün A’nın anahtarı ürün B’nin lisansını okuyamaz. Instance’a bağlı anahtar başka instance’a heartbeat/usage yazamaz.

### `kind`

Anahtar belgesinde `kind` alanı vardır: `product` (varsayılan) veya `platform_admin`. Eski kayıtlarda alan yoksa `product` sayılır. `kind`, liste ve oluşturma yanıtında (`_public_key`) görünür; rotasyon yeni anahtara kopyalanır.

| `kind` | Kural |
|--------|--------|
| `product` | v1 kapsamları (`license:verify`, `heartbeat`, `usage:write`, `platform:all`, `help:read`, …). `admin.` ile başlayan kapsam **verilemez**. |
| `platform_admin` | Yalnızca TamKobi ürünü ve `instance_id` boş. Kapsamlar yalnızca `admin.*:read` yönetim kümesinden seçilir (`admin.companies:read`, `admin.users:read`, `admin.licenses:read`, `admin.keys:read`, `admin.integrators:read`, `admin.audit:read`, `admin.mail:read`, `admin.system:read`). `platform:all` ve v1 kapsamlarıyla karıştırılamaz. |

`admin.*` kapsamı şirket anahtarına (plan D dahil) oluşturulurken de istek anında da reddedilir. Doğrudan veritabanına yazılmış `kind=product` + `admin.*` anahtarı admin-v1’de **403** döner.

## Uçlar

### POST `/api/platform/v1/licenses/verify`

Girdi: `{ "instance_ref": "…" }` veya `{ "company_id": "…" }`  
Çıktı: `{ "valid", "plan", "status", "valid_until", "modules", "seats" }`  
Kapsam: `license:verify`

### POST `/api/platform/v1/heartbeat`

Girdi: `{ "instance_ref", "version", "meta" }` — kapsam: `heartbeat`

### POST `/api/platform/v1/usage`

Girdi: `{ "instance_ref", "metrics", "period" }` — kapsam: `usage:write`  
Kayıtta `key_id` ve `product_id` saklanır.

### Yardım Merkezi (ürün etiketli içerik)

İçerikler YNT’de (`/sistem/yardim`) yönetilir. `product_tags`: `tamkobi` | `tameticaret`.

**Yayın (kimlik doğrulamasız, yalnızca `published`):**

- `GET /api/public/help/meta`
- `GET /api/public/help/articles?product=tameticaret&q=&page_key=/orders&content_type=article|video&limit=50`
- `GET /api/public/help/articles/{slug}?product=tameticaret`
- `GET /api/public/help/search?product=tameticaret&q=`

**HMAC (kapsam `help:read` veya `platform:all`):**

- `GET /api/platform/v1/help/articles?product=…` — imza gövdesi boş
- `GET /api/platform/v1/help/articles/{slug}?product=…`
- `POST /api/platform/v1/help/search` — gövde `{ "product", "q", "page_key", "content_type", "limit" }`

**Asistan bağlamı (ileride AI):** `GET /api/help/assistant/context?page=/invoices&product=tamkobi` — `chat_ready: false`, `chat_endpoint: /api/ai/help-chat`.

## admin-v1 (salt okunur)

Base path: `/api/platform/admin-v1/`. Yönetim paneli (ileride ayrı uygulama) bu uçları imzalı `kind=platform_admin` anahtarıyla okur. Tümü **GET** ve yan etkisizdir: mail/SMS gönderilmez, SMTP/IMAP açılmaz, kart verisi dönmez. `authenticate` kendi audit, nonce ve `last_used` kayıtlarını yazar; bunun dışında yazma yoktur.

Kimlik doğrulama her uçta `platform_auth.authenticate(..., audit_prefix="admin_v1")` sırasını kullanır (401 / 403 / 429 aynı metinler). Başarı audit eylemi `admin_v1.<kapsam>` olur (ör. `admin_v1.admin.companies:read`). Ayrıntıda sır, imza veya IP izin listesi yoktur. Anahtar `kind` değeri `platform_admin` değilse, kapsam doğru olsa bile **403** `Kapsam yetersiz`.

Sayfalı listeler: `limit` varsayılan 50, `1..200` (aşarsa **422**), `offset` `>= 0`. Zarf: `{"items", "limit", "offset", "total"}`. Audit zarfı: `{"items", "limit", "next_cursor"}`. Tekil uçlar: `{"item": {…}}`.

**Sır temizliği.** Yanıtın son katmanında anahtar adında `password`, `password_hash`, `_enc`, `secret`, `totp`, `recovery`, `token`, `api_key`, `card`, `pan`, `cvv`, `iban_enc`, `smtp_pass` geçen alanlar düşer. `has_password` ve diğer `has_*` boolean alanları kalır. `pan` kart numarası parçasıdır; `plan` / `company` alanları kalır.

**Kararlı sözleşme.** Bu bölümdeki yollar, kapsamlar, zarf anahtarları ve hata kodları sabittir. Yanıta alan eklemek serbesttir; alan silmek veya yeniden adlandırmak yasaktır.

Ortak hatalar: **401** eksik/bozuk imza, geçersiz anahtar, tekrarlanan nonce; **403** kapsam yetersiz veya IP izin listesi; **404** şirket yok (`Şirket bulunamadı.`); **422** `limit` / `offset`; **429** IP veya anahtar dakika limiti.

### GET `/api/platform/admin-v1/companies`

Kapsam: `admin.companies:read`. Parametreler: `limit`, `offset`, isteğe bağlı `q` (ad içinde arama). Her satır `saas._company_row` çıktısıdır (plan, lisans, kullanım).

```json
{"items": [{"id": "comp_…", "name": "…", "membership": {"plan_id": "plan_pro", "status": "active"}, "einvoice": {"has_password": false}}], "limit": 50, "offset": 0, "total": 1}
```

### GET `/api/platform/admin-v1/companies/{company_id}`

Kapsam: `admin.companies:read`. `saas.company_detail(..., include_users=false)`: `_company_row` + `quota_usage` + üyelik sayıları + son 20 yükseltme talebi. `users` alanı dönmez. Yoksa **404**.

```json
{"item": {"id": "comp_…", "name": "…", "requests": [], "quota_usage": {"product_count": 0, "contact_count": 0, "storage_bytes": 0}, "membership": {"plan_id": "plan_pro"}}}
```

### GET `/api/platform/admin-v1/companies/{company_id}/users`

Kapsam: `admin.users:read`. `list_company_members(company_id, include_platform=false)` ve ana yönetici yedeklemesi. `limit` / `offset` uygulanır. Şirket yoksa **404**.

```json
{"items": [{"id": "usr_…", "email": "ada@example.com", "role": "admin", "has_password": true}], "limit": 50, "offset": 0, "total": 1}
```

### GET `/api/platform/admin-v1/plans`

Kapsam: `admin.licenses:read`. `list_plans` ile aynı paket listesi (`company_count` dahil) ve `catalog_with_prices()` modül/eklenti kataloğu.

```json
{"item": {"plans": [{"id": "plan_pro", "name": "Profesyonel", "company_count": 1}], "catalog": [{"key": "/invoices", "price_monthly": 0}]}}
```

### GET `/api/platform/admin-v1/api-keys`

Kapsam: `admin.keys:read`. Parametre: isteğe bağlı `product_id`. `list_api_keys` çıktısı (`kind` görünür, sır yok) `limit` / `offset` ile dilimlenir.

```json
{"items": [{"id": "pk_…", "kind": "platform_admin", "scopes": ["admin.keys:read"]}], "limit": 50, "offset": 0, "total": 1}
```

### GET `/api/platform/admin-v1/integrators`

Kapsam: `admin.integrators:read`. `list_products()` (kind: `erp` / `ecommerce` / `other`). `include_instances=true` ise `list_instances` de döner; aksi halde `instances` alanı yoktur. İsteğe bağlı `product_id` örnek listesini süzer.

```json
{"item": {"products": [{"id": "pp_…", "code": "tamkobi", "kind": "erp"}]}}
```

### GET `/api/platform/admin-v1/audit`

Kapsam: `admin.audit:read`. Parametreler: `action`, `actor_id`, `target_type`, `limit` (en fazla 200), `before` (`at` ISO, hariç). `list_audit` `at` azalan sırada okunur. Sonraki sayfa varsa `next_cursor` son satırın `at` değeridir.

```json
{"items": [{"id": "pal_…", "at": "2026-01-01T00:00:05+00:00", "action": "seed.event"}], "limit": 50, "next_cursor": "2026-01-01T00:00:04+00:00"}
```

### GET `/api/platform/admin-v1/mail/status`

Kapsam: `admin.mail:read`. `platform_mail._public_server` ve `_public_box`. `password_enc` yok, `has_password` var. `admins` ve `presets` dönmez; `default_from` döner. Bu uç sunucudan mektup göndermez ve SMTP’ye bağlanmaz.

```json
{"item": {"servers": [{"id": "pms_…", "smtp_host": "smtp.example.com", "has_password": true}], "mailboxes": [], "default_from": null}}
```

### GET `/api/platform/admin-v1/system/health`

Kapsam: `admin.system:read`. `read_stamp()` içinden `version` ve `git_sha`, artı `status`. Veritabanı sorgusu yapılmaz (kimlik doğrulamasının kendi okuması dışında).

```json
{"item": {"status": "healthy", "version": "2.0.2", "git_sha": "abcdef"}}
```

## Python

```python
import hashlib, hmac, json, secrets, time, urllib.request

KEY_ID = "pk_…"
SECRET = "…"  # yalnızca oluşturma/rotasyon yanıtında bir kez
BASE = "https://ynt.taiyazilim.com"
PATH = "/api/platform/v1/licenses/verify"
body = json.dumps({"company_id": "comp_…"}).encode()
ts = str(int(time.time()))
nonce = secrets.token_hex(16)
body_hash = hashlib.sha256(body).hexdigest()
msg = f"{ts}\n{nonce}\nPOST\n{PATH}\n{body_hash}".encode()
sig = hmac.new(SECRET.encode(), msg, hashlib.sha256).hexdigest()
req = urllib.request.Request(
    BASE + PATH,
    data=body,
    method="POST",
    headers={
        "Content-Type": "application/json",
        "X-Platform-Key": KEY_ID,
        "X-Platform-Timestamp": ts,
        "X-Platform-Nonce": nonce,
        "X-Platform-Signature": sig,
    },
)
print(urllib.request.urlopen(req).read().decode())
```

## PHP

```php
<?php
$keyId = 'pk_…';
$secret = '…';
$path = '/api/platform/v1/heartbeat';
$body = json_encode(['instance_ref' => 'comp_…', 'version' => '1.0']);
$ts = (string) time();
$nonce = bin2hex(random_bytes(16));
$bodyHash = hash('sha256', $body);
$msg = "$ts\n$nonce\nPOST\n$path\n$bodyHash";
$sig = hash_hmac('sha256', $msg, $secret);
$ch = curl_init('https://ynt.taiyazilim.com' . $path);
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $body,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    "X-Platform-Key: $keyId",
    "X-Platform-Timestamp: $ts",
    "X-Platform-Nonce: $nonce",
    "X-Platform-Signature: $sig",
  ],
  CURLOPT_RETURNTRANSFER => true,
]);
echo curl_exec($ch);
```

## curl + openssl

```bash
KEY_ID='pk_…'
SECRET='…'
PATH='/api/platform/v1/licenses/verify'
BODY='{"company_id":"comp_…"}'
TS=$(date +%s)
NONCE=$(openssl rand -hex 16)
BODY_HASH=$(printf '%s' "$BODY" | openssl dgst -sha256 -hex | awk '{print $2}')
MSG=$(printf '%s\n%s\nPOST\n%s\n%s' "$TS" "$NONCE" "$PATH" "$BODY_HASH")
SIG=$(printf '%s' "$MSG" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')
curl -sS "https://ynt.taiyazilim.com${PATH}" \
  -H "Content-Type: application/json" \
  -H "X-Platform-Key: ${KEY_ID}" \
  -H "X-Platform-Timestamp: ${TS}" \
  -H "X-Platform-Nonce: ${NONCE}" \
  -H "X-Platform-Signature: ${SIG}" \
  -d "$BODY"
```
