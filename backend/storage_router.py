"""Firma bazlı depolama yönlendiricisi.

STORAGE_ROUTER_ENABLED kapalıyken (varsayılan) bu modül okunmaz: TenantDB
bugünkü koleksiyonu döner. Bayrak açıkken firma ayarı kısa TTL ile
önbelleğe alınır; her istekte companies sorgusu yapılmaz.

Kip, TenantDB kurulurken okunur. Yazma, katalogdaki storage_epoch ile
karşılaştırır; farklıysa yeni kipe yönlenir. Önbellek hiç yoksa giriş
noktası dışında gerçek sürücüye sorulmaz ve legacy sayılır; hata verilmez.
Süresi dolmuş kayıt katalogdan yeniden okunur; bayat değer kullanılmaz.
Katalog okunamazsa bayrak açıkken yazma reddedilir. Yazma kilidi
katalogdaki storage_write_lock alanındadır; bakım modu aynı alandır,
ikinci bir kilit yoktur. Taşıma apply başında bu alanı açar. Doğrulama
temiz bitince alan açık kalır; süper yönetici kapatana kadar yazma reddedilir.
Her süreç kısa TTL ile bakar.

Bu sürüm legacy, shared_v2 ve dedicated arka uçlarını tanır.
shared_v2 kipinde orders, invoices, stock_movements ve bank_transactions
kendi tablolarına gider. Diğer koleksiyonlar docs_v2 koleksiyonuna gider.
dedicated ayrı veritabanına gider. Okuma ve yazma aynı kararı kullanır
(`storage_decision`). Dedicated ve shared_v2 paylaşılan docs kopyasına
sessiz düşmez. Veritabanı adı `tamkobi_c_<8 hex>` şirket kimliği değildir;
DSN araması `comp_<8 hex>` ile yapılır. Yazma, DSN referansı yoksa önbelleği
bırakıp katalogdan bir kez daha okur; hâlâ yoksa hata verir ve yazmaz.
Bu yenileme koleksiyon adından bağımsızdır.
Bilinmeyen bir kip sessizce legacy'ye düşmez. Alanı olmayan mevcut
firmalar legacy sayılır. Hiçbir firma burada dedicated veya shared_v2 yapılmaz.

dedicated_dsn_ref şemada durur. Değer düz metin yazılmaz; mühür
comm_service.encrypt ile atılır. Yazma yolu kip, epoch ve mühürlü
referansı aynı katalog belgesinden hatırlar. Epoch değişince veya
dedicated kipte ref önbellekte yoksa katalogdan taze okunur. Çözme
yalnız dedicated koleksiyon açılırken yapılır. Düz metin loglanmaz.
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
MAINTENANCE_DETAIL = "Bakım yapılıyor, kayıt geçici olarak kapalı"
WRITE_LOCK_MESSAGE = (
    "Bakım yapılıyor, kayıt geçici olarak kapalı. "
    "Şirket salt okunur. Yazma istekleri bakım bitene kadar reddedilir."
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
_mode_refresh_inflight: set[str] = set()
_mode_refresh_after: dict[str, float] = {}
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
    _mode_refresh_inflight.clear()
    _mode_refresh_after.clear()
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


# Veritabanı adı `tamkobi_c_<8hex>` veya kısa `c_<8hex>`. Şirket kimliği `comp_<8hex>`.
_DB_NAME_COMPANY = re.compile(r"^(?:tamkobi_)?c_([0-9a-fA-F]{8})$")


def canonical_company_id(company_id: str) -> str:
    """Şirket kimliği. `tamkobi_c_<8hex>` ve `c_<8hex>` → `comp_<8hex>`.

    `comp_505a96e8` değişmez. DSN ve kip araması bu kimliği kullanır.
    Veritabanı adındaki `c_` öneki şirket kimliği değildir.
    """
    text = str(company_id or "").strip()
    match = _DB_NAME_COMPANY.fullmatch(text)
    if not match:
        return text
    return f"comp_{match.group(1).lower()}"


def dedicated_database_name(company_id: str, prefix: str = "tamkobi") -> str:
    """Rapor adı. Veritabanı oluşturmaz.

    `comp_505a96e8` → `tamkobi_c_505a96e8`. Başka kimliklerde boş döner.
    """
    cid = canonical_company_id(company_id)
    head = "comp_"
    if not cid.startswith(head):
        return ""
    tail = cid[len(head):]
    if len(tail) != 8 or any(ch not in "0123456789abcdef" for ch in tail):
        return ""
    base = str(prefix or "tamkobi").strip() or "tamkobi"
    return f"{base}_c_{tail}"


def catalog_blocked_message(mode: str, company_id: str, *, write: bool) -> str:
    verb = "yazılamaz" if write else "okunamaz"
    return f"{mode} şirket paylaşılan katalogdan {verb}. company={company_id}"


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


def _same_company(left, right: str) -> bool:
    raw = str(left or "")
    cid = str(right or "")
    if not cid:
        return False
    return raw == cid or canonical_company_id(raw) == cid


def _memory_doc(db, company_id: str):
    """Bellek içi docs listesi. Gerçek sürücüde _UNREAD."""
    companies = _companies(db)
    docs = getattr(companies, "docs", None)
    if not isinstance(docs, list):
        return _UNREAD
    cid = canonical_company_id(company_id)
    found = None
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        if _same_company(doc.get("_id"), cid):
            return doc
        if found is None and _same_company(doc.get("id"), cid):
            found = doc
    return found


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
            cur.execute(_COMPANY_BY_ID_SQL, ("companies", company_id))
            row = cur.fetchone()
            if not row:
                cur.execute(_COMPANY_BY_JSON_ID_SQL, ("companies", company_id, company_id))
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
    return _parse_doc_cell(row[0])


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
    stored = _store(company_id, mode, epoch, locked)
    _capture_dedicated_ref(company_id, memory if isinstance(memory, dict) else None, mode, epoch)
    return stored


def _refresh_mode(db, company_id: str):
    """Süresi dolmuş kipi katalogdan yeniden okur. Okunamazsa None."""
    doc = _read_company_doc(db, company_id)
    if doc is _UNREAD:
        return None
    _bump()
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    stored = _store(company_id, mode, epoch, locked)
    _capture_dedicated_ref(company_id, doc if isinstance(doc, dict) else None, mode, epoch)
    return stored


def _schedule_mode_refresh(db, company_id: str) -> None:
    """Süresi dolmuş kipi döngüyü kilitlemeden tazeler. load_mode zaten async."""
    if not company_id or company_id in _mode_refresh_inflight:
        return
    now = _now()
    if _mode_refresh_after.get(company_id, 0.0) > now:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if len(_mode_refresh_after) > CACHE_MAX:
        _mode_refresh_after.clear()
    _mode_refresh_inflight.add(company_id)

    async def _go() -> None:
        try:
            await load_mode(db, company_id)
        except Exception:
            _mode_refresh_after[company_id] = _now() + 30.0
        else:
            _mode_refresh_after.pop(company_id, None)
        finally:
            _mode_refresh_inflight.discard(company_id)

    task = loop.create_task(_go())

    def _done(fut) -> None:
        if fut.cancelled():
            _mode_refresh_inflight.discard(company_id)
            return
        fut.exception()

    task.add_done_callback(_done)


def mode_for_handle(db, company_id: str) -> str:
    """TenantDB kurulumunda sabitlenecek kip.

    Taze önbellek hemen döner. Önbellek hiç yoksa yalnız bellek içi
    katalog okunur; gerçek sürücüye sorulmaz ve hata verilmez.
    Süresi dolmuş kayıt, olay döngüsü yoksa katalogdan yeniden okunur.
    Döngüde pymysql ve thread.join yapılmaz; bayat kip döner ve async
    load_mode önbelleği tazeler.
    """
    cid = canonical_company_id(company_id)
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    if cid not in _cache:
        synced = _read_sync(db, cid)
        if synced is not None:
            return synced
        _schedule_mode_refresh(db, cid)
        return LEGACY
    if _on_loop() and _memory_doc(db, cid) is _UNREAD:
        _schedule_mode_refresh(db, cid)
        stale = _stale(cid)
        if stale is not _MISS:
            return stale
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
    cid = canonical_company_id(company_id)
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
        cursor = coll.find(query)
    except TypeError:
        cursor = coll.find(query, None)
    return await _collect_docs(cursor, _COMPANY_LIST_LIMIT)


async def warm_dedicated_refs(db) -> list[dict]:
    """Açılış kontrolü. Dedicated firmada mühür var mı; değer yazılmaz.

    Tam belge okunur. Kip projeksiyonu bu alanda mühür taşımaz; taze süreç
    o projeksiyonla koleksiyon açarsa ref boş kalır. Aynı belgedeki `_id`
    ve `id` birlikte hatırlanır.
    """
    if not enabled() or db is None:
        return []
    try:
        docs = await _catalog_companies(db)
    except Exception as exc:
        _job_logger().warning("dedicated ref kontrolü okunamadı: %s", type(exc).__name__)
        return []
    report = []
    seen = set()
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        keys = _doc_company_ids(doc)
        if not keys:
            continue
        mode, epoch, locked = _view(doc)
        for cid in keys:
            _store(cid, mode, epoch, locked)
            _capture_dedicated_ref(cid, doc, mode, epoch)
        if mode != DEDICATED:
            continue
        label = next((item for item in keys if item.startswith("comp_")), keys[0])
        if label in seen:
            continue
        seen.add(label)
        state = _ref_state(doc)
        report.append({"company_id": label, "dedicated_dsn_ref": state})
        _job_logger().info(
            "dedicated ref kontrol company=%s dedicated_dsn_ref=%s",
            _safe_company(label),
            state,
        )
    return report


async def apply_dedicated_migrations(db) -> list[dict]:
    """Açılışta dedicated veritabanlarına bekleyen migration.

    Şema ilk hazırlıkta ve taşıma hedefi kurulurken uygulanır. Çalışan
    süreç bundan sonra yeni sürümü görmez; bu çağrı kaldığı sürümden
    sürer. Idempotenttir. Legacy ve mühürsüz satır atlanır. DSN loglanmaz.
    """
    if not enabled() or db is None:
        return []
    try:
        docs = await _catalog_companies(db)
    except Exception as exc:
        _job_logger().warning("dedicated migration okunamadı: %s", type(exc).__name__)
        return []
    import storage_dedicated

    return await storage_dedicated.apply_pending_schemas(docs)


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
            _capture_dedicated_ref(cid, doc, mode, epoch)
            _store(cid, mode, epoch, locked)
            if mode == DEDICATED:
                await prepare_dedicated(db, cid, mode)
            elif mode != LEGACY and mode != SHARED_V2:
                reject_unless_legacy(mode, cid)
            _probe_store(db, cid, mode)
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


class PartialWriteError(StorageModeError):
    """Depolar arası yazmanın bir kısmı uygulandı. Tekrar çift etki yapabilir.

    applied: yazmanın gittiği şirket kimlikleri. failed: uygulanmayan şirket.
    İleti sır, VKN ve ETTN taşımaz.
    """

    def __init__(self, applied, failed: str = "", *, operation: str = ""):
        self.applied = [str(item) for item in (applied or []) if item]
        self.failed = str(failed or "")
        self.operation = str(operation or "")
        applied_text = ", ".join(_safe_company(item) for item in self.applied) or "-"
        failed_text = _safe_company(self.failed) if self.failed else "-"
        super().__init__(
            "Yazma kısmen uygulandı. Uygulanan şirketler: "
            f"{applied_text}. Uygulanmayan şirket: {failed_text}. "
            "Depolar arası tek işlem yok; aynı yazmayı tekrarlamak uygulanan "
            "şirketlerde çift etki yapabilir.",
            company_id=self.failed,
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
            _capture_dedicated_ref(cid, memory, mode, epoch)
            return locked
    if _on_loop():
        return True
    doc = _read_company_doc(db, cid)
    if doc is _UNREAD:
        return True
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    _store(cid, mode, epoch, locked)
    _capture_dedicated_ref(cid, doc, mode, epoch)
    return locked


def company_write_locked(company_id: str, db=None) -> bool:
    """Katalogdaki kilit. Taze önbellek sorgu atmaz."""
    return _locked_now(db, str(company_id or ""))


def lock_company_writes(company_id: str) -> None:
    note_write_lock(company_id, True)


def unlock_company_writes(company_id: str) -> None:
    note_write_lock(company_id, False)


def maintenance_cached(company_id: str) -> bool:
    """Taze kilit önbelleği. Katalog okumaz. Yazarın kendi yazısı geçmez."""
    cid = canonical_company_id(company_id)
    if not cid or _writer.get() == cid:
        return False
    row = _lock_cache.get(cid)
    if row is not None and _now() < row[1]:
        return bool(row[0])
    cached = _view_cached(cid)
    if cached is not None:
        return bool(cached[2])
    return False


async def maintenance_locked(db, company_id: str) -> bool:
    """Bakım açık mı. Alan storage_write_lock. Yönlendirici bayrağından bağımsız.

    Taze önbellek sorgu atmaz. Bellek kataloğu sayaç artırmaz. Taşımanın
    yazarı False döner. Gerçek sürücü okunamazsa ve bayrak kapalıysa yazma
    bu yüzden kapanmaz; bayrak açıkken load_view reddeder.
    """
    cid = canonical_company_id(company_id)
    if not cid or _writer.get() == cid or _PASSTHROUGH.get():
        return False
    if maintenance_cached(cid):
        return True
    row = _lock_cache.get(cid)
    if row is not None and _now() < row[1]:
        return False
    if db is not None:
        memory = _memory_doc(db, cid)
        if memory is not _UNREAD:
            locked = bool(_view(memory if isinstance(memory, dict) else None)[2])
            note_write_lock(cid, locked)
            return locked
    if enabled():
        _mode, _epoch, locked = await load_view(db, cid)
        return bool(locked)
    doc = await read_company_doc_async(db, cid)
    if doc is _UNREAD:
        return False
    locked = bool(_view(doc if isinstance(doc, dict) else None)[2])
    note_write_lock(cid, locked)
    return locked


async def set_company_maintenance(db, company_id: str, locked: bool) -> dict:
    """Aynı storage_write_lock alanını açar veya kapatır. İkinci kilit yazılmaz."""
    cid = canonical_company_id(company_id)
    if not cid:
        raise ValueError("company_id boş")
    with bypass_write_lock(cid):
        await db.companies.update_one(
            {"_id": cid},
            {"$set": {WRITE_LOCK_FIELD: bool(locked)}},
        )
    forget_mode(cid)
    note_write_lock(cid, bool(locked))
    return {"company_id": cid, "maintenance": bool(locked)}


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
    token = _writer.set(canonical_company_id(company_id))
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
    açmadan önce en az bir TTL bekler. Mühürlü ref de bu süreçte düşer;
    sonraki okuma kip ile birlikte yeniden alır.
    """
    cid = canonical_company_id(company_id)
    raw = str(company_id or "").strip()
    _cache.pop(cid, None)
    _lock_cache.pop(cid, None)
    import storage_dedicated

    storage_dedicated.forget_ref(cid)
    if raw and raw != cid:
        _cache.pop(raw, None)
        _lock_cache.pop(raw, None)
        storage_dedicated.forget_ref(raw)


