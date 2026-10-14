"""Users, roles (module permissions), e-mail invitations and activity log."""
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Callable, Awaitable

import user_numbers
import user_company_access as uca
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.base import BaseHTTPMiddleware

import comm_service
from auth_utils import (
    hash_password, create_access_token, create_refresh_token, get_user_from_token,
    session_token, auth_cookie_kwargs,
)
from client_ip import request_ip
import tenant_access

router = APIRouter(prefix="/api")
_db = None
_mail_account: Optional[Callable[..., Awaitable[dict]]] = None
_current_user = None

MODULES = [
    ("/", "Genel Bakış"),
    ("/invoices", "Faturalar"),
    ("/edoc-inbox", "Gelen e-Belgeler"),
    ("/dis-ticaret", "İthalat / İhracat"),
    ("/dispatches", "İrsaliyeler"),
    ("/contacts", "Cari Hesaplar"),
    ("/b2b-yonetim", "B2B Portal Yönetimi"),
    ("/installments", "Taksitler"),
    ("/reports", "Raporlar"),
    ("/banking", "Banka & Kasa & POS"),
    ("/expenses", "Masraflar"),
    ("/loans", "Krediler"),
    ("/cheques", "Çek / Senet"),
    ("/stock", "Stoklar & Ürünler"),
    ("/purchase-orders", "Verilen Siparişler"),
    ("/sayim", "Stok Sayımı"),
    ("/quotes", "Teklifler"),
    ("/projects", "Projeler"),
    ("/surveys", "Keşifler"),
    ("/ecommerce", "E-Ticaret"),
    ("/cargo", "Kargo"),
    ("/orders", "Siparişler"),
    ("/hizli-satis", "Hızlı Satış"),
    ("/saha", "Saha Sipariş"),
    ("/sevk", "Depo Sevkiyatı"),
    ("/warehouses", "Depo & Transfer"),
    ("/vehicles", "Araçlarım"),
    ("/production", "Üretim & Reçete (BOM)"),
    ("/atolye", "Atölye Ekranı"),
    ("/personnel", "Personel & Bordro"),
    ("/mesai", "Mesaim"),
    ("/communication", "İletişim"),
    ("/support", "Destek Talepleri"),
    ("/ai-advisor", "AI Danışman"),
    ("/accountant", "Mali Müşavir Paneli"),
    ("/settings", "Firma Ayarları"),
    ("/trash", "Çöp Kutusu"),
]
# Kısa açıklamalar — roller matrisi ve paket vitrini. /personelim, /panel yetkisi /mesai ve / üzerinden gelir.
MODULE_HELP = {
    "/": "Özet paneli, KPI kartları ve hızlı işlemler (web/mobil ana sayfa).",
    "/invoices": "Satış/alış faturaları, e-Fatura, e-Arşiv; mobil fatura listesi ve oluşturma.",
    "/edoc-inbox": "GİB gelen e-Fatura / e-İrsaliye kutusu, onay ve aktarım.",
    "/dis-ticaret": "İthalat/ihracat dosyası, GTIP, rejim, DAB, ticari fatura.",
    "/dispatches": "e-İrsaliye oluşturma ve takip.",
    "/contacts": "Müşteri/tedarikçi kartları, ekstre, bakiye; mobil cari ve tahsilat.",
    "/b2b-yonetim": "Bayi B2B portalı, fiyat listesi, sipariş onayı (web + mobil B2B).",
    "/installments": "Taksitli satış ve ödeme planları.",
    "/reports": "Satış, alış, stok, nakit akışı, KDV ve kârlılık raporları.",
    "/banking": "Banka, kasa, POS, virman, canlı banka eşleme; mobil kasa işlemleri.",
    "/expenses": "Masraf fişleri ve bütçe; mobil masraf girişi.",
    "/loans": "Kredi ve kredi kartı takibi.",
    "/cheques": "Alınan/verilen çek-senet, tahsil, ciro, karşılıksız; mobil çek ekranı.",
    "/stock": "Stok kartı, barkod, etiket; mobil stok ve ürün formu.",
    "/purchase-orders": "Tedarikçiye verilen siparişler ve yeniden sipariş.",
    "/sayim": "Tablet stok sayımı, barkod tarama ve fark raporu.",
    "/quotes": "Satış teklifi, müşteri onayı, faturaya çevirme; mobil teklif.",
    "/projects": "İş/saha projesi, bütçe, aşama fotoğrafları; mobil proje.",
    "/surveys": "Keşif, ölçü alma ve teklife dönüştürme.",
    "/ecommerce": "Trendyol, ShopPHP ve pazaryeri entegrasyonu; ürün/sipariş senkronu.",
    "/cargo": "Geliver ve kargo firmaları; gönderi oluşturma ve takip.",
    "/orders": "Sipariş yönetimi, faturalama, kargo; mobil sipariş ve aksiyonlar.",
    "/hizli-satis": "Perakende POS, tartı ve termal fiş.",
    "/saha": "Tablet/mobil saha siparişi ve müşteri ziyareti.",
    "/sevk": "Depo sevkiyat kiosk, sipariş toplama (web + mobil sevk).",
    "/warehouses": "Çoklu depo, transfer ve stok lokasyonları.",
    "/vehicles": "Şirket araçları (plaka, marka/model, durum); web + mobil filo listesi.",
    "/production": "Reçete (BOM), üretim emirleri ve eksik malzeme planı.",
    "/atolye": "Tablet/mobil atölye ekranı, iş emri ve PIN ile operatör.",
    "/personnel": "İK: personel kartı, bordro, vardiya, izin (yönetici).",
    "/mesai": "Puantaj, giriş-çıkış ve fazla mesai takibi.",
    "/communication": "SMS, e-posta, WhatsApp Business merkezleri.",
    "/support": "Destek talepleri, ekler, yönetim paneli erişim ve silme onayı.",
    "/ai-advisor": "AI finans danışmanı (sohbet ve nakit tahmini). Fatura, fiş, çek ve ekstre AI aktarımı ilgili modül yetkisiyle çalışır.",
    "/accountant": "Mali müşavir paneli, KDV özeti, bordro/mizan/tahakkuk yükleme ve ödenecek vergiler.",
    "/settings": "Firma ayarları, kullanıcı/rol, entegrasyonlar (yalnızca yöneticiler).",
    "/trash": "Silinen kayıtlar; 30 gün içinde geri alma.",
}
LEVELS = ("none", "view", "edit", "delete")
LEVEL_RANK = {"none": 0, "view": 1, "edit": 2, "delete": 3}
LEVEL_META = [
    {"key": "none", "label": "Yok", "help": "Menüde görünmez; API erişimi engellenir."},
    {"key": "view", "label": "Görüntüle", "help": "Liste ve detay okunur; oluşturma/düzenleme/silme kapalı."},
    {"key": "edit", "label": "Düzenle", "help": "Ekleme ve güncelleme; silme kapalı (web + mobil)."},
    {"key": "delete", "label": "Sil", "help": "Tam işlem: ekleme, güncelleme, silme ve onaylar (web + mobil)."},
]


def level_allows(have: Optional[str], need: str) -> bool:
    """Permission hierarchy: none < view < edit < delete."""
    return LEVEL_RANK.get(have or "none", 0) >= LEVEL_RANK.get(need, 0)


