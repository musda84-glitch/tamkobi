"""Çok siteli vitrin: tamkobi.com (paket vitrini) ve taiyazilim.com (kurumsal).

Kimlik `sites` koleksiyonunda (id, slug, marka, canlı adres, tema, aktif).
İçerik `site_content`, iletişim formu `site_inquiries`. tamkobi kaydı ilk
çalıştırmada platform ayarındaki marka ve adresten oluşur; sonraki
açılışlar bu kaydı ezmez.
"""
from __future__ import annotations

import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

import host_audience as ha
import saas

router = APIRouter(prefix="/api")
seo_router = APIRouter()

_db = None

SITE_TAMKOBI = "site_tamkobi"
SITE_TAI = "site_tai"
SLUG_TAMKOBI = "tamkobi"
SLUG_TAI = "tai"
THEME_VITRIN = "vitrin"
THEME_CORPORATE = "corporate"

TAI_HOSTS = ("taiyazilim.com", "www.taiyazilim.com")
TAMKOBI_HOSTS = ("tamkobi.com", "www.tamkobi.com")
TAI_LOGO = "/brand/tai/tai_yazilim_logo.svg"
TAI_COLORS = {"navy": "#13295B", "red": "#CC1F26"}

PAGE_KEYS = ("home", "about", "services", "references", "contact")
HONEYPOT_FIELD = "hp_company"
RATE_MAX = 5
RATE_WINDOW_SEC = 3600

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_CARD_ID_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")


def init(db):
    global _db
    _db = db


def db_ready() -> bool:
    return _db is not None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _norm_url(value: Any) -> str:
    return _clip(value, 500).rstrip("/")


def _hostname(url: str) -> str:
    raw = (url or "").strip()
    if "://" in raw:
        raw = raw.split("://", 1)[1]
    raw = raw.split("/", 1)[0].split("?", 1)[0]
    return ha._strip_port(raw)


def _preview_host(host: str) -> bool:
    h = ha._strip_port(host)
    if not h or h in {"localhost", "127.0.0.1"} or h.endswith(".localhost"):
        return True
    return h == ha.ynt_host()


def hosts_for(slug: str, public_url: str) -> List[str]:
    """Apex + www. ynt.taiyazilim.com asla pazarlama hostu olmaz."""
    if slug == SLUG_TAI:
        base = list(TAI_HOSTS)
    else:
        base = list(TAMKOBI_HOSTS)
    extra = _hostname(public_url)
    if extra and not extra.startswith("ynt.") and extra != ha.ynt_host():
        names = [extra]
        if extra.startswith("www."):
            names.append(extra[4:])
        else:
            names.append(f"www.{extra}")
        for name in names:
            if name and name not in base and not name.startswith("ynt."):
                base.append(name)
    return base


def _clean_image(url: Any) -> str:
    s = _clip(url, 500)
    if not s:
        return ""
    if s.startswith("/api/files/") or s.startswith("/brand/"):
        return s
    if s.startswith("https://") and not s.startswith("https://javascript"):
        return s
    return ""


def _clean_href(url: Any) -> str:
    s = _clip(url, 500)
    if not s:
        return ""
    if s.startswith("/") or s.startswith("https://") or s.startswith("http://"):
        return s
    return ""


def _page(key: str, src: Optional[dict]) -> dict:
    src = src or {}
    published = src.get("published")
    base = {
        "seo_title": _clip(src.get("seo_title"), 180),
        "seo_description": _clip(src.get("seo_description"), 320),
        "published": True if published is None else bool(published),
    }
    if key == "home":
        base.update({
            "hero_title": _clip(src.get("hero_title"), 180),
            "hero_text": _clip(src.get("hero_text"), 4000),
            "hero_image": _clean_image(src.get("hero_image")),
        })
    elif key == "contact":
        base.update({
            "title": _clip(src.get("title"), 180),
            "text": _clip(src.get("text"), 4000),
            "email": _clip(src.get("email"), 180),
            "phone": _clip(src.get("phone"), 40),
            "address": _clip(src.get("address"), 400),
        })
    else:
        base.update({
            "title": _clip(src.get("title"), 180),
            "text": _clip(src.get("text"), 4000),
            "image": _clean_image(src.get("image")),
        })
    return base


