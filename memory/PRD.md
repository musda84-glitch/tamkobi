# NexusHesap — CRM / ERP / Ön Muhasebe (bizimhesap.com benzeri, gelişmiş entegrasyonlu)

## Orijinal İstek
"bana bizimhesap.com gibi ama daha gelişmiş entegrasyonu iyi olan crm erp muhasebe programı yap"
- Modüller: Muhasebe, Banka, Stok, E-ticaret, Kargo, Sipariş/B2B, Personel, Depo, Üretim, Barkod
- Entegrasyonlar modül üzerinden kimlik bilgisi girilince otomatik bağlansın; AI finans danışmanı; çoklu şirket/kullanıcı; sade & şık UI
- Dil: Türkçe

## Mimari
React (CRA) + FastAPI + MongoDB. Tüm API `/api` öneki. Backend `server.py` (tek dosya, ~1950 satır), `models.py`, `auth_utils.py`, `ai_service.py`, `seed_data.py`, `storage_service.py` (Emergent Object Storage), `bank_providers.py`, `comm_service.py` (Netgsm + IMAP/SMTP).
Env: MONGO_URL, DB_NAME, JWT_SECRET, CORS_ORIGINS (açık origin listesi, `*` yok), EMERGENT_LLM_KEY, CREDENTIAL_ENCRYPTION_KEY (Fernet).

## Tamamlananlar
### İterasyon 1 (önceki)
- Auth (cookie JWT, çoklu şirket), Dashboard, Fatura/E-Fatura (simüle GİB), Cari, Banka/Kasa/POS + virman, Stok & barkod, E-ticaret & kargo modül ekranları (simüle), Sipariş/B2B, Depo, Üretim (BOM), Personel/bordro, AI danışman.
### İterasyon 2 (2026-09-03)
- **Stok kartı görselleri**: Emergent Object Storage'a yükleme (`POST /api/products/{id}/image`, `GET /api/files/{path}`), çoklu görsel, kapak seçimi, varyant görseli.
- **Varyant sistemi**: seçenekler (Renk/Beden…) → kombinasyon üretimi, varyant SKU/barkod otomatik, varyant stoğu toplamı; barkod okuyucu varyant eşleştirir; hızlı stok varyant bazlı.
- **Ortaklar Hesabı** (Banka sekmesi): ortak kartları (pay %), sermaye giriş/çıkış (kasa/banka hareketi oluşturur), kâr payı dağıtımı (hemen öde / tahakkuk).
- **Banka canlı veri altyapısı**: sağlayıcılar Kuveyt Türk API Market, Enpara/QNB, Finfree, Diğer (OAuth2 client-credentials). Kimlik bilgisi yoksa **SİMÜLE** hareket üretir. Sync + dedup + bakiye güncelleme, eşleştirme (cari/fatura), **öğrenen kurallar** (manuel eşleşme → kural), "Önceki Eşleşmelerle Otomatik İşle", kural yönetimi.
- **İletişim Merkezi** (/communication): Netgsm SMS (ayarlar şifreli, simüle mod, loglar, bakiye), IMAP/SMTP mail istemcisi (Outlook/O365/Gmail/Yandex/özel; klasörler, okuma, ek indirme, gönderme, yanıt, silme), toplu kampanya ({ad},{bakiye}); cari/fatura/sipariş ekranlarından hızlı SMS/e-posta.
- **Cari konum**: lat/lng + Google Maps linki, harita önizleme, "Konuma Git".
- Test: iteration_2 → backend 53/55, frontend %92; bulunan hatalar düzeltildi (kural upsert 500, seed telefonları GSM, CORS wildcard kaldırıldı, IMAP hata metni, mail hatası 424).