FEATURES = [
    ("view_prices", "Fiyat ve tutarları görebilir", "Kapalıysa tüm API yanıtlarında fiyat/tutar/bakiye alanları maskelenir (0 gösterilir); ürün, sipariş, fatura, kârlılık tutarları gizlenir."),
    ("header_barcode", "Üst bar: Hızlı barkod tarama", "Web üst çubuğundaki Barkod Oku kısayolu. Kapalıysa buton gizlenir."),
    ("header_virman", "Üst bar: Hızlı virman", "Web üst çubuğundan hesaplar arası virman. Kapalıysa buton gizlenir."),
    ("header_invoice", "Üst bar: Hızlı fatura oluştur", "Web üst çubuğundaki Yeni Fatura kısayolu."),
    ("header_ai", "Üst bar: AI asistan", "Web üst çubuğundaki AI Danışman kısayolu (lisans eklentisi de gerekir)."),
    ("production_ai", "AI Üretim & Reçete paneli", "Üretim ve Atölye sayfalarındaki AI Üretim & Reçete analiz paneli. Kapalıysa gizlenir; lisans eklentisi (ai.production) de gerekir."),
    ("support_bar", "Üst kur / arama / Destek çubuğu", "Sayfa üstündeki kurlar, global arama ve Destek talep şeridi. Kapalıysa tüm şerit gizlenir."),
    ("order_cargo_label", "Sipariş: Kargo etiketi", "Sipariş satırındaki Kargo etiketi (yazdır) butonu. Kapalıysa web + mobil gizlenir; Kargola butonu etkilenmez."),
    ("order_more_actions", "Sipariş: Diğer işlemler", "Sipariş satırındaki Diğer işlemler (⋯) menüsü. Kapalıysa web + mobil gizlenir."),
    ("sevk_open_order", "Sevk: Siparişi aç", "Mobil Depo Sevkiyat toplama ekranındaki Siparişi aç butonu. Kapalıysa mobilde gizlenir; Siparişler modül yetkisi de gerekir."),
    ("sevk_draft_invoice", "Sevk: Taslak fatura", "Mobil Depo Sevkiyat toplama ekranındaki Taslak fatura butonu. Kapalıysa mobilde gizlenir; Faturalar modül yetkisi de gerekir."),
    ("account_companies", "Hesap: Şirketlerim", "Sol menü Hesap açılır listesindeki Şirketlerim alanı ve şirket değiştirme. Kapalıysa personel yalnız aktif firmayı görür; şirket listesi/geçiş gizlenir."),
    ("export_personal_data", "Kişisel verilerimi ZIP indir", "Kenar çubuğundaki kişisel veri ZIP indirme ve Hesap → Profil veri dışa aktarımı. Kapalıysa buton gizlenir; API de engeller."),
    ("company_audit", "İşlem geçmişini görebilir", "Sistem menüsündeki İşlem Geçmişi. Kapalıysa kullanıcı ve personel bu ekranı açamaz. Firma yöneticisi her zaman görür ve buradan yetki verir."),
    # Personel portalı (ik) ve mobil saha — aç/kapa, varsayılan kapalı. Yönetici her zaman açık.
    ("portal_atolye", "Atölye (üretim / iş emri)", "İK portalı ve mobil menüde Atölye. Kapalıysa personel iş emri uçlarında 403 alır. Diğer rollerde mevcut modül yetkisi durur. Varsayılan kapalı."),
    ("portal_pick", "Sipariş Toplama", "İK portalı ve mobil menüde sipariş toplama. Kapalıysa personel toplama uçlarında 403 alır. Varsayılan kapalı."),
    ("portal_sayim", "Stok Sayımı", "İK portalı ve mobil menüde stok sayımı. Kapalıysa personel sayım uçlarında 403 alır. Varsayılan kapalı."),
    ("portal_saha", "Saha Sipariş", "İK portalı ve mobil menüde saha siparişi. Kapalıysa personel saha siparişi oluşturamaz. Varsayılan kapalı."),
    ("portal_vehicles", "Araçlarım", "İK portalı ve mobil menüde araçlar. Kapalıysa personel araç uçlarında 403 alır. Varsayılan kapalı."),
]
FEATURE_DEFAULTS: Dict[str, bool] = {k: True for k, _, _ in FEATURES}
# Saha özellikleri: kayıtlı değilse kapalı (admin role_features içinde her zaman açık).
PORTAL_FEATURE_KEYS = frozenset({
    "portal_atolye", "portal_pick", "portal_sayim", "portal_saha", "portal_vehicles",
})
# Alan (önek) — personel kapalı özellikte bu ağaca giremez. En uzun önek kazanır.
PORTAL_AREAS = (
    ("/api/production/work-orders", "portal_atolye", "/atolye"),
    ("/api/order-picks", "portal_pick", "/sevk"),
    ("/api/warehouses/stock-counts", "portal_sayim", "/sayim"),
    ("/api/vehicles", "portal_vehicles", "/vehicles"),
)
# Yöntem + yol şablonu. Özellik yalnız bu saha işlemlerinde mutation_allowed atlar.
# {id} tek yol parçasıdır. DELETE, *-settings, trash-completed, admin-trash, decide
# ve araç oluşturma/düzenleme/silme bu listede yoktur.
PORTAL_API_RULES = (
    ("GET", "/api/production/work-orders", "portal_atolye", "/atolye"),
    ("GET", "/api/production/work-orders/stations", "portal_atolye", "/atolye"),
    ("GET", "/api/production/work-orders/pause-policy", "portal_atolye", "/atolye"),
    # Operatör şifresi. Start/pause/finish bu doğrulama olmadan tabletten çalışmaz.
    ("POST", "/api/production/work-orders/shopfloor-unlock", "portal_atolye", "/atolye"),
    ("PUT", "/api/production/work-orders/{id}/assign", "portal_atolye", "/atolye"),
    ("POST", "/api/production/work-orders/{id}/start", "portal_atolye", "/atolye"),
    ("POST", "/api/production/work-orders/{id}/pause", "portal_atolye", "/atolye"),
    ("POST", "/api/production/work-orders/{id}/finish", "portal_atolye", "/atolye"),
    ("POST", "/api/production/work-orders/{id}/trash-request", "portal_atolye", "/atolye"),
    ("GET", "/api/order-picks", "portal_pick", "/sevk"),
    ("GET", "/api/order-picks/{id}", "portal_pick", "/sevk"),
    ("POST", "/api/order-picks/{id}/scan", "portal_pick", "/sevk"),
    ("POST", "/api/order-picks/{id}/adjust", "portal_pick", "/sevk"),
    ("POST", "/api/order-picks/{id}/notify-missing", "portal_pick", "/sevk"),
    ("POST", "/api/order-picks/{id}/complete", "portal_pick", "/sevk"),
    ("GET", "/api/warehouses/stock-counts", "portal_sayim", "/sayim"),
    ("POST", "/api/warehouses/stock-counts", "portal_sayim", "/sayim"),
    ("GET", "/api/warehouses/stock-counts/{id}", "portal_sayim", "/sayim"),
    ("POST", "/api/warehouses/stock-counts/{id}/scan", "portal_sayim", "/sayim"),
    ("PUT", "/api/warehouses/stock-counts/{id}/items", "portal_sayim", "/sayim"),
    ("POST", "/api/warehouses/stock-counts/{id}/complete", "portal_sayim", "/sayim"),
    # Araçlarda filo CRUD yok; personel yalnız okur. Kendi kullanım kaydı ucu yok.
    ("GET", "/api/vehicles", "portal_vehicles", "/vehicles"),
    ("GET", "/api/vehicles/{id}", "portal_vehicles", "/vehicles"),
)
PORTAL_FEATURE_LABELS = {k: label for k, label, _ in FEATURES if k in PORTAL_FEATURE_KEYS}


def feature_default(code: str, key: str) -> bool:
    """Per-role defaults when a feature key was never saved on the role doc."""
    if key == "company_audit" or key in PORTAL_FEATURE_KEYS:
        return False
    if code == "admin":
        return True
    if key in ("account_companies", "export_personal_data") and code == "personel":
        return False
    # Personel / üretim: fiyatlar varsayılan kapalı (atölye ve saha operasyonları).
    if key == "view_prices" and code in ("personel", "production"):
        return False
    # Atölye / personel: AI üretim paneli ve üst destek şeridi varsayılan kapalı (yer kaplamasın).
    if key in ("production_ai", "support_bar") and code in ("personel", "production"):
        return False
    return FEATURE_DEFAULTS.get(key, True)


def role_features(role: dict) -> Dict[str, bool]:
    code = role.get("code") or ""
    if code == "admin":
        return {k: True for k, _, _ in FEATURES}
    f = role.get("features") or {}
    return {k: bool(f.get(k, feature_default(code, k))) for k, _, _ in FEATURES}


def _portal_norm_path(path: str) -> str:
    return (path or "").split("?", 1)[0].rstrip("/") or "/"


def _portal_template_match(template: str, path: str) -> bool:
    tparts = template.strip("/").split("/")
    pparts = path.strip("/").split("/")
    if len(tparts) != len(pparts):
        return False
    for tp, pp in zip(tparts, pparts):
        if len(tp) >= 2 and tp[0] == "{" and tp[-1] == "}":
            if not pp:
                return False
            continue
        if tp != pp:
            return False
    return True


def portal_area_for_path(path: str):
    """Saha API alanı: (prefix, feature_key, module_key) veya None."""
    p = _portal_norm_path(path)
    best = None
    for prefix, feat, mod in PORTAL_AREAS:
        if p == prefix or p.startswith(prefix + "/"):
            if best is None or len(prefix) > len(best[0]):
                best = (prefix, feat, mod)
    return best


def portal_rule_for_path(path: str, method: str = "GET"):
    """İzinli saha işlemi: (şablon, feature_key, module_key) veya None.

    Yöntem ve yol birebir eşleşmezse None. Yönetici işlemleri (DELETE, ayar,
    çöp, karar, araç yazma) bu listede yoktur.
    """
    p = _portal_norm_path(path)
    method_u = str(method or "GET").upper()
    for rule_method, template, feat, mod in PORTAL_API_RULES:
        if rule_method != method_u:
            continue
        if _portal_template_match(template, p):
            return (template, feat, mod)
    return None


def portal_admin_operation(path: str, method: str = "GET") -> bool:
    """Portal özelliğinin açmaması gereken yönetici işlemi.

    DELETE, *-settings, trash-completed, admin-trash, decide ve araç CRUD.
    Araç GET saha okumasıdır. Eşleşme yalnız saha alanındadır.
    """
    if not portal_area_for_path(path):
        return False
    p = _portal_norm_path(path)
    method_u = str(method or "GET").upper()
    if p.endswith("-settings") or p.endswith("/trash-completed") or p.endswith("/admin-trash") or p.endswith("/decide"):
        return True
    if method_u == "DELETE":
        return True
    if p == "/api/vehicles" or p.startswith("/api/vehicles/"):
        return method_u not in ("GET", "HEAD")
    return False


