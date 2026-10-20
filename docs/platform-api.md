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
| `platform_admin` | Yalnızca TamKobi ürünü ve `instance_id` boş. Kapsamlar yalnızca yönetim kümesinden seçilir (`admin.companies:read`, `admin.users:read`, `admin.licenses:read`, `admin.keys:read`, `admin.integrators:read`, `admin.audit:read`, `admin.mail:read`, `admin.system:read`, `admin.overview:read`, `admin.quotas:read`, `admin.requests:read`, `admin.payments:read`, `admin.platform_users:read`, `admin.sms:read`, `admin.support:read`, `admin.licenses:write`, `admin.requests:write`, `admin.integrators:write`). `platform:all` ve v1 kapsamlarıyla karıştırılamaz. `:read` kapsamı yazma ucunu kapsamaz. |

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

Base path: `/api/platform/admin-v1/`. Yönetim paneli (ileride ayrı uygulama) bu uçları imzalı `kind=platform_admin` anahtarıyla okur. Tümü **GET** ve yan etkisizdir: mail/SMS gönderilmez, SMTP/IMAP açılmaz, SMS sağlayıcısına bağlanılmaz, kart verisi dönmez. `authenticate` kendi audit, nonce ve `last_used` kayıtlarını yazar; bunun dışında yazma yoktur.

Kimlik doğrulama her uçta `platform_auth.authenticate(..., audit_prefix="admin_v1")` sırasını kullanır (401 / 403 / 429 aynı metinler). Başarı audit eylemi `admin_v1.<kapsam>` olur (ör. `admin_v1.admin.companies:read`). Ayrıntıda sır, imza veya IP izin listesi yoktur. Anahtar `kind` değeri `platform_admin` değilse, kapsam doğru olsa bile **403** `Kapsam yetersiz`.

Sayfalı listeler: `limit` varsayılan 50, `1..200` (aşarsa **422**), `offset` `>= 0`. Zarf: `{"items", "limit", "offset", "total"}`. Audit zarfı: `{"items", "limit", "next_cursor"}`. Tekil uçlar: `{"item": {…}}`.

**Sır temizliği.** Yanıtın son katmanında anahtar adında `password`, `password_hash`, `_enc`, `secret`, `totp`, `recovery`, `token`, `api_key`, `card`, `pan`, `cvv`, `iban_enc`, `smtp_pass` geçen alanlar düşer. `has_password` ve diğer `has_*` boolean alanları kalır. `pan` kart numarası parçasıdır; `plan` / `company` alanları kalır. `pin` aynı parça kuralındadır (`pin`, `pin_hash`, `punch_pin` düşer; `shipping`, `pinned`, `company` kalır).

**Kararlı sözleşme.** Bu bölümdeki yollar, kapsamlar, zarf anahtarları ve hata kodları sabittir. Yanıta alan eklemek serbesttir; alan silmek veya yeniden adlandırmak yasaktır.

Ortak hatalar: **401** eksik/bozuk imza, geçersiz anahtar, tekrarlanan nonce; **403** kapsam yetersiz veya IP izin listesi; **404** şirket yok (`Şirket bulunamadı.`) veya destek talebi yok (`Destek talebi bulunamadı.`); **422** `limit` / `offset`; **429** IP veya anahtar dakika limiti.

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

### GET `/api/platform/admin-v1/overview`

Kapsam: `admin.overview:read`. Parametre yok, sayfalama yok. `saas.overview_stats()` — `/system/overview` ile aynı gövde. `expiring` en fazla 10, `recent` en fazla 5.

```json
{"item": {"companies": 1, "users": 2, "platform_admins": 1, "by_status": {"active": 1}, "by_plan": {"Profesyonel": 1}, "mrr": 100.0, "module_usage": {}, "expiring": [], "pending_requests": 0, "open_tickets": 0, "recent": []}}
```

### GET `/api/platform/admin-v1/quotas`