### İterasyon 3 (2026-09-03)
- **Cari detay paneli** (/contacts?contact_id=…): özet kartlar, Faturalar (taslak → "E-Faturaya Kes"), Ödemeler, Siparişler (+ sipariş detay modalı), İletişim geçmişi; fatura listesinde müşteri adına tıkla → cari paneli.
- **Barkodlu stok sayımı** (Depo > Stok Sayımı sekmesi; Stok sayfasında "Stok Sayımı" butonu): oturum, barkod okut (+1), manuel sayım, fark raporu, "Tamamla & Stoğu Güncelle".
- **Personel**: İzin talepleri (talep/onay/red, yıllık bakiye), Maaş hesaplama (brüt⇄net, 2026 yaklaşık SGK/GV/damga, işveren maliyeti), Prim / İkinci Maaş / Avans (GAYRİ RESMİ, kasadan ödeme opsiyonu).
- **Yeni fatura modalı**: aramalı cari seçici, aramalı ürün seçici (küçük görsel, SKU/barkod/stok/fiyat), "Kağıt Fatura (Matbu)" e-belge türü; invoice_number opsiyonel (422 hatası giderildi), hata detayı toast'ta.
- **Stok kartı**: "Düzenle" butonu (Genel & Barkod sekmesi: tüm alanlar + barkod düzenle/yeniden üret), +1/-1 kaldırıldı → Stok Sayımı butonu; "B2B'de göster" ve "Stok takibi" aç/kapa (tablo ve form); B2B portalı sadece B2B açık, hammadde/hizmet olmayan, fiyatı >0 ürünleri listeler.
- Test: iteration_3 → backend 27/27, frontend %92; bulunan hatalar düzeltildi.

### İterasyon 4 (2026-09-03)
- **Modül sıralama**: sol menüde sürükle-bırak + Firma Ayarları > Modül Sıralama (↑↓); kullanıcı tercihine kaydedilir (`PUT /api/auth/me/preferences`, /auth/me döner) + localStorage.
- **Firma Ayarları** (/settings): şirket bilgileri + logo (object storage), Form & Yazdırma şablonları (fatura/sipariş/teklif/irsaliye: başlık, renk, notlar, logo/imza/banka/ürün resmi), E-Fatura entegratörü (Foriba/eLogo/Uyumsoft/İzibiz/Diğer — SİMÜLE, şifre Fernet), SMS, Mail, Banka bağlantıları, E-ticaret/Kargo linkleri.
- **Yazdırma sistemi**: PrintDocument önizleme (Yazdır + Form Düzenle) fatura/sipariş/teklif; ürün resimleri sütunu; print CSS sadece belgeyi basar. **Kargo etiketi** (Siparişler → etiket ikonu: gönderici/alıcı, içerik, takip barkodu).
- **Teklif / Proje / Keşif** (/projects): teklif (aramalı ürün kalemleri, gönderildi/red, **tek tıkla faturaya çevir**, yazdır, görsel), proje (bütçe, durum, teklif özeti, görsel, teklif oluştur), keşif (ölçüler, konum linki/WhatsApp-Maps parse + "Konumum", görsel, **teklife çevir**). Belge no'ları per-yıl sayaç.
- **Cari detay**: Fatura/Sipariş modülü linkleri (filtreli), Yazdır butonları, Teklifler & Keşifler sekmeleri, İletişim'de WhatsApp görüşmeleri.
- **WhatsApp** sekmesi (İletişim): wa.me ile mesaj aç + giden/gelen görüşme kaydı (API yok, deep-link + log).
- **Fatura kalemi iskonto %**; **stok kartı**: KDV detayları (alış KDV, KDV dahil fiyat, istisna kodu), etiketler; sayfa adı "Stoklar & Ürünler", stok sayımı bu sayfaya sekme olarak taşındı; menü "Siparişler".
- Test: iteration_4 → backend 52/53, frontend %95; eksikler düzeltildi (preferences, teklif Form Düzenle, sayaç, modal kapanma).

### İterasyon 5 (2026-09-03)
- **E-ticaret detayları**: pazaryeri SKU ↔ stok kartı eşleştirme (+ eşleşmemiş liste), sipariş onayla + kargo firması seçimi, iade (stok geri, iade kaydı, `/api/returns`), **e-İrsaliye** oluştur & şablonlu yazdır (`POST /orders/{id}/create-dispatch`, IRS-YYYY-####).
- **Puantaj** (Personel > Puantaj): giriş/çıkış, devamsız, aylık özet (gün/saat/mesai); avans zaten Prim sekmesinde.
- **Mali Müşavir Paneli** (/accountant): aylık satış/alış/KDV beyanı (hesaplanan/indirilecek/ödenecek/devreden, oran dağılımı), kasa-banka, bordro, e-belge sayıları; fatura & hareket CSV dışa aktarma.
- **WhatsApp Business (Meta Cloud API)**: Ayarlar > WhatsApp (Phone Number ID + token şifreli, webhook verify), gelen mesaj webhook'u telefonla cariye eşler (boşluk toleranslı), gönderim API varsa gerçek yoksa **SİMÜLE** + wa.me; cari kartında ayrı WhatsApp sekmesi (numara eşleme, sohbet balonları).
- **Cari kart**: panel genişletildi (max-w-6xl), **Tahsilat Yap** (kasa/banka seçimi, tahsilat/ödeme), taslak fatura no'ya tıkla → düzenle (kalem/tür/vade), keserken belge türü seçimi (E-Fatura/E-Arşiv/Kağıt/İrsaliye), **Makbuz Yazdır** (tahsilat/tediye makbuzu).
- Fatura düzenleme: `PUT /api/invoices/{id}` (sadece taslak). Sipariş durumları tek sözlük: pending/approved/preparing/shipped/completed/returned/partially_returned.
- Test: iteration_5 → backend 21/22 (webhook eşleşme düzeltildi), frontend smoke %100; diğer aksiyonlar uygulandı.

## Bilinen Notlar
- Test sırasında kullanıcının bağladığı Gmail hesabı silindi → **yeniden bağlanmalı**.
- Gerçek banka/Netgsm anahtarı yok → simüle; anahtar girildiğinde aynı ekrandan canlıya geçer.
- `get_current_user` token yoksa demo admin'e düşüyor (demo kolaylığı; prod'da kaldırılmalı).
- Mail: Gmail/Outlook için uygulama şifresi gerekir; OAuth yok.