def _portal_module_allows(role: dict, module_key: str, path: str, method: str) -> bool:
    """Personel dışı roller: mevcut modül matrisi (GET dahil) erişimi sürdürür."""
    perms = (role or {}).get("permissions") or {}
    method_u = str(method or "GET").upper()
    if method_u in ("GET", "HEAD"):
        if level_allows(perms.get(module_key), "view"):
            return True
        # Üretim ekranı iş emirlerini /production ile de okur.
        if module_key == "/atolye" and level_allows(perms.get("/production"), "view"):
            return True
        return False
    if mutation_allowed(module_key, path, perms, method_u):
        return True
    if module_key == "/atolye" and level_allows(perms.get("/production"), "edit"):
        return method_u != "DELETE"
    return False


def portal_field_allowed(user: Optional[dict], role: Optional[dict], feature_key: str, module_key: str, path: str, method: str = "GET") -> bool:
    """Saha ucu.

    Açık özellik yalnız PORTAL_API_RULES satırını açar (modül none olsa da).
    Personelde bunun dışındaki her uç — DELETE, ayar, çöp, karar, araç CRUD,
    shopfloor-unlock — 403. Modül edit/delete devralınmaz.
    Diğer rollerde yazma mutation_allowed ile kalır. Kapalı özellik onların
    GET erişimini bozmaz.
    """
    if not user:
        return False
    if user.get("is_super_admin") or normalize_role_code(user.get("role")) == "admin":
        return True
    method_u = str(method or "GET").upper()
    role_code = normalize_role_code(user.get("role"))
    feats = role_features(role or {"code": role_code, "features": {}})
    field = portal_rule_for_path(path, method_u)
    if field and field[1] == feature_key and feats.get(feature_key):
        return True
    if role_code == "personel":
        return False
    if method_u in ("GET", "HEAD"):
        return True
    return _portal_module_allows(role or {}, module_key, path, method_u)


def portal_feature_grant(user: Optional[dict], role: Optional[dict], feature_key: str, path: str = "", method: str = "GET") -> bool:
    """Özellik, yalnız listelenmiş saha işleminde modül mutation kontrolünü atlar.

    Yönetici işlemlerinde her zaman False: çağıran mutation_allowed uygular.
    """
    if not user or user.get("is_super_admin") or normalize_role_code(user.get("role")) == "admin":
        return False
    if portal_admin_operation(path, method):
        return False
    field = portal_rule_for_path(path, method)
    if not field or field[1] != feature_key:
        return False
    role_code = normalize_role_code(user.get("role"))
    return bool(role_features(role or {"code": role_code, "features": {}}).get(feature_key))


def portal_denial_detail(feature_key: str) -> str:
    label = PORTAL_FEATURE_LABELS.get(feature_key) or feature_key
    return f"Bu özellik için yetkiniz yok ({label})."


MONEY_KEYS = {"sale_price", "purchase_price", "unit_price", "unit_price_incl", "price", "list_price", "local_price", "local_total", "fx_rate", "total", "total_incl", "grand_total", "subtotal", "vat_total", "total_amount", "amount", "paid_amount", "balance", "current_balance", "revenue", "net_profit", "gross_profit",
              "commission", "commission_vat", "service_fee", "cargo_fee", "product_cost", "cost", "fees", "deductions", "net", "gross", "salary", "payroll_salary", "net_salary", "gross_salary", "second_salary", "credit_limit", "discount_total", "vat_amount", "price_diff",
              "cost_price", "last_purchase_price", "avg_purchase_price", "card_purchase_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider",
              "cost_price", "last_purchase_price", "avg_purchase_price", "card_purchase_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider", "cheque_bond_balance", "portfolio", "issued_open", "due_this_week", "overdue_received", "overdue_issued", "meal_allowance", "transport_allowance", "unpaid_payroll", "unpaid_expenses", "meal_due", "transport_due", "bonus_pending", "advances",
              "cost_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider", "meal_allowance", "transport_allowance", "unpaid_payroll", "unpaid_expenses", "meal_due", "transport_due", "bonus_pending", "advances",
              "value", "incoming", "outgoing", "collections", "payments", "not_due", "overdue", "payable", "receivable", "deductible", "calculated", "vat", "week", "today", "month_total", "yearly", "cash", "bank", "pos", "kdv", "ciro", "kar", "profit_amount", "spent_amount", "limit", "avg_order", "average",
              "unit_cost", "total_cost", "material_cost", "estimated_total_cost", "total_estimated_cost", "sale_price_excl_vat", "list_price_incl", "b2b_price", "wholesale_price"}


def _money_scalar(v) -> bool:
    """True when value looks like a numeric money amount (not bool)."""
    if isinstance(v, bool):
        return False
    if isinstance(v, (int, float)):
        return True
    try:
        from decimal import Decimal
        if isinstance(v, Decimal):
            return True
    except Exception:
        pass
    if isinstance(v, str):
        s = v.strip().replace(" ", "").replace(",", ".")
        if not s:
            return False
        try:
            float(s)
            return True
        except ValueError:
            return False
    return False


def mask_money(obj):
    if isinstance(obj, dict):
        return {k: (0 if (k in MONEY_KEYS and _money_scalar(v)) else mask_money(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_money(x) for x in obj]
    return obj


def _all(level: str) -> Dict[str, str]:
    return {m: level for m, _ in MODULES}

DEFAULT_ROLES = [
    {"code": "admin", "name": "Yönetici", "is_system": True, "permissions": _all("delete")},
    {"code": "manager", "name": "Müdür", "is_system": True, "permissions": {
        **_all("view"),
        "/personnel": "edit", "/mesai": "edit",
        "/invoices": "edit", "/edoc-inbox": "edit", "/dispatches": "edit", "/contacts": "edit",
        "/b2b-yonetim": "edit", "/installments": "edit", "/banking": "edit", "/expenses": "edit",
        "/cheques": "edit", "/quotes": "edit", "/projects": "edit", "/surveys": "edit",
        "/orders": "edit", "/cargo": "edit", "/communication": "edit", "/support": "edit",
        "/reports": "edit", "/purchase-orders": "view", "/stock": "view", "/sayim": "view",
        "/warehouses": "view", "/vehicles": "edit", "/production": "view", "/atolye": "view", "/ecommerce": "view",
        "/saha": "view", "/sevk": "view", "/hizli-satis": "view", "/loans": "view",
        "/dis-ticaret": "view", "/ai-advisor": "view", "/trash": "view",
        "/settings": "none", "/accountant": "none",
    }},
    {"code": "accountant", "name": "Muhasebe", "is_system": True, "permissions": {
        **_all("view"),
        "/invoices": "edit", "/edoc-inbox": "edit", "/dis-ticaret": "edit", "/dispatches": "edit",
        "/contacts": "edit", "/installments": "edit", "/banking": "edit", "/expenses": "edit",
        "/loans": "edit", "/cheques": "edit", "/purchase-orders": "edit", "/reports": "edit",
        "/accountant": "edit", "/personnel": "view", "/mesai": "view", "/support": "edit",
        "/b2b-yonetim": "view", "/quotes": "view", "/projects": "view", "/orders": "view",
        "/settings": "none", "/production": "none", "/atolye": "none", "/ecommerce": "none",
        "/cargo": "none", "/saha": "none", "/sevk": "none", "/hizli-satis": "none", "/ai-advisor": "none",
        "/sayim": "none",
    }},
    {"code": "sales", "name": "Satış", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/invoices": "edit", "/edoc-inbox": "edit", "/dis-ticaret": "edit", "/dispatches": "edit",
        "/contacts": "edit", "/b2b-yonetim": "edit", "/quotes": "edit", "/projects": "edit", "/surveys": "edit",
        "/orders": "edit", "/hizli-satis": "edit", "/saha": "edit", "/stock": "view", "/purchase-orders": "view",
        "/installments": "view", "/sevk": "view", "/vehicles": "view", "/communication": "edit", "/support": "edit",
        "/ecommerce": "view", "/cargo": "edit", "/mesai": "view", "/reports": "view",
        "/banking": "view", "/cheques": "view", "/expenses": "view",
    }},
    {"code": "warehouse", "name": "Depo", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/stock": "edit", "/purchase-orders": "edit", "/sayim": "edit", "/warehouses": "edit",
        "/vehicles": "edit",
        "/orders": "edit", "/sevk": "edit", "/cargo": "edit", "/dispatches": "edit", "/contacts": "view",
        "/invoices": "view",
        "/mesai": "view", "/support": "view", "/production": "view", "/atolye": "view",
    }},
    {"code": "production", "name": "Üretim", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/production": "edit", "/atolye": "edit", "/warehouses": "view", "/orders": "view",
        "/sevk": "view", "/mesai": "view", "/support": "view", "/purchase-orders": "view",
    }},
    {"code": "personel", "name": "Personel", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/mesai": "edit", "/atolye": "edit", "/communication": "view", "/support": "view",
        "/saha": "view",
    }},
    {"code": "advisor", "name": "Mali Müşavir", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/invoices": "view", "/edoc-inbox": "view", "/dis-ticaret": "view", "/dispatches": "view",
        "/contacts": "view", "/installments": "view", "/banking": "view", "/expenses": "view", "/loans": "view",
        "/cheques": "view", "/purchase-orders": "view", "/reports": "edit", "/accountant": "edit",
        "/personnel": "view", "/mesai": "view", "/support": "view", "/trash": "view",
    }},
]

