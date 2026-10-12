# TamKobi e-posta mimarisi

## Özet

| Rol | Nerede | Ne için |
|-----|--------|---------|
| Uygulama giden maili | **Amazon SES** (`eu-central-1`) | Bildirim, şifre sıfırlama, lisans, fatura |
| İnsan posta kutuları | **İxirHost Kurumsal E-Posta** | `info@`, `destek@` (gelen / cevap) |
| Uygulama sunucusu (`85.95.240.184`) | — | **Doğrudan mail ASLA çıkmaz** (25/587 outbound yok) |

Kod yolu: `backend/mail_service.py` → `send_mail(...)`.

Sürücü sırası:

1. **ynt** → Sistem → Posta Sunucusu’nda tanımlı platform kutusu (`platform_mail.resolve_smtp_account(purpose)`), tipik olarak SES SMTP: `email-smtp.eu-central-1.amazonaws.com:587` STARTTLS.
2. Yoksa `.env` `MAIL_DRIVER`:
   - `console` (varsayılan) — yalnızca log
   - `smtp` — `MAIL_SMTP_*`
   - `ses` — boto3 `sesv2` API (`MAIL_SES_REGION=eu-central-1`)

Firma adına giden maillerde:

```
From: "Firma Adı via TamKobi" <bildirim@tamkobi.com>
Reply-To: firma@ornek.com   # veya MAIL_REPLY_TO=destek@tamkobi.com
```

Her gönderim `mail_logs`’a yazılır (`driver`, `purpose`, `company_id`, `to`, `subject`, `status`, `provider_message_id`, `error`). Gövde ve ek içeriği saklanmaz.

Bounce/complaint: `POST /api/mail/webhooks/ses` (SNS imza doğrulamalı) → `mail_suppressions`. Bastırılmış adreslere `send_mail` göndermez.

## DNS

### İxirHost (gelen posta — MX)

`tamkobi.com` MX kayıtları İxirHost’un verdiği değerlerde kalır (`info@`, `destek@` buraya düşer).

SPF’te İxirHost include’unu koruyun; SES’i de ekleyin, örneğin:

```
v=spf1 include:<ixirhost-spf> include:amazonses.com ~all
```

(İxirHost panelindeki SPF include ifadesini kullanın.)

### Amazon SES (gönderen kimliği)

SES’te `tamkobi.com` (veya `bildirim.tamkobi.com`) doğrulanır; DKIM için SES’in verdiği **CNAME** kayıtları eklenir.

Gönderen: `bildirim@tamkobi.com` (verified identity).

### Bounce subdomain (önerilen)

SES feedback / bounce için ayrı alt alan:

| Tip | Ad | Değer |
|-----|-----|--------|
| MX | `bounce.tamkobi.com` | SES / feedback dokümantasyonundaki MX |
| TXT | `bounce.tamkobi.com` | SPF (SES) |

SNS topic’i bounce + complaint’e bağlayın; HTTPS endpoint:

`https://<api-host>/api/mail/webhooks/ses`

### DMARC

Başlangıç (izleme):

```
_dmarc.tamkobi.com. TXT "v=DMARC1; p=none; rua=mailto:dmarc@tamkobi.com"
```

SES + İxirHost hizalandıktan sonra `p=quarantine` / `p=reject` düşünülebilir.

## ynt’de SES SMTP kurulumu

1. AWS SES → SMTP settings → SMTP kullanıcı/şifre oluştur (`eu-central-1`).
2. **ynt** → Sistem → Posta Sunucusu:
   - Host: `email-smtp.eu-central-1.amazonaws.com`
   - Port: `587` (STARTTLS)
   - Kullanıcı / şifre: SES SMTP credentials
3. Kutu ekleyin: `bildirim@tamkobi.com`, amaçlar: `transactional`, `billing`; varsayılan işaretleyin.
4. Reply-To isteğe bağlı: `destek@tamkobi.com` (İxirHost kutusu).
5. Test gönderimi yapın; `mail_logs`’ta `driver=platform_smtp`, `status=sent` görünmeli.

`.env` fallback (platform kutu yokken):

```
MAIL_DRIVER=smtp
MAIL_FROM=bildirim@tamkobi.com
MAIL_FROM_NAME=TamKobi
MAIL_REPLY_TO=destek@tamkobi.com
MAIL_SES_REGION=eu-central-1
MAIL_SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
MAIL_SMTP_PORT=587
MAIL_SMTP_USER=...
MAIL_SMTP_PASSWORD=...
```

Gerçek kimlik bilgilerini commit etmeyin.

## Ne SES’ten gider / ne İxirHost’ta kalır

- **SES:** bildirimler (`event_notify`), şifre sıfırlama (sistem paneli), lisans hatırlatma, abonelik e-Arşiv PDF.
- **İxirHost:** `info@` / `destek@` gelen kutusu; kullanıcıların İletişim Merkezi IMAP hesapları (şirket kutuları) ayrı kalır — uygulama sunucusundan relay edilmez.