## Backlog (kullanıcı istekleri — öncelik sırası önerisi)
P0 (son mesajlardan, henüz yapılmadı):
e. **B2B portalı "ovocrm gibi"**: kullanıcıdan hangi özellikler netleştirilmeli (bayi girişi/fiyat listeleri/sipariş takibi/cari ekstre/kampanya?).
f. WhatsApp Cloud API gerçek anahtarla canlı test (kullanıcı henüz anahtar vermedi).
c. Personel "Netesnaf gibi": puantaj/mesai/avans yapıldı; kalan olası: bordro PDF, SGK bildirim, vardiya planı.
d. "Cari detaylarında 'Satıcılar' yazan yazı → 'Ödemeler'": ekranda "Satıcılar" metni bulunamadı — kullanıcıya hangi ekran olduğu sorulacak.
P0 (kullanıcının son mesajı):
4. **E-ticaret entegrasyonu detayları**: ürün eşleştirme (pazaryeri SKU ↔ stok kartı), iade yönetimi, sipariş onaylama & durum, kargo seçimi + etiket/barkod yazdırma.
5. **E-Fatura entegrasyonu & e-İrsaliye**: kullanıcı kararı: entegratör henüz yok → altyapı SİMÜLE kurulacak, anahtar gelince bağlanacak; e-İrsaliye belgesi.
P1:
6. E-ticaret sync / sipariş→fatura akışında sabit cnt_01 yerine gerçek cari eşleme (server.py ~2033/2197).
7. WhatsApp Business API (gerçek mesaj alma/gönderme) — anahtar gerekir.
7. Gerçek banka API anahtarları girildiğinde canlı test; Netgsm canlı test.
P2: server.py router'lara bölme, gerçek auth zorunluluğu, raporlama, yetkilendirme.

## Test Kimlikleri
/app/memory/test_credentials.md


