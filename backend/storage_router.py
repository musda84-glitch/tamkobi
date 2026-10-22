"""Firma bazlı depolama yönlendiricisi.

STORAGE_ROUTER_ENABLED kapalıyken (varsayılan) bu modül okunmaz: TenantDB
bugünkü koleksiyonu döner. Bayrak açıkken firma ayarı kısa TTL ile
önbelleğe alınır; her istekte companies sorgusu yapılmaz.

Kip, TenantDB kurulurken bir kez sabitlenir. TTL istek ortasında dolsa
da aynı örnek yeniden okumaz. Önbellek hiç yoksa giriş noktası dışında
gerçek sürücüye sorulmaz ve legacy sayılır; hata verilmez. Süresi
dolmuş kayıt katalogdan yeniden okunur. Kip değişince storage_epoch
artar. Yazma kilidi katalogdaki storage_write_lock alanındadır; her
süreç kısa TTL ile bakar.

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

import asyncio
import contextvars
import inspect
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from contextlib import contextmanager
from typing import Any, Optional

LEGACY = "legacy"
SHARED_V2 = "shared_v2"
DEDICATED = "dedicated"
KNOWN_MODES = frozenset({LEGACY, SHARED_V2, DEDICATED})
DSN_FIELD = "dedicated_dsn_ref"
MODE_FIELD = "storage_mode"
EPOCH_FIELD = "storage_epoch"
WRITE_LOCK_FIELD = "storage_write_lock"
ENV_FLAG = "STORAGE_ROUTER_ENABLED"
WRITE_LOCK_MESSAGE = (
    "Şirket depolama taşıması sırasında salt okunur. "
    "Yazma istekleri taşıma bitene kadar reddedilir."
)
TTL_SECONDS = 15.0
LOCK_TTL_SECONDS = 2.0
CACHE_MAX = 1024

_ON = frozenset({"1", "true", "yes", "on"})
_MISS = object()
_UNREAD = object()
UNSET = object()
# (mode, exp, epoch, locked)
_cache: "OrderedDict[str, tuple]" = OrderedDict()
# (locked, exp) — yazma yolu bunu okur, şirket belgesini her yazışta değil
_lock_cache: "OrderedDict[str, tuple[bool, float]]" = OrderedDict()
read_count = 0
_write_locks: set[str] = set()
_move_owner: Optional[str] = None
_move_guard = threading.Lock()
_writer: "contextvars.ContextVar[str]" = contextvars.ContextVar(
    "tamkobi_storage_move_writer",
    default="",
)


class StorageModeError(RuntimeError):
    """Bilinen kip legacy değil."""

    def __init__(self, message: str, *, company_id: str = "", mode: str = ""):
        self.company_id = str(company_id or "")
        self.mode = str(mode or "")
        super().__init__(message)


def _now() -> float:
    return time.monotonic()


def _env_seconds(name: str, default: float) -> float:
    raw = os.environ.get(name, "")
    if not str(raw).strip():
        return max(0.0, float(default))
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return max(0.0, float(default))


def mode_ttl() -> float:
    """Kip önbelleği. Taşıma, kilidi açmadan önce en az bu kadar bekler."""
    return _env_seconds("STORAGE_MOVE_MODE_TTL", TTL_SECONDS)


def lock_ttl() -> float:
    """Yazma kilidi önbelleği. Kopyadan önce en az bu kadar beklenir."""
    return _env_seconds("STORAGE_MOVE_LOCK_TTL", LOCK_TTL_SECONDS)


def enabled() -> bool:
    """Ortam bayrağı. Boş veya tanımsız değer kapalıdır."""
    return os.environ.get(ENV_FLAG, "").strip().lower() in _ON


def reset() -> None:
    """Testler önbelleği ve sayacı sıfırlar. Ortam bayrağına dokunmaz."""
    global read_count, _move_owner
    _cache.clear()
    _lock_cache.clear()
    read_count = 0
    _write_locks.clear()
    _move_owner = None
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
    mode, exp = row[0], row[1]
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


def _view(doc: Optional[dict]) -> tuple[str, int, bool]:
    mode = _mode_from_doc(doc)
    epoch = 0
    if isinstance(doc, dict):
        try:
            epoch = int(doc.get(EPOCH_FIELD) or 0)
        except (TypeError, ValueError):
            epoch = 0
    locked = bool(doc.get(WRITE_LOCK_FIELD)) if isinstance(doc, dict) else False
    return mode, epoch, locked


def _store(company_id: str, mode: str, epoch: int = 0, locked: bool = False) -> str:
    now = _now()
    _cache[company_id] = (mode, now + mode_ttl(), int(epoch), bool(locked))
    _cache.move_to_end(company_id)
    _lock_cache[company_id] = (bool(locked), now + lock_ttl())
    _lock_cache.move_to_end(company_id)
    limit = CACHE_MAX if CACHE_MAX >= 1 else 1
    while len(_cache) > limit:
        gone, _row = _cache.popitem(last=False)
        _lock_cache.pop(gone, None)
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


def _memory_doc(db, company_id: str):
    """Bellek içi docs listesi. Gerçek sürücüde _UNREAD."""
    companies = _companies(db)
    docs = getattr(companies, "docs", None)
    if not isinstance(docs, list):
        return _UNREAD
    for doc in docs:
        if str((doc or {}).get("_id") or "") == company_id:
            return doc
    return None


def _drive(awaitable):
    """Döngü yokken bekler. Döngü varken ayrı iş parçacığında bekler.

    aiomysql havuzu burada kullanılmaz; bu yol bellek ve sahte sürücü içindir.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(awaitable)
    box: dict = {}

    def _worker() -> None:
        try:
            box["value"] = asyncio.run(awaitable)
        except BaseException as exc:  # noqa: BLE001 — çağıran _UNREAD'e çevirir
            box["error"] = exc

    thread = threading.Thread(target=_worker, daemon=True)
    thread.start()
    thread.join()
    if "error" in box:
        raise box["error"]
    return box.get("value")


