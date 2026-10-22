"""Firma bazlı depolama yönlendiricisi.

STORAGE_ROUTER_ENABLED kapalıyken (varsayılan) bu modül okunmaz: TenantDB
bugünkü koleksiyonu döner. Bayrak açıkken firma ayarı kısa TTL ile
önbelleğe alınır; her istekte companies sorgusu yapılmaz.

Kip, TenantDB kurulurken bir kez sabitlenir. TTL istek ortasında dolsa
da aynı örnek yeniden okumaz ve gerçek sürücüde senkron hataya düşmez.
Önbellek boşsa giriş noktaları async yükler. Giriş noktası dışında
senkron okuma yoksa bilinen eski kip kullanılır; o da yoksa legacy
sayılır ve hata verilmez.

Bu sürüm legacy, shared_v2 ve dedicated arka uçlarını tanır.
shared_v2 kipinde orders, invoices, stock_movements ve bank_transactions
kendi tablolarına gider. Diğer koleksiyonlar docs_v2 koleksiyonuna gider.
dedicated ayrı veritabanına gider.
Bilinmeyen bir kip sessizce legacy'ye düşmez. Alanı olmayan mevcut
firmalar legacy sayılır. Hiçbir firma burada dedicated veya shared_v2 yapılmaz.

dedicated_dsn_ref şemada durur. Değer düz metin yazılmaz; mühür
comm_service.encrypt ile atılır. Bu modül o alanı okumaz. Çözme
yalnız dedicated koleksiyon açılırken yapılır.
"""
from __future__ import annotations

import contextvars
import logging
import os
import re
import time
from collections import OrderedDict
from typing import Any, Optional

LEGACY = "legacy"
SHARED_V2 = "shared_v2"
DEDICATED = "dedicated"
KNOWN_MODES = frozenset({LEGACY, SHARED_V2, DEDICATED})
DSN_FIELD = "dedicated_dsn_ref"
MODE_FIELD = "storage_mode"
ENV_FLAG = "STORAGE_ROUTER_ENABLED"
TTL_SECONDS = 15.0
CACHE_MAX = 1024

_ON = frozenset({"1", "true", "yes", "on"})
_MISS = object()
UNSET = object()
_cache: "OrderedDict[str, tuple[str, float]]" = OrderedDict()
read_count = 0


class StorageModeError(RuntimeError):
    """Bilinen kip legacy değil."""

    def __init__(self, message: str, *, company_id: str = "", mode: str = ""):
        self.company_id = str(company_id or "")
        self.mode = str(mode or "")
        super().__init__(message)


def _now() -> float:
    return time.monotonic()


def enabled() -> bool:
    """Ortam bayrağı. Boş veya tanımsız değer kapalıdır."""
    return os.environ.get(ENV_FLAG, "").strip().lower() in _ON


def reset() -> None:
    """Testler önbelleği ve sayacı sıfırlar. Ortam bayrağına dokunmaz."""
    global read_count
    _cache.clear()
    read_count = 0
    _BOUND.set(None)
    import storage_dedicated

    storage_dedicated.reset_pools()


def public_mode(raw: Any) -> str:
    """Super-admin gösterimi. Boş alan legacy. Hata atmaz, DSN döndürmez."""
    return normalize_mode(raw)


def company_storage_view(company: Optional[dict]) -> dict:
    """Salt okunur firma alanı. dedicated_dsn_ref yanıta girmez."""
    body = company or {}
    return {MODE_FIELD: public_mode(body.get(MODE_FIELD))}


def normalize_mode(raw: Any) -> str:
    """Yok ya da boş → legacy. Bilinen kipler küçük harf. Bilinmeyen metin durur."""
    if raw is None:
        return LEGACY
    text = str(raw).strip()
    if not text:
        return LEGACY
    lowered = text.lower()
    if lowered in KNOWN_MODES:
        return lowered
    return text


