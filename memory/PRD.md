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

## Bilinen Notlar
- Test sırasında kullanıcının bağladığı Gmail hesabı silindi → **yeniden bağlanmalı**.
- Gerçek banka/Netgsm anahtarı yok → simüle; anahtar girildiğinde aynı ekrandan canlıya geçer.
- `get_current_user` token yoksa demo admin'e düşüyor (demo kolaylığı; prod'da kaldırılmalı).
- Mail: Gmail/Outlook için uygulama şifresi gerekir; OAuth yok.

## Backlog (kullanıcı istekleri — öncelik sırası önerisi)
P0 (son mesajlardan, henüz yapılmadı):
a. **Modül sıralama**: sol menüdeki modüllerin yerini sürükle/bırak ile değiştirebilme (kullanıcı tercihi kaydı).
b. **Firma Ayarları modülü**: şirket bilgileri + tüm entegrasyon/ayar ekranlarını (Netgsm, mail hesabı, banka bağlantıları, e-ticaret/kargo API, e-fatura entegratörü) tek yerde toplama; sadeleştirme.
c. **Personel modülü "Netesnaf gibi"**: kullanıcıdan hangi özelliklerin istendiği netleştirilmeli (puantaj/giriş-çıkış, avans, mesai, SGK bildirimi, bordro PDF?).
d. "Cari detaylarında 'Satıcılar' yazan yazı → 'Ödemeler'": ekranda "Satıcılar" metni bulunamadı — kullanıcıya hangi ekran olduğu sorulacak.
P0 (kullanıcının son mesajı):
4. **E-ticaret entegrasyonu detayları**: ürün eşleştirme (pazaryeri SKU ↔ stok kartı), iade yönetimi, sipariş onaylama & durum, kargo seçimi + etiket/barkod yazdırma.
5. **E-Fatura entegrasyonu & e-İrsaliye**: kullanıcı kararı: entegratör henüz yok → altyapı SİMÜLE kurulacak, anahtar gelince bağlanacak; e-İrsaliye belgesi.
P1:
6. **Teklif / Proje / Keşif modülleri** + görsel yükleme (object storage mevcut).
7. Gerçek banka API anahtarları girildiğinde canlı test; Netgsm canlı test.
P2: server.py router'lara bölme, gerçek auth zorunluluğu, raporlama, yetkilendirme.

## Test Kimlikleri
/app/memory/test_credentials.md
