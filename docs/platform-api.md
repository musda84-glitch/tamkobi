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
| `platform_admin` | Yalnızca TamKobi ürünü ve `instance_id` boş. Kapsamlar yalnızca yönetim kümesinden seçilir (`admin.companies:read`, `admin.users:read`, `admin.licenses:read`, `admin.keys:read`, `admin.integrators:read`, `admin.audit:read`, `admin.mail:read`, `admin.system:read`, `admin.overview:read`, `admin.quotas:read`, `admin.requests:read`, `admin.payments:read`, `admin.platform_users:read`, `admin.sms:read`, `admin.support:read`, `admin.notifications:read`, `admin.licenses:write`, `admin.requests:write`, `admin.integrators:write`, `admin.support:write`, `admin.notifications:write`, `admin.impersonate`, `admin.dangerous`). `platform:all` ve v1 kapsamlarıyla karıştırılamaz. `:read` kapsamı yazma ucunu kapsamaz. `:read` ve `:write` kapsamları `admin.impersonate` ve `admin.dangerous` kapsamlarını kapsamaz. `admin.impersonate` ve `admin.dangerous` birbirini ve diğer kapsamları kapsamaz. `admin.dangerous` yalnızca anahtara açıkça yazıldıysa geçerlidir. |

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

Oturum çerezi aranmaz: `/api/platform/admin-v1/` öneki (sondaki `/` sınırdır) oturum allowlist’indedir; imzasız istek `Giriş yapmanız gerekiyor.` yerine `platform_auth.authenticate` ile reddedilir.

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

Bu GET bakiye sormaz. Kayıtlı şifreyi çözüp sağlayıcıya giden bakiye, doğrulama ve test SMS’i A6’daki `POST /sms/balance`, `POST /sms/verify` ve `POST /sms/send-test` uçlarındadır (`admin.sms:write`). `sms/logs` yanıtındaki `summary` sayıları değişmez.

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

### GET `/api/platform/admin-v1/companies/{company_id}/notify-prefs`

Kapsam: `admin.notifications:read`. `admin.notifications:write` bu ucu açmaz. Idempotency-Key yoktur; tekrar okuma yazmaz. Şirket yoksa **404** `Şirket bulunamadı.`. Gövde `event_notify.present_prefs(..., with_usage=true)` ve `{"item": …}` zarfıdır. `extra_emails` düzenleyicinin aynı adresi geri yazabilmesi için maskelenmez. Şifre ve SMTP alanı yoktur.

### GET `/api/platform/admin-v1/companies/{company_id}/notify-mail-log`

Kapsam: `admin.notifications:read`. Parametre: `limit` (`1..200`, varsayılan 50). `event_notify.company_notify_mail_log` ile aynı pencere (`sent`, `deferred`). `/saas/companies/{id}/notify-mail-log` ham alıcı döndürmeye devam eder. Bu uçta `to` ve `recipients` `password_reset.mask_email` / `mask_phone` ile maskelenir. Şirket yoksa **404** `Şirket bulunamadı.`. Başka şirketin satırı dönmez. Idempotency-Key yoktur.

```json
{"sent": [{"id": "nl_…", "to": ["ad•••@example.com"], "recipients": "ad•••@example.com", "subject": "Sipariş", "status": "sent"}], "deferred": []}
```

## admin-v1 yazma (A4)

Base path salt okunur uçlarla aynıdır: `/api/platform/admin-v1/`. Kimlik doğrulama `platform_auth.authenticate(..., audit_prefix="admin_v1")` sırasıdır; ardından `kind=platform_admin` ve boş `instance_id` gerekir. `:read` anahtarı yazma ucunda **403** `Kapsam yetersiz` döner. Yanlış `:write` kapsamı da **403** döner. Mail ve SMS gönderilmez.

**Idempotency-Key zorunlu.** Başlık yoksa **400** `Idempotency-Key gerekli`. Kayıt ad alanı `platform_admin:<key_id>` dir; bir şirket kimliği varsayılmaz. Uç kimliği `METHOD path#sha256(canonical_json(gövde))[:16]` olur.

- Aynı anahtar + aynı gövde: kayıtlı yanıt döner. İkinci doğrulama, ikinci iş ve ikinci `admin_v1.write.*` audit’i çalışmaz.
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

### POST `/api/platform/admin-v1/companies`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.company.create`, `target_id` yeni şirket. İzinli alanlar: `name`, `admin_email`, `admin_password` (zorunlu; şifre en az 6), `tax_number`, `tax_office`, `address`, `city`, `phone`, `admin_name`, `plan_id`, `trial_days` (tamsayı `0..3650`), `expires_at` (ISO veya yok), `billing_period` (`monthly`|`yearly`), `notes`. İş `saas.validate_new_company` + `saas.apply_create_company`. `/system/companies` aynı yardımcıları çağırır ve gevşek gövdeyi kabul etmeye devam eder. Yanıt `{"item": _company_row}`. `admin_password` ve `password_hash` yanıtta ve audit `fields` listesinde yoktur. E-posta zaten varsa **400** `Bu e-posta ile kullanıcı zaten var.`. Paket yoksa **400** `Geçersiz paket.`.