def _card_id(prefix: str, raw: Any) -> str:
    cid = str((raw or {}).get("id") or "").strip().lower()
    if _CARD_ID_RE.fullmatch(cid):
        return cid
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _cards(raw: Any, prefix: str, *, with_href: bool = False) -> List[dict]:
    if not isinstance(raw, list):
        return []
    out = []
    seen = set()
    for i, item in enumerate(raw[:40]):
        if not isinstance(item, dict):
            continue
        cid = _card_id(prefix, item)
        if cid in seen:
            cid = f"{prefix}_{uuid.uuid4().hex[:8]}"
        seen.add(cid)
        row = {
            "id": cid,
            "title": _clip(item.get("title"), 180),
            "text": _clip(item.get("text"), 2000),
            "image": _clean_image(item.get("image")),
            "sort": int(item.get("sort") if str(item.get("sort") or "").lstrip("-").isdigit() else i),
            "published": bool(item.get("published", True)),
        }
        if with_href:
            row["href"] = _clean_href(item.get("href"))
        out.append(row)
    out.sort(key=lambda r: (r["sort"], r["title"]))
    return out


def normalize_content(raw: Optional[dict]) -> dict:
    raw = raw or {}
    pages_in = raw.get("pages") if isinstance(raw.get("pages"), dict) else {}
    return {
        "pages": {key: _page(key, pages_in.get(key)) for key in PAGE_KEYS},
        "services": _cards(raw.get("services"), "svc"),
        "references": _cards(raw.get("references"), "ref"),
        "products": _cards(raw.get("products"), "prd", with_href=True),
    }


def public_content(content: Optional[dict]) -> Optional[dict]:
    if not content:
        return None
    norm = normalize_content(content)
    pages = {}
    for key, page in norm["pages"].items():
        if page.get("published"):
            pages[key] = page

    def _vis(rows):
        return [r for r in rows if r.get("published")]

    return {
        "pages": pages,
        "services": _vis(norm["services"]),
        "references": _vis(norm["references"]),
        "products": _vis(norm["products"]),
    }