Kapsam: `admin.quotas:read`. Parametreler: `limit`, `offset`, isteğe bağlı `q` (şirket adında, `casefold`). `saas.quota_rows()`; sıralama ve satır alanları `/system/quotas` ile aynı. Zarf `items` + `plans` (plan listesi süzülmez).

```json
{"items": [{"id": "comp_…", "name": "Ada", "plan_id": "plan_pro", "plan_name": "Profesyonel", "user_count": 1}], "limit": 50, "offset": 0, "total": 1, "plans": [{"id": "plan_pro", "name": "Profesyonel", "user_limit": 0}]}
```

### GET `/api/platform/admin-v1/upgrade-requests`

Kapsam: `admin.requests:read`. Parametreler: `status` (yalnızca `pending` / `approved` / `rejected`; başka değer **400** `Geçersiz durum.`), `company_id` (sorgu parametresi, path değil), `limit`, `offset`. `saas.upgrade_request_rows` (en fazla 200, `created_at` azalan). `/system/upgrade-requests` `company_id` kabul etmez. Kayıttaki `token` / `password` ve diğer sır alanları son katman `_redact` ile düşer.

```json
{"items": [{"id": "ur_…", "company_id": "comp_…", "status": "pending", "plan_id": "plan_pro"}], "limit": 50, "offset": 0, "total": 1}
```

### GET `/api/platform/admin-v1/payments`

Kapsam: `admin.payments:read`. Parametreler: `status`, `payment_status`, `company_id`, `limit`, `offset`. `saas_billing.payment_rows` en fazla 300 satır (`/system/payments` ile aynı pencere); `total` bu pencereyi aşmaz. Süzgeç `items` ve `total` ile birlikte `total_paid` / `paid_count` hesabına uygulanır (sayfa dilimi uygulanmaz). `total_paid` yalnızca `payment_status=paid` satırların tutar toplamıdır.

Her satır beyaz listeden geçer: `id`, `provider`, `company_id`, `company_name`, `plan_id`, `plan_name`, `period`, `product_type`, `pack_id`, `credits`, `amount`, `currency`, `status`, `payment_status`, `applied`, `applied_at`, `paid_at`, `created_at`, `updated_at`, `invoice_id`, `invoice_number`, `payment_type`, `failed_reason_code`, `failed_reason_msg`, `paytr_error`, `invoice_mail_status` (`invoice_mail.status`). `session_id` ve `merchant_oid` dönmez: `GET /api/payments/status/{session_id}` oturumsuz çağrılabiliyor ve ödemeyi işliyor. Kart alanları (`card*`, `pan`, `cvv`) beyaz listede yoktur; `_redact` de düşürür. Bu uç Stripe/PayTR çağırmaz, mail/SMS göndermez.

```json
{"items": [{"id": "…", "provider": "paytr", "company_id": "comp_…", "company_name": "Ada", "amount": 100, "currency": "try", "status": "completed", "payment_status": "paid", "invoice_mail_status": "sent"}], "limit": 50, "offset": 0, "total": 1, "total_paid": 100.0, "paid_count": 1}
```

### GET `/api/platform/admin-v1/platform-users`

Kapsam: `admin.platform_users:read` (şirket personeli için olan `admin.users:read` ayrıdır). Parametreler: `q` (ad, e-posta veya kullanıcı numarası), `limit`, `offset`. `saas.platform_user_rows(q, assign_numbers=false)`: `user_numbers.ensure_user_number` çağrılmaz, eksik `user_number` `null` döner. Yanıt yalnızca sayfa zarfıdır; `companies` haritası ve `roles` listesi dönmez. Satır `saas._user_row` beyaz listesidir. `/system/users` `assign_numbers=true` ile numara atar ve `companies` + `roles` döner.

```json
{"items": [{"id": "usr_…", "name": "Ada", "email": "ada@example.com", "user_number": null, "is_super_admin": true, "companies": []}], "limit": 50, "offset": 0, "total": 1}
```