# Bildirim / UI etiketleri — sistem rolleri + eski owner takma adı.
SYSTEM_ROLE_LABELS = {
    "admin": "Yönetici",
    "owner": "Yönetici",
    "manager": "Müdür",
    "accountant": "Muhasebe",
    "sales": "Satış",
    "warehouse": "Depo",
    "production": "Üretim",
    "personel": "Personel",
    "advisor": "Mali Müşavir",
}


def normalize_role_code(code: Optional[str]) -> str:
    """Sahip (owner) eski kayıtlarda admin ile eşdeğerdir."""
    raw = str(code or "admin").strip().lower()
    if raw in ("owner", "yönetici", "yonetici"):
        return "admin"
    if raw in ("müdür", "mudur"):
        return "manager"
    return raw or "admin"


def role_label(code: Optional[str]) -> str:
    key = normalize_role_code(code)
    return SYSTEM_ROLE_LABELS.get(key) or SYSTEM_ROLE_LABELS.get(str(code or "").strip().lower()) or (code or "rol")

# Sistem rollerinde stok kartı yalnızca depo / yönetici. Personel ve üretim giremez.
FORCE_SYSTEM_PERMISSIONS = {
    "production": {"/stock": "none"},
    "personel": {"/stock": "none", "/personnel": "none"},
}

# API path prefix -> module key (longest prefix wins)
API_MODULE_MAP = [("/api/production/work-orders", "/atolye"), ("/api/production", "/production"), ("/api/invoices", "/invoices"), ("/api/einvoice", "/invoices"), ("/api/gib", "/invoices"),
                  ("/api/ai/invoice-extract", "/invoices"), ("/api/ai/expense-extract", "/expenses"), ("/api/ai/receipt-extract", "/expenses"), ("/api/ai/cheque-extract", "/cheques"), ("/api/tax-obligations", "/accountant"),
                  ("/api/ai/order-extract", "/orders"), ("/api/ai/product-extract", "/stock"), ("/api/ai/production-advisor", "/production"), ("/api/ai/production-summary", "/production"),
                  ("/api/contacts", "/contacts"), ("/api/installments", "/installments"), ("/api/reports", "/reports"), ("/api/banking", "/banking"), ("/api/expenses", "/expenses"), ("/api/loans", "/loans"), ("/api/cheques", "/cheques"), ("/api/products", "/stock"),
                  ("/api/purchase-orders", "/purchase-orders"), ("/api/warehouses/stock-counts", "/sayim"), ("/api/warehouses", "/warehouses"), ("/api/quotes", "/quotes"), ("/api/projects", "/projects"), ("/api/surveys", "/surveys"), ("/api/integrations/ecommerce", "/ecommerce"),
                  ("/api/integrations/cargo", "/cargo"), ("/api/cargo", "/cargo"), ("/api/order-picks", "/sevk"), ("/api/orders", "/orders"), ("/api/vehicles", "/vehicles"), ("/api/pos", "/hizli-satis"), ("/api/stock-lots", "/stock"), ("/api/returns", "/orders"), ("/api/personnel", "/personnel"),
                  ("/api/comm/sms/settings", "/settings"), ("/api/comm/sms/verify", "/settings"), ("/api/comm/sms/balance", "/settings"),
                  ("/api/comm", "/communication"), ("/api/ai", "/ai-advisor"), ("/api/accountant", "/accountant"), ("/api/fx", "/settings"), ("/api/companies", "/settings"), ("/api/users", "/settings"),
                  ("/api/roles", "/settings"), ("/api/activity-logs", "/settings"), ("/api/migration", "/settings"), ("/api/demo", "/settings"), ("/api/edocs", "/edoc-inbox"), ("/api/trade-files", "/dis-ticaret"), ("/api/support", "/support"), ("/api/trash", "/trash"), ("/api/dashboard", "/"), ("/api/sync", "/")]
# Modül yetkisi (RBAC) kontrolü atlanır — yine de oturum gerekebilir.
SKIP_PREFIXES = ("/api/auth", "/api/setup", "/api/public", "/api/files", "/api/notifications", "/api/health", "/api/version", "/api/mobile", "/api/system", "/api/platform", "/api/license", "/api/payments", "/api/webhook", "/api/personnel/me", "/api/personnel/messages", "/api/personnel/attendance/self", "/api/personnel/attendance/me", "/api/personnel/attendance/reminder-prefs", "/api/personnel/attendance/geo", "/api/personnel/attendance/early-leave-request", "/api/personnel/attendance/intraday-leave-request", "/api/personnel/leaves/self", "/api/personnel/leaves/me", "/api/personnel/bonuses/self")
SELF_SERVICE_SUFFIXES = ("/confirm", "/dispute", "/early-leave-cancel")

# Tokensız /api isteklerine izin verilen tek allowlist (varsayılan reddet).
# Önekler '/' ile biter; tam yollar birebir eşleşir.
PUBLIC_API_ALLOWLIST = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/google",
    "/api/auth/forgot-password",
    "/api/auth/reset/",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/2fa/verify",
    "/api/auth/impersonate/exit",
    "/api/auth/sso-exchange",
    "/api/public/",
    "/api/setup/",
    "/api/version",
    "/api/health/",
    "/api/mobile/manifest",
    "/api/platform/notices",
    "/api/platform/v1/",
    "/api/webhook/",
    "/api/payments/paytr/callback",
    "/api/payments/status/",
    "/api/comm/whatsapp/webhook",
    "/api/mail/webhooks/ses",
)

# Yalnızca GET/HEAD ile tokensız (yükleme / silme oturum ister)
_PUBLIC_GET_PREFIXES = ("/api/files/",)


def is_public_api_path(path: str, method: str = "GET", query_t: Optional[str] = None) -> bool:
    """Allowlist: tokensız erişime açık /api yolları (tek kaynak).

    Fatura PDF/XML için yalnızca GET + geçerli imza (?t=) kabul edilir.
    """
    if not path:
        return False
    p = path.split("?", 1)[0]
    method_u = (method or "GET").upper()
    if any(p == pref.rstrip("/") or p.startswith(pref) for pref in _PUBLIC_GET_PREFIXES):
        return method_u in ("GET", "HEAD")
    # İmzalı belge: allowlist'te sabit yol yok; geçerli HMAC zorunlu
    try:
        import signed_links
        if signed_links.is_signed_public_doc(p, method_u, query_t):
            return True
    except Exception:
        pass
    # impersonate/exit yalnızca POST
    if p == "/api/auth/impersonate/exit":
        return method_u == "POST"
    if p == "/api/platform/notices" or p == "/api/auth/me":
        return method_u in ("GET", "HEAD")
    for rule in PUBLIC_API_ALLOWLIST:
        if rule in ("/api/auth/impersonate/exit", "/api/platform/notices", "/api/auth/me"):
            continue  # method-specific above
        if rule.endswith("/"):
            if p == rule.rstrip("/") or p.startswith(rule):
                return True
        elif p == rule:
            return True
    return False


_license_guard = None


def set_license_guard(fn):
    global _license_guard
    _license_guard = fn


def init(db, mail_account_fn, current_user_dep):
    global _db, _mail_account, _current_user
    _db, _mail_account, _current_user = db, mail_account_fn, current_user_dep


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="RBAC auth bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    d.pop("password_hash", None)
    if "cashier_pin_hash" in d:
        d["has_cashier_pin"] = bool(d.pop("cashier_pin_hash"))
    return d


def apply_forced_system_permissions(code: Optional[str], perms: Dict[str, str]) -> Dict[str, str]:
    """Personel / üretim sistem rollerinde stok kartını kapalı tut."""
    out = dict(perms)
    for path, level in FORCE_SYSTEM_PERMISSIONS.get(code or "", {}).items():
        out[path] = level
    return out


def backfill_permissions(perms: Optional[Dict[str, str]]) -> Dict[str, str]:
    """Fill newly added module keys for legacy role docs (in-memory; does not mutate caller)."""
    p = dict(perms or {})
    p.setdefault("/dispatches", p.get("/invoices", "none"))
    p.setdefault("/trash", p.get("/settings", "none"))
    p.setdefault("/expenses", p.get("/banking", "none"))
    p.setdefault("/loans", p.get("/banking", "none"))
    p.setdefault("/cheques", p.get("/banking", "none"))
    p.setdefault("/quotes", p.get("/projects", "none"))
    p.setdefault("/surveys", p.get("/projects", "none"))
    p.setdefault("/edoc-inbox", p.get("/invoices", "none"))
    p.setdefault("/dis-ticaret", p.get("/invoices", "none"))
    p.setdefault("/b2b-yonetim", p.get("/contacts", "none"))
    p.setdefault("/sayim", "none")
    p.setdefault("/saha", p.get("/orders", "none"))
    p.setdefault("/sevk", "none")
    p.setdefault("/vehicles", p.get("/warehouses", "none"))
    p.setdefault("/mesai", "none")
    p.setdefault("/support", p.get("/communication", "none"))
    p.setdefault("/purchase-orders", p.get("/stock", "none"))
    # Eski üretim rollerinde /atolye anahtarı yoksa üretim seviyesini miras al
    p.setdefault("/atolye", p.get("/production", "none"))
    for m, _ in MODULES:
        p.setdefault(m, "none")
    return p