def default_tai_content() -> dict:
    return {
        "_id": SITE_TAI,
        "site_id": SITE_TAI,
        "pages": {
            "home": {
                "seo_title": "TAI Yazılım | Kurumsal yazılım ve TamKobi",
                "seo_description": "TAI Yazılım; kurumsal yazılım, bulut ERP ve entegrasyon geliştirir. TamKobi ile fatura, stok ve üretimi tek panelden yönetin.",
                "hero_title": "İşletmeniz için güvenilir yazılım",
                "hero_text": "Kurumsal yazılım, bulut ERP ve entegrasyon. TamKobi ile fatura, stok, cari ve üretimi tek panelde topluyoruz.",
                "hero_image": "",
                "published": True,
            },
            "about": {
                "seo_title": "Hakkımızda | TAI Yazılım",
                "seo_description": "TAI Yazılım, işletmelerin günlük işini sadeleştiren yazılımlar üretir. TamKobi ürünümüz operasyonu tek panelde birleştirir.",
                "title": "Hakkımızda",
                "text": "TAI Yazılım, işletmelerin günlük işini sadeleştiren yazılımlar üretir. TamKobi ürünümüz fatura, stok, e-ticaret ve üretimi tek panelde birleştirir. Projeyi ihtiyaca göre kurar, yayına aldıktan sonra da yanında kalırız.",
                "image": "",
                "published": True,
            },
            "services": {
                "seo_title": "Hizmetler | TAI Yazılım",
                "seo_description": "Kurumsal yazılım, bulut ERP, entegrasyon ve devreye alma. TAI Yazılım hizmetlerini inceleyin.",
                "title": "Hizmetler",
                "text": "Yazılımı işletmenin kendi akışına göre kurarız. Hazır ürün, entegrasyon ve danışmanlık aynı ekipte yürür.",
                "image": "",
                "published": True,
            },
            "references": {
                "seo_title": "Referanslar | TAI Yazılım",
                "seo_description": "Üretim, ticaret ve hizmet işletmelerinde yürüttüğümüz işler. Referansları panelden güncelleyebilirsiniz.",
                "title": "Referanslar",
                "text": "Çalıştığımız iş kollarından örnekler. Kartları panelden kendi referanslarınızla değiştirin.",
                "image": "",
                "published": True,
            },
            "contact": {
                "seo_title": "İletişim | TAI Yazılım",
                "seo_description": "TAI Yazılım ile projenizi konuşun. İletişim formundan gelen talepler panelde listelenir.",
                "title": "İletişim",
                "text": "Projenizi kısaca yazın, size dönüş yapalım.",
                "email": "info@taiyazilim.com",
                "phone": "",
                "address": "",
                "published": True,
            },
        },
        "services": [
            {"id": "svc_yazilim", "title": "Kurumsal yazılım", "text": "İhtiyaca göre web ve iş uygulamaları.", "image": "", "sort": 0, "published": True},
            {"id": "svc_erp", "title": "Bulut ERP", "text": "TamKobi ile fatura, stok, cari ve üretim.", "image": "", "sort": 1, "published": True},
            {"id": "svc_entegrasyon", "title": "Entegrasyon", "text": "e-Fatura, pazaryeri ve banka bağlantıları.", "image": "", "sort": 2, "published": True},
            {"id": "svc_danismanlik", "title": "Danışmanlık", "text": "Süreç analizi ve devreye alma.", "image": "", "sort": 3, "published": True},
        ],
        "references": [
            {"id": "ref_uretim", "title": "Üretim", "text": "Üretim emri, reçete ve stok takibi.", "image": "", "sort": 0, "published": True},
            {"id": "ref_ticaret", "title": "Ticaret", "text": "Sipariş, e-belge ve kargo süreçleri.", "image": "", "sort": 1, "published": True},
            {"id": "ref_hizmet", "title": "Hizmet", "text": "Cari, tahsilat ve teklif düzeni.", "image": "", "sort": 2, "published": True},
        ],
        "products": [
            {
                "id": "prd_tamkobi",
                "title": "TamKobi",
                "text": "KOBİ'ler için bulut ERP: fatura, stok, e-ticaret ve üretim tek panelde.",
                "image": "",
                "href": "https://tamkobi.com",
                "sort": 0,
                "published": True,
            },
        ],
    }


def _public_site(site: dict, content: Optional[dict]) -> dict:
    slug = site.get("slug") or ""
    theme = site.get("theme") or THEME_VITRIN
    out = {
        "id": site.get("_id"),
        "slug": slug,
        "brand_name": site.get("brand_name") or "",
        "public_url": site.get("public_url") or "",
        "theme": theme,
        "active": bool(site.get("active", True)),
        "logo": TAI_LOGO if slug == SLUG_TAI else "/brand/tamkobi-mark.svg",
        "colors": TAI_COLORS if theme == THEME_CORPORATE else None,
        "content": public_content(content) if theme == THEME_CORPORATE else None,
    }
    return out


def _admin_site(site: dict) -> dict:
    return {
        "id": site.get("_id"),
        "slug": site.get("slug"),
        "brand_name": site.get("brand_name") or "",
        "public_url": site.get("public_url") or "",
        "theme": site.get("theme") or THEME_VITRIN,
        "active": bool(site.get("active", True)),
        "hosts": list(site.get("hosts") or []),
        "plans": site.get("slug") == SLUG_TAMKOBI,
    }