def _view_cached(company_id: str):
    """İkisi de tazeyse (mode, epoch, locked). Değilse None. Bayat değer dönmez."""
    cid = str(company_id or "")
    row = _cache.get(cid)
    lock = _lock_cache.get(cid)
    now = _now()
    if not row or not lock or now >= row[1] or now >= lock[1]:
        return None
    return row[0], int(row[2]), bool(lock[0])


def _capture_dedicated_ref(company_id: str, doc, mode: str, epoch: int) -> None:
    """Kip ile aynı belgedeki mühür. Başka önbellekten boş ref bağlanmaz."""
    import storage_dedicated

    storage_dedicated.sync_ref_from_doc(company_id, doc if isinstance(doc, dict) else None, mode, epoch)


def _dedicated_ref_ready(company_id: str, mode: str, epoch: int) -> bool:
    if mode != DEDICATED:
        return True
    import storage_dedicated

    return storage_dedicated.ref_ready(company_id, epoch)


def _remember_view(company_id: str, doc) -> tuple[str, int, bool]:
    mode, epoch, locked = _view(doc if isinstance(doc, dict) else None)
    _store(company_id, mode, epoch, locked)
    _capture_dedicated_ref(company_id, doc, mode, epoch)
    _bump()
    return mode, epoch, locked