def _sql_company(settings: dict, company_id: str):
    """Katalog belgesi. Bağlantı ayarı loglanmaz. Hata _UNREAD döner."""
    try:
        import pymysql
    except Exception:
        return _UNREAD
    conn = None
    try:
        import db_ssl

        conn = pymysql.connect(
            host=settings.get("host") or "127.0.0.1",
            port=int(settings.get("port") or 3306),
            user=settings.get("user") or "",
            password=settings.get("password") or "",
            database=settings.get("db") or "",
            charset=settings.get("charset") or "utf8mb4",
            autocommit=True,
            connect_timeout=3,
            **db_ssl.connect_kwargs(settings),
        )
        with conn.cursor() as cur:
            cur.execute(
                "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                ("companies", company_id),
            )
            row = cur.fetchone()
    except Exception:
        return _UNREAD
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    if not row:
        return None
    raw = row[0]
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return _UNREAD
    return raw if isinstance(raw, dict) else _UNREAD


def _read_company_doc(db, company_id: str):
    """Şirket belgesi. Yoksa None. Okunamazsa _UNREAD. Hata atmaz."""
    if db is None:
        return _UNREAD
    memory = _memory_doc(db, company_id)
    if memory is not _UNREAD:
        return memory
    settings = getattr(db, "_settings", None)
    if isinstance(settings, dict) and settings.get("host") and settings.get("db"):
        return _sql_company(settings, company_id)
    find_one = getattr(_companies(db), "find_one", None)
    if find_one is None:
        return _UNREAD
    try:
        result = find_one({"_id": company_id})
        if inspect.isawaitable(result):
            result = _drive(result)
    except Exception:
        return _UNREAD
    if result is None:
        return None
    return result if isinstance(result, dict) else _UNREAD


def _read_sync(db, company_id: str):
    """Bellek içi docs listesi varsa senkron okur. Gerçek sürücüde None.

    Soğuk önbellek gerçek sürücüye burada gitmez. Süresi dolmuş kayıt
    _refresh_mode ile okunur.
    """
    memory = _memory_doc(db, company_id)
    if memory is _UNREAD:
        return None
    _bump()
    mode, epoch, locked = _view(memory if isinstance(memory, dict) else None)
    return _store(company_id, mode, epoch, locked)


def _refresh_mode(db, company_id: str):
    """Süresi dolmuş kipi katalogdan yeniden okur. Okunamazsa None."""
    doc = _read_company_doc(db, company_id)
    if doc is _UNREAD:
        return None
    _bump()
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    return _store(company_id, mode, epoch, locked)