def reject_unless_legacy(mode: str, company_id: str = "") -> None:
    if mode == LEGACY:
        return
    if mode in (SHARED_V2, DEDICATED):
        raise StorageModeError(
            f"Depolama kipi henüz yok: {mode}. Bu sürüm yalnız legacy arka ucunu kullanır.",
            company_id=company_id,
            mode=mode,
        )
    raise StorageModeError(
        f"Bilinmeyen depolama kipi: {mode}. İzin verilen değerler: legacy, shared_v2, dedicated.",
        company_id=company_id,
        mode=mode,
    )


def seal_dedicated_dsn(dsn: str) -> str:
    """İlerideki dedicated DSN referansı. Düz metin döndürmez. Bu PR okunmaz."""
    text = str(dsn or "")
    if not text.strip():
        raise ValueError("DSN boş")
    from comm_service import encrypt

    sealed = encrypt(text)
    if not sealed or sealed == text or not str(sealed).startswith("gAAAA"):
        raise RuntimeError("DSN şifrelenemedi")
    return sealed


def _cached(company_id: str):
    row = _cache.get(company_id)
    if not row:
        return _MISS
    mode, exp = row
    if _now() >= exp:
        return _MISS
    _cache.move_to_end(company_id)
    return mode


def _stale(company_id: str):
    """TTL dolmuş kayıt. Yoksa _MISS. Süreyi uzatmaz."""
    row = _cache.get(company_id)
    if not row:
        return _MISS
    return row[0]


def _store(company_id: str, mode: str) -> str:
    _cache[company_id] = (mode, _now() + TTL_SECONDS)
    _cache.move_to_end(company_id)
    limit = CACHE_MAX if CACHE_MAX >= 1 else 1
    while len(_cache) > limit:
        _cache.popitem(last=False)
    return mode


def _bump() -> None:
    global read_count
    read_count += 1


def _companies(db):
    return db["companies"]


def _mode_from_doc(doc: Optional[dict]) -> str:
    if not doc:
        return LEGACY
    return normalize_mode(doc.get(MODE_FIELD))


def _read_sync(db, company_id: str):
    """Bellek içi docs listesi varsa senkron okur. Gerçek sürücüde None.

    MySQL havuzu burada bekletilmez ve boş önbellek hata üretmez.
    """
    docs = getattr(_companies(db), "docs", None)
    if not isinstance(docs, list):
        return None
    _bump()
    found = None
    for doc in docs:
        if str((doc or {}).get("_id") or "") == company_id:
            found = doc
            break
    return _store(company_id, _mode_from_doc(found))


def mode_for_handle(db, company_id: str) -> str:
    """TenantDB kurulumunda sabitlenecek kip.

    Taze önbellek, sonra bellek içi docs, sonra süresi dolmuş kayıt.
    Hiçbiri yoksa legacy. Gerçek sürücüde sorgu atmaz, hata vermez.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    synced = _read_sync(db, cid)
    if synced is not None:
        return synced
    stale = _stale(cid)
    if stale is not _MISS:
        return stale
    return LEGACY


async def prepare_dedicated(db, company_id: str, mode: str) -> None:
    """Giriş noktası dedicated kipte mühürlü referansı hatırlar.

    Düz metin DSN burada okunmaz ve saklanmaz. Legacy çağrı ek sorgu atmaz.
    """
    if mode != DEDICATED:
        return
    import storage_dedicated

    await storage_dedicated.note_company(db, company_id)


async def load_mode(db, company_id: str) -> str:
    """Firma kipini döndürür. TTL dolmadan companies sorgusu yapmaz.

    shared_v2 / dedicated / bilinmeyen kip burada hata atmaz; seçim
    legacy_collection içindedir. Projeksiyon yalnız storage_mode ister.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    _bump()
    doc = await _companies(db).find_one({"_id": cid}, {MODE_FIELD: 1})
    return _store(cid, _mode_from_doc(doc))


