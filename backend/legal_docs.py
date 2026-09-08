"""Mesafeli satış, ön bilgilendirme ve KVKK metinleri — şirket bilgisiyle doldurulur."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request

import saas

router = APIRouter(prefix="/api")
_db = None
_current_user = None

SLUGS = ("mesafeli-satis", "on-bilgilendirme", "kvkk")
TITLES = {
    "mesafeli-satis": "Mesafeli Satış Sözleşmesi",
    "on-bilgilendirme": "Ön Bilgilendirme Formu",
    "kvkk": "KVKK Aydınlatma Metni",
}
ACCEPT_KEYS = ("accept_mss", "accept_obf", "accept_kvkk")
ACCEPT_DETAIL = "Mesafeli Satış Sözleşmesi, Ön Bilgilendirme Formu ve KVKK Aydınlatma Metni onaylanmadan işleme devam edilemez."
VERSION = "2026-09"


def init(db, current_user=None):
    global _db, _current_user
    _db = db
    _current_user = current_user


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _esc(s: Any) -> str:
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def party_from_company(company: Optional[dict], brand: str = "") -> dict:
    c = company or {}
    name = (c.get("name") or brand or "Satıcı").strip()
    address = ", ".join(x for x in [(c.get("address") or "").strip(), (c.get("city") or "").strip()] if x) or "—"
    return {
        "name": name,
        "address": address,
        "city": (c.get("city") or "—").strip() or "—",
        "tax_number": (c.get("tax_number") or c.get("tax_number_or_id") or "—").strip() or "—",
        "tax_office": (c.get("tax_office") or "—").strip() or "—",
        "email": (c.get("email") or "—").strip() or "—",
        "phone": (c.get("phone") or "—").strip() or "—",
        "mersis": (c.get("mersis") or "—").strip() or "—",
        "website": (c.get("website") or "").strip(),
        "iban": (c.get("iban") or "—").strip() or "—",
        "bank_name": (c.get("bank_name") or "—").strip() or "—",
    }


def template_mesafeli(p: dict) -> str:
    return f"""MADDE 1 — TARAFLAR
İşbu Mesafeli Satış Sözleşmesi (“Sözleşme”), 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında; satıcı {p['name']} (VKN/TCKN: {p['tax_number']}, vergi dairesi: {p['tax_office']}, adres: {p['address']}, e-posta: {p['email']}, telefon: {p['phone']}, MERSİS: {p['mersis']}) ile elektronik ortamda sipariş veren alıcı arasında, alıcının siparişi onayladığı anda kurulur.

MADDE 2 — KONU
Sözleşme’nin konusu, alıcının satıcının internet satış kanalı / B2B sipariş portalı üzerinden sipariş ettiği mal veya hizmetin satışı, teslimi ve bedelinin tahsilidir. Sipariş özeti (ürün, adet, birim fiyat, KDV, teslimat adresi) sipariş kaydının ayrılmaz parçasıdır.

MADDE 3 — SÖZLEŞMENİN KURULMASI
Alıcı, siparişi göndermeden önce işbu sözleşmeyi, Ön Bilgilendirme Formu’nu ve KVKK Aydınlatma Metni’ni okuduğunu ilgili onay kutularını işaretleyerek beyan eder. Onay verilmeden sipariş tamamlanamaz. Siparişin sisteme düşmesi, satıcının stok ve kredi limiti kontrolü sonrasında kabul veya reddetme hakkını ortadan kaldırmaz.

MADDE 4 — BEDEL VE ÖDEME
Satış bedeli, sipariş anında görünen KDV dahil/hariç fiyatlara ve varsa iskontoya göredir. Ödeme, açık hesap, havale/EFT, kredi kartı veya satıcının bildirdiği diğer yöntemlerle yapılır. Temerrüt halinde satıcı teslimi durdurabilir ve yasal faiz talep edebilir.