def mode_for_handle(db, company_id: str) -> str:
    """TenantDB kurulumunda sabitlenecek kip.

    Taze önbellek hemen döner. Önbellek hiç yoksa yalnız bellek içi
    katalog okunur; gerçek sürücüye sorulmaz ve hata verilmez.
    Süresi dolmuş kayıt katalogdan yeniden okunur.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    if cid not in _cache:
        synced = _read_sync(db, cid)
        if synced is not None:
            return synced
        return LEGACY
    refreshed = _refresh_mode(db, cid)
    if refreshed is not None:
        return refreshed
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
    legacy_collection içindedir. Projeksiyon kip, epoch ve yazma kilidini ister.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    _bump()
    doc = await _companies(db).find_one(
        {"_id": cid},
        {MODE_FIELD: 1, EPOCH_FIELD: 1, WRITE_LOCK_FIELD: 1},
    )
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    return _store(cid, mode, epoch, locked)


def collection_for_mode(db, mode: str, company_id: str, name: str):
    """Sabitlenmiş kipe göre arka uç.

    Legacy aynı db[name]. shared_v2'de dört büyük koleksiyon kendi
    tablosuna, diğerleri docs_v2'ye gider. Bu çağrı bağlantı açmaz.
    Dedicated ayrı veritabanıdır; açılamazsa hata verir, legacy koleksiyon
    dönmez.
    """
    if mode == LEGACY:
        return _bind_catalog(db[name], db)
    if mode == SHARED_V2:
        import storage_tables

        if name in storage_tables.REAL_COLLECTIONS:
            return _bind_catalog(storage_tables.collection_for(company_id, name), db)
        import storage_shared_v2

        return _bind_catalog(storage_shared_v2.collection_for(company_id, name), db)
    if mode == DEDICATED:
        import storage_dedicated

        return _bind_catalog(storage_dedicated.collection(db, company_id, name), db)
    reject_unless_legacy(mode, company_id)
    return _bind_catalog(db[name], db)


def _bind_catalog(coll, db):
    """Yazma yolu şirket kilidini bu katalogdan okur."""
    if coll is None or db is None:
        return coll
    try:
        setattr(coll, "_catalog_db", db)
    except Exception:
        return coll
    return coll


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


class StorageWriteLocked(StorageModeError):
    """Taşıma sırasında şirkete yazılamaz. İleti sır taşımaz."""

    def __init__(self, message: str = "", *, company_id: str = ""):
        super().__init__(message or WRITE_LOCK_MESSAGE, company_id=company_id, mode="")


class StorageMoveBusy(RuntimeError):
    """İkinci taşıma başlayamaz."""


def any_write_lock() -> bool:
    now = _now()
    if _write_locks:
        return True
    for locked, exp in _lock_cache.values():
        if locked and now < exp:
            return True
    return False


def note_write_lock(company_id: str, locked: bool) -> None:
    """Bu sürecin kilit önbelleği. Katalog yazısı ayrıca yapılır."""
    cid = str(company_id or "").strip()
    if not cid:
        return
    _lock_cache[cid] = (bool(locked), _now() + lock_ttl())
    _lock_cache.move_to_end(cid)
    if locked:
        _write_locks.add(cid)
    else:
        _write_locks.discard(cid)


def _locked_now(db, company_id: str) -> bool:
    cid = str(company_id or "").strip()
    if not cid:
        return False
    row = _lock_cache.get(cid)
    if row is not None and _now() < row[1]:
        return bool(row[0])
    doc = _read_company_doc(db, cid)
    if doc is _UNREAD:
        if row is not None:
            return bool(row[0])
        return False
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    if _cached(cid) is _MISS:
        _store(cid, mode, epoch, locked)
    else:
        _lock_cache[cid] = (locked, _now() + lock_ttl())
        _lock_cache.move_to_end(cid)
    return locked


def company_write_locked(company_id: str, db=None) -> bool:
    """Katalogdaki kilit. Taze önbellek sorgu atmaz."""
    return _locked_now(db, str(company_id or ""))


def lock_company_writes(company_id: str) -> None:
    note_write_lock(company_id, True)


def unlock_company_writes(company_id: str) -> None:
    note_write_lock(company_id, False)


def assert_writable(company_id: str, db=None) -> None:
    """Kilitli şirkete yazmayı reddeder. Taşımanın kendi yazısı geçer.

    Bayrak kapalıyken kilit tutulmaz; bu çağrı hemen döner.
    Açıkken kilit katalogdan okunur. Sık yazış kısa TTL ile önbelleğe alınır.
    """
    if not enabled():
        return
    cid = str(company_id or "").strip()
    if not cid or _writer.get() == cid:
        return
    if _locked_now(db, cid):
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)


def assert_document_writable(query=None, doc=None, db=None) -> None:
    """Belge veya sorgudaki company_id kilitliyse yazmayı reddeder.

    Bayrak kapalıyken taşıma kilit tutmaz. Açıkken katalog okunur.
    """
    if not enabled():
        return
    found = []
    if isinstance(doc, dict):
        if doc.get("company_id"):
            found.append(str(doc.get("company_id")))
    elif isinstance(doc, (list, tuple)):
        for item in doc:
            if isinstance(item, dict) and item.get("company_id"):
                found.append(str(item.get("company_id")))
    if isinstance(query, dict) and isinstance(query.get("company_id"), str):
        found.append(query["company_id"])
    for cid in found:
        assert_writable(cid, db=db)


@contextmanager
def bypass_write_lock(company_id: str):
    """Taşıma aracı kendi kopyasını yazarken kilidi deler. İstek bunu görmez."""
    token = _writer.set(str(company_id or ""))
    try:
        yield
    finally:
        _writer.reset(token)


def try_begin_move(company_id: str) -> None:
    """Süreçte tek taşıma. İkincisi StorageMoveBusy atar."""
    global _move_owner
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    with _move_guard:
        if _move_owner is not None:
            raise StorageMoveBusy("Başka bir depolama taşıması sürüyor. İkincisi başlatılamaz.")
        _move_owner = cid


def end_move(company_id: str) -> None:
    global _move_owner
    with _move_guard:
        if _move_owner == str(company_id or ""):
            _move_owner = None


def forget_mode(company_id: str) -> None:
    """Bu sürecin kip ve kilit önbelleğini bırakır.

    Diğer süreçler TTL dolunca katalogdan yeniden okur. Taşıma, kilidi
    açmadan önce en az bir TTL bekler.
    """
    cid = str(company_id or "")
    _cache.pop(cid, None)
    _lock_cache.pop(cid, None)


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