### POST `/api/platform/admin-v1/companies/{company_id}/companies`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.company.child.create`. Üst şirket yoksa **404** `Şirket bulunamadı.`. İş `saas.validate_licensed_company` + `saas.add_licensed_company`. Kota `check_company_limit` ile aynıdır. Ayrı giriş için `admin_email` ve `admin_password` (en az 6) birlikte gerekir; `separate_login` gerçek boolean olmalıdır. Şifre yanıtta ve audit alan adlarında yoktur. Başka şirketin kaydı değişmez. `/system` aynı yardımcıları çağırır.

### PUT `/api/platform/admin-v1/companies/{company_id}/parent`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.company.parent`. Gövde yalnız `parent_company_id`. İş `saas.prepare_company_parent` + `saas.apply_set_company_parent`. Kendine bağlama, döngü ve dolu alt lisans `/system` ile aynı metinleri döner. Üst şirket yoksa **404** `Üst şirket bulunamadı.`. Bağı koparan ayrı uç yoktur; `/system`de de yoktur.

### PUT `/api/platform/admin-v1/companies/{company_id}/einvoice`

Kapsam: `admin.integrators:write`. Audit: `admin_v1.write.company.einvoice`. Gövde yalnız `provider` (zorunlu metin). Alan yoksa **400** `provider zorunlu.`. Trim sonrası boş değer (`""` veya yalnız boşluk) atamayı kaldırır; `assigned` false döner ve **400** `provider boş olamaz` üretilmez. `/system/companies/{id}/einvoice` de boş sağlayıcıyı kaldırma sayar. Bilinmeyen dolu kod **400** `Desteklenmeyen entegratör.` ve kayıt yazılmaz. İş `einvoice_assign.assign_company_provider` — `/system` aynı fonksiyonu çağırır ve tam `_einvoice_view` döndürmeye devam eder. Bu uç `public_assignment` döner: `company_id`, `provider`, `provider_name`, `assigned`, `status`, `has_password`, `has_api_key`. Kullanıcı adı, VKN, URL, `password_enc` ve `api_key_enc` yoktur. Sağlayıcı değişince veya atama kalkınca şifreli alanlar silinir. Şifre veya API anahtarı yazmak bu uçta yoktur.

### PUT `/api/platform/admin-v1/companies/{company_id}/notify-prefs`

Kapsam: `admin.notifications:write`. Audit: `admin_v1.write.notify.prefs` ve mevcut `company_audit` tercih farkı. İzinli alanlar: `events` (nesne), `extra_emails` (en çok 30 metin), `email_from` (`platform`|`company`), `gib_credits_threshold` (tamsayı `1..10000`), `daily_email_cap` (tamsayı `1..100000` veya `null`). `company_id` gövdede **400**. İş `event_notify.save_prefs`. `/saas` ucu süper admin oturumuyla aynı yazmayı yapar. Yanıt `present_prefs(..., with_usage=true)`. `extra_emails` geri yazılabilmesi için maskelenmez.

### POST `/api/platform/admin-v1/companies/{company_id}/addons/{addon_key}`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.addon.toggle`. Bilinmeyen anahtar **400** `Bilinmeyen araç.`. Şirket yoksa **404**. `inherit: true` override’ı kaldırır ve `enabled` ile birlikte gönderilemez. Aksi halde `enabled` gerçek boolean zorunludur (`bool()` yok). İş `addons.apply_company_addon`. `/system` ucu `bool()` ile dönüştürür ve şirket aramaz.

### POST `/api/platform/admin-v1/plans`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.plan.create`, `target_id` yeni paket. `name` zorunlu. `code` varsa `^[a-z0-9][a-z0-9_-]{0,39}$` (küçük harfe çevrilir). `modules` içindeki her öğe `saas._ALL` içinde olmalıdır; değilse **400** `Bilinmeyen modül.`. Sayılar negatif olamaz. `is_public` ve `is_popular` gerçek boolean. İş `saas.apply_create_plan`. `/system/plans` aynı yardımcıyı gevşek gövdeyle çağırır.

### PUT `/api/platform/admin-v1/plans/{plan_id}`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.plan.update`. `code` bu uçta yoktur. Paket yoksa **404** `Paket bulunamadı.`. `plan_custom` için `apply_update_plan` `is_public=false` ve `modules=[]` zorlar. İş `saas.apply_update_plan`.

### PUT `/api/platform/admin-v1/modules/prices`

Kapsam: `admin.licenses:write`. Audit: `admin_v1.write.module.prices`. Gövde yalnız `{"prices": {modül: sayı}}`. Bilinmeyen modül veya negatif değer **400**; `/system/modules/prices` bilinmeyen anahtarı atlamaya devam eder. İş `saas.write_module_prices`. Kayıt, `/system` ile aynı şekilde `platform_settings.module_prices` belgesinin tamamını verilen haritayla değiştirir.

### POST `/api/platform/admin-v1/support/tickets/{ticket_id}/messages`

Kapsam: `admin.support:write`. `admin.support:read` yetmez. Audit: `admin_v1.write.support.reply`. `operator_email` zorunlu ve aktif süper admindir; değilse **403** `Operatör yetkili değil.`. `body` en çok `MAX_BODY`. `is_internal` gerçek boolean. `status` verilirse `support_tickets.STATUSES` içinde olmalıdır; `/system` bilinmeyen durumu yok sayar. Ekler `sanitize_attachments`. İş `apply_staff_reply`. Bildirim yalnız uygulama içidir. Talep yoksa **404** `Destek talebi bulunamadı.`.