## Faz 6–8 (Haziran 2026) — Tamamlanan (test agent iteration 6/7/8/9 ile doğrulandı)
- Faturalar: satır sağ tık / ⋮ bağlam menüsü (E-Fatura / E-Arşiv / Kağıt olarak kes, görüntüle, yazdır, bildirim, tahsilat, taksitlendir); işlem sütunu sabit 6 slot; cari filtre çipi; GİB'den VKN ile cari çağırma (SİMÜLE, `GET /gib/lookup`); satır + genel iskonto (% / ₺); kesilmiş faturada yalnızca vade/not düzenlenebilir.
- Taksit modülü: `db.installments`; fatura taksitleri, teklif ödeme planı (faturaya dönüşürken taşınır), açık bakiye taksitlendirme (`/contacts/{id}/installments`), `/installments` sayfası (özet, filtreler, hatırlatma), ödeme kasa/banka/POS/ortak ile (`partner_id`).
- Cari kartı: Vade Uygula (`payment_term_days`, `late_fee_rate`, yaşlandırma `GET /contacts/{id}/aging`), ödeme düzenle/sil (bank_sync/partner kilitli — `PUT/DELETE /banking/transactions/{id}`), teklif düzenle, keşif detayı, Taksitler sekmesi, fatura satırında sağ tık; ekstre paylaşımı (Yazdır/PDF, mail, SMS, WhatsApp, kopyala) ve fatura+ödeme birleşik ekstre.
- Cari listesi finansal filtreler: bize borçlu / bize alacaklı / vadesi geçen / 7 gün içinde taksit ödemesi gelen / bakiyesi sıfır (`GET /contacts/flags`).
- Teklif onay sistemi: `POST /quotes/{id}/send-approval` (sms/email/whatsapp), public `/teklif/:token` sayfası (`GET/POST /public/quotes/{token}`), bildirimler (`/notifications`, zil).
- Üretim & Reçete yenilendi: BOM (fire %, işçilik, genel gider, birim maliyet), ihtiyaç/eksik analizi, kısmi tamamlama (fire hammadde tüketir), `DELETE /production/orders/{id}`; stok kartından "Üretim Emri Ver"; kategoriler (`/products/categories`, sadece filtre).
- Atölye / tablet ekranı `/atolye`: reçete adımları → iş emirleri (`/production/work-orders` start/pause/finish/assign), operatör seçimi (localStorage), istasyon filtresi, kiosk modu, son adım bitince stok işlenir.
- Diğer: barkod etiketi (jsbarcode + QR, 5 boyut, etiketler/ek satır), yazdırma şablonu seçimi (classic/modern/minimal/bold), banka hesabına tıkla → hareket filtresi, sipariş onayında kargo firması entegrasyon listesinden, Türkçe durum etiketleri (`utils/labels.js`), Ayarlar sol menü, SMS log düzeni, "Faturalar" menü adı, "Taksitler" ve "Üretim Ekranı (Atölye)" menüleri.

## Bekleyen büyük istekler (kullanıcı sırası: 1→2→3→4→5)
1. Raporlar modülü (OVOCRM gibi: satış/alış, cari yaşlandırma, stok, nakit akışı, KDV, kârlılık; tarih filtresi; Excel/PDF)
2. B2B müşteri portalı (OVOCRM gibi: müşteri girişi, özel fiyat listesi, sepet, sipariş, sipariş takibi, ekstre)
3. Üretim iş emirleri — TEMEL TAMAMLANDI (Faz 8); geliştirme: personel bazlı performans raporu, barkodla iş emri açma
4. Kargo pazaryerleri (Navlungo, Geliver, Kolay Kargo, BasitKargo) entegrasyon kartları + API ayarları
5. E-ticaret modülünü en gelişmiş sistemlere göre güncelleme (araştırma)
6. Personel modülünü Netesnaf ile birebir yapma
Notlar: WhatsApp Business Cloud API, e-İrsaliye entegratör, canlı banka, pazaryeri/kargo/e-fatura sağlayıcı bağlantıları hâlâ SİMÜLE; aktif şirket başlığı "MATEK DEKORASYON" görünürken listeler comp_nexus_main_01 sorguluyor (bilinen tutarsızlık).


## Faz 9 (Haziran 2026) — Tamamlanan (iteration 10/11 ile doğrulandı, bulgular düzeltildi)
- **Raporlar** `/reports` (`GET /reports/{sales|purchases|aging|stock|cashflow|vat|profit}`; cari/ürün/ay gruplama, tarih presetleri, Excel(CSV)/PDF).
- **B2B müşteri portalı** `/portal/:token` (public; `POST /contacts/{id}/b2b-access`, `GET/POST /public/b2b/{token}[/orders]`): özel indirimli fiyat, sepet (localStorage), sipariş → Siparişler modülü + bildirim, sipariş/kargo takip, ekstre, taksitler. Cari kartında "B2B Portal" butonu.
- **Kargo kataloğu**: Navlungo, Geliver, Kolay Kargo, BasitKargo, Kargom Sende + firmalar (`GET /integrations/cargo/catalog`, `POST/DELETE /integrations/cargo`, db.cargo_configs).
- **Atölye performans** paneli (`GET /production/work-orders/performance`).
- **Siparişler**: toplu seçim (onayla / fatura kes / kargo etiketleri), satırda "Faturala ▾" ile E-Fatura/E-Arşiv/Kağıt seçimi, `DELETE /orders/{id}`, sipariş→fatura cari eşlemesi (customer_name → cari, yoksa oluşturur).
- **Birimler & Kategoriler** ayarı (Firma Ayarları → Birimler & Kategoriler; `/products/units` CRUD + yeniden adlandırma; stok formlarında datalist).

