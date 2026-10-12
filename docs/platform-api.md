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

## Doğrulama sırası (401 / 429)

1. Eksik başlıklar → **401**
2. Timestamp kayması (±300 sn dışı) → **401**
3. Anahtar yok / iptal / süresi dolmuş / grace geçmiş → **401**
4. IP başına dakika limiti (300) → **429** *(imza öncesi)*
5. İmza hatalı / hex değil / yanlış uzunluk → **401**
6. Scope eksik → **403**
7. Tekrarlanan nonce → **401**
8. Anahtar başına dakika limiti (120) → **429** *(yalnızca geçerli imzadan sonra)*

Geçersiz imzalı istekler anahtar kotasını yakmaz; IP kotası yine de artar.

## Anahtar kapsamı

Varsayılan scope’lar: `license:verify`, `heartbeat`, `usage:write`. Boş scope ile anahtar oluşturulamaz.

| Anahtar | Erişim |
|---------|--------|
| `instance_id` dolu | Yalnızca o instance (TamKobi’de o `company_id`) |
| `instance_id` boş | Çözülen hedefin `product_id`’si anahtarınkiyle eşleşmeli |
| TamKobi + `instance_id` boş | Ek olarak `platform:all` scope’u gerekir; aksi halde **403** |

Ürün A’nın anahtarı ürün B’nin lisansını okuyamaz. Instance’a bağlı anahtar başka instance’a heartbeat/usage yazamaz.

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