### POST `/api/platform/admin-v1/support/tickets/{ticket_id}/status`

Kapsam: `admin.support:write`. Audit: `admin_v1.write.support.status`. `status` zorunlu ve `STATUSES` içinde; değilse **400** `Geçersiz durum.`. `operator_email` yanıt ucuyla aynı kuraldadır. İş `apply_staff_status`.

### POST `/api/platform/admin-v1/integrators/products`

Kapsam: `admin.integrators:write`. Audit: `admin_v1.write.product.create` ve `store.create_product` içindeki `product.create`. `code` zorunlu, plan kodu ile aynı desen, küçük harf. `kind` verilirse `erp` | `ecommerce` | `other`; sessizce `other` yapılmaz. `base_url` doluysa `http`/`https`. Aynı kod **400** `Bu ürün kodu zaten var`. Silme bu uçta yoktur.

### A5'e kalanlar

Doğrudan `DELETE` yoktur. Paket silme `plan.delete`, entegratör ürünü silme `product.delete` action’ı olarak A5b’dedir.

Bu A4 yüzeyinde yoktur; sonraki bölümlerdedir:

- kimliğe bürünme — A5a
- şirket silme, kullanıcı veri silme (`user.erase`), şifre sıfırlama, 2FA sıfırlama — A5b
- panel yöneticisi silme (`user.delete`), anahtar iptali (`key.revoke`), bakım açma, eşik üstü kontör, alt şirket koparma — A5b
- kota, depolama, panel kullanıcısı, API anahtarı yaşam döngüsü — A6
- e-fatura kimliği, SMS, AI, PayTR, SMTP/IMAP, platform ayarları — A6
- CMS, yardım, bakım metni, XSLT, kontör (eşik altı), veritabanı özeti, destek eki — A6

## admin-v1 impersonation (A5a)

Base path yazma uçlarıyla aynıdır: `/api/platform/admin-v1/`. Kapsam `admin.impersonate`. Bu kapsam `ADMIN_SCOPES` içindedir. Hiçbir `:read` veya `:write` kapsamı onu kapsamaz. `admin.dangerous` bu uçlarda geçerli değildir. Kimlik doğrulama `platform_auth.authenticate(..., audit_prefix="admin_v1")` sırasıdır; ardından `kind=platform_admin` ve boş `instance_id` gerekir. Idempotency-Key kuralları yazma uçlarıyla aynıdır: ad alanı `platform_admin:<key_id>`, uç kimliği `METHOD path#sha256(canonical_json(gövde))[:16]`. Başlık yoksa **400** `Idempotency-Key gerekli`. Aynı anahtar + farklı gövde **409** `Idempotency-Key farklı istekle kullanıldı`.

Doğrulama yazmadan önce yapılır. **400**, **403** ve **404** destek oturumu, handoff, `activity_logs` ve `admin_v1.danger.*` audit’i yazmaz. Başarılı imzada `authenticate` erişim audit’i kalır. Ham JWT yanıtta, logda ve audit’te yoktur. Tek kullanımlık kod `auth_handoff.create_handoff` ile üretilir; `_TTL_S` 60 saniyedir ve değişmez. Handoff gövdesinde `sa_return` boş stringdir. Bu oturumda `POST /api/auth/impersonate/exit` **400** `Destek oturumu bulunamadı.` döner; kapatma aşağıdaki uçladır.

Başarılı işlemden sonra `platform_audit_log` kaydı: `actor_type=api_key`, `actor_id` anahtar kimliği, `action=admin_v1.danger.impersonate.start` veya `admin_v1.danger.impersonate.end`, `details` yalnız `operator`, `reason`, `session_id`, `ttl_minutes`, `as_user`. Token, handoff kodu, `sa_return`, imza, nonce, Idempotency-Key ve secret `details` içine girmez. Aynı anahtar + aynı gövde kayıtlı yanıtı döner; yeni oturum ve ikinci danger audit’i yoktur. Zaten kapalı oturumu kapatmak no-op’tur; ikinci danger audit’i yazılmaz.

Yanıtlar `{"item": …}` zarfındadır. `access_token`, `token` ve `sa_return` anahtarları yoktur.

### POST `/api/platform/admin-v1/companies/{company_id}/impersonate`

Kapsam: `admin.impersonate`. Audit: `admin_v1.danger.impersonate.start` ve `impersonate.enter`. Gövde: `reason` (zorunlu, trim sonrası 10..500 karakter), `operator_email` (zorunlu), `ttl_minutes` (opsiyonel tamsayı 5..60, varsayılan 30). Başka alan **400** `Desteklenmeyen alan: <ad>`. `reason` metin değilse **400** `reason metin olmalı.`; yoksa **400** `reason zorunlu.`; uzunluk dışındaysa **400** `reason 10 ile 500 karakter arasında olmalı.`. `ttl_minutes` aralık dışındaysa veya tamsayı değilse **400** `ttl_minutes 5 ile 60 arasında bir tamsayı olmalı.`.

`operator_email`, kullanıcı koleksiyonunda `is_super_admin=True` ve `is_active` false olmayan bir kayda denk gelmiyorsa **403** `Operatör yetkili değil.`.

