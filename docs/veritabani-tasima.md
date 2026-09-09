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

## Bağlantı şifrelemesi (TLS)

Şifre ve tüm ERP verisi bu bağlantıdan geçtiği için, sunucu bu makinede değilse bağlantı şifrelenir **ve** sunucunun kimliği doğrulanır. Modlar MySQL'in kendi `--ssl-mode` değerleriyle aynı anlama gelir:

| Mod | Anlamı |
|---|---|
| `disabled` | Şifresiz. Yalnızca aynı makinedeki MySQL için |
| `required` | Şifreli, sertifika doğrulanmaz. Araya giren biri kendi sertifikasını sunabileceği için yalnızca bağlantı VPN/özel ağ ile korunuyorsa seçin |
| `verify_ca` | Şifreli; sertifika verdiğiniz CA dosyasıyla doğrulanır (sunucu adı kontrol edilmez) |
| `verify_identity` | Şifreli; sertifika güvenilen bir CA'ya bağlanmalı **ve** yazdığınız sunucu adıyla eşleşmeli |

Mod seçimi tek bir kuralla yapılır ve uygulamanın açtığı **her** bağlantı (çalışan API, istek günlüğü, yedek betiği, kurulum sihirbazı, panel, CLI) aynı kuralı izler:

1. Panel/sihirbaz formunda, CLI'da (`--ssl-mode`, `--ssl-ca`) ya da `database.json` içinde yazılı bir mod varsa aynen o kullanılır.
2. Yoksa `MYSQL_SSL_MODE` / `MYSQL_SSL_CA` geçerlidir — ancak veritabanı başka bir sunucudaysa ve değişken **doğrulamasız** bir mod (`disabled`, `required`) söylüyorsa dikkate alınmaz.
3. Hiçbiri yoksa sunucuya bakılır: `localhost`/`127.0.0.1` için `disabled`, **başka her sunucu için `verify_identity`**.

2. adımdaki istisna önemli: `MYSQL_SSL_MODE=disabled` bu makinedeki MySQL için doğru olabilir, ama başka bir sunucuya taşırken ya da uzak bir sunucuyu tarif eden bir ayar dosyasında sizin adınıza "şifresiz olsun" kararı verilmez; o durumda `verify_identity` uygulanır. Doğrulama yapan bir değer (`verify_ca` + `MYSQL_SSL_CA`, ya da `verify_identity`) ise her sunucu için geçerlidir — kendi imzalı sertifikalı bir sunucuyu dosyaya dokunmadan bu şekilde çalıştırabilirsiniz.

Formdaki "otomatik" seçeneği hangi modu seçeceğini parantez içinde yazar; doğrulamasız bir mod çıkıyorsa (bu makinedeki MySQL ya da elle seçilen `disabled`/`required`) formda uyarı görünür.

Aynı kural kayıtlı ayar dosyası için de geçerlidir: `database.json` içinde `ssl_mode` alanı **yoksa** (bu alan eklenmeden önce yazılmış dosyalar) bu "seçim yapılmamış" sayılır. Yani uzak bir veritabanına işaret eden eski bir dosya artık şifresiz değil doğrulamalı bağlanır. Sunucunuz kendi imzalı sertifika kullanıyorsa bağlantı reddedilir; iki kurtarma yolu var ve ikisi de uygulama açılamıyorken çalışır:

- `.env` dosyasına `MYSQL_SSL_MODE=verify_ca` ve `MYSQL_SSL_CA=/yol/ca.pem` yazıp backend'i yeniden başlatmak (dosyada yazılı bir mod olmadığı için bu değer uygulanır).
- `backend/data/database.json` içine `"ssl_mode": "verify_ca"` ve `"ssl_ca": "/yol/ca.pem"` alanlarını eklemek.

Dosyada yazılı bir mod varsa ona dokunulmaz; onu değiştirmek için de aynı iki yol geçerlidir (ortam değişkeni yazılı modun önüne geçmez, yani bu durumda dosyayı düzenleyin). Panelden şifreleme modu ancak **başka** bir sunucuya taşırken seçilir; aynı sunucu için taşıma reddedilir.

Taşımada (ve kurulumda) kullanılan mod `database.json` dosyasına yazılır; yani taşımadan sonra uygulamanın canlı bağlantısı da aynı doğrulamayı yapar. Depodaki `docker-compose.yml` MySQL'e loopback üzerinden bağlandığı için `MYSQL_SSL_MODE` değerini boş bırakır: sunucu kuralı bu durumda `disabled` verir, ama boş bırakılması sayesinde uzak bir sunucuya geçtiğinizde doğrulama kendiliğinden devreye girer. Kendi imzalı sertifikalı özel bir sunucu için `.env` dosyanıza `MYSQL_SSL_MODE`/`MYSQL_SSL_CA` yazabilirsiniz.