_COMPANY_BY_ID_SQL = "SELECT doc FROM docs WHERE collection=%s AND id=%s"
_COMPANY_BY_JSON_ID_SQL = (
    "SELECT doc FROM docs WHERE collection=%s AND ("
    "JSON_UNQUOTE(JSON_EXTRACT(doc, '$._id'))=%s OR "
    "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.id'))=%s"
    ") LIMIT 1"
)


def _doc_company_ids(doc) -> list[str]:
    """Belge kimliği. `_id` ile JSON `id` aynı firmaysa ikisi de tutulur."""
    found = []
    if not isinstance(doc, dict):
        return found
    for key in ("_id", "id"):
        value = str(doc.get(key) or "").strip()
        if value and value not in found:
            found.append(value)
    return found


def _ref_state(doc) -> str:
    """Mührün varlığı. Değer dönmez."""
    sealed = (doc or {}).get(DSN_FIELD) if isinstance(doc, dict) else None
    if isinstance(sealed, str) and sealed.strip():
        return "var"
    return "yok"


def _parse_doc_cell(raw):
    if not raw:
        return None
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


async def _sql_company_async(db, company_id: str):
    """Havuzdaki async sürücü. Olay döngüsünde pymysql açılmaz.

    Önce satır kimliği. Yoksa JSON `_id` / `id`. Projeksiyon yok; mühür belgenin içindedir.
    """
    await db._ensure()
    async with db._pool.acquire() as conn:
        async with conn.cursor() as cur:
            await cur.execute(_COMPANY_BY_ID_SQL, ("companies", company_id))
            row = await cur.fetchone()
            if not row:
                await cur.execute(
                    _COMPANY_BY_JSON_ID_SQL,
                    ("companies", company_id, company_id),
                )
                row = await cur.fetchone()
    if not row:
        return None
    return _parse_doc_cell(row[0])


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
        result = find_one({"_id": company_id})
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
    cid = canonical_company_id(company_id)
    if not cid:
        raise ValueError("company_id boş")
    cached = _view_cached(cid)
    if cached is not None and _dedicated_ref_ready(cid, cached[0], cached[1]):
        return cached
    doc = await read_company_doc_async(db, cid)
    if doc is _UNREAD:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=cid)
    return _remember_view(cid, doc)