MADDE 5 — TESLİMAT
Teslimat, alıcının bildirdiği adrese, stok durumuna ve kargo / sevkiyat planına göre yapılır. Mücbir sebep, gümrük veya taşıyıcı kaynaklı gecikmelerden satıcı sorumlu tutulamaz; alıcı gecikme halinde satıcıyı yazılı olarak haberdar eder.

MADDE 6 — CAYMA HAKKI
6502 sayılı Kanun md. 48 kapsamında tüketici sıfatındaki alıcı, teslimden itibaren 14 gün içinde herhangi bir gerekçe göstermeksizin cayma hakkına sahiptir. Cayma bildirimi {p['email']} adresine yazılı yapılır. Kullanılmış, kişiye özel üretilmiş, çabuk bozulan veya ambalajı açılmış hijyen ürünlerinde cayma hakkı kullanılamaz. Ticari amaçla (B2B / bayi) verilen siparişlerde cayma hakkı, tarafların ticari teamülü ve satıcının iade politikası çerçevesinde uygulanır.

MADDE 7 — AYIPLI MAL
Ayıplı mal halinde 6502 sayılı Kanun ve 6098 sayılı Türk Borçlar Kanunu hükümleri uygulanır. Alıcı ayıbı öğrendiği andan itibaren makul sürede satıcıya bildirir.

MADDE 8 — KİŞİSEL VERİLER
Alıcının kimlik, iletişim, teslimat ve fatura verileri 6698 sayılı KVKK uyarınca, KVKK Aydınlatma Metni’nde belirtilen amaçlarla işlenir.

MADDE 9 — UYUŞMAZLIK
Uyuşmazlıklarda satıcının bulunduğu yer mahkemeleri ve tüketici hakem heyetleri / tüketici mahkemeleri yetkilidir. Satıcı kayıtları (sipariş, onay kutusu, IP/zaman damgası) delil olarak kullanılabilir.

MADDE 10 — YÜRÜRLÜK
Alıcı onay kutusunu işaretleyip siparişi gönderdiğinde Sözleşme kabul edilmiş sayılır."""


def template_on_bilgilendirme(p: dict) -> str:
    return f"""1. SATICI BİLGİLERİ
Ünvan: {p['name']}
Adres: {p['address']}
VKN/TCKN: {p['tax_number']}  ·  Vergi dairesi: {p['tax_office']}
MERSİS: {p['mersis']}
E-posta: {p['email']}  ·  Telefon: {p['phone']}
Web: {p['website'] or '—'}
IBAN: {p['iban']} ({p['bank_name']})

2. TEMEL NİTELİKLER
Satılan mal/hizmet, sipariş ekranında görünen ad, kod, miktar, birim, KDV oranı ve açıklamaya göredir. Stokta olmayan ürünler siparişe konu edilemez veya satıcı tarafından iptal / ertelenebilir.

3. FİYAT
Sipariş özetindeki ara toplam, KDV ve genel toplam geçerlidir. Kampanya ve bayi iskontosu sipariş anındaki listedeki fiyata yansıtılır. Kargo / sevkiyat bedeli ayrıca belirtilmedikçe satıcının iade politikasına tabidir.

4. ÖDEME VE TESLİMAT
Ödeme yöntemleri sipariş / cari hesap ekranında gösterilir. Teslimat süresi stok ve lojistik koşullarına bağlıdır; tahmini süre sipariş onayından sonra bildirilir.

5. CAYMA HAKKI
Tüketici, teslimden itibaren 14 gün içinde cayma hakkını {p['email']} üzerinden kullanabilir. Cayma formuna ihtiyaç yoktur; açık bir beyan yeterlidir. İade kargo yükümlülüğü Mesafeli Sözleşmeler Yönetmeliği’ne göredir. Ticari alıcılar (B2B) için cayma, satıcının yazılı iade koşullarına tabidir.

6. ŞİKÂYET VE UYGULAMA
Şikayetler {p['email']} ve {p['phone']} kanallarından iletilir. Tüketici, Gümrük ve Ticaret Bakanlığı’na bağlı il müdürlükleri ile tüketici hakem heyetine başvurabilir.