MySQL kendi imzaladığı sertifikayla kurulmuşsa (varsayılan kurulumların çoğu böyle) `verify_identity` "sertifika doğrulanamadı" hatası verir. İki seçeneğiniz var: sunucudaki `ca.pem` dosyasını TamKobi sunucusuna kopyalayıp `verify_ca` modunda o dosyayı vermek (önerilen), ya da bağlantı zaten özel bir ağdan geçiyorsa bilerek `required` seçmek. Panel ve sihirbazdaki hata mesajı bu iki yolu da hatırlatır. Uzak bir veritabanına bu ayar olmadan geçerseniz uygulama açılışta bağlanamaz ve aynı mesajı günlüğe yazar; `MYSQL_SSL_MODE`'u (ya da `database.json` içindeki `ssl_mode` alanını) düzeltip yeniden başlatın.

Doğrulamasız bir modu bilerek seçtiyseniz ve veritabanı başka bir makinedeyse, günlüğe bir kez uyarı yazılır (`MySQL connection to ... is encrypted but unverified` / `is not encrypted`).

## Panelden taşıma

Platform Yönetimi → **Veritabanı** (`/sistem/veritabani`, yalnızca süper admin):

1. Üstteki kart şu an kullanılan sunucuyu, veritabanını, ayarın nereden geldiğini (kurulum dosyası veya ortam değişkeni) ve tablo satır sayılarını gösterir.
2. Hedef sunucu bilgilerini girip **Bağlantıyı test et**'e basın. Yetki varsa veritabanı yoksa oluşturulur; hedefte veri varsa uyarı çıkar.
3. **Verileri taşı ve buraya bağlan**. Kopyalama öncesi mevcut veritabanının yedeği `backend/data/backups` klasörüne yazılır (Docker'da bu klasör konteynere bağlı olduğu için yedek kalıcıdır), kopyalama sonrası satır sayıları karşılaştırılır ve doğrulama geçerse uygulama yeniden başlatmaya gerek kalmadan yeni veritabanına bağlanır.

Taşıma hedef şemadaki **tüm** tabloları silip yeniden oluşturduğu için, hedef ancak boş ve okunabilir olduğunda onaysız kabul edilir: içinde satır bulunan bir TamKobi kurulumu, TamKobi'ye ait olmayan tablolar (ör. başka bir uygulamanın tabloları) veya içeriği listelenemeyen bir şema için **üzerine yaz** kutusunu işaretlemeniz gerekir. Yetki eksikliği yüzünden hedefin içeriği okunamıyorsa taşıma boş varsayımıyla devam etmez.

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
| `--backup-dir DIR` | Yedek klasörünü değiştirir (varsayılan `backend/data/backups`, `MYSQL_BACKUP_DIR` ile de değişir) |
| `--ssl-mode` / `--ssl-ca` | TLS modu ve CA dosyası (başka bir sunucuda varsayılan `verify_identity`) |

Panelden taşımada çalışan API kendini yeni veritabanına bağlar; bu adım başarısız olursa veriler ve ayar yerinde kalır ve panel "backend'i yeniden başlatın" uyarısı gösterir. Komut satırından taşıdıktan sonra çalışan süreç zaten eski bağlantıyı kullanmaya devam eder; backend'i yeniden başlatın:

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

Taşıma öncesi yedek `backend/data/backups/tamkobi-YYYYMMDD-HHMMSS.json.gz` olarak durur. Eski sunucuya dönmek için `backend/data/database.json` dosyasını silin (veya eski bilgilerle panelden geri taşıyın) ve backend'i yeniden başlatın. Yedekten geri yükleme:

```bash
./scripts/mysql_restore.sh backend/data/backups/tamkobi-YYYYMMDD-HHMMSS.json.gz --yes
```

## Testler

```bash
python3 -m pytest backend/tests/test_db_relocate.py -q
```

Canlı test, mevcut veritabanını aynı sunucudaki `tamkobi_relocate_test` şemasına kopyalar, satır sayılarını karşılaştırır ve bağlantıyı değiştirmez; MySQL erişilemiyorsa veya veritabanı oluşturma yetkisi yoksa atlanır.