def load_view_sync(db, company_id: str) -> tuple[str, int, bool]:
    """Senkron yazma yolu. Olay döngüsünde pymysql açmaz; okuyamazsa reddeder."""
    cid = canonical_company_id(company_id)
    if not cid:
        raise ValueError("company_id boş")
    cached = _view_cached(cid)
    if cached is not None and _dedicated_ref_ready(cid, cached[0], cached[1]):
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
    cid = canonical_company_id(company_id)
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
    cid = canonical_company_id(company_id)
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
        if isinstance(value, str):
            text = canonical_company_id(value)
        else:
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

    Depolar arası tek işlem yoktur. Yazmadan önce her hedefte sorgu
    çalıştırılır. Bu kontrol düşerse hiçbir yere yazılmaz. Yazının bir
    kısmı uygulandıktan sonra sonraki hedef hata verirse PartialWriteError
    uygulanmış şirketleri söyler. Toplam matched/modified/deleted, hatasız
    biten her hedefin toplamıdır.
    """

    def __init__(self, legacy, legacy_query, legacy_companies, parts):
        self._legacy = legacy
        self._legacy_query = legacy_query
        self._legacy_companies = [str(item) for item in (legacy_companies or []) if item]
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

    async def _probe_one(self, target, query):
        """Sorguyu hedefte çalıştır. shared_v2 planı SQL'i kurar; legacy tam tarama yapmaz."""
        body = copy.deepcopy(query) if isinstance(query, dict) else {}
        planner = getattr(target, "_read_plan", None)
        if callable(planner):
            built, _reason = planner(body, [("_id", 1)], 0, 1, 1)
            if built is not None:
                fetch = getattr(target, "_fetch_docs", None)
                if callable(fetch):
                    fetch(*built)
            return
        if hasattr(target, "_load_filtered"):
            await self._probe_legacy_sql(target, body)
            return
        await self._probe_find(target, body)

    async def _probe_legacy_sql(self, target, query):
        from mysql_store import sql_pushdown

        sql, params = sql_pushdown(str(getattr(target, "name", "") or ""), query)
        limited = sql + " LIMIT 1"
        loader = getattr(target, "_load_sql", None)
        if callable(loader):
            rows = loader(limited, params)
            if inspect.isawaitable(rows):
                await rows
            return
        fetch = getattr(target, "_fetch_rows", None)
        if callable(fetch):
            fetch(limited, params)
            return
        await self._probe_find(target, query)

    async def _probe_find(self, target, query):
        find = getattr(target, "find", None)
        if find is None:
            return
        cursor = find(query, {"_id": 1})
        if hasattr(cursor, "limit"):
            limited = cursor.limit(1)
            if limited is not None:
                cursor = limited
        if hasattr(cursor, "to_list"):
            rows = cursor.to_list(1)
            if inspect.isawaitable(rows):
                await rows
            return
        if inspect.isawaitable(cursor):
            await cursor

    async def _probe(self):
        """Yazmadan önce her depoda sorguyu çalıştır. Derleme hatası yazmaz."""
        if self._legacy is not None:
            await self._probe_one(self._legacy, self._legacy_query)
        for _cid, coll, part_query in self._parts:
            await self._probe_one(coll, part_query)

    def _log_partial(self, operation: str, applied, failed: str) -> None:
        _job_logger().warning(
            "bölünmüş yazma kısmi op=%s uygulanan=%s uygulanmayan=%s",
            operation,
            ",".join(_safe_company(item) for item in applied) or "-",
            _safe_company(failed),
        )

    async def _apply(self, operation: str, legacy_method, legacy_args, legacy_kwargs, part_method, part_args, part_kwargs):
        await self._probe()
        applied: list[str] = []
        results = []
        failed = ""
        try:
            if self._legacy is not None:
                failed = self._legacy_companies[0] if self._legacy_companies else ""
                legacy = await self._legacy_call(legacy_method, legacy_args, legacy_kwargs)
                if legacy is not None:
                    results.append(legacy)
                applied.extend(self._legacy_companies)
                failed = ""
            for cid, coll, part_query in self._parts:
                failed = str(cid)
                results.append(await self._call(coll, part_method, part_query, part_args, part_kwargs))
                applied.append(str(cid))
                failed = ""
        except PartialWriteError:
            raise
        except Exception:
            if not applied:
                raise
            self._log_partial(operation, applied, failed)
            raise PartialWriteError(applied, failed, operation=operation) from None
        return results

    async def update_many(self, query, update, upsert: bool = False):
        results = await self._apply(
            "update_many",
            "update_many",
            (update,),
            {"upsert": upsert},
            "update_many",
            (update,),
            {"upsert": upsert},
        )
        return _sum_update(results)

    async def delete_many(self, query):
        results = await self._apply(
            "delete_many",
            "delete_many",
            (),
            {},
            "delete_many",
            (),
            {},
        )
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


