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

## İterasyon 14 (Haziran 2026) — UI iyileştirmeleri + yeni modüller (test agent iteration_14: backend 7/7, frontend %100)
- **Masraflar modülü** (`backend/expenses.py`, `/expenses`, `ExpensesPage.jsx`): kategori (15 varsayılan + özel), KDV dahil/hariç, kasa/banka ile öde/geri al, tedarikçi/personel bağlama, fiş yükleme, aylık tekrarlayan masraf (`run-recurring`), kategori dağılımı; kâr raporunda `expenses`/`net_profit`.
- **İrsaliyeler modülü** (`/dispatches`, menü + rbac): faturadan irsaliye (`POST /invoices/{id}/create-dispatch`), irsaliyeden fatura (`POST /invoices/{id}/convert-to-invoice`), Yeni İrsaliye (invoice_type dispatch, IRS-…, KDV'siz). Liste `type=all` irsaliye içermez.
- Fatura listesi: `InvoiceToolbar` (arama, ödeme/belge türü/tarih/tutar filtreleri, sıralama), `SourceBadge` (kaynak: Kullanıcı/B2B/Trendyol/GİB/AI PDF…), Yeni Fatura modalı geniş + `QuickContactForm` hızlı cari, `/invoices?new=sales|purchase&contact_id=` ön dolu.
- Cariler: `ContactRow` yatay liste, finans filtresi select; cari kartı ortada modal + Esc; üst bar Satış Yap / Alış Yap / Tahsilat + ikon grubu; Faturalar tablosu `SortableColumns` (sırala + sürükle-bırak, localStorage).
- Stok: `StockToolbar` (kategori/stok durumu/B2B/sıralama select'leri, stok değeri); işlem butonları sabit grid hizası.
- Siparişler: `OrdersToolbar` (arama, durum, kanal, fatura/kargo durumu, tarih, sıralama).
- Banka → Ortaklar: `PartnerTxTable` sıralama + satır içi düzenle/sil (`PUT/DELETE /banking/partners/transactions/{id}`, bakiyeler geri alınır; bank_transactions.partner_tx_id).
- Personel: bordro satırında **Avans** / **Masraf** (`QuickPayModal`, Esc; masraf → Masraflar modülüne bağlı: kayıtlı masrafı öde veya yeni masraf), **Konumla Giriş/Çıkış** (`GeoAttendanceCard`; `PUT /companies/{id}/location` firma konumu 300 m yarıçap; `POST /personnel/attendance/geo` haversine kontrol, kullanıcı→personel kartı bağı gerekir; `GET .../geo-status`). Demo firma konumu İstanbul (41.0082, 28.9784) olarak sabitlendi — kullanıcı "Firma Konumunu Güncelle" ile değiştirmeli.
- Teklif formunda "+ Yeni cari aç".

## İterasyon 15–16 (Haziran 2026)
- it15 (test agent): masraf bütçeleri (`BudgetPanel`), dashboard `OverviewPanel` (`GET /dashboard/overview`), Krediler `/loans` (`finance.py`, AI PDF ödeme planı), kredi kartı hesabı + `CardStatementImport`. Sonrası küçük düzeltmeler (hesap silme, boş ekstre mesajı, DOM nesting) — retest bekliyor.
- **Firma Konumu paneli** (`CompanyLocationPanel.jsx`) Firma Ayarları → Şirket Bilgileri altına bağlandı: adres ara (`GET /geocode`, Nominatim) → sonuç seç → `PUT /companies/{id}/location`; "Konumumu Bul" (GPS); yarıçap. Self-test: e2e ekran + geo-status doğrulandı (kullanıcı onayı bekliyor).
- Açık: `ExportButtons.jsx` tüm liste ekranlarına (Faturalar, Cariler, Siparişler, Masraflar) bağlanması teyit edilmeli; roller için kullanıcının istediği özel rol seti netleştirilmeli; personel bordro `2099-01` dönemi incelenmeli.

## İterasyon 16–17 (Haziran 2026) — test ajanı: 16 ✅ 35/35, 17 ✅ 22/22
- **Banka entegrasyonu gelişmiş**: entegre (bank_connections.linked_account_id) hesaplara manuel gelir/gider/virman/ödeme engeli (`bank_guard.py`, expenses/finance/personel/fatura ödemeleri dahil); `GET /banking/accounts` → `is_integrated`; BankingPage ENTEGRE rozeti + virman filtreleri. Gelişmiş eşleme (`BankMatchRow.jsx`): cari / cari+açık fatura / kasa-hesap virman (karşı hareket `source=bank_match`) / kategori; `learn` ile kural (target_account_id dahil); `POST /banking/transactions/{id}/unmatch`; `GET /banking/transactions/matched` (matched_via: manual/rule/auto/suggestion). Bağlantı kartında **Otomatik İşle** toggle (`auto_match`) → sync'te `_auto_match_by_rules`.
- **Özel roller**: şablondan kopyala, rol adı değiştir, Tümü Yok/Görüntüle/Düzenle hızlı butonlar (`UsersRolesPanel.jsx`).
- **Konum haritası**: `LocationMap.jsx` (leaflet 1.9, OSM tile) marker + yarıçap dairesi, haritaya tıkla → "Bu noktayı kaydet".
- **Puantaj self-servis** (`attendance.py`, `/mesai` → `MyAttendancePage.jsx`): firma mesai saatleri (`GET/PUT /companies/{id}/work-schedule`, tz Europe/Istanbul), personel bazlı override (`employees.work_schedule`), `compute_day` → hours/normal/overtime/late/early_leave/is_off_day (bitiş sonrası çıkış + tatil günü = fazla mesai), `POST /personnel/attendance/self` (konum zorunlu ise 300 m), `/{id}/confirm`, `/{id}/dispute` (bildirim), RBAC skip. Puantaj sekmesi: `WorkScheduleSettings`, `EmployeeScheduleModal`, F. Mesai/Geç/Onaysız sütunları; PersonnelPage `?tab=` URL senkron.
- Excel/PDF export: `ExportButtons` zaten Faturalar/Cariler/Siparişler/Masraflar/Stok/Krediler'de — test ajanıyla doğrulandı.
- Temizlik: test artığı `2099-01` bordrolar silindi.
- Açık: `input type=time` tarayıcı locale'inde 12 saat gösterebilir (kozmetik); `server.py` 4300+ satır (modüllere bölme borcu sürüyor).

## İterasyon 18 (Haziran 2026) — test ajanı ✅ 20/20 backend, 6/6 frontend
- **Fazla mesai ücreti bordroya**: `attendance.overtime_rate` (yasal: bordro brüt/225 × 1,5, tatil × 2; sabit: personel saatlik ücreti), `overtime_pay_for_period`, `GET /personnel/overtime-preview`; `generate_payroll` upsert (mükerrer yok) + `overtime_pay`, `second_salary`, `final_payable = net + mesai + 2. maaş + prim − kesinti − avans`; Puantaj tablosunda "Mesai ₺", bordro satırında breakdown.
- **Personel ücretleri**: `payroll_salary` (brüt), `salary` (net), `second_salary`, `overtime_method`, `overtime_hourly_rate` — Personel Kartı → "Ücret & Mesai" sekmesi (`EmployeeCompensationForm`). `PUT /personnel/employees/{id}` whitelist + sayısal doğrulama.
- **Gün gün mesai**: `work_schedule.days{"0".."6": {start,end,break_minutes}}` firma + personel override (`DaySchedule` tablosu), `day_window()`.
- **Puantaj bildirimi**: `watcher_loop` (60 sn) → mesai başlangıcı+tolerans sonrası giriş yapmayanlar (günde 1 kez, `attendance_alerts` dedupe), geç girişte anlık bildirim; SMTP varsa yöneticilere e-posta; `POST /personnel/attendance/run-alerts` (admin). Ayarlar: `notify_missing_checkin`, `notify_late_checkin`.
- **Banka kural önerisi**: `GET /banking/match-rule-suggestions` (aynı kalıpla ≥2 eşleşme, kural yoksa), `POST .../accept` (kural + bekleyenleri uygula); BankConnectionsPanel öneri kutusu.
- **Mobil Mesaim**: büyük saat + 2 sütun büyük Giriş/Çıkış butonları, yatay taşma yok.

## İterasyon 19–21 (Haziran 2026) — test ajanı ✅ (it19 95% → düzeltildi, it20 20/20+UI, it21 hepsi geçti)
- **B2B müşteri portalı mobil** (`B2BPortalParts.jsx`): dikey header, 4'lü grid sekmeler, yatay kaydırmalı kategoriler, mobilde sabit alt sepet çubuğu + açılır sepet paneli (`-mobile` testid soneki), sipariş/ekstre mobil kart listesi, `n/a` → Ödenmedi. B2B/ORD sipariş no atomik sayaç (`_next_order_number`, mükerrer engeli), `Order.order_number` Optional.
- **Kamera barkod** (`CameraScanner.jsx`, html5-qrcode): sürekli okuma, bip/titreşim, kamera değiştir, flaş, izin hatası mesajı. Bağlandı: Stok sayımı (sürekli), Barkod Okuyucu modalı, Ürün formu barkod alanı, Fatura "Barkodla Ekle", üst bar hızlı okut (mobilde görünür). craco `ignoreWarnings` source-map uyarıları.
- **İzin talebi Mesaim'den** (`MyLeavePanel.jsx`; `GET /personnel/leaves/me`, `POST/DELETE /personnel/leaves/self`): bakiye − bekleyen, çakışma engeli, yöneticiye bildirim.
- **Bordro PDF** (`utils/payslip.js` → yazdır penceresi): brüt/net/mesai kırılımı/2. maaş/prim/kesinti/avans/ödenecek, imza alanları.
- **Haftalık Vardiya Planı** (`ShiftPlanner.jsx`; `shift_plans`, `GET/PUT/DELETE /personnel/shifts`, `copy-week`): hücre bazlı saat/izin; puantaj ve giriş-yok bildirimi plana göre hesaplar (`schedule_snapshot.from_shift_plan`).
- Dashboard grafik konteynerlerine sabit yükseklik (mobil Recharts uyarısı giderildi).

## İterasyon 22 (Haziran 2026) — test ajanı ✅ 3/3 backend, 2/2 frontend
- **Portal sipariş takibi**: `_b2b_tracking` (PUBLIC_TRACKING_URLS kargo firması takip linkleri, SHIPMENT_STEPS adım çubuğu, ETA = shipment.estimated_delivery ya da kargolanma+3 gün, is_late) → `TrackingCard` (mobil + masaüstü).
- **Vardiya-izin çakışma uyarısı**: `get_shifts` hücrelerde `leave`/`conflict`, `conflicts` sayısı; `put_shifts` `warnings`; ShiftPlanner turuncu hücre + ikon + banner + editör uyarısı.

## İterasyon 23 (Haziran 2026) — test ajanı ✅ 10/10 backend, UI geçti
- **Vardiya toplu atama**: `shift_templates` CRUD, `POST /personnel/shifts/bulk-assign` (departman/all/employee_ids, template_id veya days, skip_leave, overwrite, conflicts) → `BulkAssignModal.jsx` (ShiftPlanner "Toplu Ata").

## SIRADAKİ FAZ
1. **Kullanıcı & Roller (OVOCRM tarzı)** — Firma Ayarları içinde: kullanıcı listesi, roller (yönetici/muhasebe/satış/depo/üretim/mali müşavir), modül bazlı yetki matrisi, e-posta ile davet (mail hesabı üzerinden link), kullanıcı bazlı işlem günlüğü. ⚠ Auth değişikliği → önce `integration_expert` (JWT auth playbook) çağrılmalı; mevcut `auth_utils.py`, `/auth/*`, `AuthContext.jsx` incelenmeli; `menuItems` yetkiye göre filtrelenmeli.
2. **Personel Kartı** — `/personnel` içinde detay modalı: belgeler (upload), maaş geçmişi (payroll kayıtları), izin bakiyesi, puantaj özeti, "Sistem kullanıcısı oluştur" (1. maddeye bağlı: employee_id ↔ user).
3. **AI PDF Aktarım** — tedarikçi PDF faturasını yükle → LLM (Emergent key, `integration_expert` ile OpenAI/Gemini playbook) satırları/cari/tutarları çıkarır → taslak alış faturası; tüm listelerde tek tık Excel/PDF (Raporlar'daki CSV/print yaklaşımı yeniden kullanılabilir).

## İterasyon 27–28 (Eylül 2026) — test ajanı ✅ it27 backend 7/7 + UI; it28 backend 10/10 + UI
- **Stok → Pazaryeri Ürün Kârlılığı & Eşleştirme** (`ProductProfitPanel.jsx`; `GET /marketplace/product-profitability`, `POST /marketplace/product-match`, `POST /marketplace/product-create` = eşleşmeyen pazaryeri ürününden stok kartı aç + otomatik eşle).
- **Çöp Kutusu** (`trash.py`, `/trash`, menü "Çöp Kutusu", rbac modülü `/trash` ← `/settings` yetkisi): cari/ürün/sipariş/teklif/proje/keşif/masraf/kredi/banka hareketi/banka hesabı/ortak/ortak hareketi/izin/prim/reçete/üretim emri(+iş emirleri)/sayım/vardiya/şablon silinince `db.trash` (30 gün). `GET /trash`, `GET /trash/{id}`, `POST /trash/{id}/restore` (hook'lar: banka hareketi/ortak hareketi/izin/prim/masraf bakiyeleri yeniden uygulanır, reçete has_recipe), `DELETE /trash/{id}`, `POST /trash/empty`.
- **Siparişte otomatik cari** (`_ensure_order_contact`: ad/telefon/e-posta/VKN ile bul, yoksa "Trendyol Müşterisi" vb. kategoriyle aç; sync + POST /orders + faturalamada; `POST /orders/auto-contacts` backfill, Siparişler'de "Carileri Eşle").
- **Pazaryeri hakediş hesabı** (`PUT /integrations/ecommerce/{id}/settlement-account`; entegre hesap seçilemez): sipariş faturalanınca net (ciro − komisyon − kom.KDV − hizmet − kargo) hesaba `source=marketplace_settlement` tahsilat, kesintiler "Pazaryeri Komisyonu" masrafı (`netted_in_settlement`, ayrı kasa çıkışı yok), `order.settlement`; kârlılık panelinde kanal kartında hesap seçimi + hakediş özeti.
- **Siparişler**: pazaryeri siparişlerinde durum salt-okunur rozet (marketplace_status), "Yeni Sipariş" modalı (`OrderCreateModals.jsx`), **AI ile Sipariş Yükle** (PDF/Excel/CSV → `POST /ai/order-extract` Claude Sonnet 4.6 → onay `POST /ai/order-extract/confirm`), **Ürünler & Fiyat** sekmesi (`MarketplaceProductsPanel.jsx`; `GET /marketplace/products` canlı Trendyol ürün listesi + önbellek `marketplace_product_cache`, eşleşme/Kart Aç, toplu stok, stok kaynağı Pazaryeri/Stok Kartı, `POST /marketplace/products/push` → Trendyol price-and-inventory). /orders ve /stock genişliği 1680px.
- **Veri Aktarım Merkezi** (`migration.py`, Firma Ayarları → Veri Aktarımı, `MigrationPanel.jsx`): kaynaklar (BizimHesap/Paraşüt/Logo İşbaşı/Mikro/OVOCRM/Netesnaf/Diğer), veri türleri cariler/ürünler/faturalar/banka-kasa/personel; `GET /migration/sources`, `GET /migration/template/{entity}`, `POST /migration/parse` (xlsx/csv, başlık otomatik, Türkçe sayı/tarih), `POST /migration/preview`, `POST /migration/import` (on_duplicate skip/update, parti kaydı), `GET /migration/batches`, `.../errors.csv`, `POST .../rollback`. **BizimHesap API** (yalnızca ürün/depo/stok — resmi API kapsamı): `GET/PUT /migration/bizimhesap/config` (token Fernet), `POST .../test`, `POST .../import`. Kullanıcı token'ını henüz UI'dan girmedi.
- Kullanıcı kabulü bekleyen: tüm bu özellikler agent-tested.

## İterasyon 29 ✅ (backend 8/8, UI %100) — **Barkod Etiket Tasarımcısı** TAMAMLANDI (`LabelDesigner.jsx`, Stok → "Etiket Tasarımı"; `GET/POST/PUT/DELETE /label-templates`; varsayılan şablon "Etiket 100×50" DB'de). Özellikler: sürükle-bırak tuval (100×30, 100×50, 50×30, 60×40, 100×150 + özel, mm ızgara), öğeler (EAN13/Code128/QR barkod, ürün adı, fiyat KDV dahil/hariç, SKU, varyant, kategori, firma adı/logo, serbest metin, çizgi/kutu, ürün görseli), font/boyut/kalın/hizalama/döndürme/katman, şablon kaydet/varsayılan/kopyala, seçili ürünlere toplu yazdır (termal rulo veya A4 sütun/satır), gerçek ürün verisiyle canlı önizleme. Mevcut `BarcodeLabelPrint.jsx` + jsbarcode/QR altyapısı yeniden kullanılmalı.

- Kullanıcıdan bekleyen canlı doğrulamalar: BizimHesap token girişi + "Bağlantıyı Test Et" (Firma Ayarları → Veri Aktarımı); Trendyol tek ürün fiyat push denemesi (Siparişler → Ürünler & Fiyat).

## İterasyon 30–32 (Eylül 2026) ✅ test ajanı: it30 11/11+13/13, it31 geçti (dashboard mask fix sonrası), it32 10/10
- **BizimHesap canlı aktarım TAMAM**: gerçek token ile 2005 ürün okundu → 1843 yeni stok kartı, 162 güncellendi, Ana Depo'dan 1189 stok kaydı (parti `migration_batches`, UI'dan geri alınabilir). Zarf `{resultCode,errorText,data:{products}}` çözümü, /products 15 dk önbellek (`migration_api_cache`), 429 mesajı. Alanlar: id,title,code,barcode,price,buyingPrice,tax,unit,category,brand,photo,variantName,quantity; envanter id/barcode/qty.
- **Excel aktarımında AI sütun eşleme** (`POST /migration/ai-map`, Claude; "AI ile Eşle" butonu).
- **Kanal kataloğu** (BizimHesap ile aynı 69 kanal; `GET /integrations/ecommerce/catalog`, `POST .../add-channel`, `DELETE /integrations/ecommerce/{id}`; UI "Kanal Ekle"). Kanal ayar modalında **Ödeme/Hakediş Hesabı** seçimi.
- **ShopPHP canlı XML entegrasyonu** (kullanıcının mağazası willhome.com.tr, `ecom_shopphp`): `xml.php?c=siparisler|shopphp|alter&xmlc=…` — alanlara kod ya da tam URL yapıştırılabilir (`shopphp_resolve` c= tipine göre ayırır; rss beslemesi kullanılmaz). Sipariş sync (2 gerçek sipariş, otomatik cari), ürün/varyasyon XML (29 satır, 20 eşleşti), test-connection sayaçlı mesaj. Fiyat/stok gönderimi XML'de yok (salt-okunur); REST istemcisi (`ShopPHPClient`) hazır ama devre dışı.
- **Ürünler & Fiyat sekmesi**: kanal seçici (Trendyol/ShopPHP), OVOCRM benzeri tablo, toplu stok, stok kaynağı, Trendyol push + **Gönderim Geçmişi** (`GET /marketplace/push-logs?check=true` → batch-requests durumu). Kullanıcı henüz gerçek push denemedi.
- **Rol özellik yetkileri** (`rbac.FEATURES`): fiyat/tutar görünürlüğü (kapalıysa GET yanıtlarında `MONEY_KEYS` maskelenir → 0, `X-Prices-Masked`), üst bar hızlı işlemler (barkod/virman/fatura/AI). UI: Roller → "Özellik Yetkileri"; MainLayout banner + gizli butonlar.
- **Siparişler**: sıralanabilir başlıklar, sabit slotlu işlem sütunu; **Stok satırında "Etiket Yazdır"** (varsayılan şablon, ürün ön seçili).
- Bilinen kozmetik: `<span>` içinde `<option>` React uyarısı (Ürünler & Fiyat eşleştirme select'i) — davranışı etkilemez.
- İt33 ✅ (11/11 + UI): **ShopPHP sipariş geri bildirimi** (REST `updateOrder/no/{no}`: sdurum, kargoFirma, kargoSeriNo, faturaNo). `PUT /integrations/ecommerce/{id}/rest-credentials` (parola Fernet), `POST .../rest-test`, `POST /orders/{id}/push-shopphp`; onay/durum/fatura/kargo hook'ları otomatik (creds yoksa sessiz). UI: ShopPHP Ayarlar → "Mağazaya Geri Bildirim"; sipariş satırında "Mağazaya Bildir". Kullanıcı REST kullanıcı bilgilerini henüz girmedi (ShopPHP panelinde REST API açılmalı).
- İt34 ✅: **Günlük Toplu Kargolama** (`POST /cargo/auto-ship` dry_run/allow_simulated guard, `GET /cargo/auto-ship/runs`; Siparişler → "Toplu Kargola" modalı `AutoShipModal.jsx`). Geliver henüz kurulmadı → canlı kargo için Kargo ayarlarında Geliver token + senderAddressID girilmeli. ShopPHP REST kullanıcı bilgileri hâlâ girilmedi (REST Test sonucu bekleniyor).
- İt35 ✅: **Fiyat Merkezi** (`pricing.py`: `GET/PUT /pricing/rules/{channel}`, `POST /pricing/compute`; Siparişler → Fiyat Merkezi sekmesi; formül price=(cost·(1+m)+sabit)/(1−kom·(1+komKDV)), yuvarlama ,90/,99/…; push Trendyol'a `marketplace/products/push`). **Sabah Özeti** (`/reports/morning-summary/*`, dakikalık scheduler `pricing.scheduler_loop`; Firma Ayarları → Sabah Özeti; e-posta SMTP + WhatsApp). 
- İt36 ✅: **BizimHesap cari + bakiye aktarımı** (`POST /migration/bizimhesap/import-customers`; gerçek çalıştırıldı: 2348 cari → 2309 yeni, 39 güncel, toplam bakiye 3.361.911,77 ₺; geri alınabilir parti). /contacts ve /products liste limiti 10000.
- Kullanıcıdan bekleyen: Geliver token/gönderici adresi; ShopPHP REST kullanıcı bilgisi; Trendyol fiyat push denemesi; bakiye işareti kontrolü (BizimHesap bakiye + = müşteri borcu varsayıldı; "ters çevir" seçeneği var).

## İterasyon 37 (Eylül 2026) ✅ test ajanı: backend 24/24, frontend %100
- **SaaS Sistem Yönetim Paneli** (`backend/saas.py`, `/sistem` → `SystemAdminPage.jsx`, `components/saas/*`): modül kataloğu (rbac.MODULES; çekirdek: `/`, `/settings`, `/trash`), paketler `db.saas_plans` (Başlangıç 499₺/2 kullanıcı, Standart 899₺/5, Profesyonel 1499₺/10, Kurumsal 2499₺/sınırsız — düzenlenebilir CRUD), şirket lisansları `db.company_licenses` (plan, durum trial/active/suspended/expired/cancelled, deneme/bitiş tarihi, kullanıcı limiti, modül override'ları, not, +7/+30/+365 uzat), yeni müşteri şirket + yönetici hesabı açma, yükseltme talepleri `db.upgrade_requests` (onayla → paket aktif + bildirim). Genel bakış: şirket/kullanıcı/MRR/modül kullanımı/7 gün içinde bitecekler.
- **Enforcement**: `rbac.PermissionAndAuditMiddleware` → `saas.guard` (kapalı modül → 403 `code=module_disabled`; askıda/süresi dolmuş → çekirdek dışı tüm modüller kilitli), kullanıcı limiti davette (`saas.check_user_limit`), register → 14 gün Profesyonel deneme (`saas.start_trial`). Frontend: `AuthContext.license` + `moduleOn()` → menü gizler, `MainLayout` → `ModuleLockedPanel` (yükseltme talebi), üst barda `LicenseBadge`. Firma Ayarları → **Paketim & Modüller** (`MyPlanPanel`: modül durumu, paket karşılaştırma, aylık/yıllık, "Bu Pakete Geç" talebi).
- **Süper admin**: `users.is_super_admin`; `.env` SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD ile seed (musda84@gmail.com) + admin@nexus.com da süper admin. `/api/system/*` yalnız süper admin (403). Mevcut 2 şirket Kurumsal/aktif lisansla seed edildi. Lisans efektif hesabı 15 sn bellek önbelleği (`saas.invalidate`).
- **Gelen e-Belgeler** (`/edoc-inbox`, `EdocInboxPage.jsx`, `edocs.py`) menüye/route'a bağlandı ve e2e doğrulandı: UBL XML/PDF(AI) yükle → tedarikçi eşle/oluştur → satır↔stok kartı (oto barkod/SKU/ad eşleme, tedarikçi kodu öğrenme, kart aç) → onayla (alış faturası/gelen irsaliye + stok girişi + alış fiyatı) / reddet. Örnek: `backend/tests/sample_einvoice_ubl.xml`.
- Ödeme/abonelik tahsilatı YOK (manuel lisans) — Stripe sonraki adım olarak önerildi.

## İterasyon 38 (Eylül 2026) ✅ test ajanı: backend 22/22, frontend %100 (+ Stripe test kartı ile gerçek ödeme→aktivasyon agent tarafından doğrulandı)
- **Sistem paneli ERP'den ayrıldı**: `/sistem/giris` (SystemLoginPage; yalnız `is_super_admin`, ERP kullanıcısı reddedilir), `SystemLayout` (koyu, kendi sol menüsü), route bazlı bölümler `/sistem`, `/sistem/sirketler|paketler|moduller|talepler|odemeler|hatirlatmalar|ayarlar`. ERP menüsünden "Sistem Yönetimi" kaldırıldı; süper admin için sidebar altında "Platform Paneli" linki. `/api/system/*` artık gerçek token zorunlu (demo fallback yok → 401); `/auth/me` → `authenticated`.
- **Stripe abonelik** (`saas_billing.py`, emergentintegrations, `STRIPE_API_KEY` test anahtarı, TRY): `POST /api/payments/checkout {company_id, plan_id, period}` → Stripe Checkout; `/odeme/basarili` poll `GET /api/payments/status/{sid}` → ödendiğinde `_apply_payment` (plan aktif, expires_at +30/365, bekleyen talepler kapanır, bildirim); webhook `/api/webhook/stripe`; panel "Ödemeler" (`GET /api/system/payments`). Paketim & Modüller'de "Satın Al" (Stripe) + "Yöneticiden talep et". NOT: Stripe Türkiye'de yerleşik hesaba ödeme yapamaz (claimable sandbox TR desteklemiyor) → canlıya geçişte iyzico/PayTR veya yurt dışı Stripe hesabı gerekir; ödeme katmanı sağlayıcı-bağımsız tasarlandı.
- **Lisans hatırlatmaları**: `run_reminders` (saatlik `reminder_loop` + `POST /api/system/reminders/run`): bitişe 7/1 gün (ayarlanabilir) ve süresi dolunca → uygulama içi bildirim + e-posta (gönderici şirketin SMTP'si) + WhatsApp (wa_send); dedupe `license_reminders`; panel "Hatırlatmalar" günlüğü. **Platform Ayarları** (`GET/PUT /api/system/settings`): hatırlatma günleri, gönderici şirket, e-posta/WhatsApp aç-kapa, deneme süresi/paketi, marka, destek iletişim.
- **Herkese açık**: `/fiyatlar` (PricingPage; `GET /api/public/plans`, aylık/yıllık), `/kayit` (SignupPage; `POST /api/public/signup` → şirket + admin + roller + deneme lisansı + cookie login), `/odeme/basarili|iptal` (PaymentResultPage). Login sayfasında "14 gün ücretsiz deneyin" linki.
