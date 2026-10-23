"""Firma bazlı depolama yönlendiricisi.

STORAGE_ROUTER_ENABLED kapalıyken (varsayılan) bu modül okunmaz: TenantDB
bugünkü koleksiyonu döner. Bayrak açıkken firma ayarı kısa TTL ile
önbelleğe alınır; her istekte companies sorgusu yapılmaz.

Kip, TenantDB kurulurken okunur. Yazma, katalogdaki storage_epoch ile
karşılaştırır; farklıysa yeni kipe yönlenir. Önbellek hiç yoksa giriş
noktası dışında gerçek sürücüye sorulmaz ve legacy sayılır; hata verilmez.
Süresi dolmuş kayıt katalogdan yeniden okunur; bayat değer kullanılmaz.
Katalog okunamazsa bayrak açıkken yazma reddedilir. Yazma kilidi
katalogdaki storage_write_lock alanındadır; her süreç kısa TTL ile bakar.

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
import copy
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
# (active, exp) — company_id çözülemeyen ham yazma
_any_move: tuple[bool, float] = (False, 0.0)
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
    global read_count, _move_owner, _any_move
    _cache.clear()
    _lock_cache.clear()
    _any_move = (False, 0.0)
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
    if isinstance(raw, dict):
        return raw
    return _UNREAD


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
        return _bind_catalog(db[name], db, mode, company_id)
    if mode == SHARED_V2:
        import storage_tables

        if name in storage_tables.REAL_COLLECTIONS:
            return _bind_catalog(storage_tables.collection_for(company_id, name), db, mode, company_id)
        import storage_shared_v2

        return _bind_catalog(storage_shared_v2.collection_for(company_id, name), db, mode, company_id)
    if mode == DEDICATED:
        import storage_dedicated

        return _bind_catalog(storage_dedicated.collection(db, company_id, name), db, mode, company_id)
    reject_unless_legacy(mode, company_id)
    return _bind_catalog(db[name], db, mode, company_id)


def _bind_catalog(coll, db, mode: str = "", company_id: str = ""):
    """Yazma yolu şirket kilidini ve açılış epoch'unu bu katalogdan okur."""
    if coll is None or db is None:
        return coll
    try:
        setattr(coll, "_catalog_db", db)
        if mode:
            setattr(coll, "_pinned_mode", mode)
            row = _cache.get(str(company_id or ""))
            setattr(coll, "_pinned_epoch", row[2] if row else None)
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

    def __init__(self, db, company_id: str, mode: str, epoch: int = 0):
        self.company_id = company_id
        self.mode = mode
        self.epoch = int(epoch or 0)
        self._db = db

    def __repr__(self) -> str:
        return f"CompanyStore(company_id={self.company_id!r}, mode={self.mode!r})"

    def __getitem__(self, name: str):
        coll = collection_for_mode(self._db, self.mode, self.company_id, str(name))
        if not enabled():
            return coll
        return BoundCollection(self, str(name), coll)

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
        cursor = coll.find(query, {"_id": 1, MODE_FIELD: 1, EPOCH_FIELD: 1, WRITE_LOCK_FIELD: 1, DSN_FIELD: 1})
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
        return CompanyStore(db, cid, LEGACY, 0)
    mode = await load_mode(db, cid)
    if mode == DEDICATED:
        await prepare_dedicated(db, cid, mode)
    _probe_store(db, cid, mode)
    row = _cache.get(cid)
    epoch = int(row[2]) if row else 0
    return CompanyStore(db, cid, mode, epoch)


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
            mode, epoch, locked = _view(doc)
            if mode == DEDICATED:
                await prepare_dedicated(db, cid, mode)
            elif mode != LEGACY and mode != SHARED_V2:
                reject_unless_legacy(mode, cid)
            _probe_store(db, cid, mode)
            _store(cid, mode, epoch, locked)
            yield cid, CompanyStore(db, cid, mode, epoch)
        except Exception as exc:
            log_store_failure(cid, exc)