def collection_for_mode(db, mode: str, company_id: str, name: str):
    """Sabitlenmiş kipe göre arka uç.

    Legacy aynı db[name]. shared_v2'de dört büyük koleksiyon kendi
    tablosuna, diğerleri docs_v2'ye gider. Bu çağrı bağlantı açmaz.
    Dedicated ayrı veritabanıdır; açılamazsa hata verir, legacy koleksiyon
    dönmez.
    """
    if mode == LEGACY:
        return db[name]
    if mode == SHARED_V2:
        import storage_tables

        if name in storage_tables.REAL_COLLECTIONS:
            return storage_tables.collection_for(company_id, name)
        import storage_shared_v2

        return storage_shared_v2.collection_for(company_id, name)
    if mode == DEDICATED:
        import storage_dedicated

        return storage_dedicated.collection(db, company_id, name)
    reject_unless_legacy(mode, company_id)
    return db[name]


def legacy_collection(db, company_id: str, name: str):
    """Kipi bir kez çözer. Bayrak kapalıyken TenantDB bunu çağırmaz."""
    cid = str(company_id or "").strip()
    mode = mode_for_handle(db, cid)
    return collection_for_mode(db, mode, cid, name)


_BOUND: "contextvars.ContextVar[Any]" = contextvars.ContextVar(
    "tamkobi_company_store",
    default=None,
)
_VKN_RE = re.compile(r"(?<!\d)\d{10,11}(?!\d)")
_ETTN_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)
_SEAL_RE = re.compile(r"gAAAA[A-Za-z0-9_\-=]+")
_COMPANY_LIST_LIMIT = 10000


def _job_logger() -> logging.Logger:
    log = logging.getLogger("storage_router")
    try:
        from storage_migrations.masking import RedactFilter
    except Exception:
        return log
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log


def current_store():
    """Bu görevde bağlanan şirket deposu. Yoksa None."""
    return _BOUND.get()


def use_store(store):
    """İş, şirket deposunu bağlar. reset_bound ile bırakılır."""
    return _BOUND.set(store)


def reset_bound(token) -> None:
    if token is not None:
        _BOUND.reset(token)


def active_db(db):
    """Bağlı depo varsa o, yoksa verilen katalog db.

    Bayrak kapalıyken işler bağlamaz; dönüş verilen db'dir.
    """
    store = _BOUND.get()
    if store is None:
        return db
    return store


def _safe_company(company_id: str) -> str:
    text = str(company_id or "")
    if not text or len(text) > 80:
        return "gizli"
    if _VKN_RE.fullmatch(text) or _ETTN_RE.fullmatch(text):
        return "gizli"
    if all(ch.isalnum() or ch in "-_" for ch in text):
        return text
    return "gizli"


def public_store_error(exc: BaseException) -> str:
    """Loga gidecek ileti. Sır, VKN ve ETTN kalmaz."""
    try:
        from storage_migrations.masking import scrub
    except Exception:
        scrub = None
    raw = str(exc or "")
    if scrub is not None:
        raw = scrub(raw)
    raw = _SEAL_RE.sub("***", raw)
    raw = _VKN_RE.sub("***", raw)
    raw = _ETTN_RE.sub("***", raw)
    raw = " ".join(raw.split())
    if not raw or len(raw) > 180:
        return "depo açılamadı"
    return raw


def log_store_failure(company_id: str, exc: BaseException) -> None:
    """Açılamayan şirket. Diğer şirketler sürer. Ayrıntı scrub edilir."""
    _job_logger().warning(
        "şirket deposu açılamadı company=%s error=%s",
        _safe_company(company_id),
        public_store_error(exc),
    )


class CompanyStore:
    """Bir şirketin yönlendirilmiş deposu. Koleksiyon erişimi doğru arka uca gider.

    companies kataloğu burada değildir; iş şirket belgesini ana db'den okur.
    """

    def __init__(self, db, company_id: str, mode: str):
        self.company_id = company_id
        self.mode = mode
        self._db = db

    def __repr__(self) -> str:
        return f"CompanyStore(company_id={self.company_id!r}, mode={self.mode!r})"

    def __getitem__(self, name: str):
        return collection_for_mode(self._db, self.mode, self.company_id, str(name))

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    async def list_collection_names(self):
        if self.mode == LEGACY:
            fn = getattr(self._db, "list_collection_names", None)
            if fn is None:
                return []
            found = fn()
            if hasattr(found, "__await__"):
                found = await found
            return list(found or [])
        return ["marketplace_claims", "orders", "invoices", "products"]