7. ONAY
Bu form, sipariş tamamlanmadan önce alıcıya sunulur. İlgili onay kutusu işaretlenmeden sipariş gönderilemez. Form, Mesafeli Satış Sözleşmesi ile birlikte okunmalıdır."""


def template_kvkk(p: dict) -> str:
    return f"""VERİ SORUMLUSU
6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca veri sorumlusu: {p['name']}, adres: {p['address']}, e-posta: {p['email']}, telefon: {p['phone']}.

İŞLENEN VERİLER
Kimlik (ad soyad, TCKN/VKN, unvan), iletişim (telefon, e-posta, adres), müşteri işlem (sipariş, fatura, ödeme, sepet, iade), finans (IBAN, bakiye, vade), işlem güvenliği (giriş kaydı, IP, onay kutusu zamanı) ve pazarlama tercihleri (SMS/e-posta izni).

AMAÇ VE HUKUKİ SEBEP
Sözleşmenin kurulması ve ifası, mal/hizmet tedariki, faturalama, kargo, cari hesap, yasal yükümlülükler (vergi, e-belge), bilgi güvenliği ve (ayrı açık rıza varsa) ticari elektronik ileti. Hukuki sebepler: KVKK md. 5/2 (a), (c), (ç), (e), (f); açık rıza gereken hallerde md. 5/1.

AKTARIM
Kargo ve ödeme kuruluşları, e-belge entegratörleri, barındırma / e-posta altyapısı, yasal zorunluluk halinde kamu kurumları. Yurt dışı aktarım ancak KVKK md. 9 şartlarında yapılır.

SAKLAMA
Veriler, ticari defter ve vergi mevzuatındaki süreler ile zamanaşımı boyunca; amaç ortadan kalkınca silinir, yok edilir veya anonim hale getirilir.

HAKLARINIZ (KVKK md. 11)
Verilerinizin işlenip işlenmediğini öğrenme, düzeltme, silme, aktarılan üçüncü kişileri bilme, itiraz ve zararın giderilmesini talep etme haklarına sahipsiniz. Başvurular {p['email']} adresine yazılı iletilir; en geç 30 gün içinde yanıtlanır.