def _dsn_missing(exc: BaseException) -> bool:
    """Yalnız boş dedicated ref. Çözülemedi veya başka kip hatası yenilenmez."""
    import storage_dedicated

    return (
        isinstance(exc, storage_dedicated.DedicatedStorageError)
        and "DSN referansı yok" in str(exc)
    )


async def open_company_collection(db, mode: str, company_id: str, name: str):
    """Koleksiyon. Dedicated ref yoksa katalogdan bir kez tazeler.

    Ad fark etmez: orders, invoices ve diğerleri aynı yolu kullanır.
    İkinci okuma da boşsa aynı hata çıkar. Bu çağrı yazmaz.
    """
    if mode != DEDICATED:
        return collection_for_mode(db, mode, company_id, name)
    try:
        return collection_for_mode(db, mode, company_id, name)
    except Exception as exc:
        if not _dsn_missing(exc):
            raise
    forget_mode(company_id)
    mode2, _epoch, locked = await load_view(db, company_id)
    if locked:
        raise StorageWriteLocked(WRITE_LOCK_MESSAGE, company_id=company_id)
    return collection_for_mode(db, mode2, company_id, name)


def _plain_company(value) -> str:
    if isinstance(value, str):
        return canonical_company_id(value)
    if isinstance(value, dict) and len(value) == 1 and isinstance(value.get("$eq"), str):
        return canonical_company_id(value["$eq"])
    return ""