def _probe_store(db, company_id: str, mode: str) -> None:
    """Depo açılır mı. Legacy sorgu atmaz. Hata şirket döngüsünü kesmez."""
    if mode == LEGACY:
        return
    if mode == SHARED_V2:
        import storage_shared_v2

        storage_shared_v2.get_store().connection()
        return
    if mode == DEDICATED:
        import storage_dedicated

        coll = storage_dedicated.collection(db, company_id, "storage_probe")
        storage_dedicated.checkout(company_id, coll._dsn)
        storage_dedicated.release(company_id)
        return
    reject_unless_legacy(mode, company_id)


async def _collect_docs(cursor, limit: int):
    if hasattr(cursor, "to_list"):
        return await cursor.to_list(limit)
    rows = []
    if hasattr(cursor, "__aiter__"):
        async for doc in cursor:
            rows.append(doc)
            if len(rows) >= limit:
                break
        return rows
    return list(cursor or [])[:limit]


async def _catalog_companies(db, company_id: str = ""):
    coll = _companies(db)
    only = str(company_id or "").strip()
    query = {"_id": only} if only else {}
    try:
        cursor = coll.find(query, {"_id": 1, MODE_FIELD: 1, DSN_FIELD: 1})
    except TypeError:
        cursor = coll.find(query)
    return await _collect_docs(cursor, _COMPANY_LIST_LIMIT)


async def open_company_store(db, company_id: str) -> CompanyStore:
    """Tek şirketin deposu. Açılamazsa hata verir; çağıran loglayıp devam eder.

    Bayrak kapalıyken legacy arka uç döner ve companies sorgusu yapmaz.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    if not enabled():
        return CompanyStore(db, cid, LEGACY)
    mode = await load_mode(db, cid)
    if mode == DEDICATED:
        await prepare_dedicated(db, cid, mode)
    _probe_store(db, cid, mode)
    return CompanyStore(db, cid, mode)


async def iter_company_stores(db, *, company_id: str = ""):
    """Her şirket için (company_id, CompanyStore).

    Katalog ana db.companies üzerindedir. Aynı şirket bir kez gelir.
    Depo açılamazsa o şirket loglanır ve atlanır; döngü sürer.
    Bayrak kapalıyken üretmez: çağıran mevcut sorguyu kullanır.
    """
    if not enabled():
        return
    seen = set()
    only = str(company_id or "").strip()
    try:
        docs = await _catalog_companies(db, only)
    except Exception as exc:
        log_store_failure(only or "-", exc)
        return
    for doc in docs or []:
        cid = str((doc or {}).get("_id") or "").strip()
        if not cid or cid in seen:
            continue
        if only and cid != only:
            continue
        seen.add(cid)
        try:
            mode = _mode_from_doc(doc)
            if mode == DEDICATED:
                await prepare_dedicated(db, cid, mode)
            elif mode != LEGACY and mode != SHARED_V2:
                reject_unless_legacy(mode, cid)
            _probe_store(db, cid, mode)
            _store(cid, mode)
            yield cid, CompanyStore(db, cid, mode)
        except Exception as exc:
            log_store_failure(cid, exc)


async def collect_company_rows(db, collection: str, query=None, limit: int = 500):
    """Bayrak açıkken her şirketin deposundan company_id ile satır okur.

    Dönüş: [(company_id, rows), ...]. Açılmayan depo atlanır.
    Bayrak kapalıyken boş liste; çağıran eski sorguyu kullanır.
    """
    if not enabled():
        return []
    base = dict(query or {})
    base.pop("company_id", None)
    found = []
    async for cid, store in iter_company_stores(db):
        try:
            q = dict(base)
            q["company_id"] = cid
            cursor = store[collection].find(q)
            rows = await _collect_docs(cursor, limit)
            found.append((cid, list(rows or [])))
        except Exception as exc:
            log_store_failure(cid, exc)
    return found