Kontroller `/system/companies/{company_id}/impersonate` ile aynı sırada ve aynı metinlerdedir:

1. `support.impersonate` kapalı → **403** `Bu müşteri için 'şirket olarak gir' destek aracı kapalı.`
2. Giriş yapılabilir kullanıcı yok → **400** `Bu şirkette giriş yapılabilecek kullanıcı yok.`
3. `platform_access_allowed` false → **403** `Bu şirket gizlilik ayarından yönetim paneli erişimini kapatmış. Destek girişi yapılamaz.`
4. Şirket yok → **404** `Şirket bulunamadı.`

Oturum süresi ve JWT `exp` `ttl_minutes` dakikadır. JWT `aud=app`, `imp_by` operatör e-postasıdır. `imp_via=api` yalnız bu API’de yazılır. `/system` ucu aynı yardımcıyı 120 dakika ve `sa_return=session_token(request)` ile çağırır. `/system` yanıtı, `Destek modu 2 saat geçerlidir.` metni ve **401** `Sistem paneli oturumu bulunamadı; tekrar giriş yapın.` kontrolü aynı kalır. `/system` JWT’sinde `imp_via` yoktur.

```json
{"item": {"company_name": "Ada", "as_user": "ada@example.com", "session_id": "ss_…", "started_at": "…", "expires_at": "…", "redirect": "https://app.example/sso?code=…", "code": "…"}}
```

### POST `/api/platform/admin-v1/impersonation/{session_id}/end`

Kapsam: `admin.impersonate`. Audit: `admin_v1.danger.impersonate.end` (yalnızca aktif oturum kapanınca). Gövde: `reason` zorunlu; trim ve uzunluk kuralı başlangıç ucuyla aynıdır. Başka alan **400** `Desteklenmeyen alan: <ad>`.

`support_access.close_session(session_id, ended_by="api_key:<key_id>", reason="revoked")`. Oturum yoksa **404** `Oturum bulunamadı.`. Zaten kapalıysa no-op; ikinci danger audit’i yazılmaz. Kapanan oturumun JWT’si `impersonation_info` için geçersizdir (`None`).

Silme, veri sıfırlama, şifre sıfırlama, 2FA sıfırlama ve kullanıcı silme bu bölümde yoktur; aşağıdaki A5b bölümündedir. Şirket askıya alma A4 aktivasyon ucundadır. Süper admin silme ve deletion-confirmations bu yüzeyde yoktur.

## admin-v1 tehlikeli işlemler (A5b)

Base path `/api/platform/admin-v1/danger/{action}/`. Kapsam `admin.dangerous`. Bu kapsam `ADMIN_SCOPES` içindedir ve yalnızca anahtara açıkça verildiyse geçerlidir. `admin.impersonate`, `:read` ve `:write` onu kapsamaz; `admin.dangerous` de diğer kapsamları kapsamaz. Kimlik doğrulama ve Idempotency-Key kuralları A5a ile aynıdır: ad alanı `platform_admin:<key_id>`, başlık yoksa **400** `Idempotency-Key gerekli`, aynı anahtar + farklı gövde **409** `Idempotency-Key farklı istekle kullanıldı`. Aynı anahtar + aynı gövde kayıtlı yanıtı döner; confirm işlemi ve danger audit’i ikinci kez çalışmaz. prepare tekrarı aynı `confirmation_token` değerini döner, yeni token üretilmez.

İki adımdır. prepare hiçbir iş verisi yazmaz, silmez ve e-posta göndermez. confirm, token’ı işlemden önce atomik tüketir. Süre `created_at` + 5 dakikadır. Token düz metin olarak saklanmaz; `platform_danger_confirmations` koleksiyonunda `_id` sha256 özetidir. Ayrı bir şema migration’ı gerekmez.

`confirm_text`: `company.*` ve `gib.gift` için şirket adı, `plan.delete` için paket adı, `product.delete` için ürün adı, `key.revoke`, `key.admin_create` ve `key.admin_scopes` için anahtar adı, `maintenance.enable` için bakım başlığı (trim, birebir); `user.*` ve `superadmin.*` için hedef e-posta (trim, küçük harf). Uyuşmazsa **400** ve token tüketilmez. `confirm_phrase`: `company.reset_data` için `VERİLERİ SIFIRLA`, `user.erase` için `VERİLERİ SİL`, `maintenance.enable` için `BAKIMI AÇ`, `gib.gift` için `KONTÖR YÜKLE`; diğer işlemlerde gönderilirse **400**. `operator_otp`, operatörün 6 haneli güncel TOTP kodudur. Operatörde 2FA yoksa **403** `Operatör 2FA kurulu değil.`; kod hatalı veya sayaç yeniden kullanıldıysa **403** `Doğrulama kodu hatalı.` ve deneme `2fa:<uid>` kilidine yazılır. Kilitliyken **429**. Şifre alanı kabul edilmez. Bilinmeyen action **404** `İşlem bulunamadı.`. Bilinmeyen alan **400** `Desteklenmeyen alan: <ad>`.

Token yok, süresi dolmuş, kullanılmış, başka `key_id` veya URL’deki action ile farklıysa hepsi **400** `Onay kodu geçersiz veya süresi dolmuş.` Hedef prepare ile confirm arasında değişirse **409** `Hedef değişti, yeniden hazırlayın.` ve token tüketilmiş kalır. İşlem hata verirse token da tüketilmiş kalır; yeniden prepare gerekir.