def _query_company_id(query) -> str:
    if not isinstance(query, dict):
        return ""
    direct = _plain_company(query.get("company_id"))
    if direct:
        return direct
    parts = query.get("$and")
    if not isinstance(parts, list):
        return ""
    found: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        one = _plain_company(part.get("company_id"))
        if one and one not in found:
            found.append(one)
    if len(found) == 1:
        return found[0]
    return ""


def align_query_company(query):
    """Sorguyu kanonik şirket kimliğine taşır. Çağıranın sözlüğü değişmez."""
    if not isinstance(query, dict):
        return query
    copied = None

    def ensure():
        nonlocal copied
        if copied is None:
            copied = dict(query)
        return copied

    changed = False
    value = query.get("company_id")
    if isinstance(value, str):
        cid = canonical_company_id(value)
        if cid and cid != value:
            ensure()["company_id"] = cid
            changed = True
    elif isinstance(value, dict) and len(value) == 1 and isinstance(value.get("$eq"), str):
        cid = canonical_company_id(value["$eq"])
        if cid and cid != value["$eq"]:
            ensure()["company_id"] = {"$eq": cid}
            changed = True
    parts = query.get("$and")
    if isinstance(parts, list):
        new_parts = []
        parts_changed = False
        for part in parts:
            aligned = align_query_company(part) if isinstance(part, dict) else part
            if aligned is not part:
                parts_changed = True
            new_parts.append(aligned)
        if parts_changed:
            ensure()["$and"] = new_parts
            changed = True
    return copied if changed else query