ONAY
Müşteri kaydı, B2B erişimi veya internet siparişi sırasında ilgili kutunun işaretlenmesi, bu aydınlatma metninin okunduğu ve anlaşıldığı anlamına gelir. Ticari elektronik ileti ancak ayrı SMS/e-posta izni ile gönderilir."""


TEMPLATES = {
    "mesafeli-satis": template_mesafeli,
    "on-bilgilendirme": template_on_bilgilendirme,
    "kvkk": template_kvkk,
}


def text_to_html(text: str) -> str:
    blocks = []
    for raw in (text or "").split("\n\n"):
        line = raw.strip()
        if not line:
            continue
        first, _, rest = line.partition("\n")
        if first.isupper() or first.startswith("MADDE") or (len(first) < 80 and first[:1].isdigit()):
            body = _esc(rest.strip()) if rest.strip() else ""
            inner = f"<h2>{_esc(first)}</h2>" + (f"<p>{body.replace(chr(10), '<br/>')}</p>" if body else "")
        else:
            inner = f"<p>{_esc(line).replace(chr(10), '<br/>')}</p>"
        blocks.append(inner)
    return "".join(blocks)


def require_acceptance(req: Optional[dict]):
    req = req or {}
    ok = all(bool(req.get(k)) for k in ACCEPT_KEYS)
    if not ok:
        raise HTTPException(status_code=400, detail=ACCEPT_DETAIL)


def acceptance_record(req: Optional[dict]) -> dict:
    req = req or {}
    return {k: bool(req.get(k)) for k in ACCEPT_KEYS} | {"accepted_at": _now(), "version": VERSION}


async def company_or_404(company_id: str) -> dict:
    c = await _db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return c


def render_doc(slug: str, company: dict, brand: str = "") -> dict:
    if slug not in SLUGS:
        raise HTTPException(status_code=404, detail="Yasal metin bulunamadı.")
    party = party_from_company(company, brand)
    custom = ((company or {}).get("legal_texts") or {}).get(slug)
    text = custom.strip() if isinstance(custom, str) and custom.strip() else TEMPLATES[slug](party)
    return {
        "slug": slug,
        "title": TITLES[slug],
        "version": VERSION,
        "seller": {k: party[k] for k in ("name", "address", "city", "tax_number", "email", "phone")},
        "customized": bool(isinstance(custom, str) and custom.strip()),
        "text": text,
        "html": text_to_html(text),
    }


async def platform_company() -> tuple:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    brand = st.get("brand_name") or "TamKobi"
    cid = st.get("sender_company_id") or "comp_nexus_main_01"
    company = await _db.companies.find_one({"_id": cid}) or {"name": brand, "email": st.get("support_email"), "phone": st.get("support_phone"), "website": st.get("public_url")}
    return company, brand


@router.get("/public/legal")
async def list_platform_legal():
    company, brand = await platform_company()
    return {"brand": brand, "docs": [{"slug": s, "title": TITLES[s], "path": f"/yasal/{s}"} for s in SLUGS], "seller": party_from_company(company, brand)}


@router.get("/public/legal/{slug}")
async def get_platform_legal(slug: str):
    company, brand = await platform_company()
    return render_doc(slug, company, brand)


@router.get("/public/b2b/{token}/legal")
async def list_b2b_legal(token: str):
    c = await _db.contacts.find_one({"b2b_token": token, "b2b_enabled": True})
    if not c:
        raise HTTPException(status_code=404, detail="B2B erişimi bulunamadı veya kapatılmış.")
    company = await _db.companies.find_one({"_id": c["company_id"]}) or {}
    return {"docs": [{"slug": s, "title": TITLES[s], "path": f"/yasal/{s}?b2b={token}"} for s in SLUGS], "seller": party_from_company(company)}


@router.get("/public/b2b/{token}/legal/{slug}")
async def get_b2b_legal(token: str, slug: str):
    c = await _db.contacts.find_one({"b2b_token": token, "b2b_enabled": True})
    if not c:
        raise HTTPException(status_code=404, detail="B2B erişimi bulunamadı veya kapatılmış.")
    company = await _db.companies.find_one({"_id": c["company_id"]}) or {}
    return render_doc(slug, company)


@router.get("/companies/{company_id}/legal")
async def get_company_legal(company_id: str, request: Request):
    user = await _current_user(request)
    saas._require_company_access(user, company_id)
    company = await company_or_404(company_id)
    docs = [render_doc(s, company) for s in SLUGS]
    overrides = {s: ((company.get("legal_texts") or {}).get(s) or "") for s in SLUGS}
    return {"company_id": company_id, "docs": docs, "overrides": overrides, "titles": TITLES}


@router.put("/companies/{company_id}/legal")
async def put_company_legal(company_id: str, req: Dict[str, Any], request: Request):
    user = await _current_user(request)
    saas._require_company_access(user, company_id)
    await company_or_404(company_id)
    incoming = req.get("overrides") if isinstance(req.get("overrides"), dict) else req
    cleaned = {}
    for s in SLUGS:
        if s in incoming:
            cleaned[s] = str(incoming[s] or "")[:80000]
    if not cleaned:
        raise HTTPException(status_code=400, detail="Güncellenecek metin yok.")
    await _db.companies.update_one({"_id": company_id}, {"$set": {f"legal_texts.{k}": v for k, v in cleaned.items()} | {"legal_texts_updated_at": _now()}})
    company = await company_or_404(company_id)
    return {"status": "success", "docs": [render_doc(s, company) for s in SLUGS], "overrides": {s: ((company.get("legal_texts") or {}).get(s) or "") for s in SLUGS}}