### GET `/api/platform/admin-v1/sms/settings`

Kapsam: `admin.sms:read`. `platform_sms._public_view(await load_settings())` — `/system/sms` ile aynı gövde. `password_enc` yok. `has_password` ve `password_unreadable` boolean kalır. Bu uç şifreyi yanıta koymaz.

Bakiye ucu yoktur. `/system/sms/balance` kayıtlı şifreyi çözüp sağlayıcıya dış istek atar; admin-v1 bunu çağırmaz. SMS kredisi bu API’de yalnızca `sms/logs` yanıtındaki `summary` sayılarıdır.

```json
{"item": {"provider": "netgsm", "usercode": "user1", "msgheader": "TAMKOBI", "is_active": true, "has_password": true, "password_unreadable": false}}
```

### GET `/api/platform/admin-v1/sms/logs`

Kapsam: `admin.sms:read`. Parametreler: `limit` (varsayılan 50, `1..200`), `before` (`created_at` ISO, hariç), `status`, `context`. `platform_sms_log_rows` `source=platform` ve `created_at` azalan. Sonraki sayfa varsa `next_cursor` son satırın `created_at` değeridir (`/audit` ile aynı imleç).

Her satır beyaz listedendir: `id`, `company_id`, `context`, `provider`, `status`, `detail`, `code`, `job_id`, `contact_name`, `created_at`, `phone_masked`, `message`, `message_redacted`. Ham `phone` ve `ref_id` dönmez. `ref_id` şifre sıfırlama SMS’inde düz sıfırlama token’ıdır (`context=erp_reset`). `message` yalnızca `context` ∈ `announcement`, `maintenance`, `event_notify`, `platform_test` ise döner; diğer her bağlamda (`erp_reset` ve bilinmeyenler dahil) `message` null ve `message_redacted` true olur. `phone_masked` son dört hanedir.

`summary` sayfadan bağımsızdır: `{"sent", "failed"}`, `count_documents` ile `source=platform`. Sağlayıcıya bakiye sorulmaz.

```json
{"items": [{"id": "sms_…", "context": "announcement", "status": "sent", "phone_masked": "•••8877", "message": "Planlı duyuru", "message_redacted": false, "created_at": "2026-05-04T00:00:00+00:00"}], "limit": 50, "next_cursor": null, "summary": {"sent": 1, "failed": 0}}
```

### GET `/api/platform/admin-v1/sms/failed-resets`

Kapsam: `admin.sms:read`. Parametre: `limit` (varsayılan 40, `1..200`). `platform_sms.failed_reset_rows` — `/system/password-resets/failed` ile aynı satırlar (`phone_masked`, `email_masked`, kısaltılmış `id`). Token ve sıfırlama bağlantısı dönmez. `total` dönen satır sayısıdır (limit ile sınırlı).

```json
{"items": [{"id": "pr_full_…", "channel": "sms", "phone_masked": "•••2233", "email_masked": "ad•••@example.com", "sms_failed": true, "mail_failed": false}], "total": 1}
```

### GET `/api/platform/admin-v1/companies/{company_id}/sms`

Kapsam: `admin.sms:read`. Şirket yoksa **404** `Şirket bulunamadı.`. Sonra `company_sms.company_sms_summary` — `/system/companies/{company_id}/sms` ile aynı gövde (bağlı mı, operatör, son kayıt zamanı, hata sayısı, `readonly`). Şifre ve sağlayıcı çağrısı yok.

```json
{"item": {"company_id": "comp_…", "connected": true, "operator": "Netgsm", "provider": "netgsm", "last_sent_at": "2026-05-04T00:00:00+00:00", "error_count": 0, "readonly": true}}
```

### GET `/api/platform/admin-v1/support/tickets`