async def ensure_roles(company_id: str):
    if await _db.roles.count_documents({"company_id": company_id}) == 0:
        await _db.roles.insert_many([
            {
                "_id": f"role_{company_id}_{r['code']}",
                "company_id": company_id,
                **r,
                "permissions": {k: ("delete" if v == "edit" else v) for k, v in (r.get("permissions") or {}).items()},
                "perm_levels_v2": True,
                "created_at": _now(),
            }
            for r in DEFAULT_ROLES
        ])
        return
    existing = {r["code"]: r for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    for rdef in DEFAULT_ROLES:
        cur = existing.get(rdef["code"])
        if not cur:
            perms = {k: ("delete" if v == "edit" else v) for k, v in (rdef.get("permissions") or {}).items()}
            await _db.roles.insert_one({
                "_id": f"role_{company_id}_{rdef['code']}",
                "company_id": company_id,
                **{**rdef, "permissions": perms},
                "perm_levels_v2": True,
                "created_at": _now(),
            })
            continue
        upd: Dict[str, Any] = {}
        if cur.get("is_system") and cur.get("name") != rdef["name"]:
            upd["name"] = rdef["name"]
        raw = dict(cur.get("permissions") or {})
        missing = [m for m, _ in MODULES if m not in raw]
        if cur.get("code") == "admin":
            filled = _all("delete")
        else:
            filled = backfill_permissions(raw)
            # New catalog keys on system roles: prefer DEFAULT_ROLES over inheritance heuristics
            if cur.get("is_system") and missing:
                for m in missing:
                    if m in rdef["permissions"]:
                        # Seeded catalog still uses "edit" for full access modules — store as delete
                        lvl = rdef["permissions"][m]
                        filled[m] = "delete" if lvl == "edit" else lvl
        if cur.get("is_system"):
            filled = apply_forced_system_permissions(rdef.get("code"), filled)
        # Legacy: "edit" included delete. One-time promote to "delete" so Sil is the full-access level;
        # afterwards admins can set Düzenle to revoke silme without losing ekleme/güncelleme.
        if not cur.get("perm_levels_v2"):
            filled = {k: ("delete" if v == "edit" else v) for k, v in filled.items()}
            upd["perm_levels_v2"] = True
        if filled != raw:
            upd["permissions"] = filled
        if upd:
            await _db.roles.update_one({"_id": cur["_id"]}, {"$set": {**upd, "updated_at": _now()}})


async def role_for(user: dict, company_id: Optional[str] = None) -> Dict[str, Any]:
    code = normalize_role_code(user.get("role", "admin"))
    cid = company_id or user.get("active_company_id") or "comp_nexus_main_01"
    await ensure_roles(cid)
    r = await _db.roles.find_one({"company_id": cid, "code": code})
    if not r:
        # Bilinmeyen kod admin yetkisi almasın; en kısıtlı sistem rolüne düş.
        r = await _db.roles.find_one({"company_id": cid, "code": "personel"})
    if r:
        r["permissions"] = backfill_permissions(r.get("permissions"))
        if r.get("is_system"):
            r["permissions"] = apply_forced_system_permissions(r.get("code"), r["permissions"])
        if r.get("code") == "admin":
            r["permissions"] = _all("delete")
        return r
    return {
        "code": "personel",
        "name": "Personel",
        "permissions": apply_forced_system_permissions(
            "personel",
            backfill_permissions({"/": "view", "/mesai": "edit", "/atolye": "edit", "/support": "view"}),
        ),
    }

def module_for_path(path: str) -> Optional[str]:
    best = None
    for prefix, mod in API_MODULE_MAP:
        if path.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, mod)
    return best[1] if best else None


def is_accountant_evrak_ai_path(path: str, method: str = "POST") -> bool:
    """Mali müşavir paneli: fatura/fiş/çek/ekstre AI yükleme (danışman view olsa da)."""
    p = str(path or "")
    m = str(method or "POST").upper()
    if m not in ("POST", "PUT", "PATCH"):
        return False
    if p.startswith("/api/ai/invoice-extract"):
        return True
    if p.startswith("/api/ai/expense-extract"):
        return True
    if p.startswith("/api/ai/receipt-extract"):
        return True
    if p.startswith("/api/ai/cheque-extract"):
        return True
    if p.startswith("/api/loans/extract"):
        return True
    if p.startswith("/api/tax-obligations"):
        return True
    if p.startswith("/api/banking/") and "import-statement" in p:
        return True
    stripped = p.rstrip("/")
    if m == "POST" and stripped in ("/api/expenses", "/api/cheques"):
        return True
    return False


def mutation_allowed(module: Optional[str], path: str, perms: Dict[str, str], method: str = "POST") -> bool:
    """POST/PUT/PATCH: edit veya delete; DELETE (ve toplu silme): yalnızca delete. Atölye tablet işlemlerinde view de yeterli."""
    if not module:
        return True
    method_u = str(method or "").upper()
    destructive = method_u == "DELETE" or "bulk-delete" in path or path.rstrip("/").endswith("/delete")
    need = "delete" if destructive else "edit"
    if level_allows(perms.get(module, "none"), need):
        return True
    # Sipariş ekranından kargolama: /orders edit yeterli (ayrı /cargo yetkisi şart değil)
    if module == "/cargo" and (
        path.startswith("/api/cargo/create-shipment")
        or path.startswith("/api/cargo/auto-ship")
        or path.startswith("/api/cargo/geliver-balance")
    ):
        return need == "edit" and level_allows(perms.get("/orders", "none"), "edit")
    # Atölye ekranı (PIN + iş emri başlat/duraklat/bitir): modülü görebilen kullanıcı işletebilsin.
    # Özel "Atölye" rolü çoğu zaman view ile açılır; edit şartı operatör girişini 403 yapıyordu.
    if module == "/atolye" and path.startswith("/api/production/work-orders"):
        if need == "delete":
            return level_allows(perms.get("/atolye", "none"), "delete") or level_allows(
                perms.get("/production", "none"), "delete"
            )
        if level_allows(perms.get("/atolye", "none"), "view"):
            return True
        # Üretim edit yetkisi olanlar da atölye iş emirlerini işletebilir
        return level_allows(perms.get("/production", "none"), "edit")
    # Mali müşavir paneli: evrak AI yükleme (fatura/fiş/çek/ekstre) /ai-advisor gerektirmez.
    if need == "edit" and is_accountant_evrak_ai_path(path, method_u) and level_allows(perms.get("/accountant", "none"), "edit"):
        return True
    return False


class PermissionAndAuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        from fastapi.responses import JSONResponse

        path = request.url.path
        if not path.startswith("/api") or request.method in ("OPTIONS", "HEAD"):
            return await call_next(request)

        token = session_token(request)
        user = None
        if token:
            try:
                user = await get_user_from_token(token, _db, request=request, path=path)
            except HTTPException as exc:
                # Audience / auth failures for cookie-bearing requests → surface status
                if exc.status_code in (401, 403) and not is_public_api_path(path, request.method, request.query_params.get("t")):
                    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
                user = None

        query_t = request.query_params.get("t")
        # Varsayılan reddet: allowlist dışı tokensız /api → 401
        if not user and not is_public_api_path(path, request.method, query_t):
            return JSONResponse({"detail": "Giriş yapmanız gerekiyor."}, status_code=401)

        skip_rbac = path.startswith(SKIP_PREFIXES) or is_public_api_path(path, request.method, query_t)
        if skip_rbac and not user:
            return await call_next(request)

        if user and request.method not in ("GET", "HEAD", "OPTIONS"):
            import company_audit
            await company_audit.safe_prepare(request, _db, user)

        async def _audit_done(response):
            if user and request.method not in ("GET", "HEAD", "OPTIONS"):
                import company_audit
                await company_audit.safe_commit(request, _db, user, getattr(response, "status_code", 500))
            return response

        cid = None
        if user and not user.get("is_super_admin"):
            cid = request.query_params.get("company_id")
            if not cid:
                parts = path.strip("/").split("/")
                if len(parts) >= 3 and parts[0] == "api" and parts[1] == "companies":
                    cid = parts[2]
            if not cid:
                allowed = [c for c in (user.get("company_ids") or []) if c]
                cid = user.get("active_company_id") if user.get("active_company_id") in allowed else (allowed[0] if allowed else None)
                if cid and "company_id" not in request.query_params:
                    from urllib.parse import parse_qsl, urlencode
                    q = dict(parse_qsl(request.scope.get("query_string", b"").decode(), keep_blank_values=True))
                    q["company_id"] = cid
                    request.scope["query_string"] = urlencode(q).encode()
            if cid and cid not in (user.get("company_ids") or []):
                return JSONResponse({"detail": "Bu şirket hesabına erişiminiz yok."}, status_code=403)

        if skip_rbac:
            return await _audit_done(await call_next(request))

        module = module_for_path(path)
        # Mesaim self-service confirm/dispute is licensed under /mesai, not /personnel
        if path.startswith("/api/personnel/attendance/") and path.endswith(SELF_SERVICE_SUFFIXES):
            module = "/mesai"
        if _license_guard and module:
            blocked = await _license_guard(request, user, module)
            if blocked is not None:
                return blocked
        try:
            import addons as _addons
            addon_block = await _addons.guard_request(request, user, path)
            if addon_block is not None:
                return addon_block
        except Exception:
            pass
        portal_grant = False
        if user and not user.get("is_super_admin") and normalize_role_code(user.get("role")) != "admin":
            rule = portal_area_for_path(path)
            saha_post = request.method == "POST" and path.rstrip("/") == "/api/orders"
            if rule or (saha_post and normalize_role_code(user.get("role")) == "personel"):
                role = await role_for(user, cid)
                if rule:
                    _prefix, feat, mod = rule
                    if not portal_field_allowed(user, role, feat, mod, path, request.method):
                        return JSONResponse({"detail": portal_denial_detail(feat)}, status_code=403)
                    # Grant yalnız yöntem+yol listesindeki saha işleminde. Ayar, çöp,
                    # karar, DELETE ve araç CRUD mutation_allowed'da kalır.
                    if portal_feature_grant(user, role, feat, path, request.method):
                        portal_grant = True
                # Saha siparişi ortak /orders ucunu kullanır; personelde özellik açıkça gerekir.
                if saha_post and normalize_role_code(user.get("role")) == "personel":
                    if not role_features(role).get("portal_saha"):
                        return JSONResponse({"detail": portal_denial_detail("portal_saha")}, status_code=403)
                    portal_grant = True
        if request.method == "GET" or (path.startswith("/api/personnel/attendance/") and path.endswith(SELF_SERVICE_SUFFIXES)):
            response = await call_next(request)
            if user and user.get("role") != "admin" and "application/json" in (response.headers.get("content-type") or ""):
                role = await role_for(user)
                if not role_features(role)["view_prices"]:
                    import json as _json
                    body = b"".join([chunk async for chunk in response.body_iterator])
                    try:
                        data = mask_money(_json.loads(body))
                    except ValueError:
                        return await _audit_done(JSONResponse(content=None, status_code=response.status_code))
                    return await _audit_done(JSONResponse(content=data, status_code=response.status_code, headers={"X-Prices-Masked": "1"}))
            return await _audit_done(response)
        if user and user.get("role") != "admin" and module and not portal_grant:
            role = await role_for(user)
            perms = role.get("permissions", {})
            if not mutation_allowed(module, path, perms, request.method):
                return JSONResponse({"detail": f"Bu işlem için yetkiniz yok ({role.get('name')} rolü: {module})."}, status_code=403)
        response = await call_next(request)
        if response.status_code < 400 and user:
            ip = request_ip(request)
            await _db.activity_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": user.get("active_company_id") or "comp_nexus_main_01", "user_id": user.get("id"), "user_name": user.get("name"),
                                                "method": request.method, "path": path, "module": module, "ip": ip, "status": response.status_code, "created_at": _now()})
        return await _audit_done(response)