| action | hedef | phrase | kaynak |
|--------|--------|--------|--------|
| `company.reset_data` | `target_id` = company_id; `scopes` opsiyonel (yoksa `all`) | `VERİLERİ SIFIRLA` | `company_reset.apply_reset` |
| `company.delete` | company_id | yok | `saas.apply_company_delete` |
| `user.erase` | user_id | `VERİLERİ SİL` | `user_erase.apply_erase` |
| `user.password_reset` | company_id; opsiyonel `user_id`, `email` | yok | `saas.send_password_reset_for` (`notify_outbox`) |
| `superadmin.2fa_reset` | user_id, `is_super_admin=True` | yok | `superadmin_2fa.reset_user_totp` |
| `plan.delete` | plan_id | yok | `saas.apply_delete_plan` |
| `product.delete` | product_id | yok | `store.delete_product` |
| `company.detach` | company_id | yok | `saas.apply_detach_subsidiary` |
| `user.delete` | süper admin user_id | yok | `saas.system_delete_user` |
| `key.revoke` | api key id | yok | `store.revoke_api_key` |
| `key.admin_create` | `target_id` = `platform`; `name`, `product_id`, `scopes` | yok | `store.create_api_key` (`kind=platform_admin`) |
| `key.admin_scopes` | api key id; `scopes` | yok | `store.update_api_key_scopes` |
| `maintenance.enable` | `target_id` = `platform` | `BAKIMI AÇ` | `platform_notices.system_put_maintenance` (`enabled=true`) |
| `gib.gift` | company_id; `credits` > 1000 | `KONTÖR YÜKLE` | `gib_credits.gift` |

Kullanımda olan paket prepare’de **400** `Bu paketi kullanan N şirket var; önce paketlerini değiştirin.`. `plan_custom` **400** `Özel paket silinemez.`. Olmayan paket **404** `Paket bulunamadı.`. `tamkobi` ürünü **400** `tamkobi ürünü silinemez`. Olmayan ürün **404** `Ürün bulunamadı`. Bu iki action başka şirketi, başka paketi ve kardeş ürünü silmez. `activity_logs.company_id` şirket olmayan hedeflerde `platform` kalır.

Korumalı şirketler (`PROTECTED_COMPANY_IDS`) reset ve delete için **400** `Platform demo şirketleri silinemez.` Platform gönderici şirketi delete için **400** `Platform gönderici şirketi silinemez. Önce ayarlardan başka bir gönderici seçin.` Kendi 2FA sıfırlama **400** `Kendi 2FA'nızı bu yolla sıfırlayamazsınız.` Süper admin olmayan 2FA hedefi **404** `Panel yöneticisi bulunamadı.`

`company.detach` üstü olmayan şirkette **400** `Bu şirket bir üst şirkete bağlı değil.`. Paylaşılan lisanstayken `saas.apply_detach_subsidiary` çocuğa kendi lisans kopyasını açar; üst lisans silinmez. `user.delete` panel yöneticisi (`is_super_admin`) siler; kendi hesabı ve son süper admin **400**. Kiracı veri silme `user.erase` olarak kalır. `key.revoke` isteği atan anahtarın kendisini iptal edemez (**400** `Bu istekte kullanılan anahtar iptal edilemez.`); zaten iptal edilmiş anahtar **400**. `key.admin_create` ve `key.admin_scopes` `admin.dangerous` ile birlikte `admin.keys:write` ister; yoksa **403** `Kapsam yetersiz`. İstenen kapsamlar çağıran anahtarın kapsamlarının alt kümesi olmalıdır; değilse **403** `İstenen kapsam çağıran anahtarın kapsamının dışında.` ve anahtar yazılmaz. `key.admin_create` yalnız TamKobi `platform_admin` anahtarı açar; `confirm_text` yeni anahtarın adıdır. Başarıda `credential` `item` içindedir ve bir kez döner. `key.admin_scopes` yalnız mevcut `platform_admin` anahtarının kapsamını değiştirir, sır döndürmez. Parmak izi kapsam listesini taşır; hedef veya çağıran kapsamı prepare ile confirm arasında değişirse **409** `Hedef değişti, yeniden hazırlayın.` `maintenance.enable` için `target_id` `platform` olmalıdır. `gib.gift` tutarı `gib_credits.GIFT_DIRECT_MAX` (1000) ve altındaysa **400** `1000 ve altı doğrudan yüklenebilir.`; üstü bu danger action’dadır. Doğrudan `POST .../gib-credits/gift` tersini uygular.

Audit: `admin_v1.danger.<action>.prepare` ve `admin_v1.danger.<action>.confirm`. `target_type` company, user, plan, product, api_key veya maintenance. `details` yalnız `operator`, `reason`, `action`, preview özeti veya sonuç sayıları, `scopes`. Token, token özeti, `operator_otp`, `confirm_text`, imza, nonce, Idempotency-Key, secret ve sıfırlama bağlantısı girmez. `activity_logs` ve applog satırında `operator_email` ve `via=api` görünür.

### POST `/api/platform/admin-v1/danger/{action}/prepare`