Kapsam: `admin.support:read`. Parametreler: `status` (`support_tickets.STATUSES` dışı **400** `Geçersiz durum.`), `company_id` (sorgu parametresi; verilmezse şirket süzgeci yok), `q`, `limit`, `offset`. `admin_ticket_rows` en fazla 300 satır (`/system/support-tickets` ile aynı pencere, `updated_at` azalan) sonra `_window`. Satır `public_ticket(..., staff=true, include_messages=false)`. `counts` ve `open_count` süzgeçten bağımsızdır. Yanıta `meta()` (`statuses`, `categories`, `priorities`) eklenir. Okuma sırasında talep güncellenmez.

```json
{"items": [{"id": "stk_…", "status": "open", "company_id": "comp_…", "subject": "Yazıcı", "message_count": 1}], "limit": 50, "offset": 0, "total": 1, "counts": {"open": 1, "in_progress": 0, "waiting_customer": 0, "resolved": 0, "closed": 0}, "open_count": 1}
```

### GET `/api/platform/admin-v1/support/tickets/{ticket_id}`

Kapsam: `admin.support:read`. `find_one` + `public_ticket(doc, staff=true)` — `/system/support-tickets/{ticket_id}` ile aynı gövde, ardından `_redact`. Yoksa **404** `Destek talebi bulunamadı.`. Mesajlar döner. Ekler yalnızca `/api/files/…` `url`, `filename`, `content_type`, `size`. Okundu, atama veya durum yazılmaz.

```json
{"id": "stk_…", "status": "open", "messages": [{"body": "…", "attachments": [{"url": "/api/files/shot", "filename": "ekran.png", "content_type": "image/png", "size": 1200}]}]}
```

## admin-v1 yazma (A4)

Base path salt okunur uçlarla aynıdır: `/api/platform/admin-v1/`. Kimlik doğrulama `platform_auth.authenticate(..., audit_prefix="admin_v1")` sırasıdır; ardından `kind=platform_admin` ve boş `instance_id` gerekir. `:read` anahtarı yazma ucunda **403** `Kapsam yetersiz` döner. Yanlış `:write` kapsamı da **403** döner. Mail ve SMS gönderilmez.

**Idempotency-Key zorunlu.** Başlık yoksa **400** `Idempotency-Key gerekli`. Kayıt ad alanı `platform_admin:<key_id>` dir; bir şirket kimliği varsayılmaz. Uç kimliği `METHOD path#sha256(canonical_json(gövde))[:16]` olur.

- Aynı anahtar + aynı gövde: kayıtlı yanıt döner. İkinci iş yazılmaz, ikinci `admin_v1.write.*` audit’i yazılmaz.
- Aynı anahtar + farklı gövde: **409** `Idempotency-Key farklı istekle kullanıldı`.

Doğrulama yazmadan önce yapılır. **400** ve **404** hedef koleksiyonlara ve `idempotency_keys` kaydına yazmaz; yalnızca `authenticate` erişim audit’i (veya IP reddi audit’i) kalır. Beyaz liste dışı anahtar **400** `Desteklenmeyen alan: <ad>`. Boş gövde **400**.

Başarılı yazmadan sonra `platform_audit_log` kaydı: `actor_type=api_key`, `actor_id` anahtar kimliği, `ip` `request_ip`, `action=admin_v1.write.<op>`, `details` yalnızca `fields` (sıralı değişen alan adları) ve `idempotency`. Değer, not metni, `base_url`, gövde, imza, nonce, Idempotency-Key ve secret `details` içine girmez. Doğrulama hatasında ve **404**’te bu yazma audit’i yoktur.

Yanıtlar `{"item": …}` zarfındadır; son katman sır alanlarını düşürür.

### PUT `/api/platform/admin-v1/companies/{company_id}/license`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.license.update`. İzinli alanlar: `plan_id`, `status`, `trial_ends_at`, `expires_at`, `extend_days`, `billing_period`, `notes`. `user_limit`, `company_limit`, `product_limit`, `contact_limit`, `storage_limit_mb` ve `module_overrides` bu uçta yoktur (modül için ayrı uç).