## TALİMAT DENETİMİ (kullanıcının tüm istekleri — durum)
| İstek | Durum |
|---|---|
| Fatura sağ tık ile kesim türü seçimi | ✅ |
| Banka hesabına tıkla → hareketler | ✅ |
| Barkod yazdırma (OVOCRM gibi, resimli, QR, 100x30, etiketler) | ✅ |
| Gönderilen teklif/keşifler modülden gizlensin | ✅ |
| Ayarlar sol menü | ✅ |
| Taksit modülü (satış/alış fatura + teklif) | ✅ |
| SMS log daralt / mesaj aşağı | ✅ |
| Ödeme seçiminde ortaklar + POS | ✅ |
| Yazdırmada şablon seçme | ✅ |
| GİB'den VKN ile cari çağırma | ✅ (SİMÜLE) |
| Satır + genel iskonto | ✅ |
| Menü adı "Faturalar" | ✅ |
| Durumları Türkçeleştir | ✅ (ana ekranlar) |
| Sipariş onayında kargo entegrasyondan | ✅ |
| Cari: teklif düzenle, fatura düzenle, ödeme sil/düzenle, keşif detayı, butonları kaldır | ✅ |
| Ekstre paylaşım + yazdır + ödemeler | ✅ |
| Cariye vade uygula / bakiyeyi taksitlendir / taksitler sekmesi / fatura sağ tık | ✅ |
| Teklif onayı (mail/SMS/WhatsApp) | ✅ |
| Üretim & reçete + stok kartından üretim emri | ✅ |
| Kategori filtresi (sadece filtre) | ✅ |
| Gelişmiş sayım depo sayfasında | ✅ |
| Atölye tablet ekranı | ✅ |
| Cari filtreleri (borçlu/alacaklı/vadesi geçen/taksit) | ✅ |
| Raporlar, B2B portal, kargo pazaryerleri, atölye performans | ✅ |
| Birimler çoğalt/sil/düzenle (Firmam) | ✅ |
| Sipariş satırında fatura kes + onayla + tür seçimi | ✅ |
| **Personel modülünü Netesnaf gibi yap** | ⏳ Bekliyor |
| **E-ticaret modülünü en gelişmiş sisteme göre güncelle** (+ **ShopPHP** pazaryeri) | ⏳ Bekliyor |
| **Sipariş kargo verisi pazaryerinden otomatik gelsin** | ⏳ Bekliyor (gerçek pazaryeri API gerektirir) |
| **B2B ayarları Firma Ayarları içinde (özellikler, giriş yöntemi)** | ✅ Firma Ayarları → B2B Portal (`GET/PUT /companies/{id}/b2b-settings`; özellik anahtarları, giriş yöntemi seçimi [link aktif; PIN/şifre "yakında"], varsayılan indirim, min sipariş, müşteri erişim listesi). Self-test (curl + ekran); test agent koşulmadı. |
| **Kasaları silme/düzenleme** | ⏳ Bekliyor |
| **AI ile PDF içeri/dışarı aktarma (OVOCRM gibi)** | ✅ PDF→alış faturası (it13); listelerde tek tık Excel/PDF dışa aktarma ⏳ |
| **Personel kartı + detay + personelden kullanıcı açma** | ✅ (it13) |
| **OVOCRM kullanıcı modülü ve ayarları (roller, yetkiler)** | ✅ (it13) — UI'da view/edit ayrımı sadece menü+backend 403; sayfa içi butonlar henüz gizlenmiyor |
| **Diğer yazılımlardaki kolaylaştırıcı özellikler** | ⏳ Kapsam netleştirilecek |
| Sağlayıcı canlı bağlantıları (WhatsApp, banka, e-fatura, pazaryeri, kargo) | SİMÜLE — kullanıcı API anahtarı gerekir |