Gövde: `target_id`, `reason` (A5a, 10..500), `operator_email` (A5a). Action’a özel opsiyoneller yukarıdadır. Yanıt düz nesnedir: `action`, `target_id`, `target_label`, `preview`, `confirm_text_hint`, `confirm_phrase` (yoksa null), `confirmation_token`, `expires_at`. `user.password_reset` ve `superadmin.2fa_reset` önizlemesi yalnız hedef e-postadır.

### POST `/api/platform/admin-v1/danger/{action}/confirm`

Gövde: `confirmation_token`, `confirm_text`, `operator_otp`, phrase isteyen işlemlerde `confirm_phrase`. Başarıda `/system` ile aynı gövde `{"item": …}` zarfında döner. `user.password_reset` e-postayı SMTP ile göndermez; tek `notify_outbox` kaydı yazar. SMS yoktur.

## admin-v1 eski /sistem yüzeyi (A6)

`/sistem` modüllerinin admin-v1’de eksik kalan yazma ve okuma uçları. Kimlik doğrulama, `kind=platform_admin`, boş `instance_id`, Idempotency-Key ve audit kuralları A4 ile aynıdır. Yazma audit’i `admin_v1.write.<op>`. Yanıt zarfı `{"item": …}` (liste okumaları düz nesne). `_redact` parola, `api_key`, `secret`, `token` ve `iban_enc` alanlarını düşürür. Tek seferlik şirket/platform anahtar sırrı bu yüzden `credential` adıyla döner; sonraki `GET /api-keys` onu içermez. Aynı Idempotency-Key tekrarı ilk yanıttaki `credential` değerini geri verir.

Sır taşıyan gövde alanları (`password`, `api_key`, `merchant_key`, `merchant_salt`, `legal_iban`, `clear_key: true`) özellik yazma kapsamına ek olarak `admin.secrets:write` ister. Alan gövdede varsa boş string ve yalnızca boşluk da sayılır. Eksikse **403** `Kapsam yetersiz` ve kayıt yazılmaz. `clear_key: false` sır sayılmaz. Panel kullanıcısında boş veya yalnızca boşluk `password`, kapsam varken **400** `Şifre boş olamaz.` döner ve hash yazılmaz. Okuma `configured` / `has_*` ve maskeli ipucu döner; düz sır dönmez. Audit `details.fields` bu alan adlarını listelemez.

`is_public` paket bayrağı A4’teki `POST/PUT /plans` üzerindedir (`saas.apply_create_plan` / `apply_update_plan`). Ayrı uç yoktur.

Yeni kapsamlar `ADMIN_SCOPES` içindedir. Bir `:write` diğerini kapsamaz. `admin.secrets:write` tek başına özellik ucunu açmaz.

| kapsam | eski /sistem |
|--------|----------------|
| `admin.quotas:write` | kotalar |
| `admin.settings:read` / `admin.settings:write` | ayarlar, PayTR, SMTP/IMAP, eklenti varsayılanı |
| `admin.secrets:write` | parola ve API anahtarı yazma (ek kapsam) |
| `admin.storage:read` / `admin.storage:write` | depolama |
| `admin.users:write` | panel kullanıcıları (oluşturma, düzenleme) |
| `admin.keys:write` | API anahtarı oluşturma, kapsam, döndürme |
| `admin.einvoice:read` / `admin.einvoice:write` | e-fatura kimliği, İşNet çıkış IP, XSLT |
| `admin.sms:write` | SMS kayıt, doğrulama, bakiye, test (`admin.sms:read` GET’te kalır) |
| `admin.ai:read` / `admin.ai:write` | AI sağlayıcı |
| `admin.cms:read` / `admin.cms:write` | site ve yardım merkezi |
| `admin.maintenance:read` / `admin.maintenance:write` | bakım metni ve duyuru (açma danger) |
| `admin.db:read` | veritabanı paneli, salt okunur |
| `admin.licenses:write` | eşik altı kontör hediyesi (mevcut lisans kapsamı) |
| `admin.support:read` | destek eki indirme (mevcut) |
| `admin.dangerous` | koparma, kullanıcı silme, anahtar iptali, bakım açma, eşik üstü kontör |

### Kota, eklenti, depolama

| uç | kapsam | iş |
|----|--------|-----|
| `PUT /companies/{company_id}/quotas` | `admin.quotas:write` | `saas.apply_license_update`. Alanlar `user_limit`, `company_limit`, `product_limit`, `contact_limit`, `storage_limit_mb`. `null` override’ı siler. Negatif veya bool **400**. Audit `quota.update`. |
| `GET /addons` | `admin.settings:read` | `addons._list_addons` |
| `PUT /addons` | `admin.settings:write` | `{"defaults": {anahtar: bool\|null}}`. Bilinmeyen anahtar **400**. Audit `addon.defaults`. Şirket eklenti aç/kapa A4’te `admin.licenses:write` olarak kalır. |
| `GET /storage` | `admin.storage:read` | `storage_manager.list_accounts_storage` |
| `GET /companies/{company_id}/storage` | `admin.storage:read` | `account_storage_summary` + `saas.effective` kota |
| `GET /companies/{company_id}/storage/folders/{area_key}/files` | `admin.storage:read` | `list_folder_files` |
| `POST /companies/{company_id}/storage/ensure` | `admin.storage:write` | `ensure_account_folders`. Audit `storage.ensure`. |
| `POST /companies/{company_id}/storage/folders` | `admin.storage:write` | `{"label"}`. Audit `storage.folder`. |
| `POST /storage/ensure-all` | `admin.storage:write` | her şirket için `ensure_account_folders`. Audit `storage.ensure_all`. |