def align_pipeline_company(pipeline):
    if not isinstance(pipeline, (list, tuple)):
        return pipeline
    changed = False
    out = []
    for stage in pipeline:
        if isinstance(stage, dict) and isinstance(stage.get("$match"), dict):
            aligned = align_query_company(stage["$match"])
            if aligned is not stage["$match"]:
                changed = True
                stage = {**stage, "$match": aligned}
        out.append(stage)
    return out if changed else pipeline


async def storage_decision(db, company_id: str) -> tuple[str, int, bool]:
    """Okuma ve yazmanın ortak kararı: kip, epoch, kilit."""
    return await load_view(db, company_id)


def storage_decision_sync(db, company_id: str) -> tuple[str, int, bool]:
    """Senkron yolun ortak kararı. Olay döngüsünde pymysql açmaz."""
    return load_view_sync(db, company_id)


async def route_legacy_read(coll, query=None):
    """Şirket okumasını kipin deposuna bırakır.

    Bayrak kapalı, legacy veya taşımanın kendi yazarı katalogda kalır.
    Dedicated ve shared_v2 satırı kendi deposundan okur. Paylaşılan docs
    tablosu ve ham SQL bu yolda çalışmaz. DSN yoksa katalog bir kez
    tazelenir; hâlâ yoksa hata çıkar, boş katalog listesi dönmez.
    """
    if not enabled() or _PASSTHROUGH.get():
        return None
    name = str(getattr(coll, "name", "") or "")
    if name in _CONTROL_COLLECTIONS:
        return None
    cid = _query_company_id(query)
    if not cid or _writer.get() == cid:
        return None
    db = getattr(coll, "_db", None) or getattr(coll, "db", None)
    mode, _epoch, _locked = await storage_decision(db, cid)
    if mode == LEGACY:
        return None
    return await open_company_collection(db, mode, cid, name)


async def route_legacy_write(coll, op: str, *, doc=None, query=None, update=None):
    """Ham legacy yazmayı kilit ve güncel kipe göre bırakır, yönlendirir veya reddeder.

    Bayrak kapalıyken None döner ve katalog okunmaz. Dönüş None ise yazma
    bu koleksiyonda sürer. Koleksiyon dönerse yazma oraya gider.     Birden
    fazla arşiv şirketine yayılan update_many/delete_many her şirketin
    canlı deposuna uygulanır ve sayılar toplanır. Yazmadan önce her
    hedefte sorgu çalışır; bu kontrol düşerse hiçbir yazma yapılmaz.
    Yazının bir kısmı kalırsa PartialWriteError uygulanmış şirketleri
    söyler. Depolar arası tek işlem yoktur. Diğer çoklu yazmalar
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
        views.append((cid, await storage_decision(db, cid)))
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
        return await open_company_collection(db, mode, cid, name)
    if op not in _MANY_WRITES or not isinstance(query, dict):
        raise StorageEpochStale(
            "Yazma birden fazla şirketin deposuna dağılmış. Uygulanmadı.",
            company_id=archived[0],
        )
    parts = []
    for cid, (mode, _epoch, _locked) in views:
        if mode == LEGACY:
            continue
        parts.append((cid, await open_company_collection(db, mode, cid, name), copy.deepcopy(query)))
    legacy_coll = coll if legacy else None
    legacy_query = narrow_legacy_query(query, archived) if legacy else None
    return SplitWrite(legacy_coll, legacy_query, legacy, parts)


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
        views.append((cid, storage_decision_sync(db, cid)))
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
            self._raw = await open_company_collection(
                self._store._db, mode, self._store.company_id, self._name,
            )
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
