# Google ile kayıt / giriş

TamKobi, [Google Identity Services](https://developers.google.com/identity/gsi/web) ID token ile giriş ve yeni şirket kaydı destekler.

## Ortam değişkenleri

| Değişken | Nerede | Açıklama |
|----------|--------|----------|
| `GOOGLE_CLIENT_ID` | Backend | Google OAuth 2.0 Web Client ID. **Yoksa** `POST /api/auth/google` → **404**. |
| `REACT_APP_GOOGLE_CLIENT_ID` | Frontend (build) | Aynı Client ID. **Yoksa** «Google ile devam et» butonu gizlenir. |

Örnek (Geliştirme / prod Client ID):

```bash
GOOGLE_CLIENT_ID=359977032625-m1essfnlouaa4tmh0jsqfk8dca0fn67o.apps.googleusercontent.com
REACT_APP_GOOGLE_CLIENT_ID=359977032625-m1essfnlouaa4tmh0jsqfk8dca0fn67o.apps.googleusercontent.com
```

Değerleri `env.example` ve `backend/env.example` içinde de belgelenir. Gerçek secret commit edilmez; Client ID public bir kimliktir.

## API

`POST /api/auth/google`

```json
{ "credential": "<Google ID token>", "remember": true }
```

Doğrulama (`google-auth`):

- `aud` = `GOOGLE_CLIENT_ID`
- `iss` ∈ `accounts.google.com` / `https://accounts.google.com`
- `email_verified` zorunlu

Davranış:

1. **E-posta kayıtlı** → mevcut oturum/cookie akışı (`_issue_session_for_user`). TOTP açıksa `requires_2fa` + `pending_token`.
2. **Süper admin** → **403** (Google ile giremez; platform `/sistem/giris` kullanır).
3. **Yeni kullanıcı**, şirket adı / telefon yok → `{ "needs_profile": true, "pending_token", "email", "name", "missing": [...] }`.
4. Profil tamamlanınca (aynı endpoint + `pending_token` + `company_name` + `phone`) deneme kaydı: şirket + yönetici, `auth_provider=google`, `google_sub`, şifresiz.

## Frontend

Giriş (`/login`) ve kayıt (`/kayit`) sayfalarında GIS butonu. `needs_profile` ise kısa form (şirket + telefon + yasal onay).

## Mobil

Bu özellik **yalnızca web** paneli içindir. Mobil uygulama bu PR kapsamında Google girişine bağlanmaz; ileride ayrı native Google Sign-In entegrasyonu gerekir.