### Panel kullanıcısı ve API anahtarı

`/sistem/kullanicilar` süper adminleridir. Kiracı kullanıcı CRUD’u bu uçlarda yoktur.

| uç | kapsam | iş |
|----|--------|-----|
| `POST /platform-users` | `admin.users:write` | `saas.system_create_user`. `name`, `email`, `password` zorunlu. `password` için `admin.secrets:write`; boş veya yalnız boşluk **400** `Şifre boş olamaz.`. Audit `platform_user.create`. Yanıtta parola yoktur. |
| `PUT /platform-users/{user_id}` | `admin.users:write` | `saas.system_update_user`. `name`, `email`, `phone`, `is_active`, `password`. `password` alanı varsa `admin.secrets:write`; boş veya yalnız boşluk hash yazmaz. Silme yoktur. |
| `POST /api-keys` | `admin.keys:write` | `store.create_api_key`. Yalnız `kind=product`. `instance_id` zorunlu ve şirket olmalıdır. `admin.*` şirket anahtarına **400**. `kind=platform_admin` **400** `platform_admin anahtarı danger/key.admin_create ile oluşturulur.` Yanıt `item` + bir kez `credential`. Audit `api_key.create`. |
| `PUT /api-keys/{key_id}/scopes` | `admin.keys:write` | `store.update_api_key_scopes`. Şirket anahtarı. `platform_admin` **400** `platform_admin anahtarının kapsamı danger/key.admin_scopes ile değişir.` Sır dönmez. Audit `api_key.scopes`. |
| `POST /api-keys/{key_id}/rotate` | `admin.keys:write` | `store.rotate_api_key`. Yeni `credential` bir kez. `platform_admin` hedefinin kapsamı çağıranın alt kümesi değilse **403** `İstenen kapsam çağıran anahtarın kapsamının dışında.` ve yeni anahtar yazılmaz. Audit `api_key.rotate`. |

İptal yalnız `key.revoke`. `DELETE` yoktur. Eski `/platform/admin` ve `/system` anahtar uçları durur.

### E-fatura, SMS, AI, PayTR, ayar, posta

| uç | kapsam | iş |
|----|--------|-----|
| `GET /companies/{company_id}/einvoice` | `admin.einvoice:read` | `server._einvoice_view` maskeli. `username` yerine `username_configured` ve `username_hint`. `has_password`, `has_api_key`. `mode` İşNet SOAP ortamıdır (`test` \| `live`). `despatch_defaults` e-irsaliye varsayılanıdır. |
| `PUT /companies/{company_id}/einvoice/credentials` | `admin.einvoice:write` | `server.save_einvoice_settings`. Sağlayıcı önceden atanmış olmalıdır. `password` ve `api_key` için `admin.secrets:write`. Audit `einvoice.credentials`. |
| `GET /einvoice/isnet/egress` | `admin.einvoice:read` | `isnet.isnet_ip_registration_info` (çıkış IP). |
| `PUT /sms/settings` | `admin.sms:write` | `platform_sms.save_platform_sms`. Parola için `admin.secrets:write`. `msgheader` 3–11 karakter. Audit `sms.save`. |
| `POST /sms/verify` | `admin.sms:write` | `verify_platform_sms`. Audit `sms.verify`. |
| `POST /sms/balance` | `admin.sms:write` | `platform_sms_balance`. Audit `sms.balance`. |
| `POST /sms/send-test` | `admin.sms:write` | `phone` zorunlu. Audit `sms.send_test`. |
| `GET /ai` | `admin.ai:read` | `saas_extras._system_ai_public` (`has_key`, `key_hint`). |
| `PUT /ai` | `admin.ai:write` | `put_system_ai`. `api_key` ve `clear_key: true` için `admin.secrets:write`. Audit `ai.save`. |
| `POST /ai/test` | `admin.ai:write` | `test_system_ai`. Kayıtlı anahtar yalnız kayıtlı `provider` ve `base_url` ile gider. Farklı sağlayıcı veya uç nokta, gövdede dolu `api_key` yoksa **400** ve kayıtlı anahtar gönderilmez; `api_key` varsa `admin.secrets:write` gerekir ve yalnız o anahtar kullanılır. Audit `ai.test`. |
| `GET /paytr` | `admin.settings:read` | `_paytr_public` (`has_key`, `has_salt`, `merchant_id`). |
| `PUT /paytr` | `admin.settings:write` | `put_paytr`. `merchant_key` ve `merchant_salt` için `admin.secrets:write`. Audit `paytr.save`. |
| `POST /paytr/test` | `admin.settings:write` | `test_paytr`. Audit `paytr.test`. |
| `GET /settings` | `admin.settings:read` | `saas_billing.settings` maskeli. `legal_iban` yerine `legal_iban_configured` ve `legal_iban_hint`. `ai` ve `paytr` bu gövdede yoktur. |
| `PUT /settings` | `admin.settings:write` | `saas_billing.put_settings`. `legal_iban` için `admin.secrets:write`. Audit `settings.save`. |
| `GET /mail` | `admin.settings:read` | `platform_mail.mail_overview`. `has_password`; `password_enc` yok. Gelen kutusu okuma bu API’de yoktur. |
| `POST /mail/servers` | `admin.settings:write` | `create_server`. Parola zorunlu ve `admin.secrets:write`. Audit `mail.server.create`. |
| `PUT /mail/servers/{server_id}` | `admin.settings:write` | `update_server`. Audit `mail.server.update`. |
| `POST /mail/servers/{server_id}/delete` | `admin.settings:write` | `delete_server`. Audit `mail.server.delete`. |
| `POST /mail/servers/{server_id}/test` | `admin.settings:write` | `test_server`. Audit `mail.server.test`. |
| `POST /mail/mailboxes` | `admin.settings:write` | `create_mailbox`. Audit `mail.mailbox.create`. |
| `PUT /mail/mailboxes/{box_id}` | `admin.settings:write` | `update_mailbox`. Audit `mail.mailbox.update`. |
| `POST /mail/mailboxes/{box_id}/delete` | `admin.settings:write` | `delete_mailbox`. Audit `mail.mailbox.delete`. |