async def ensure_seeded() -> None:
    """tamkobi kaydı yoksa platform ayarından oluştur. Var olan kaydı ezme."""
    if _db is None:
        return
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    if not await _db.sites.find_one({"_id": SITE_TAMKOBI}):
        brand = str(st.get("brand_name") or "").strip() or "TamKobi"
        url = _norm_url(st.get("public_url") or "") or "https://tamkobi.com"
        now = _now()
        await _db.sites.insert_one({
            "_id": SITE_TAMKOBI,
            "slug": SLUG_TAMKOBI,
            "brand_name": brand,
            "public_url": url,
            "theme": THEME_VITRIN,
            "active": True,
            "hosts": hosts_for(SLUG_TAMKOBI, url),
            "created_at": now,
            "updated_at": now,
        })
    if not await _db.sites.find_one({"_id": SITE_TAI}):
        now = _now()
        await _db.sites.insert_one({
            "_id": SITE_TAI,
            "slug": SLUG_TAI,
            "brand_name": "TAI Yazılım",
            "public_url": "https://taiyazilim.com",
            "theme": THEME_CORPORATE,
            "active": True,
            "hosts": list(TAI_HOSTS),
            "created_at": now,
            "updated_at": now,
        })
    if not await _db.site_content.find_one({"_id": SITE_TAI}):
        doc = default_tai_content()
        doc["updated_at"] = _now()
        await _db.site_content.insert_one(doc)


async def sync_tamkobi_from_settings(fields: dict) -> None:
    """Platform ayarındaki marka / canlı adres tamkobi site kaydına yansır."""
    if _db is None or not fields:
        return
    if "brand_name" not in fields and "public_url" not in fields:
        return
    await ensure_seeded()
    site = await _db.sites.find_one({"_id": SITE_TAMKOBI}) or {}
    upd: Dict[str, Any] = {}
    if "brand_name" in fields:
        upd["brand_name"] = _clip(fields.get("brand_name"), 120) or "TamKobi"
    url = site.get("public_url") or ""
    if "public_url" in fields:
        url = _norm_url(fields.get("public_url") or "")
        upd["public_url"] = url
    if "public_url" in upd or "brand_name" in fields:
        upd["hosts"] = hosts_for(SLUG_TAMKOBI, url if "public_url" in upd else (site.get("public_url") or ""))
    if upd:
        upd["updated_at"] = _now()
        await _db.sites.update_one({"_id": SITE_TAMKOBI}, {"$set": upd})


async def tamkobi_identity() -> Optional[dict]:
    if _db is None:
        return None
    return await _db.sites.find_one({"_id": SITE_TAMKOBI})


async def _all_sites() -> List[dict]:
    cur = _db.sites.find({})
    rows = await cur.to_list(20)
    rows.sort(key=lambda r: 0 if r.get("slug") == SLUG_TAMKOBI else 1)
    return rows


async def _by_slug(slug: str) -> Optional[dict]:
    return await _db.sites.find_one({"slug": slug})


async def site_for_host(host: str) -> Optional[dict]:
    h = ha._strip_port(host)
    if not h or h == ha.ynt_host():
        return None
    kind = ha.host_kind_from_hostname(h)
    if kind != ha.KIND_SITE:
        return None
    await ensure_seeded()
    for site in await _all_sites():
        if h in (site.get("hosts") or []):
            return site
    if h in TAI_HOSTS:
        return await _by_slug(SLUG_TAI)
    return await _by_slug(SLUG_TAMKOBI)


def _base_url(site: dict) -> str:
    url = _norm_url(site.get("public_url") or "")
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if site.get("slug") == SLUG_TAI:
        return "https://taiyazilim.com"
    return "https://tamkobi.com"