class StorageWriteLocked(StorageModeError):
    """Taşıma sırasında şirkete yazılamaz. İleti sır taşımaz."""

    def __init__(self, message: str = "", *, company_id: str = ""):
        super().__init__(message or WRITE_LOCK_MESSAGE, company_id=company_id, mode="")


class StorageEpochStale(StorageModeError):
    """Açılış kipinin epoch'u katalogla uyuşmuyor. Yazma eski depoya gitmez."""

    def __init__(self, message: str = "", *, company_id: str = "", mode: str = ""):
        super().__init__(
            message or "Depolama kipi değişti. Yazma eski depoya yapılmadı.",
            company_id=company_id,
            mode=mode,
        )


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


def _on_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _locked_now(db, company_id: str) -> bool:
    """Taze önbellek. Süresi dolmuş değer kullanılmaz.

    Katalog okunamazsa kilitli sayılır. Bellek kataloğu döngüde de okunur.
    Gerçek sürücüde olay döngüsü pymysql açmaz; okuyamazsa yazma reddedilir.
    """
    cid = str(company_id or "").strip()
    if not cid:
        return False
    row = _lock_cache.get(cid)
    if row is not None and _now() < row[1]:
        return bool(row[0])
    if db is not None:
        memory = _memory_doc(db, cid)
        if memory is not _UNREAD:
            mode, epoch, locked = _view(memory if isinstance(memory, dict) else None)
            _store(cid, mode, epoch, locked)
            return locked
    if _on_loop():
        return True
    doc = _read_company_doc(db, cid)
    if doc is _UNREAD:
        return True
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    _store(cid, mode, epoch, locked)
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


def _view_cached(company_id: str):
    """İkisi de tazeyse (mode, epoch, locked). Değilse None. Bayat değer dönmez."""
    cid = str(company_id or "")
    row = _cache.get(cid)
    lock = _lock_cache.get(cid)
    now = _now()
    if not row or not lock or now >= row[1] or now >= lock[1]:
        return None
    return row[0], int(row[2]), bool(lock[0])


def _remember_view(company_id: str, doc) -> tuple[str, int, bool]:
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    _store(company_id, mode, epoch, locked)
    _bump()
    return mode, epoch, locked


async def _sql_company_async(db, company_id: str):
    """Havuzdaki async sürücü. Olay döngüsünde pymysql açılmaz."""
    await db._ensure()
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                ("companies", company_id),
            )
            row = await cur.fetchone()
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
    if isinstance(raw, dict):
        return raw
    return _UNREAD


async def read_company_doc_async(db, company_id: str):
    """Şirket belgesi. Yoksa None. Okunamazsa _UNREAD. Döngüyü pymysql ile durdurmaz."""
    if db is None:
        return _UNREAD
    memory = _memory_doc(db, company_id)
    if memory is not _UNREAD:
        return memory
    if hasattr(db, "_ensure") and (getattr(db, "_pool", None) is not None or hasattr(db, "_settings")):
        try:
            return await _sql_company_async(db, company_id)
        except Exception:
            return _UNREAD
    settings = getattr(db, "_settings", None)
    if isinstance(settings, dict) and settings.get("host") and settings.get("db"):
        try:
            return await asyncio.to_thread(_sql_company, settings, company_id)
        except Exception:
            return _UNREAD
    find_one = getattr(_companies(db), "find_one", None)
    if find_one is None:
        return _UNREAD
    try:
        result = find_one(
            {"_id": company_id},
            {MODE_FIELD: 1, EPOCH_FIELD: 1, WRITE_LOCK_FIELD: 1},
        )
        if inspect.isawaitable(result):
            result = await result
    except Exception:
        return _UNREAD
    if result is None:
        return None
    return result if isinstance(result, dict) else _UNREAD