`status` `saas.STATUSES` içinden (`trial`, `active`, `suspended`, `expired`, `cancelled`); değilse **400** `Geçersiz durum.`. `plan_id` `saas_plans` içinde yoksa **400** `Geçersiz paket.`. `extend_days` tamsayı `1..3650`. `trial_ends_at` / `expires_at` ISO tarih ya da `null`. `billing_period` `monthly` veya `yearly`. `notes` metin, en çok 2000 karakter. Şirket yoksa **404** `Şirket bulunamadı.`. Yanıt `effective(company_id)`.

`/system/companies/{id}/license` limitler ve `module_overrides` dahil eski alanları kabul etmeye devam eder. Sıkı doğrulama yalnızca admin-v1 katmanındadır.

### POST `/api/platform/admin-v1/companies/{company_id}/modules/{module_key:path}`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.module.toggle`. Gövde `{"enabled": bool}`; alan zorunlu ve gerçek boolean olmalı (dize `"true"` **400**). Bilinmeyen veya çekirdek modül **400** `Bilinmeyen ya da çekirdek modül.`. Şirket yoksa **404** `Şirket bulunamadı.`. `/ai-advisor` açılıp kapanınca `addon_overrides["ai.advisor"]` aynı şekilde güncellenir. `/system` ucu `bool()` ile dönüştürmeye devam eder ve şirket varlığı aramaz.

### POST `/api/platform/admin-v1/companies/{company_id}/activation`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.company.activation`. Gövde `{"active": bool}`; zorunlu ve boolean. `false` lisansı `suspended` yapar, `true` deneme süresi duruyorsa `trial` aksi halde `active` döndürür. Askıya alma silme değildir; veri silinmez. Şirket yoksa **404** `Şirket bulunamadı.`. `/system` ucu `active` verilmezse `true` saymaya devam eder.

### PUT `/api/platform/admin-v1/upgrade-requests/{req_id}`

Kapsam: `admin.requests:write`. Audit: `admin_v1.write.upgrade_request.resolve`. Gövde: `status` zorunlu ve `approved` | `rejected` | `pending` (varsayılan `approved` yoktur). `note` metin, en çok 1000 karakter. `apply` boolean, varsayılan `true`. Talep yoksa **404** `Talep bulunamadı.`. Onay ve `apply` paketi lisansa yazar. Bildirim yalnızca uygulama içidir (`notify.insert_notification`); mail ve SMS gönderilmez. Talep zaten aynı `status` ise ikinci çağrı lisansı yeniden yazmaz ve ikinci bildirim üretmez; mevcut kayıt döner. `/system` ucu `status` verilmezse `approved` varsayar.

### PUT `/api/platform/admin-v1/integrators/products/{product_id}`

Kapsam: `admin.integrators:write`. Audit: `admin_v1.write.product.update`. İzinli alanlar: `name` (boş olmayan metin, en çok 200), `status`, `base_url` (`http`/`https`, en çok 500 karakter). `code` ve `kind` **400** `Desteklenmeyen alan`. Ürün kodu değişikliği ve tamkobi kuralı `/platform/admin` ucunda kalır. Ürün yoksa **404** `Ürün bulunamadı`. `store.update_product` `actor_id` olarak anahtar kimliğini kullanır.

### A5'e kalanlar

Bu yazma yüzeyinde yoktur:

- kimliğe bürünme ve oturum açma
- şirket, kullanıcı, ürün veya anahtar silme
- şifre sıfırlama gönderimi, şifre ve 2FA sıfırlama
- kullanıcı oluşturma ve düzenleme
- API anahtarı oluşturma, döndürme ve iptal
- `ip_allowlist` düzenleme
- SMS ve mail ayarları ile şifreleri
- plan oluşturma, plan düzenleme ve modül fiyatları
- şirket oluşturma ve üst şirket (parent) değişikliği

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
