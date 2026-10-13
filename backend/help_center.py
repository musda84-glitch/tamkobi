"""In-app help center: YNT CMS + product-tagged distribution (TamKobi / TamEticaret).

Published articles are served over public, session, and HMAC platform-v1 APIs so
sibling products can reuse the same copy. Drafts stay on /api/system/help.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request

router = APIRouter(prefix="/api")
_db = None
_current_user = None

PRODUCT_TAMKOBI = "tamkobi"
PRODUCT_TAMETICARET = "tameticaret"
PRODUCT_CODES = (PRODUCT_TAMKOBI, PRODUCT_TAMETICARET)
CONTENT_ARTICLE = "article"
CONTENT_VIDEO = "video"
CONTENT_TYPES = (CONTENT_ARTICLE, CONTENT_VIDEO)
STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
STATUSES = (STATUS_DRAFT, STATUS_PUBLISHED)
LOCALES = ("tr", "en")
MAX_BODY = 80_000
MAX_TITLE = 180
MAX_SUMMARY = 400
MAX_LIST = 200
COLL = "help_articles"

_FOLD = str.maketrans(
    "çğıöşüâîûÇĞİÖŞÜÂÎÛ",
    "cgiosuaiuCGIOSUAIU",
)


def init(db, current_user_dep=None):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def fold_text(value: Optional[str], *, keep_spaces: bool = False) -> str:
    raw = str(value or "").strip().translate(_FOLD).lower()
    if keep_spaces:
        return re.sub(r"[^a-z0-9]+", " ", raw).strip()
    return re.sub(r"[^a-z0-9]+", "", raw)


def slugify(title: str) -> str:
    folded = fold_text(title, keep_spaces=True)
    slug = re.sub(r"\s+", "-", folded).strip("-")[:80]
    return slug or "makale"


def normalize_product_tags(raw) -> List[str]:
    if raw is None:
        raw = [PRODUCT_TAMKOBI]
    if isinstance(raw, str):
        raw = [raw]
    out, seen = [], set()
    for item in raw:
        code = str(item or "").strip().lower()
        if code not in PRODUCT_CODES or code in seen:
            continue
        seen.add(code)
        out.append(code)
    if not out:
        out = [PRODUCT_TAMKOBI]
    return out


def normalize_status(raw: Optional[str], *, default: str = STATUS_DRAFT) -> str:
    st = str(raw or default).strip().lower() or default
    return st if st in STATUSES else default


def normalize_content_type(raw: Optional[str]) -> str:
    ct = str(raw or CONTENT_ARTICLE).strip().lower() or CONTENT_ARTICLE
    return ct if ct in CONTENT_TYPES else CONTENT_ARTICLE


def normalize_page_keys(raw) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out, seen = [], set()
    for item in raw:
        key = str(item or "").strip()
        if not key.startswith("/"):
            key = f"/{key.lstrip('/')}"
        key = key[:80]
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out[:40]


def normalize_tags(raw) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [p.strip() for p in raw.split(",")]
    out, seen = [], set()
    for item in raw:
        tag = str(item or "").strip()[:40]
        if not tag or tag.lower() in seen:
            continue
        seen.add(tag.lower())
        out.append(tag)
    return out[:24]


def normalize_assistant(raw) -> Dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    prompts = src.get("suggested_prompts") or src.get("prompts") or []
    if isinstance(prompts, str):
        prompts = [prompts]
    keywords = src.get("keywords") or []
    if isinstance(keywords, str):
        keywords = [p.strip() for p in keywords.split(",")]
    return {
        "intent": str(src.get("intent") or "").strip()[:80],
        "keywords": [str(k).strip()[:40] for k in keywords if str(k).strip()][:24],
        "suggested_prompts": [str(p).strip()[:180] for p in prompts if str(p).strip()][:8],
    }


def public_article(doc: Optional[dict], *, include_body: bool = True) -> Optional[dict]:
    if not doc:
        return None
    out = {
        "id": str(doc.get("_id") or doc.get("id") or ""),
        "slug": doc.get("slug") or "",
        "title": doc.get("title") or "",
        "summary": doc.get("summary") or "",
        "content_type": normalize_content_type(doc.get("content_type")),
        "video_url": doc.get("video_url") or "",
        "video_duration_sec": int(doc.get("video_duration_sec") or 0),
        "product_tags": list(doc.get("product_tags") or []),
        "page_keys": list(doc.get("page_keys") or []),
        "category": doc.get("category") or "",
        "tags": list(doc.get("tags") or []),
        "locale": doc.get("locale") or "tr",
        "featured": bool(doc.get("featured")),
        "sort": int(doc.get("sort") or 0),
        "published_at": doc.get("published_at"),
        "updated_at": doc.get("updated_at"),
        "assistant": normalize_assistant(doc.get("assistant")),
    }
    if include_body:
        out["body_md"] = doc.get("body_md") or ""
        out["transcript"] = doc.get("transcript") or ""
    return out


def admin_article(doc: Optional[dict]) -> Optional[dict]:
    row = public_article(doc, include_body=True)
    if not row:
        return None
    row["status"] = normalize_status(doc.get("status"))
    row["created_at"] = doc.get("created_at")
    row["created_by"] = doc.get("created_by") or ""
    return row


def article_matches_query(doc: dict, q: str) -> bool:
    needle = fold_text(q)
    if not needle:
        return True
    blobs = [
        doc.get("title"),
        doc.get("summary"),
        doc.get("body_md"),
        doc.get("transcript"),
        doc.get("category"),
        " ".join(doc.get("tags") or []),
        " ".join((doc.get("assistant") or {}).get("keywords") or []),
        " ".join(doc.get("page_keys") or []),
    ]
    hay = fold_text(" ".join(str(b or "") for b in blobs))
    return all(part in hay for part in needle.split())


def filter_published(
    rows: Iterable[dict],
    *,
    product: str,
    q: str = "",
    page_key: str = "",
    content_type: str = "",
    locale: str = "",
) -> List[dict]:
    product = str(product or "").strip().lower() or PRODUCT_TAMKOBI
    page_key = str(page_key or "").strip()
    content_type = str(content_type or "").strip().lower()
    locale = str(locale or "").strip().lower()
    out = []
    for doc in rows:
        if normalize_status(doc.get("status"), default=STATUS_PUBLISHED) != STATUS_PUBLISHED:
            continue
        if product not in (doc.get("product_tags") or []):
            continue
        if page_key and page_key not in (doc.get("page_keys") or []):
            continue
        if content_type and normalize_content_type(doc.get("content_type")) != content_type:
            continue
        if locale and str(doc.get("locale") or "tr").lower() != locale:
            continue
        if not article_matches_query(doc, q):
            continue
        out.append(doc)
    out.sort(key=lambda d: (-int(bool(d.get("featured"))), int(d.get("sort") or 0), str(d.get("title") or "")))
    return out


def build_assistant_context(
    *,
    product: str,
    page_key: str,
    page_summary: str,
    articles: List[dict],
) -> Dict[str, Any]:
    """Stable payload a future AI assistant can ingest without scraping the UI."""
    related = [public_article(a, include_body=False) for a in articles[:8]]
    prompts = []
    for a in articles:
        for p in (normalize_assistant(a.get("assistant")).get("suggested_prompts") or []):
            if p not in prompts:
                prompts.append(p)
    return {
        "product": product,
        "page_key": page_key or "",
        "page_summary": page_summary or "",
        "related_articles": related,
        "suggested_prompts": prompts[:8],
        "chat_endpoint": "/api/ai/help-chat",
        "chat_ready": False,
        "instructions": (
            "Cevapları related_articles ve page_summary ile sınırla. "
            "Bilinmiyorsa yardım merkezine yönlendir. İleride POST chat_endpoint bağlanır."
        ),
    }


SEED_ARTICLES = (
    {
        "slug": "ilk-kurulum",
        "title": "İlk kurulum sihirbazı",
        "summary": "Firma bilgileri, logo, e-fatura, ilk cari, ürün ve faturayı adım adım tamamlayın.",
        "body_md": (
            "Girişten sonra **ilk kurulum sihirbazı** açılır. Adımlar:\n\n"
            "1. Firma unvanı, VKN, vergi dairesi ve adres\n"
            "2. Logo yükleme\n"
            "3. e-Fatura entegratör bilgileri (platform atadıysa)\n"
            "4. İlk cari kartı\n"
            "5. İlk stok/ürün kartı\n"
            "6. İlk satış faturası (taslak)\n\n"
            "Her adım **Atla** ile geçilebilir. İlerleme çubuğu üstte görünür. "
            "Sihirbazı kapatırsanız Yardım (?) menüsünden yeniden açabilirsiniz."
        ),
        "page_keys": ["/panel", "/settings", "/yardim"],
        "category": "Başlangıç",
        "tags": ["kurulum", "sihirbaz"],
        "assistant": {
            "intent": "onboarding",
            "keywords": ["kurulum", "sihirbaz", "ilk fatura"],
            "suggested_prompts": ["Kurulum sihirbazını nasıl yeniden açarım?", "e-Fatura adımını atlayabilir miyim?"],
        },
    },
    {
        "slug": "fatura-nasil-kesilir",
        "title": "Satış faturası nasıl kesilir?",
        "summary": "Cari seçin, kalem ekleyin, taslak kaydedin veya onaylayıp GİB'e gönderin.",
        "body_md": (
            "1. **Faturalar** menüsünden **Yeni Fatura**.\n"
            "2. Cari seçin (veya hızlı cari ekleyin).\n"
            "3. Ürün/hizmet satırı ekleyin; KDV otomatik hesaplanır.\n"
            "4. **Taslak kaydet** veya **Onayla**.\n"
            "5. e-Fatura / e-Arşiv için GİB gönderimini fatura satırından yapın.\n\n"
            "Üst çubuktaki yeşil **Yeni Fatura** kısayolu da aynı formu açar."
        ),
        "page_keys": ["/invoices", "/panel"],
        "category": "Muhasebe",
        "tags": ["fatura", "e-fatura"],
        "assistant": {
            "intent": "create_invoice",
            "keywords": ["fatura", "kes", "e-arşiv"],
            "suggested_prompts": ["Taslak faturayı nasıl onaylarım?", "Faturayı GİB'e nasıl gönderirim?"],
        },
    },
    {
        "slug": "cari-nasil-eklenir",
        "title": "Cari hesap nasıl eklenir?",
        "summary": "Müşteri veya tedarikçi kartı açın; GİB unvan sorgusu VKN ile doldurulabilir.",
        "body_md": (
            "**Cari Hesaplar → Yeni Cari Ekle**. Tür (müşteri/tedarikçi/her ikisi), unvan ve VKN/TCKN zorunludur. "
            "GİB sorgusu vergi numarasından unvan ve adresi doldurur. Fatura formundan da hızlı cari açabilirsiniz."
        ),
        "page_keys": ["/contacts", "/invoices"],
        "category": "Muhasebe",
        "tags": ["cari", "müşteri"],
        "assistant": {
            "intent": "create_contact",
            "keywords": ["cari", "müşteri", "tedarikçi"],
            "suggested_prompts": ["VKN ile cari nasıl bulunur?"],
        },
    },
    {
        "slug": "urun-nasil-eklenir",
        "title": "Ürün / stok kartı nasıl açılır?",
        "summary": "Stoklar ekranından ürün adı, SKU, KDV ve satış fiyatı ile kart oluşturun.",
        "body_md": (
            "**Stoklar & Ürünler → Ürün Ekle**. Barkod boşsa sistem üretir. Varyant, etiket ve pazaryeri eşlemesi "
            "kart kaydından sonra açılır. Fatura satırından da stok kartı türetilebilir."
        ),
        "page_keys": ["/stock", "/invoices"],
        "category": "Stok",
        "tags": ["ürün", "stok", "barkod"],
        "assistant": {
            "intent": "create_product",
            "keywords": ["ürün", "stok", "barkod"],
            "suggested_prompts": ["Barkod otomatik oluşur mu?"],
        },
    },
    {
        "slug": "efatura-baglantisi",
        "title": "e-Fatura entegratörü nasıl bağlanır?",
        "summary": "Entegratörü platform atar; firma kullanıcı adı/şifre veya İşNet VKN-alias girer.",
        "body_md": (
            "Entegratör seçimi **ynt.taiyazilim.com → Şirketler** ekranındandır. "
            "Firma tarafında **Ayarlar → e-Fatura** ile kullanıcı, şifre, kurum kodu veya İşNet SOAP (VKN + alias) girilir. "
            "Test bağlantısı yeşil olduktan sonra giden kutusu ve gelen e-belge çalışır."
        ),
        "page_keys": ["/settings", "/invoices", "/edoc-inbox"],
        "category": "e-Belge",
        "tags": ["e-fatura", "işnet", "gib"],
        "assistant": {
            "intent": "einvoice_connect",
            "keywords": ["e-fatura", "entegratör", "işnet"],
            "suggested_prompts": ["Entegratör neden seçilemiyor?"],
        },
    },
    {
        "slug": "sayfa-yardimi-ve-tur",
        "title": "Sayfa yardımı ve baloncuklu tur",
        "summary": "Her ekrandaki ? düğmesi kısa anlatım açar; Tur ile önemli düğmeler işaretlenir.",
        "body_md": (
            "Sağ üstteki **?** düğmesi: bu sayfada ne yapılır, hangi düğmeler önemli, ilgili Nasıl yapılır? makaleleri. "
            "**Sayfa turu** baloncuklarla adım adım gösterir. Turu atlayabilirsiniz; tekrar ? menüsünden başlatılır."
        ),
        "page_keys": ["/panel", "/yardim"],
        "category": "Başlangıç",
        "tags": ["yardım", "tur"],
        "assistant": {
            "intent": "page_tour",
            "keywords": ["tur", "yardım", "?"],
            "suggested_prompts": ["Sayfa turunu nasıl başlatırım?"],
        },
    },
    {
        "slug": "siparis-kargoya-hazirlama",
        "title": "Siparişi kargoya nasıl hazırlarım?",
        "summary": "Pazaryeri siparişini onaylayın, faturayı kesin, kargo etiketi alın.",
        "body_md": (
            "E-ticaret siparişleri **Siparişler** listesine düşer. Onay → faturala → kargo entegrasyonundan etiket. "
            "Stok eşleşmesi yoksa önce ürün kartı açın."
        ),
        "page_keys": ["/orders", "/ecommerce", "/cargo"],
        "category": "E-Ticaret",
        "tags": ["sipariş", "kargo"],
        "product_tags": [PRODUCT_TAMKOBI, PRODUCT_TAMETICARET],
        "assistant": {
            "intent": "ship_order",
            "keywords": ["sipariş", "kargo", "etiket"],
            "suggested_prompts": ["Kargo etiketi nereden basılır?"],
        },
    },
    {
        "slug": "tameticaret-vitrin-urun",
        "title": "TamEticaret vitrine ürün ekleme",
        "summary": "Ürün kartını vitrine alın, görsel ve fiyat yayınlayın. TamKobi stok kartıyla aynı içerik etiketini paylaşır.",
        "body_md": (
            "TamEticaret vitrininde ürün **Yayınla** ile görünür. SKU TamKobi stok kartıyla eşleşiyorsa stok ve fiyat "
            "ortak API üzerinden gelir. Bu makale `tameticaret` ürün etiketiyle dağıtılır; TamKobi yardımında da görünür."
        ),
        "page_keys": ["/ecommerce", "/stock"],
        "category": "E-Ticaret",
        "tags": ["vitrin", "tameticaret"],
        "content_type": CONTENT_VIDEO,
        "video_url": "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "product_tags": [PRODUCT_TAMETICARET, PRODUCT_TAMKOBI],
        "assistant": {
            "intent": "publish_storefront",
            "keywords": ["vitrin", "yayınla", "tameticaret"],
            "suggested_prompts": ["Vitrin ürünü TamKobi stoğuyla nasıl eşleşir?"],
        },
    },
)


def _seed_doc(seed: dict, now: str) -> dict:
    slug = seed["slug"]
    tags = normalize_product_tags(seed.get("product_tags") or [PRODUCT_TAMKOBI])
    return {
        "_id": f"help_{slug}",
        "slug": slug,
        "title": seed["title"],
        "summary": seed.get("summary") or "",
        "body_md": seed.get("body_md") or "",
        "transcript": seed.get("transcript") or "",
        "content_type": normalize_content_type(seed.get("content_type")),
        "video_url": seed.get("video_url") or "",
        "video_duration_sec": int(seed.get("video_duration_sec") or 0),
        "product_tags": tags,
        "page_keys": normalize_page_keys(seed.get("page_keys")),
        "category": seed.get("category") or "",
        "tags": normalize_tags(seed.get("tags")),
        "locale": seed.get("locale") or "tr",
        "status": STATUS_PUBLISHED,
        "featured": bool(seed.get("featured")),
        "sort": int(seed.get("sort") or 0),
        "assistant": normalize_assistant(seed.get("assistant")),
        "published_at": now,
        "created_at": now,
        "updated_at": now,
        "created_by": "seed",
    }


async def ensure_seeded(db=None) -> int:
    db = db or _db
    if db is None:
        return 0
    existing = await db.help_articles.find_one({})
    if existing:
        return 0
    now = _now()
    n = 0
    for seed in SEED_ARTICLES:
        await db.help_articles.insert_one(_seed_doc(seed, now))
        n += 1
    return n


def _patch_from_body(req: Dict[str, Any], existing: Optional[dict] = None) -> Dict[str, Any]:
    existing = existing or {}
    title = str(req.get("title") if "title" in req else existing.get("title") or "").strip()[:MAX_TITLE]
    if not title:
        raise HTTPException(status_code=400, detail="Başlık gerekli.")
    slug_in = str(req.get("slug") if "slug" in req else existing.get("slug") or "").strip()
    slug = slugify(slug_in or title)
    body = str(req.get("body_md") if "body_md" in req else existing.get("body_md") or "")[:MAX_BODY]
    summary = str(req.get("summary") if "summary" in req else existing.get("summary") or "").strip()[:MAX_SUMMARY]
    status = normalize_status(req.get("status") if "status" in req else existing.get("status"))
    now = _now()
    published_at = existing.get("published_at")
    if status == STATUS_PUBLISHED and not published_at:
        published_at = now
    if status == STATUS_DRAFT:
        published_at = published_at  # keep history
    locale = str(req.get("locale") if "locale" in req else existing.get("locale") or "tr").strip().lower()
    if locale not in LOCALES:
        locale = "tr"
    return {
        "slug": slug,
        "title": title,
        "summary": summary,
        "body_md": body,
        "transcript": str(req.get("transcript") if "transcript" in req else existing.get("transcript") or "")[:MAX_BODY],
        "content_type": normalize_content_type(req.get("content_type") if "content_type" in req else existing.get("content_type")),
        "video_url": str(req.get("video_url") if "video_url" in req else existing.get("video_url") or "").strip()[:500],
        "video_duration_sec": max(0, int(req.get("video_duration_sec") if "video_duration_sec" in req else existing.get("video_duration_sec") or 0)),
        "product_tags": normalize_product_tags(req.get("product_tags") if "product_tags" in req else existing.get("product_tags")),
        "page_keys": normalize_page_keys(req.get("page_keys") if "page_keys" in req else existing.get("page_keys")),
        "category": str(req.get("category") if "category" in req else existing.get("category") or "").strip()[:60],
        "tags": normalize_tags(req.get("tags") if "tags" in req else existing.get("tags")),
        "locale": locale,
        "status": status,
        "featured": bool(req.get("featured") if "featured" in req else existing.get("featured")),
        "sort": int(req.get("sort") if "sort" in req else existing.get("sort") or 0),
        "assistant": normalize_assistant(req.get("assistant") if "assistant" in req else existing.get("assistant")),
        "published_at": published_at,
        "updated_at": now,
    }


async def _require_unique_slug(slug: str, *, exclude_id: Optional[str] = None):
    cur = await _db.help_articles.find_one({"slug": slug})
    if cur and str(cur.get("_id")) != str(exclude_id or ""):
        raise HTTPException(status_code=409, detail="Bu slug zaten kullanılıyor.")


async def fetch_published(
    *,
    product: str,
    q: str = "",
    page_key: str = "",
    content_type: str = "",
    locale: str = "",
    limit: int = 50,
) -> List[dict]:
    await ensure_seeded()
    product = str(product or "").strip().lower() or PRODUCT_TAMKOBI
    if product not in PRODUCT_CODES:
        raise HTTPException(status_code=400, detail="Geçersiz ürün etiketi. tamkobi veya tameticaret kullanın.")
    limit = max(1, min(int(limit or 50), MAX_LIST))
    rows = await _db.help_articles.find({"status": STATUS_PUBLISHED, "product_tags": product}).to_list(MAX_LIST)
    filtered = filter_published(
        rows, product=product, q=q, page_key=page_key, content_type=content_type, locale=locale
    )
    return filtered[:limit]


async def fetch_by_slug(slug: str, *, product: str, include_drafts: bool = False) -> dict:
    await ensure_seeded()
    slug = str(slug or "").strip()
    doc = await _db.help_articles.find_one({"slug": slug})
    if not doc:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    if not include_drafts and normalize_status(doc.get("status")) != STATUS_PUBLISHED:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    product = str(product or "").strip().lower() or PRODUCT_TAMKOBI
    if product not in (doc.get("product_tags") or []):
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    return doc


async def _require_super_admin(request: Request):
    import saas
    return await saas.require_super_admin(request)


def _meta() -> dict:
    return {
        "products": [{"key": PRODUCT_TAMKOBI, "label": "TamKobi"}, {"key": PRODUCT_TAMETICARET, "label": "TamEticaret"}],
        "content_types": [{"key": CONTENT_ARTICLE, "label": "Makale"}, {"key": CONTENT_VIDEO, "label": "Video"}],
        "statuses": [{"key": STATUS_DRAFT, "label": "Taslak"}, {"key": STATUS_PUBLISHED, "label": "Yayında"}],
        "locales": [{"key": "tr", "label": "Türkçe"}, {"key": "en", "label": "English"}],
    }


# ---------- Public distribution (TamEticaret + in-app) ----------

@router.get("/public/help/meta")
async def public_help_meta():
    return _meta()


@router.get("/public/help/articles")
async def public_help_list(
    product: str = Query(PRODUCT_TAMKOBI),
    q: str = Query(""),
    page_key: str = Query(""),
    content_type: str = Query(""),
    locale: str = Query(""),
    limit: int = Query(50),
):
    rows = await fetch_published(
        product=product, q=q, page_key=page_key, content_type=content_type, locale=locale, limit=limit
    )
    return {
        "product": product,
        "count": len(rows),
        "articles": [public_article(r, include_body=False) for r in rows],
    }


@router.get("/public/help/articles/{slug}")
async def public_help_get(slug: str, product: str = Query(PRODUCT_TAMKOBI)):
    doc = await fetch_by_slug(slug, product=product)
    return public_article(doc, include_body=True)


@router.get("/public/help/search")
async def public_help_search(
    q: str = Query(""),
    product: str = Query(PRODUCT_TAMKOBI),
    page_key: str = Query(""),
    content_type: str = Query(""),
    limit: int = Query(20),
):
    rows = await fetch_published(
        product=product, q=q, page_key=page_key, content_type=content_type, limit=limit
    )
    return {"product": product, "q": q, "count": len(rows), "articles": [public_article(r, include_body=False) for r in rows]}


# ---------- Tenant session (TamKobi app) ----------

@router.get("/help/articles")
async def tenant_help_list(
    request: Request,
    q: str = Query(""),
    page_key: str = Query(""),
    content_type: str = Query(""),
    product: str = Query(PRODUCT_TAMKOBI),
    limit: int = Query(50),
):
    if _current_user:
        await _current_user(request)
    rows = await fetch_published(product=product, q=q, page_key=page_key, content_type=content_type, limit=limit)
    return {
        "product": product,
        "count": len(rows),
        "articles": [public_article(r, include_body=False) for r in rows],
    }


@router.get("/help/articles/{slug}")
async def tenant_help_get(slug: str, request: Request, product: str = Query(PRODUCT_TAMKOBI)):
    if _current_user:
        await _current_user(request)
    doc = await fetch_by_slug(slug, product=product)
    return public_article(doc, include_body=True)


@router.get("/help/assistant/context")
async def tenant_assistant_context(
    request: Request,
    page: str = Query(""),
    product: str = Query(PRODUCT_TAMKOBI),
    summary: str = Query(""),
):
    if _current_user:
        await _current_user(request)
    page_key = str(page or "").strip()
    rows = await fetch_published(product=product, page_key=page_key, limit=12)
    if page_key and not rows:
        rows = await fetch_published(product=product, q=page_key.strip("/"), limit=8)
    return build_assistant_context(product=product, page_key=page_key, page_summary=summary, articles=rows)


# ---------- YNT CMS ----------

@router.get("/system/help/meta")
async def system_help_meta(_: dict = Depends(_require_super_admin)):
    await ensure_seeded()
    return _meta()


@router.get("/system/help/articles")
async def system_help_list(
    q: str = Query(""),
    product: str = Query(""),
    status: str = Query(""),
    content_type: str = Query(""),
    _: dict = Depends(_require_super_admin),
):
    await ensure_seeded()
    rows = await _db.help_articles.find({}).to_list(MAX_LIST)
    st = str(status or "").strip().lower()
    product = str(product or "").strip().lower()
    content_type = str(content_type or "").strip().lower()
    out = []
    for doc in rows:
        if st and normalize_status(doc.get("status")) != st:
            continue
        if product and product not in (doc.get("product_tags") or []):
            continue
        if content_type and normalize_content_type(doc.get("content_type")) != content_type:
            continue
        if not article_matches_query(doc, q):
            continue
        out.append(doc)
    out.sort(key=lambda d: (str(d.get("title") or "")))
    return {"count": len(out), "articles": [admin_article(r) for r in out]}


@router.post("/system/help/articles")
async def system_help_create(req: Dict[str, Any] = Body(...), admin: dict = Depends(_require_super_admin)):
    await ensure_seeded()
    patch = _patch_from_body(req, {})
    await _require_unique_slug(patch["slug"])
    now = _now()
    doc = {
        "_id": f"help_{uuid.uuid4().hex[:12]}",
        **patch,
        "created_at": now,
        "created_by": (admin or {}).get("email") or (admin or {}).get("name") or "admin",
    }
    await _db.help_articles.insert_one(doc)
    return {"status": "success", "article": admin_article(doc)}


@router.get("/system/help/articles/{article_id}")
async def system_help_get(article_id: str, _: dict = Depends(_require_super_admin)):
    doc = await _db.help_articles.find_one({"_id": article_id})
    if not doc:
        doc = await _db.help_articles.find_one({"slug": article_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    return admin_article(doc)


@router.put("/system/help/articles/{article_id}")
async def system_help_update(
    article_id: str,
    req: Dict[str, Any] = Body(...),
    _: dict = Depends(_require_super_admin),
):
    cur = await _db.help_articles.find_one({"_id": article_id})
    if not cur:
        cur = await _db.help_articles.find_one({"slug": article_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    patch = _patch_from_body(req, cur)
    await _require_unique_slug(patch["slug"], exclude_id=str(cur.get("_id")))
    await _db.help_articles.update_one({"_id": cur["_id"]}, {"$set": patch})
    doc = await _db.help_articles.find_one({"_id": cur["_id"]})
    return {"status": "success", "article": admin_article(doc)}


@router.delete("/system/help/articles/{article_id}")
async def system_help_delete(article_id: str, _: dict = Depends(_require_super_admin)):
    cur = await _db.help_articles.find_one({"_id": article_id})
    if not cur:
        cur = await _db.help_articles.find_one({"slug": article_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Makale bulunamadı.")
    await _db.help_articles.delete_one({"_id": cur["_id"]})
    return {"status": "success"}