### CMS, yardım, bakım, XSLT, kontör, veritabanı, ek

| uç | kapsam | iş |
|----|--------|-----|
| `GET /maintenance` | `admin.maintenance:read` | `platform_notices.get_maintenance` |
| `PUT /maintenance` | `admin.maintenance:write` | `system_put_maintenance`. `enabled: true` şu an kapalıyken **400** `Bakım modunu açmak için danger akışını kullanın.` Kapatma ve açıkken metin düzenleme normal yazmadır. Audit `maintenance.save`. |
| `GET /announcements` | `admin.maintenance:read` | `system_list_announcements` |
| `POST /announcements` | `admin.maintenance:write` | `system_create_announcement`. Audit `announcement.create`. |
| `PUT /announcements/{announce_id}` | `admin.maintenance:write` | `system_update_announcement`. Audit `announcement.update`. |
| `POST /announcements/{announce_id}/delete` | `admin.maintenance:write` | `system_delete_announcement`. Audit `announcement.delete`. |
| `GET /sites` | `admin.cms:read` | `public_sites.list_sites` |
| `GET /sites/{slug}` | `admin.cms:read` | `get_site` |
| `PUT /sites/{slug}` | `admin.cms:write` | `update_site`. Audit `site.update`. |
| `PUT /sites/{slug}/content` | `admin.cms:write` | `update_content`. Audit `site.content`. |
| `GET /sites/{slug}/inquiries` | `admin.cms:read` | `list_inquiries` |
| `GET /help/articles` | `admin.cms:read` | `help_center.system_help_list` |
| `POST /help/articles` | `admin.cms:write` | `system_help_create`. Audit `help.create`. |
| `PUT /help/articles/{article_id}` | `admin.cms:write` | `system_help_update`. Audit `help.update`. |
| `POST /help/articles/{article_id}/delete` | `admin.cms:write` | `system_help_delete`. Audit `help.delete`. |
| `GET /einvoice-designs` | `admin.einvoice:read` | `einvoice_designs._list` |
| `POST /einvoice-designs` | `admin.einvoice:write` | `_create_design_impl`. Audit `einvoice_design.create`. |
| `PUT /einvoice-designs/{design_id}` | `admin.einvoice:write` | `_update_scoped` veya `_update_design_impl`. Audit `einvoice_design.update`. |
| `POST /einvoice-designs/{design_id}/select` | `admin.einvoice:write` | `_select_scoped`. Audit `einvoice_design.select`. |
| `POST /einvoice-designs/{design_id}/delete` | `admin.einvoice:write` | `_delete_scoped`. Audit `einvoice_design.delete`. |
| `GET /einvoice-designs/settings/embed` | `admin.einvoice:read` | `get_xslt_embed_mode` |
| `PUT /einvoice-designs/settings/embed` | `admin.einvoice:write` | `set_xslt_embed_mode` (`base64` \| `gzip_base64`). Audit `einvoice_design.embed`. |
| `POST /companies/{company_id}/gib-credits/gift` | `admin.licenses:write` | `gib_credits.gift`. `credits` 1..1000. Üstü **400** `Bu tutar danger akışı gerektirir.` Audit `gib.gift`. |
| `GET /database` | `admin.db:read` | `db_relocate.public_view` + `whitelisted_table_counts`. Yalnız `KNOWN_TABLES` (`docs`, `meta_indexes`, `system_logs`). Parola, kullanıcı, `ssl_ca` ve serbest SQL yok. `has_password` bool. Taşıma ve bağlantı denemesi bu API’de yoktur. |
| `GET /support/tickets/{ticket_id}/attachments/{message_id}/{index}` | `admin.support:read` | Ek `url` `/api/files/` ile başlar. Yol `rbac.normalized_file_storage_path` ile normalize edilir. `files` satırı `storage_path` ile bulunur, `company_id` talep şirketiyle aynı ve `is_deleted` false olmalıdır; değilse **404** ve nesne okunmaz. HTML gövde **404**. Yanıt `Content-Disposition: attachment` ve `X-Content-Type-Options: nosniff`. İmzalı `?t=` bu uçta yetki yerine geçmez. |

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