async def load_view(db, company_id: str) -> tuple[str, int, bool]:
    """Kip, epoch ve kilit. Taze önbellek sorgu atmaz.

    Okunamazsa StorageWriteLocked. Süresi dolmuş önbellek kullanılmaz.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    cached = _view_cached(cid)
    if cached is not None:
        return cached
    doc = await read_company_doc_async(db, cid)
    if doc is _UNREAD:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    return _remember_view(cid, doc)


def load_view_sync(db, company_id: str) -> tuple[str, int, bool]:
    """Senkron yazma yolu. Olay döngüsünde pymysql açmaz; okuyamazsa reddeder."""
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    cached = _view_cached(cid)
    if cached is not None:
        return cached
    if db is not None:
        memory = _memory_doc(db, cid)
        if memory is not _UNREAD:
            return _remember_view(cid, memory)
    if _on_loop():
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    doc = _read_company_doc(db, cid)
    if doc is _UNREAD:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    return _remember_view(cid, doc)


async def guard_pinned_write(company_id: str, db=None, pinned_mode=None, pinned_epoch=None) -> tuple[str, int, bool]:
    """Yazmadan önce kilit ve epoch. Bayrak kapalıyken sorgu yok.

    Epoch veya kip uyuşmazsa StorageEpochStale. Kilitli ya da okunamazsa
    StorageWriteLocked. Taşımanın kendi yazısı geçer.
    """
    if not enabled():
        return (LEGACY, 0, False)
    cid = str(company_id or "").strip()
    if not cid or _writer.get() == cid:
        return (str(pinned_mode or LEGACY), int(pinned_epoch or 0), False)
    mode, epoch, locked = await load_view(db, cid)
    if locked:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    if pinned_mode is not None and (mode != pinned_mode or (pinned_epoch is not None and int(pinned_epoch) != epoch)):
        raise StorageEpochStale(company_id=cid, mode=mode)
    return mode, epoch, locked


def guard_pinned_write_sync(company_id: str, db=None, pinned_mode=None, pinned_epoch=None) -> tuple[str, int, bool]:
    if not enabled():
        return (LEGACY, 0, False)
    cid = str(company_id or "").strip()
    if not cid or _writer.get() == cid:
        return (str(pinned_mode or LEGACY), int(pinned_epoch or 0), False)
    mode, epoch, locked = load_view_sync(db, cid)
    if locked:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    if pinned_mode is not None and (mode != pinned_mode or (pinned_epoch is not None and int(pinned_epoch) != epoch)):
        raise StorageEpochStale(company_id=cid, mode=mode)
    return mode, epoch, locked


async def any_move_running(db) -> bool:
    """Çözülemeyen ham yazma için. Okunamazsa kilitli sayılır. Bayrak kapalıyken çağrılmaz."""
    global _any_move
    now = _now()
    if now < _any_move[1]:
        return _any_move[0]
    try:
        import tenant_scope

        with tenant_scope.unscoped("depolama taşıma kilidi"):
            found = db["storage_move_locks"].find_one({"status": "running"})
            if inspect.isawaitable(found):
                found = await found
    except Exception:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
    active = isinstance(found, dict)
    _any_move = (active, now + lock_ttl())
    return active


def any_move_running_sync(db) -> bool:
    global _any_move
    now = _now()
    if now < _any_move[1]:
        return _any_move[0]
    if _on_loop():
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
    try:
        import tenant_scope

        with tenant_scope.unscoped("depolama taşıma kilidi"):
            found = db["storage_move_locks"].find_one({"status": "running"})
    except Exception:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
    active = isinstance(found, dict)
    _any_move = (active, now + lock_ttl())
    return active


_CONTROL_COLLECTIONS = frozenset({"companies", "storage_moves", "storage_move_locks"})


def _payload_companies(op: str, doc, query, update, name: str = "") -> list[str]:
    found: list[str] = []

    def add(value) -> None:
        text = str(value or "").strip()
        if text and text not in found:
            found.append(text)

    if op == "insert_one" and isinstance(doc, dict):
        add(doc.get("company_id"))
        if name == "companies":
            add(doc.get("_id"))
    elif op == "insert_many" and isinstance(doc, (list, tuple)):
        for item in doc:
            if isinstance(item, dict):
                add(item.get("company_id"))
    elif op == "replace_one" and isinstance(doc, dict):
        add(doc.get("company_id"))
    if isinstance(query, dict):
        if isinstance(query.get("company_id"), str):
            add(query.get("company_id"))
        if name == "companies" and query.get("_id") and not isinstance(query.get("_id"), dict):
            add(query.get("_id"))
    if isinstance(update, dict):
        for key in ("$set", "$setOnInsert"):
            body = update.get(key)
            if isinstance(body, dict):
                add(body.get("company_id"))
    return found


def narrow_legacy_query(query, archived: list[str]) -> dict:
    """Arşiv şirketlerini dışlayan kopya. Çağıranın sözlüğü değişmez."""
    body = copy.deepcopy(query) if isinstance(query, dict) else {}
    if not archived:
        return body
    clause = {"company_id": {"$nin": list(archived)}}
    if isinstance(body.get("$and"), list):
        merged = dict(body)
        merged["$and"] = list(body["$and"]) + [clause]
        return merged
    if body:
        return {"$and": [body, clause]}
    return {"$and": [clause]}


_PASSTHROUGH: "contextvars.ContextVar[bool]" = contextvars.ContextVar(
    "storage_route_passthrough",
    default=False,
)
_MANY_WRITES = frozenset({"update_many", "delete_many"})


def _sum_update(results):
    from mysql_store import UpdateResult

    matched = 0
    modified = 0
    upserted = None
    for result in results:
        try:
            matched += int(getattr(result, "matched_count", 0) or 0)
        except (TypeError, ValueError):
            pass
        try:
            modified += int(getattr(result, "modified_count", 0) or 0)
        except (TypeError, ValueError):
            pass
        if getattr(result, "upserted_id", None):
            upserted = result.upserted_id
    return UpdateResult(matched, modified, upserted)


def _sum_delete(results):
    from mysql_store import DeleteResult

    deleted = 0
    for result in results:
        try:
            deleted += int(getattr(result, "deleted_count", 0) or 0)
        except (TypeError, ValueError):
            pass
    return DeleteResult(deleted)


class SplitWrite:
    """Arşiv şirketinin canlı deposu ve legacy şirketler. Sorgular kopyadır.

    Toplam matched/modified/deleted, uygulanan her hedefin toplamıdır.
    """

    def __init__(self, legacy, legacy_query, parts):
        self._legacy = legacy
        self._legacy_query = legacy_query
        self._parts = list(parts)

    async def _call(self, target, method, query, args, kwargs):
        fn = getattr(target, method)
        result = fn(query, *args, **kwargs)
        if inspect.isawaitable(result):
            result = await result
        return result

    async def _legacy_call(self, method, args, kwargs):
        if self._legacy is None:
            return None
        token = _PASSTHROUGH.set(True)
        try:
            return await self._call(self._legacy, method, self._legacy_query, args, kwargs)
        finally:
            _PASSTHROUGH.reset(token)

    async def update_many(self, query, update, upsert: bool = False):
        results = []
        legacy = await self._legacy_call("update_many", (update,), {"upsert": upsert})
        if legacy is not None:
            results.append(legacy)
        for coll, part_query in self._parts:
            results.append(await self._call(coll, "update_many", part_query, (update,), {"upsert": upsert}))
        return _sum_update(results)

    async def delete_many(self, query):
        results = []
        legacy = await self._legacy_call("delete_many", (), {})
        if legacy is not None:
            results.append(legacy)
        for coll, part_query in self._parts:
            results.append(await self._call(coll, "delete_many", part_query, (), {}))
        return _sum_delete(results)


def _company_ids_from_rows(rows, name: str) -> list[str]:
    found: list[str] = []
    for row in rows or []:
        if isinstance(row, str):
            cid = row.strip()
        elif isinstance(row, dict):
            cid = str(row.get("company_id") or "").strip()
            if not cid and name == "companies":
                cid = str(row.get("_id") or "").strip()
        else:
            continue
        if cid and cid != "null" and cid not in found:
            found.append(cid)
    return found


async def _matched_company_ids(coll, query, name: str) -> list[str]:
    distinct = getattr(coll, "distinct_company_ids", None)
    if distinct is not None:
        try:
            rows = distinct(query)
            if inspect.isawaitable(rows):
                rows = await rows
        except Exception:
            rows = None
        if isinstance(rows, list):
            return _company_ids_from_rows(rows, name)
    loader = getattr(coll, "_load_filtered", None)
    rows = None
    if loader is not None:
        rows = loader(query)
        if inspect.isawaitable(rows):
            rows = await rows
    if rows is None:
        find = getattr(coll, "find", None)
        if find is None:
            return []
        cursor = find(query, {"_id": 1, "company_id": 1})
        if hasattr(cursor, "to_list"):
            rows = cursor.to_list(None)
            if inspect.isawaitable(rows):
                rows = await rows
        else:
            rows = list(cursor or [])
    return _company_ids_from_rows(rows, name)


async def route_legacy_write(coll, op: str, *, doc=None, query=None, update=None):
    """Ham legacy yazmayı kilit ve güncel kipe göre bırakır, yönlendirir veya reddeder.

    Bayrak kapalıyken None döner ve katalog okunmaz. Dönüş None ise yazma
    bu koleksiyonda sürer. Koleksiyon dönerse yazma oraya gider. Birden
    fazla arşiv şirketine yayılan update_many/delete_many her şirketin
    canlı deposuna uygulanır ve sayılar toplanır. Diğer çoklu yazmalar
    uygulanmadan hata verir. Çağıranın sorgu sözlüğü değişmez.
    """
    if not enabled() or _PASSTHROUGH.get():
        return None
    db = getattr(coll, "_db", None) or getattr(coll, "db", None)
    name = str(getattr(coll, "name", "") or "")
    known = _payload_companies(op, doc, query, update, name)
    if name in _CONTROL_COLLECTIONS:
        for cid in known:
            if _writer.get() == cid:
                continue
            await guard_pinned_write(cid, db=db)
        if not known and name != "companies":
            if _writer.get():
                return None
            if await any_move_running(db):
                raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
        return None
    if not known and op not in ("insert_one", "insert_many"):
        known = await _matched_company_ids(coll, query, name)
    if not known:
        if _writer.get():
            return None
        if await any_move_running(db):
            raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
        return None
    views = []
    for cid in known:
        if _writer.get() == cid:
            continue
        views.append((cid, await load_view(db, cid)))
    if not views:
        return None
    if any(locked for _cid, (_mode, _epoch, locked) in views):
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=views[0][0])
    legacy = [cid for cid, (mode, _epoch, _locked) in views if mode == LEGACY]
    archived = [cid for cid, (mode, _epoch, _locked) in views if mode != LEGACY]
    if not archived:
        return None
    if len(archived) == 1 and not legacy:
        cid, (mode, _epoch, _locked) = views[0]
        return collection_for_mode(db, mode, cid, name)
    if op not in _MANY_WRITES or not isinstance(query, dict):
        raise StorageEpochStale(
            "Yazma birden fazla şirketin deposuna dağılmış. Uygulanmadı.",
            company_id=archived[0],
        )
    parts = []
    for cid, (mode, _epoch, _locked) in views:
        if mode == LEGACY:
            continue
        parts.append((collection_for_mode(db, mode, cid, name), copy.deepcopy(query)))
    legacy_coll = coll if legacy else None
    legacy_query = narrow_legacy_query(query, archived) if legacy else None
    return SplitWrite(legacy_coll, legacy_query, parts)


def route_legacy_write_sync(coll, op: str, *, doc=None, query=None, update=None):
    """Senkron ham yazma. Olay döngüsünde katalog için pymysql açmaz.

    Arşiv şirketine denk gelen yazma eski depoda başarı dönmez.
    """
    if not enabled() or _PASSTHROUGH.get():
        return None
    db = getattr(coll, "_db", None) or getattr(coll, "db", None)
    name = str(getattr(coll, "name", "") or "")
    known = _payload_companies(op, doc, query, update, name)
    if name in _CONTROL_COLLECTIONS:
        for cid in known:
            if _writer.get() == cid:
                continue
            guard_pinned_write_sync(cid, db=db)
        if not known and name != "companies":
            if _writer.get():
                return None
            if any_move_running_sync(db):
                raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
        return None
    if not known and op not in ("insert_one", "insert_many"):
        distinct = getattr(coll, "distinct_company_ids", None)
        rows = None
        if distinct is not None:
            try:
                rows = distinct(query)
            except Exception:
                rows = None
        if isinstance(rows, list):
            known.extend(_company_ids_from_rows(rows, name))
        else:
            loader = getattr(coll, "_load_filtered", None)
            loaded = loader(query) if loader is not None else []
            known.extend(_company_ids_from_rows(loaded, name))
    if not known:
        if _writer.get():
            return None
        if any_move_running_sync(db):
            raise StorageWriteLocked(WRITE_LOCK_MESSAGE)
        return None
    views = []
    for cid in known:
        if _writer.get() == cid:
            continue
        views.append((cid, load_view_sync(db, cid)))
    if not views:
        return None
    if any(locked for _cid, (_mode, _epoch, locked) in views):
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=views[0][0])
    legacy = [cid for cid, (mode, _epoch, _locked) in views if mode == LEGACY]
    archived = [cid for cid, (mode, _epoch, _locked) in views if mode != LEGACY]
    if not archived:
        return None
    chosen = next(item for item in views if item[0] == archived[0])
    cid, (mode, _epoch, _locked) = chosen
    raise StorageEpochStale(
        "Depolama kipi değişti. Senkron yazma eski depoya yapılmadı.",
        company_id=cid,
        mode=mode,
    )


class BoundCollection:
    """Şirket deposu yazması kendi company_id kilidini ve epoch'unu bilir."""

    def __init__(self, store: "CompanyStore", name: str, raw):
        self._store = store
        self._name = name
        self._raw = raw
        self.company_id = store.company_id
        self.name = name

    def __getattr__(self, item):
        return getattr(self._raw, item)

    async def _align(self):
        if not enabled():
            return self._raw
        if _writer.get() == self._store.company_id:
            return self._raw
        mode, epoch, locked = await load_view(self._store._db, self._store.company_id)
        if locked:
            raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=self._store.company_id)
        if mode != self._store.mode or epoch != self._store.epoch:
            self._store.mode = mode
            self._store.epoch = epoch
            self._raw = collection_for_mode(self._store._db, mode, self._store.company_id, self._name)
        return self._raw

    async def insert_one(self, doc):
        raw = await self._align()
        return await raw.insert_one(doc)

    async def insert_many(self, docs, ordered: bool = True):
        raw = await self._align()
        fn = raw.insert_many
        if "ordered" in getattr(fn, "__code__", type("c", (), {"co_varnames": ()})).co_varnames:
            return await fn(docs, ordered=ordered)
        return await fn(docs)

    async def update_one(self, query, update, upsert: bool = False):
        raw = await self._align()
        return await raw.update_one(query, update, upsert=upsert)

    async def update_one_atomic(self, query, update):
        raw = await self._align()
        return await raw.update_one_atomic(query, update)

    async def update_many(self, query, update, upsert: bool = False):
        raw = await self._align()
        return await raw.update_many(query, update, upsert=upsert)

    async def replace_one(self, query, replacement, upsert: bool = False):
        raw = await self._align()
        return await raw.replace_one(query, replacement, upsert=upsert)

    async def find_one_and_update(self, query, update, upsert: bool = False, return_document=True, projection=None):
        raw = await self._align()
        return await raw.find_one_and_update(
            query, update, upsert=upsert, return_document=return_document, projection=projection,
        )

    async def delete_one(self, query):
        raw = await self._align()
        return await raw.delete_one(query)

    async def delete_many(self, query):
        raw = await self._align()
        return await raw.delete_many(query)


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
