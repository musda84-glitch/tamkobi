# JWT_SECRET ve sıfır kurulum

## Zorunluluk

`JWT_SECRET` tanımlı ve bilinen zayıf değerlerden (`change-me`, `nexus_default_secret_key_99482910`, …) farklı olmalıdır. Aksi halde backend açılmaz.

```bash
# backend/.env
JWT_SECRET=$(openssl rand -hex 32)
```

`backend/env.example` içinde `JWT_SECRET=` boş bırakılmıştır; kopyaladıktan sonra üretin.

## Sıfır kurulum akışı

1. `.env` oluşturun (`cp backend/env.example backend/.env`), MySQL ve boş `JWT_SECRET` (veya openssl ile doldurulmuş) ayarlayın.
2. Uygulamayı başlatın. Veritabanında kullanıcı yoksa `/kurulum` sihirbazı açılır.
3. Sihirbaz güvenli bir JWT secret üretebilir (`setup_install`) ve `SUPER_ADMIN_EMAIL` / şifre ile platform yöneticisini oluşturur.
4. Seed artık `admin@nexus.com` oluşturmaz; demo şirket kullanıcısı `admin@tamkobi.local` (süper admin değil).

## Secret değiştirince

JWT_SECRET değişirse tüm oturumlar düşer; kullanıcılar yeniden giriş yapmalıdır.
