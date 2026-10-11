# admin@nexus.com — canlıda devre dışı bırakma

Bu hesap artık seed / `saas.seed()` ile oluşturulmaz ve süper admin yapılmaz.

Canlıda hâlâ varsa **silmeyin**; tek seferlik onaylı script ile pasifleştirin:

```bash
cd /var/www/tamkobi.com/backend   # veya kurulum dizininiz
CONFIRM_DISABLE_NEXUS_ADMIN=yes python scripts/disable_nexus_admin.py
```

Script yalnızca `is_active=false` ve `is_super_admin=false` yazar; kaydı silmez.

Veritabanı adı `mysql_settings_from_env()["db"]` üzerinden okunur.

Ayrıca bkz. [JWT_SECRET / sıfır kurulum](./security-p0-jwt-setup.md).
