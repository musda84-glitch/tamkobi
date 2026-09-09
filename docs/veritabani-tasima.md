# Veritabanını kendi sunucunuza taşıma

TamKobi tüm ERP verisini MySQL 8 üzerindeki üç tabloda tutar: `docs` (JSON belgeler), `meta_indexes` ve `system_logs`. Bu yüzden "kendi sunucumdaki veritabanını kullan" işlemi iki adımdır: tabloları ve verileri hedef sunucuya kopyalamak, sonra uygulamanın bağlantı ayarını o sunucuya çevirmek. Şema haritası için [mysql-schema.md](mysql-schema.md).

İşlem, satır sayıları kaynakla eşleşmeden bağlantıyı değiştirmez; kopyalama yarıda kalırsa uygulama eski veritabanıyla çalışmaya devam eder.

## Hedef sunucuda gerekenler

- MySQL 8.0 (utf8mb4 / utf8mb4_unicode_ci), TamKobi sunucusundan erişilebilir bir port
- Veritabanı ve kullanıcı. Kullanıcıya en az `SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, REFERENCES` yetkisi gerekir; `DROP`/`INDEX` tabloların hedefte yeniden oluşturulması içindir.
- Veritabanını önceden açmadıysanız kullanıcının `CREATE DATABASE` yetkisi olmalı; yoksa şunu bir kez çalıştırın:

```sql
CREATE DATABASE tamkobi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'tamkobi'@'%' IDENTIFIED BY 'guclu-bir-sifre';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, REFERENCES ON tamkobi.* TO 'tamkobi'@'%';
FLUSH PRIVILEGES;
```

## Panelden taşıma

Platform Yönetimi → **Veritabanı** (`/sistem/veritabani`, yalnızca süper admin):

1. Üstteki kart şu an kullanılan sunucuyu, veritabanını, ayarın nereden geldiğini (kurulum dosyası veya ortam değişkeni) ve tablo satır sayılarını gösterir.
2. Hedef sunucu bilgilerini girip **Bağlantıyı test et**'e basın. Yetki varsa veritabanı yoksa oluşturulur; hedefte veri varsa uyarı çıkar.
3. **Verileri taşı ve buraya bağlan**. Kopyalama öncesi mevcut veritabanının yedeği `backups/mysql` klasörüne yazılır, kopyalama sonrası satır sayıları karşılaştırılır ve doğrulama geçerse uygulama yeniden başlatmaya gerek kalmadan yeni veritabanına bağlanır.

Hedefte eski bir TamKobi kurulumu varsa taşımak için **üzerine yaz** kutusunu işaretlemeniz gerekir; bu, hedefteki tabloları silip yeniden oluşturur.

## Komut satırından taşıma

```bash
# Şu an hangi veritabanı kullanılıyor?
./scripts/db_move.sh show

# Hedefe bağlan (gerekiyorsa veritabanını oluşturur)
TARGET_MYSQL_PASSWORD='guclu-bir-sifre' \
  ./scripts/db_move.sh test --host db.firmaniz.com --db tamkobi --user tamkobi

# Tabloları ve verileri taşı, uygulamayı hedefe bağla
TARGET_MYSQL_PASSWORD='guclu-bir-sifre' \
  ./scripts/db_move.sh move --host db.firmaniz.com --db tamkobi --user tamkobi --yes
```

Şifreyi komut geçmişine yazmamak için `TARGET_MYSQL_PASSWORD` kullanın; `--password` da kabul edilir. Tek satırda bağlantı adresi de verilebilir: `--url mysql://tamkobi:sifre@db.firmaniz.com:3306/tamkobi`.

| Seçenek | Etkisi |
|---|---|
| `--yes` | Zorunlu; taşımayı onaylar |
| `--overwrite` | Hedefteki mevcut TamKobi tablolarını silip yeniden yazar |
| `--no-repoint` | Sadece kopyalar; uygulama eski veritabanında kalır (deneme için) |
| `--no-backup` | Kopyalama öncesi yedek dosyası yazmaz |
| `--backup-dir DIR` | Yedek klasörünü değiştirir (varsayılan `backups/mysql`) |

Komut satırından taşıdıktan sonra çalışan süreç eski bağlantıyı kullanmaya devam eder; backend'i yeniden başlatın:

```bash
docker compose up -d --no-deps --force-recreate backend
```

## Ayar nereye yazılır?

Bağlantı `backend/data/database.json` dosyasına yazılır (0600, git'e girmez) ve **ortam değişkenlerinden önce gelir**. Yani `docker-compose.yml` içindeki `MYSQL_HOST` değerini değiştirmeseniz de uygulama yeni sunucuyu kullanır. Ortam değişkenlerine dönmek isterseniz bu dosyayı silin.

Docker kullanıyorsanız `./backend/data` klasörünün konteynere bağlı olduğundan emin olun; aksi halde ayar konteyner yenilenince kaybolur.

## Taşıma sonrası kontrol

```bash
./scripts/db_move.sh show            # host/veritabanı ve satır sayıları hedefi göstermeli
curl -s http://127.0.0.1/api/setup/status
```

Panelde Veritabanı kartındaki satır sayıları taşımadan önceki değerlerle aynı olmalıdır.

## Kapsam dışındakiler

- **Yüklenen dosyalar** (ürün resimleri, fatura PDF/XML) MySQL'de değil diskte durur. Sunucu değiştiriyorsanız `backend/data` (ve varsa yükleme klasörünüz) ayrıca kopyalanmalıdır.
- **MySQL kullanıcıları ve yetkileri** kopyalanmaz; hedef sunucuda kendiniz oluşturursunuz. Yetki modeli için [mysql-users.md](mysql-users.md).
- Kurulum kilidi (`backend/data/install.json`) yerelde kalır. Hedefte kullanıcı kayıtları olduğu için kurulum sihirbazı yeniden açılmaz.

## Geri dönüş

Taşıma öncesi yedek `backups/mysql/tamkobi-YYYYMMDD-HHMMSS.json.gz` olarak durur. Eski sunucuya dönmek için `backend/data/database.json` dosyasını silin (veya eski bilgilerle panelden geri taşıyın) ve backend'i yeniden başlatın. Yedekten geri yükleme:

```bash
./scripts/mysql_restore.sh backups/mysql/tamkobi-YYYYMMDD-HHMMSS.json.gz --yes
```

## Testler

```bash
python3 -m pytest backend/tests/test_db_relocate.py -q
```

Canlı test, mevcut veritabanını aynı sunucudaki `tamkobi_relocate_test` şemasına kopyalar, satır sayılarını karşılaştırır ve bağlantıyı değiştirmez; MySQL erişilemiyorsa veya veritabanı oluşturma yetkisi yoksa atlanır.