async def _notify_role_assigned(company_id: Optional[str], emp: Dict[str, Any], role: str, user_id: Optional[str]):
    if not company_id:
        return
    import notify as _notify
    name = emp.get("full_name") or emp.get("name") or "Personel"
    label = _notify.role_label(role)
    await _notify.insert_notification(_db, _notify.notification_doc(
        company_id, "role_assigned",
        f"Rol atandı: {label}",
        f"{name} kullanıcısına {label} rolü verildi.",
        link="/personnel",
        user_id=user_id or emp.get("user_id"),
        employee_id=emp.get("_id") or emp.get("id") or emp.get("employee_id"),
        ref_type="employee",
        ref_id=emp.get("_id") or emp.get("id") or emp.get("employee_id"),
    ))


# ---------------- Roles ----------------
@router.get("/roles")
async def list_roles(company_id: str = "comp_nexus_main_01"):
    await ensure_roles(company_id)
    roles = [_clean(r) for r in await _db.roles.find({"company_id": company_id}).to_list(100)]
    counts = {}
    async for u in _db.users.find({"company_ids": company_id, "is_super_admin": {"$ne": True}}, {"role": 1}):
        counts[u.get("role", "admin")] = counts.get(u.get("role", "admin"), 0) + 1
    company = await _db.companies.find_one({"_id": company_id}) or {}
    policies = {"cash_dual_approval": bool(company.get("cash_dual_approval"))}
    return {
        "modules": [{"key": k, "label": l, "help": MODULE_HELP.get(k, "")} for k, l in MODULES],
        "levels": list(LEVELS),
        "level_meta": list(LEVEL_META),
        "features": [
            {
                "key": k,
                "label": l,
                "help": h,
                "group": "portal" if k in PORTAL_FEATURE_KEYS else "detail",
            }
            for k, l, h in FEATURES
        ],
        "policies": policies,
        "roles": [{**r, "features": role_features(r), "user_count": counts.get(r["code"], 0)} for r in roles],
    }