## İterasyon 12 (Haziran 2026) — Kod kalitesi / güvenlik (test agent iteration_12: backend 75/75, frontend %100)
- Test secret'ları: `backend/tests/conftest.py` (TEST_COMPANY_ID / TEST_B2B_TOKEN env, yoksa API'den dinamik); test_iteration10/11 buradan okur; it11 autouse cleanup fixture (sızıntı yok).
- `bank_providers.py`: MD5/SHA1 → SHA256 (simülasyon seed/ID), `mode=="simulation"` bağlantılar canlı OAuth'a gitmez.
- 44 `react-hooks/exhaustive-deps` uyarısı → 0 (load fonksiyonları `useCallback`, doğru bağımlılıklar; eslint-disable yok). Lint komutu: `npx eslint -c /tmp/eslint.config.mjs src` (flat config react-hooks plugin).
- Rapor yanlış pozitifleri: CargoPage:95 (etiket metni), B2BPortalPage localStorage (yalnızca sepet) — kullanıcı kararı: localStorage kalsın.
- Kullanıcı kararı: refactor (ContactDetailPanel/seed_all_data/büyük sayfalar bölme, index-key, useMemo) **ertelendi** (kapsam "sadece 1–2").
- Siparişler: onay butonu başlığı "Onayla".
- Kullanıcı Geliver API örneği paylaştı (`POST https://api.geliver.io/api/v1/shipments`, Bearer token, senderAddressID, recipientAddress, order) → gerçek Geliver kargo entegrasyonu istiyor olabilir; **integration_expert + kullanıcıdan Bearer token/senderAddressID gerekir**.

## İterasyon 13 (Haziran 2026) — 4 özellik (test agent iteration_13: backend 32/33 → bulgu düzeltildi, frontend %92 → 3 bulgu düzeltildi)
- **Geliver canlı kargo** (`cargo_providers.py`): katalogda geliver fields api_key+sender_address_id, `test_mode` (varsayılan açık); `POST /integrations/cargo/{id}/test` (adresleri getirir), `POST /cargo/create-shipment` geliver+token varsa canlı (shipment → offers.cheapest → accept-offer → tracking/label), `POST /cargo/shipments/{id}/refresh`; token şifreli, listede maskeli; `CargoConfigModal.jsx`. Kullanıcı token'ı henüz girmedi (dummy ile 400 doğrulandı).
- **Kullanıcılar & Roller** (`rbac.py`): db.roles (6 sistem rolü + özel), modül yetki matrisi none/view/edit, `PermissionAndAuditMiddleware` (admin olmayan token'lı kullanıcıda edit yoksa 403 + db.activity_logs), davet (`/users/invite` → SMTP varsa mail, `/davet/:token`), `/login`, `/auth/me` → role_name+permissions, menü filtresi + access-denied, `UsersRolesPanel.jsx`. Ayarlar sekmesi "Kullanıcılar & Roller".
- **Personel Kartı** (`EmployeeCardModal.jsx`, `GET /personnel/employees/{id}/card`, `POST .../create-user`, `DELETE /files/{id}`): özet, belgeler (object storage), maaş geçmişi, izin bakiyesi, puantaj, sistem kullanıcısı (davet/şifre; çift kullanıcı engeli).
- **AI PDF Aktarım** (`ai_service.extract_invoice_from_text` Claude Sonnet 4.6, pypdf): `POST /ai/invoice-extract` (PDF → JSON taslak, cari/ürün eşleme, PDF object storage), `POST /ai/invoice-extract/confirm` → taslak alış faturası (+ yeni tedarikçi). `AiInvoiceImportModal.jsx`, Faturalar'da "PDF'den Aktar (AI)". Taranmış (metinsiz) PDF desteklenmez.
- Teklif/Proje/Keşif formunda "+ Yeni cari aç" (inline cari oluştur & seç).
- Lint: `npx eslint -c /app/memory/eslint.hooks.config.mjs src` → 0 hook uyarısı.

## SIRADAKİ FAZ
1. **Kullanıcı & Roller (OVOCRM tarzı)** — Firma Ayarları içinde: kullanıcı listesi, roller (yönetici/muhasebe/satış/depo/üretim/mali müşavir), modül bazlı yetki matrisi, e-posta ile davet (mail hesabı üzerinden link), kullanıcı bazlı işlem günlüğü. ⚠ Auth değişikliği → önce `integration_expert` (JWT auth playbook) çağrılmalı; mevcut `auth_utils.py`, `/auth/*`, `AuthContext.jsx` incelenmeli; `menuItems` yetkiye göre filtrelenmeli.
2. **Personel Kartı** — `/personnel` içinde detay modalı: belgeler (upload), maaş geçmişi (payroll kayıtları), izin bakiyesi, puantaj özeti, "Sistem kullanıcısı oluştur" (1. maddeye bağlı: employee_id ↔ user).
3. **AI PDF Aktarım** — tedarikçi PDF faturasını yükle → LLM (Emergent key, `integration_expert` ile OpenAI/Gemini playbook) satırları/cari/tutarları çıkarır → taslak alış faturası; tüm listelerde tek tık Excel/PDF (Raporlar'daki CSV/print yaklaşımı yeniden kullanılabilir).