def _tamkobi_robots(base: str) -> str:
    return (
        "# TamKobi — herkese açık vitrin\n"
        "User-agent: *\n"
        "Allow: /\n"
        "Allow: /web\n"
        "Allow: /fiyatlar\n"
        "Allow: /kayit\n"
        "Allow: /yasal/\n"
        "Allow: /b2b/giris\n"
        "\n"
        "# Uygulama / yönetim (dizine eklenmez)\n"
        "Disallow: /panel\n"
        "Disallow: /login\n"
        "Disallow: /sistem\n"
        "Disallow: /sistem/\n"
        "Disallow: /api/\n"
        "Disallow: /kurulum\n"
        "Disallow: /hesap\n"
        "Disallow: /settings\n"
        "Disallow: /trash\n"
        "Disallow: /portal/\n"
        "Disallow: /davet/\n"
        "Disallow: /odeme/\n"
        "Disallow: /yenile/\n"
        "\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )


def _tai_robots(base: str) -> str:
    return (
        "# TAI Yazılım\n"
        "User-agent: *\n"
        "Allow: /\n"
        "Allow: /hakkimizda\n"
        "Allow: /hizmetler\n"
        "Allow: /referanslar\n"
        "Allow: /iletisim\n"
        "\n"
        "Disallow: /api/\n"
        "Disallow: /sistem\n"
        "Disallow: /panel\n"
        "\n"
        f"Sitemap: {base}/sitemap.xml\n"
    )


def _urlset(locs: List[tuple]) -> str:
    rows = ["<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
            "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"]
    for loc, freq, prio in locs:
        rows.append("  <url>")
        rows.append(f"    <loc>{xml_escape(loc)}</loc>")
        rows.append(f"    <changefreq>{freq}</changefreq>")
        rows.append(f"    <priority>{prio}</priority>")
        rows.append("  </url>")
    rows.append("</urlset>")
    return "\n".join(rows) + "\n"


def _tamkobi_sitemap(base: str) -> str:
    return _urlset([
        (f"{base}/", "weekly", "1.0"),
        (f"{base}/web", "weekly", "0.9"),
        (f"{base}/kayit", "monthly", "0.8"),
        (f"{base}/yasal/on-bilgilendirme", "yearly", "0.4"),
        (f"{base}/yasal/kvkk", "yearly", "0.4"),
        (f"{base}/yasal/mesafeli-satis", "yearly", "0.4"),
        (f"{base}/b2b/giris", "monthly", "0.3"),
    ])


def _tai_sitemap(base: str, content: Optional[dict]) -> str:
    paths = [("/", "home", "1.0"), ("/hakkimizda", "about", "0.8"), ("/hizmetler", "services", "0.8"),
             ("/referanslar", "references", "0.6"), ("/iletisim", "contact", "0.7")]
    pub = (public_content(content) or {}).get("pages") or {}
    locs = []
    for path, key, prio in paths:
        if key in pub or key == "home":
            locs.append((f"{base}{path if path != '/' else '/'}", "weekly" if key == "home" else "monthly", prio))
    if not locs:
        locs = [(f"{base}/", "weekly", "1.0")]
    return _urlset(locs)


async def robots_body(host: str) -> str:
    h = ha._strip_port(host)
    if ha.host_kind_from_hostname(h) != ha.KIND_SITE:
        return "User-agent: *\nDisallow: /\n"
    site = await site_for_host(h)
    if not site or site.get("slug") != SLUG_TAI:
        base = _base_url(site or {"slug": SLUG_TAMKOBI, "public_url": "https://tamkobi.com"})
        return _tamkobi_robots(base)
    return _tai_robots(_base_url(site))


async def sitemap_body(host: str) -> str:
    h = ha._strip_port(host)
    if ha.host_kind_from_hostname(h) != ha.KIND_SITE:
        return _urlset([])
    site = await site_for_host(h)
    if not site or site.get("slug") != SLUG_TAI:
        base = _base_url(site or {"slug": SLUG_TAMKOBI, "public_url": "https://tamkobi.com"})
        return _tamkobi_sitemap(base)
    content = await _db.site_content.find_one({"_id": site["_id"]}) if _db is not None else None
    return _tai_sitemap(_base_url(site), content)


def client_ip(request: Request) -> str:
    headers = getattr(request, "headers", None) or {}
    peer = ""
    client = getattr(request, "client", None)
    if client is not None:
        peer = (getattr(client, "host", None) or "").strip()
    if peer in {"127.0.0.1", "::1", "testclient"}:
        xf = (headers.get("x-forwarded-for") or headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        if xf:
            return xf[:80]
    return peer or "unknown"


async def allow_inquiry(ip: str) -> bool:
    now = time.time()
    doc = await _db.site_inquiry_rate.find_one({"_id": ip}) or {}
    start = float(doc.get("window_start") or 0)
    count = int(doc.get("count") or 0)
    if now - start >= RATE_WINDOW_SEC:
        start, count = now, 0
    if count >= RATE_MAX:
        return False
    await _db.site_inquiry_rate.update_one(
        {"_id": ip},
        {"$set": {"window_start": start, "count": count + 1, "updated_at": _now()}},
        upsert=True,
    )
    return True


async def _send_inquiry_mail(site: dict, content: Optional[dict], inquiry: dict) -> dict:
    import comm_service
    import platform_mail

    sender = await platform_mail.resolve_smtp_account("general")
    if not sender or not sender.get("email"):
        return {"ok": False, "status": "skipped", "error": "general mailbox missing"}
    contact = ((content or {}).get("pages") or {}).get("contact") or {}
    to = []
    email = str(contact.get("email") or "").strip()
    if _EMAIL_RE.match(email):
        to.append(email)
    box = str(sender.get("email") or "").strip()
    if box and box not in to and not to:
        to.append(box)
    if not to:
        return {"ok": False, "status": "skipped", "error": "no recipient"}
    payload = dict(sender)
    if inquiry.get("email"):
        payload["reply_to"] = inquiry["email"]
    brand = site.get("brand_name") or "Site"
    subject = f"{brand} iletişim: {inquiry.get('name') or ''}".strip()
    body = "\n".join([
        f"Ad: {inquiry.get('name') or ''}",
        f"E-posta: {inquiry.get('email') or ''}",
        f"Telefon: {inquiry.get('phone') or ''}",
        "",
        inquiry.get("message") or "",
    ])
    try:
        await comm_service.smtp_send(payload, to, subject[:180], body)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status": "failed", "error": str(getattr(exc, "detail", exc))[:300]}
    return {"ok": True, "status": "sent", "error": None}


def _inquiry_public(doc: dict) -> dict:
    return {
        "id": doc.get("_id"),
        "site_id": doc.get("site_id"),
        "name": doc.get("name") or "",
        "email": doc.get("email") or "",
        "phone": doc.get("phone") or "",
        "message": doc.get("message") or "",
        "created_at": doc.get("created_at"),
        "mail_status": doc.get("mail_status") or "",
    }


async def _require_site(slug: str) -> dict:
    await ensure_seeded()
    site = await _by_slug(slug)
    if not site:
        raise HTTPException(status_code=404, detail="Site bulunamadı.")
    return site


@router.get("/system/sites")
async def list_sites(_: dict = Depends(saas.require_super_admin)):
    await ensure_seeded()
    return [_admin_site(s) for s in await _all_sites()]


@router.get("/system/sites/{slug}")
async def get_site(slug: str, _: dict = Depends(saas.require_super_admin)):
    site = await _require_site(slug)
    content = None
    if site.get("theme") == THEME_CORPORATE:
        content = await _db.site_content.find_one({"_id": site["_id"]})
        if content:
            content = {**normalize_content(content), "id": content.get("_id")}
    return {**_admin_site(site), "content": content}


@router.put("/system/sites/{slug}")
async def update_site(slug: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    site = await _require_site(slug)
    upd: Dict[str, Any] = {"updated_at": _now()}
    if "brand_name" in req:
        upd["brand_name"] = _clip(req.get("brand_name"), 120) or site.get("brand_name") or ""
    if "public_url" in req:
        upd["public_url"] = _norm_url(req.get("public_url") or "")
    if "active" in req:
        upd["active"] = bool(req.get("active"))
    if slug == SLUG_TAMKOBI:
        upd["theme"] = THEME_VITRIN
        upd["active"] = True
    elif "theme" in req and req.get("theme") in (THEME_VITRIN, THEME_CORPORATE):
        upd["theme"] = req.get("theme")
    url = upd.get("public_url", site.get("public_url") or "")
    upd["hosts"] = hosts_for(slug, url)
    await _db.sites.update_one({"_id": site["_id"]}, {"$set": upd})
    if slug == SLUG_TAMKOBI and ("brand_name" in upd or "public_url" in upd):
        mirror = {}
        if "brand_name" in upd:
            mirror["brand_name"] = upd["brand_name"]
        if "public_url" in upd:
            mirror["public_url"] = upd["public_url"]
        mirror["updated_at"] = _now()
        await _db.platform_settings.update_one({"_id": "platform"}, {"$set": mirror}, upsert=True)
    saved = {**site, **upd}
    return _admin_site(saved)


@router.put("/system/sites/{slug}/content")
async def update_content(slug: str, req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    site = await _require_site(slug)
    if site.get("slug") != SLUG_TAI and site.get("theme") != THEME_CORPORATE:
        raise HTTPException(status_code=400, detail="Paket vitrininin içeriği paketlerden gelir.")
    norm = normalize_content(req)
    doc = {"_id": site["_id"], "site_id": site["_id"], **norm, "updated_at": _now()}
    existing = await _db.site_content.find_one({"_id": site["_id"]})
    if existing:
        await _db.site_content.update_one({"_id": site["_id"]}, {"$set": {**norm, "site_id": site["_id"], "updated_at": doc["updated_at"]}})
    else:
        await _db.site_content.insert_one(doc)
    return {**norm, "id": site["_id"]}


@router.get("/system/sites/{slug}/inquiries")
async def list_inquiries(slug: str, _: dict = Depends(saas.require_super_admin)):
    site = await _require_site(slug)
    cur = _db.site_inquiries.find({"site_id": site["_id"]})
    rows = await cur.to_list(200)
    rows.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return [_inquiry_public(r) for r in rows]


@router.get("/public/site")
async def public_site(request: Request, slug: Optional[str] = None):
    host = ha.request_host(request)
    await ensure_seeded()
    site = None
    if slug and _preview_host(host) and slug in (SLUG_TAMKOBI, SLUG_TAI):
        site = await _by_slug(slug)
    else:
        site = await site_for_host(host)
    if not site or not site.get("active", True):
        raise HTTPException(status_code=404, detail="Site bulunamadı.")
    content = None
    if site.get("theme") == THEME_CORPORATE:
        content = await _db.site_content.find_one({"_id": site["_id"]})
    return _public_site(site, content)


@router.post("/public/site/contact")
async def public_contact(req: Dict[str, Any], request: Request, slug: Optional[str] = None):
    host = ha.request_host(request)
    await ensure_seeded()
    if slug and _preview_host(host) and slug in (SLUG_TAMKOBI, SLUG_TAI):
        site = await _by_slug(slug)
    else:
        site = await site_for_host(host)
    if not site or site.get("theme") != THEME_CORPORATE or not site.get("active", True):
        raise HTTPException(status_code=404, detail="İletişim formu bu sitede kapalı.")
    if str(req.get(HONEYPOT_FIELD) or "").strip():
        return {"ok": True}
    name = _clip(req.get("name"), 120)
    email = _clip(req.get("email"), 180)
    phone = _clip(req.get("phone"), 40)
    message = _clip(req.get("message"), 4000)
    if len(name) < 2 or not _EMAIL_RE.match(email) or len(message) < 5:
        raise HTTPException(status_code=400, detail="Ad, geçerli e-posta ve mesaj gerekli.")
    ip = client_ip(request)
    if not await allow_inquiry(ip):
        raise HTTPException(status_code=429, detail="Çok fazla deneme. Lütfen daha sonra tekrar deneyin.")
    content = await _db.site_content.find_one({"_id": site["_id"]})
    inquiry = {
        "_id": f"inq_{uuid.uuid4().hex[:12]}",
        "site_id": site["_id"],
        "site_slug": site.get("slug"),
        "name": name,
        "email": email,
        "phone": phone,
        "message": message,
        "created_at": _now(),
        "ip": ip,
    }
    mail = await _send_inquiry_mail(site, content, inquiry)
    inquiry["mail_status"] = mail.get("status") or "failed"
    inquiry["mail_error"] = mail.get("error")
    await _db.site_inquiries.insert_one(inquiry)
    return {"ok": True, "id": inquiry["_id"], "mail_status": inquiry["mail_status"]}


@seo_router.get("/robots.txt")
async def robots_txt(request: Request):
    body = await robots_body(ha.request_host(request))
    return Response(content=body, media_type="text/plain; charset=utf-8")


@seo_router.get("/sitemap.xml")
async def sitemap_xml(request: Request):
    body = await sitemap_body(ha.request_host(request))
    return Response(content=body, media_type="application/xml; charset=utf-8")