@router.put("/roles/policies")
async def update_company_policies(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    company = await _db.companies.find_one({"_id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    upd: Dict[str, Any] = {}
    if "cash_dual_approval" in req:
        upd["cash_dual_approval"] = bool(req["cash_dual_approval"])
    if upd:
        await _db.companies.update_one({"_id": company_id}, {"$set": {**upd, "updated_at": _now()}})
    company = await _db.companies.find_one({"_id": company_id}) or {}
    return {"status": "success", "policies": {"cash_dual_approval": bool(company.get("cash_dual_approval"))}}


@router.post("/roles")
async def create_role(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rol adı boş olamaz.")
    code = (req.get("code") or "").strip().lower() or "r_" + secrets.token_hex(3)
    if await _db.roles.find_one({"company_id": company_id, "code": code}):
        raise HTTPException(status_code=400, detail="Bu rol kodu zaten var.")
    perms = {k: (req.get("permissions") or {}).get(k, "none") for k, _ in MODULES}
    # Normalize invalid levels; accept delete/edit/view/none
    perms = {k: (v if v in LEVELS else "none") for k, v in perms.items()}
    doc = {
        "_id": f"role_{company_id}_{code}",
        "company_id": company_id,
        "code": code,
        "name": name,
        "is_system": False,
        "permissions": perms,
        "features": {k: bool((req.get("features") or {}).get(k, feature_default(code, k))) for k, _, _ in FEATURES},
        "perm_levels_v2": True,
        "created_at": _now(),
    }
    await _db.roles.insert_one(doc)
    return _clean(doc)


@router.put("/roles/{role_id}")
async def update_role(role_id: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    r = await tenant_access.get_tenant_doc(_db, "roles", role_id, user, not_found="Rol bulunamadı.")
    upd: Dict[str, Any] = {}
    if req.get("name") and not r.get("is_system"):
        upd["name"] = req["name"].strip()
    if "permissions" in req:
        if r["code"] == "admin":
            raise HTTPException(status_code=400, detail="Yönetici rolünün yetkileri değiştirilemez.")
        upd["permissions"] = {k: (req["permissions"].get(k) if req["permissions"].get(k) in LEVELS else r["permissions"].get(k, "none")) for k, _ in MODULES}
        upd["perm_levels_v2"] = True
    if "features" in req:
        if r["code"] == "admin":
            raise HTTPException(status_code=400, detail="Yönetici rolünün yetkileri değiştirilemez.")
        cur = role_features(r)
        upd["features"] = {k: bool(req["features"].get(k, cur[k])) for k, _, _ in FEATURES}
    if upd:
        await _db.roles.update_one({"_id": role_id}, {"$set": {**upd, "updated_at": _now()}})
    return _clean(await _db.roles.find_one({"_id": role_id}))


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, user: dict = Depends(_user_dep)):
    r = await tenant_access.get_tenant_doc(_db, "roles", role_id, user, not_found="Rol bulunamadı.")
    if r.get("is_system"):
        raise HTTPException(status_code=400, detail="Sistem rolleri silinemez.")
    if await _db.users.count_documents({"role": r["code"], "company_ids": r["company_id"], "is_super_admin": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Bu role sahip kullanıcılar var; önce rollerini değiştirin.")
    await _db.roles.delete_one({"_id": role_id})
    return {"status": "success"}


# ---------------- Users ----------------
@router.get("/users")
async def list_users(company_id: str = "comp_nexus_main_01"):
    await ensure_roles(company_id)
    names = {r["code"]: r["name"] for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    raw_users = await _db.users.find({"$and": [{"$or": [{"company_ids": company_id}, {"active_company_id": company_id}]}, {"is_super_admin": {"$ne": True}}]}).sort("name", 1).to_list(500)
    for u in raw_users:
        await user_numbers.ensure_user_number(_db, u)
    users = [_clean(u) for u in raw_users]
    invites = [_clean(i) for i in await _db.user_invites.find({"company_id": company_id, "accepted_at": None}).sort("created_at", -1).to_list(100)]
    emp_ids = {u.get("employee_id") for u in users if u.get("employee_id")} | {i.get("employee_id") for i in invites if i.get("employee_id")}
    emp_names = {}
    if emp_ids:
        async for e in _db.employees.find({"_id": {"$in": list(emp_ids)}}, {"full_name": 1}):
            emp_names[str(e.get("_id"))] = e.get("full_name") or ""

    def _enrich(row: dict) -> dict:
        eid = row.get("employee_id")
        code = row.get("role")
        return {
            **row,
            "role_name": names.get(code) or role_label(code),
            "employee_name": emp_names.get(str(eid), "") if eid else "",
        }

    import saas
    lid = await saas.license_id_of(company_id)
    sibling_docs = await saas.companies_on_license(lid)
    assignable = [uca.company_brief(c) for c in sibling_docs if c.get("_id")]
    return {
        "users": [{**_enrich(u), "is_active": u.get("is_active", True), "company_ids": list(u.get("company_ids") or [])} for u in users],
        "invites": [_enrich(i) for i in invites],
        "assignable_companies": assignable,
    }


def _actor_is_company_admin(actor: dict) -> bool:
    """Şirket kullanıcı yönetimi: admin/owner veya süper admin."""
    if not actor:
        return False
    if actor.get("is_super_admin"):
        return True
    role = normalize_role_code(actor.get("role"))
    return role == "admin"


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: Dict[str, Any], request: Request):
    import phone_norm as _phone_norm
    actor = await _current_user(request) if _current_user else None
    if not actor:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    # Diğer kullanıcıları yalnızca şirket yöneticisi düzenler; kendi profili → PUT /auth/me.
    if not _actor_is_company_admin(actor):
        raise HTTPException(status_code=403, detail="Bu kullanıcıyı düzenleme yetkiniz yok.")
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Platform yöneticileri şirket kullanıcı listesinden düzenlenemez.")
    if not tenant_access.users_share_company(actor, u):
        raise HTTPException(status_code=403, detail="Bu kullanıcıyı düzenleme yetkiniz yok.")
    upd = {k: req[k] for k in ("name", "role", "is_active", "employee_id") if k in req}
    if "name" in upd:
        name = str(upd.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Ad soyad boş olamaz.")
        upd["name"] = name
    if "phone" in req:
        try:
            phone_fields = _phone_norm.phone_update_fields(req.get("phone"), allow_empty=True)
            await _phone_norm.ensure_unique_phone_norm(
                _db, phone_fields.get("phone_norm"), exclude_user_id=user_id,
            )
            upd.update(phone_fields)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    email_changed = False
    old_email = (u.get("email") or "").strip().lower()
    if "email" in req:
        email = (req.get("email") or "").strip().lower()
        if not email or "@" not in email:
            raise HTTPException(status_code=400, detail="Geçerli bir e-posta girin.")
        other = await _db.users.find_one({"email": email})
        if other and other["_id"] != user_id:
            raise HTTPException(status_code=400, detail="Bu e-posta başka bir kullanıcıya ait.")
        if email != old_email:
            upd["email"] = email
            email_changed = True
            # Mevcut JWT'ler iat < sessions_revoked_at ile reddedilir (yeniden giriş).
            upd["sessions_revoked_at"] = _now()
    if "role" in upd:
        role_code = normalize_role_code(upd["role"])
        upd["role"] = role_code
        company_id = str(
            req.get("company_id")
            or u.get("active_company_id")
            or ((u.get("company_ids") or [None])[0])
            or ""
        ).strip()
        if company_id:
            await ensure_roles(company_id)
            if not await _db.roles.find_one({"company_id": company_id, "code": role_code}):
                raise HTTPException(status_code=400, detail="Geçersiz rol.")
        if u.get("is_super_admin") and role_code != "admin":
            raise HTTPException(status_code=400, detail="Platform yöneticisinin rolü değiştirilemez.")
    if req.get("password"):
        if len(req["password"]) < 6:
            raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
        upd["password_hash"] = hash_password(req["password"])
    if "company_ids" in req:
        import saas
        context_cid = str(req.get("company_id") or u.get("active_company_id") or ((u.get("company_ids") or [None])[0]) or "").strip()
        if not context_cid:
            raise HTTPException(status_code=400, detail="Şirket bağlamı gerekli.")
        lid = await saas.license_id_of(context_cid)
        assignable_ids = [c["_id"] for c in await saas.companies_on_license(lid)]
        chosen = uca.filter_assignable_company_ids(req.get("company_ids"), assignable_ids)
        if not chosen:
            raise HTTPException(status_code=400, detail="En az bir şirket seçilmeli (lisans grubundaki hesaplar).")
        upd["company_ids"] = chosen
        upd["active_company_id"] = uca.resolve_active_company_id(chosen, u.get("active_company_id"))
    if "employee_id" in upd:
        eid = upd.get("employee_id") or None
        if eid in ("", None):
            upd["employee_id"] = None
        else:
            emp = await _db.employees.find_one({"_id": eid})
            if not emp:
                raise HTTPException(status_code=400, detail="Personel bulunamadı.")
            if not tenant_access.user_may_access_company(actor, emp.get("company_id")):
                raise HTTPException(status_code=403, detail="Bu personele erişiminiz yok.")
            upd["employee_id"] = eid
    if not upd:
        return _clean(await _db.users.find_one({"_id": user_id}))
    await _db.users.update_one({"_id": user_id}, {"$set": {**upd, "updated_at": _now()}})
    if email_changed:
        # Bekleyen sıfırlama bağlantılarını da iptal et.
        try:
            await _db.password_resets.update_many(
                {"user_id": user_id, "used_at": None},
                {"$set": {"used_at": _now(), "revoked": True}},
            )
        except Exception:
            pass
    if "employee_id" in upd:
        old_eid = u.get("employee_id")
        new_eid = upd.get("employee_id")
        if old_eid and old_eid != new_eid:
            await _db.employees.update_one({"_id": old_eid, "user_id": user_id}, {"$unset": {"user_id": ""}})
        if new_eid:
            await _db.employees.update_one({"_id": new_eid}, {"$set": {"user_id": user_id}})
    if email_changed:
        company_id = u.get("active_company_id") or ((u.get("company_ids") or [None])[0])
        try:
            await _db.activity_logs.insert_one({
                "_id": str(uuid.uuid4()),
                "company_id": company_id,
                "user_id": actor.get("_id") or actor.get("id"),
                "user_name": actor.get("name"),
                "method": "PUT",
                "path": f"/users/{user_id}",
                "module": "/settings",
                "status": 200,
                "detail": f"email_change:{old_email}->{upd.get('email')}",
                "created_at": _now(),
            })
        except Exception:
            pass
    if "role" in upd and upd["role"] != u.get("role"):
        await _notify_role_assigned(u.get("active_company_id") or (u.get("company_ids") or [None])[0], {
            "full_name": upd.get("name") or u.get("name"),
            "_id": upd.get("employee_id") if "employee_id" in upd else u.get("employee_id"),
            "user_id": user_id,
        }, upd["role"], user_id)
    return _clean(await _db.users.find_one({"_id": user_id}))


@router.post("/users")
async def create_company_user(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    """Create a company user immediately with a password (no e-mail invite)."""
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    email = (req.get("email") or "").strip().lower()
    name = (req.get("name") or "").strip() or (email.split("@")[0] if email else "")
    pwd = req.get("password") or ""
    role = req.get("role") or "sales"
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Geçerli bir e-posta girin.")
    if not name:
        raise HTTPException(status_code=400, detail="Ad soyad girin.")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kayıtlı kullanıcı zaten var.")
    await ensure_roles(company_id)
    import saas
    await saas.check_user_limit(company_id)
    role = normalize_role_code(role)
    if not await _db.roles.find_one({"company_id": company_id, "code": role}):
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    import phone_norm as _phone_norm
    try:
        phone_fields = _phone_norm.phone_update_fields(req.get("phone") or "", allow_empty=True)
        await _phone_norm.ensure_unique_phone_norm(_db, phone_fields.get("phone_norm"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {"_id": user_id, "email": email, "password_hash": hash_password(pwd), "name": name, "role": role,
           "company_ids": [company_id], "active_company_id": company_id, "is_active": True,
           "employee_id": req.get("employee_id"), "phone": phone_fields.get("phone") or "",
           "phone_norm": phone_fields.get("phone_norm"), "preferences": {},
           "user_number": await user_numbers.next_user_number(_db), "created_at": _now()}
    await _db.users.insert_one(doc)
    await _db.user_invites.delete_many({"company_id": company_id, "email": email, "accepted_at": None})
    if req.get("employee_id"):
        await _db.employees.update_one({"_id": req["employee_id"]}, {"$set": {"user_id": user_id, "email": email}})
    await _notify_role_assigned(company_id, {"full_name": name, "_id": req.get("employee_id"), "user_id": user_id}, role, user_id)
    names = {r["code"]: r["name"] for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    out = _clean(dict(doc))
    return {**out, "role_name": names.get(role, role), "is_active": True, "message": f"{name} eklendi. {email} ile giriş yapabilir."}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    actor = await _current_user(request) if _current_user else None
    if not actor:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Platform yöneticileri şirket kullanıcı listesinden silinemez.")
    if not tenant_access.users_share_company(actor, u):
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    await _db.users.delete_one({"_id": user_id})
    return {"status": "success"}


# ---------------- Invitations ----------------
@router.post("/users/invite")
async def invite_user(req: Dict[str, Any], request: Request):
    actor = await _current_user(request) if _current_user else None
    if not actor:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    company_id = tenant_access.resolve_company_id(actor, req.get("company_id"))
    email = (req.get("email") or "").strip().lower()
    phone = (req.get("phone") or "").strip()
    channels = [c for c in (req.get("channels") or ["email"]) if c in ("email", "sms", "whatsapp")]
    if not channels:
        channels = ["email"]
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Geçerli bir e-posta girin.")
    if ("sms" in channels or "whatsapp" in channels) and not phone:
        raise HTTPException(status_code=400, detail="SMS / WhatsApp için telefon numarası gerekli.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kayıtlı kullanıcı zaten var.")
    role = normalize_role_code(req.get("role") or "sales")
    await ensure_roles(company_id)
    import saas
    await saas.check_user_limit(company_id)
    if not await _db.roles.find_one({"company_id": company_id, "code": role}):
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    company = await _db.companies.find_one({"_id": company_id}) or {}
    token = secrets.token_urlsafe(32)
    import public_url as pu
    _inv_ctx = "ik" if req.get("employee_id") or role == "personel" else "app"
    base = await pu.public_base_url_for(
        _db, _inv_ctx, explicit=req.get("base_url") or "", request=request,
    )
    link = f"{base}/davet/{token}"
    doc = {
        "_id": token,
        "company_id": company_id,
        "company_name": company.get("name"),
        "email": email,
        "phone": phone or None,
        "name": (req.get("name") or "").strip(),
        "role": role,
        "employee_id": req.get("employee_id"),
        "invited_by": req.get("invited_by"),
        "link": link,
        "channels": channels,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "accepted_at": None,
        "created_at": _now(),
    }
    await _db.user_invites.delete_many({"company_id": company_id, "email": email, "accepted_at": None})
    await _db.user_invites.insert_one(doc)

    role_name = ((await _db.roles.find_one({"company_id": company_id, "code": role})) or {}).get("name") or role
    invitee = doc["name"] or "Merhaba"
    firm = company.get("name") or "Firmamız"
    short_msg = f"{invitee}, {firm} sizi TamKobi'ye '{role_name}' rolüyle davet etti. Hesap: {link} (7 gün)"
    mail_body = f"Merhaba {doc['name'] or ''},\n{firm} sizi TamKobi sistemine '{role_name}' rolüyle davet etti. Hesabınızı oluşturmak için: {link}\nBu link 7 gün geçerlidir."

    delivery: Dict[str, Any] = {}
    mail = {"status": "skipped", "detail": "E-posta kanalı seçilmedi."}
    if "email" in channels:
        mail = {"status": "skipped", "detail": "E-posta hesabı tanımlı değil; linki kopyalayıp iletin."}
        try:
            a = await _mail_account(company_id)
            subject = f"{firm} sizi davet ediyor"
            html = f"<p>{mail_body.replace(chr(10), '<br>')}</p><p><a href='{link}' style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold'>Daveti Kabul Et</a></p>"
            await comm_service.smtp_send(a, [email], subject, mail_body, html=html)
            mail = {"status": "sent", "detail": f"{email} adresine davet gönderildi."}
        except HTTPException as e:
            mail = {"status": "skipped", "detail": e.detail}
        except Exception as e:
            mail = {"status": "failed", "detail": f"SMTP hatası: {str(e)[:120]}"}
    delivery["mail"] = mail

    if "sms" in channels:
        try:
            from server import _send_sms_to  # lazy — circular import yok
            r = await _send_sms_to(
                company_id,
                [{"phone": phone, "contact_name": doc.get("name")}],
                short_msg,
                "user_invite",
                token,
            )
            delivery["sms"] = comm_service.sms_channel_result(r) if hasattr(comm_service, "sms_channel_result") else {
                "status": "sent" if r.get("sent") else ("failed" if r.get("failed") else "simulated"),
                "detail": r.get("message") or r.get("error") or "SMS işlendi.",
            }
        except HTTPException as e:
            delivery["sms"] = {"status": "failed", "detail": e.detail}
        except Exception as e:
            delivery["sms"] = {"status": "failed", "detail": str(e)[:160]}

    if "whatsapp" in channels:
        try:
            from server import wa_send  # lazy
            r = await wa_send({
                "company_id": company_id,
                "phone": phone,
                "message": short_msg,
                "contact_name": doc.get("name"),
            })
            delivery["whatsapp"] = {
                "status": r.get("status") or "simulated",
                "detail": r.get("message_info") or "WhatsApp işlendi.",
                "wa_link": r.get("wa_link"),
            }
        except HTTPException as e:
            delivery["whatsapp"] = {"status": "failed", "detail": e.detail}
        except Exception as e:
            delivery["whatsapp"] = {"status": "failed", "detail": str(e)[:160]}

    await _db.user_invites.update_one({"_id": token}, {"$set": {"mail": mail, "delivery": delivery}})
    await _notify_role_assigned(company_id, {"full_name": doc.get("name") or email, "_id": req.get("employee_id")}, role, None)
    summary_bits = []
    for ch, res in delivery.items():
        if not res:
            continue
        st = res.get("status")
        if st in ("sent", "simulated"):
            summary_bits.append(f"{ch}: {res.get('detail') or st}")
        elif st == "failed":
            summary_bits.append(f"{ch} hata: {res.get('detail')}")
    return {
        **_clean(doc),
        "mail": mail,
        "delivery": delivery,
        "message": " · ".join(summary_bits) if summary_bits else (mail.get("detail") or "Davet oluşturuldu."),
    }


@router.delete("/users/invite/{token}")
async def cancel_invite(token: str, request: Request):
    inv = await _db.user_invites.find_one({"_id": token})
    if not inv:
        return {"status": "success"}
    user = await _current_user(request) if _current_user else None
    import tenant_access
    if not user or not tenant_access.user_may_access_company(user, inv.get("company_id")):
        raise HTTPException(status_code=404, detail="Davet bulunamadı.")
    await _db.user_invites.delete_one({"_id": token})
    return {"status": "success"}


@router.get("/public/invites/{token}")
async def get_invite(token: str):
    inv = await _db.user_invites.find_one({"_id": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Davet bulunamadı veya iptal edilmiş.")
    if inv.get("accepted_at"):
        raise HTTPException(status_code=400, detail="Bu davet zaten kullanılmış. Giriş yapabilirsiniz.")
    if inv.get("expires_at") < _now():
        raise HTTPException(status_code=400, detail="Davetin süresi dolmuş; yöneticinizden yeni davet isteyin.")
    role = await _db.roles.find_one({"company_id": inv["company_id"], "code": inv["role"]}) or {}
    return {
        "email": inv["email"],
        "name": inv.get("name"),
        "company_name": inv.get("company_name"),
        "role": inv.get("role"),
        "role_name": role.get("name", inv["role"]),
        "employee_id": inv.get("employee_id"),
    }


@router.post("/public/invites/{token}/accept")
async def accept_invite(token: str, req: Dict[str, Any], request: Request, response: Response):
    import json as _json
    import auth_handoff
    import host_audience as _ha
    import public_url as pu

    inv = await _db.user_invites.find_one({"_id": token})
    if not inv or inv.get("accepted_at") or inv.get("expires_at") < _now():
        raise HTTPException(status_code=400, detail="Davet geçersiz, kullanılmış veya süresi dolmuş.")
    pwd = req.get("password") or ""
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": inv["email"]}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kullanıcı zaten var.")
    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {"_id": user_id, "email": inv["email"], "password_hash": hash_password(pwd), "name": (req.get("name") or inv.get("name") or inv["email"].split("@")[0]).strip(), "role": inv["role"],
           "company_ids": [inv["company_id"]], "active_company_id": inv["company_id"], "is_active": True, "employee_id": inv.get("employee_id"), "preferences": {},
           "user_number": await user_numbers.next_user_number(_db), "created_at": _now()}
    await _db.users.insert_one(doc)
    await _db.user_invites.update_one({"_id": token}, {"$set": {"accepted_at": _now(), "user_id": user_id}})
    if inv.get("employee_id"):
        await _db.employees.update_one({"_id": inv["employee_id"]}, {"$set": {"user_id": user_id}})
    # personel → ik; diğerleri → app
    target_kind = _ha.KIND_IK if (inv.get("employee_id") or (inv.get("role") or "").strip().lower() == "personel") else _ha.KIND_APP
    aud = _ha.AUD_IK if target_kind == _ha.KIND_IK else _ha.AUD_APP
    access = create_access_token(user_id, doc["email"], doc["role"], aud=aud)
    refresh = create_refresh_token(user_id)
    kind = _ha.host_kind(request)
    out = {
        "status": "success",
        "user": _clean(dict(doc)),
        "message": "Hesabınız oluşturuldu, giriş yapıldı.",
    }
    if kind == target_kind:
        response.set_cookie(key="access_token", value=access, **auth_cookie_kwargs(request, max_age=86400 * 7))
        response.set_cookie(key="refresh_token", value=refresh, **auth_cookie_kwargs(request, max_age=86400 * 30))
        out["redirect"] = "/personelim" if target_kind == _ha.KIND_IK else "/panel"
    else:
        blob = _json.dumps({"access_token": access, "sa_return": ""})
        code = await auth_handoff.create_handoff(_db, blob, purpose="invite")
        base = await pu.public_base_url_for(_db, target_kind)
        out["redirect"] = f"{base}/sso?code={code}"
    return out


# ---------------- Activity log ----------------
@router.get("/activity-logs")
async def activity_logs(company_id: str = "comp_nexus_main_01", user_id: Optional[str] = None, module: Optional[str] = None, limit: int = 100):
    q: Dict[str, Any] = {"company_id": company_id}
    if user_id:
        q["user_id"] = user_id
    if module:
        q["module"] = module
    return [_clean(x) for x in await _db.activity_logs.find(q).sort("created_at", -1).to_list(min(limit, 500))]
