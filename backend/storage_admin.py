"""Süper admin veritabanı yönetimi.

Ölçüm, eşik ve iş kuyruğu burada. Taşıma storage_move.plan_move,
apply_move, rollback_move ve recover_move ile yapılır; kopyalama
yeniden yazılmaz. Eşik yalnız öneriyi değiştirir. DSN, parola ve
mühürlü referans yanıta ve loga girmez.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote, unquote, urlparse
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException

import saas
import storage_router
import scripts.storage_move as storage_move
from tenant_scope import unscoped

router = APIRouter(prefix="/api")
_db = None

SUMMARIES = "storage_measure_summaries"
SNAPSHOTS = "storage_measure_snapshots"
JOBS = "storage_admin_jobs"
SETTINGS = "platform_settings"
AUDITS = "activity_logs"
MOVES = "storage_moves"
LOCKS = "storage_move_locks"
META_ID = "storage_admin_meta"
THRESHOLD_ID = "storage_admin_thresholds"
ISTANBUL = ZoneInfo("Europe/Istanbul")
DBA_ENV = "STORAGE_DBA_DSN"

DEFAULT_THRESHOLDS = {
    "records": 100_000,
    "data_mb": 50,
    "users": 5,
    "growth_pct": 20,
}
SKIP_VOLUME = frozenset({
    "files", "users", "companies", "activity_logs", "platform_settings",
    "storage_moves", "storage_move_locks", "storage_measure_summaries",
    "storage_measure_snapshots", "storage_admin_jobs",
})
_SECRET_KEYS = frozenset({
    "dedicated_dsn_ref", "dsn", "password", "password_hash", "secret",
    "token", "totp_secret", "db_password", "app_dsn", "admin_dsn",
    "ssl_ca", "merchant_key", "merchant_salt",
})
_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_IDENT = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_ACTIVE = frozenset({"queued", "running"})
_OPEN = frozenset({"queued", "running", "scheduled"})


class StorageAdminError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def _logger() -> logging.Logger:
    log = logging.getLogger("storage_admin")
    try:
        from storage_migrations.masking import RedactFilter
    except Exception:
        return log
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log


def init(db) -> None:
    global _db
    _db = db


def _database():
    if _db is None:
        raise StorageAdminError("Veritabanı yönetimi hazır değil.", status=500)
    return _db


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime] = None) -> str:
    return (value or _now()).astimezone(timezone.utc).isoformat()


def _parse(value) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(text)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _actor(admin: Optional[dict]) -> dict:
    admin = admin or {}
    return {
        "id": str(admin.get("_id") or admin.get("id") or ""),
        "name": str(admin.get("name") or "süper yönetici")[:80],
    }


def _company_id(raw: str) -> str:
    text = str(raw or "").strip()
    if not _ID.fullmatch(text):
        raise StorageAdminError("Firma kimliği geçersiz.")
    return text


def _mode(raw: str) -> str:
    mode = storage_router.normalize_mode(raw)
    if mode not in storage_router.KNOWN_MODES:
        raise StorageAdminError("Hedef kip legacy, shared_v2 veya dedicated olmalı.")
    return mode


def fmt_int(value: int) -> str:
    return f"{int(value):,}".replace(",", ".")


def fmt_mb(value: float) -> str:
    number = float(value)
    if abs(number - round(number)) < 0.05:
        return str(int(round(number)))
    return f"{number:.1f}".replace(".", ",")


def public_copy(value):
    """Yanıttan gizli anahtarları ve URL benzeri dizgeleri çıkarır."""
    from storage_migrations.masking import scrub

    if isinstance(value, dict):
        return {
            key: public_copy(item)
            for key, item in value.items()
            if key not in _SECRET_KEYS
        }
    if isinstance(value, list):
        return [public_copy(item) for item in value]
    if isinstance(value, str):
        return scrub(value)
    return value


def auto_kick() -> bool:
    raw = (os.environ.get("STORAGE_ADMIN_AUTO_KICK") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def tick_seconds() -> float:
    try:
        value = float(os.environ.get("STORAGE_ADMIN_TICK_SECONDS") or "30")
    except (TypeError, ValueError):
        value = 30.0
    return value if value >= 1 else 30.0


def measure_seconds() -> float:
    try:
        value = float(os.environ.get("STORAGE_ADMIN_MEASURE_SECONDS") or str(6 * 3600))
    except (TypeError, ValueError):
        value = 6 * 3600
    return value if value >= 30 else 6 * 3600


async def _find_one(db, name: str, query: dict):
    found = db[name].find_one(query)
    if inspect.isawaitable(found):
        found = await found
    return found if isinstance(found, dict) else None


async def _all(db, name: str) -> list:
    return await storage_move._collect(db[name].find({}))


async def _save(db, name: str, doc_id: str, fields: dict) -> None:
    body = {key: value for key, value in fields.items() if key != "_id"}
    current = await _find_one(db, name, {"_id": doc_id})
    if current:
        await db[name].update_one({"_id": doc_id}, {"$set": body})
        return
    await db[name].insert_one({"_id": doc_id, **body})


def _thresholds_from(doc: Optional[dict]) -> dict:
    raw = doc or {}
    out = dict(DEFAULT_THRESHOLDS)
    for key in DEFAULT_THRESHOLDS:
        if raw.get(key) is None or raw.get(key) == "":
            continue
        try:
            number = float(raw[key])
        except (TypeError, ValueError):
            continue
        if key == "data_mb" or key == "growth_pct":
            out[key] = number
        else:
            out[key] = int(number)
    return out


def _check_thresholds(raw: dict) -> dict:
    bounds = {
        "records": (1, 10_000_000, int),
        "data_mb": (1, 1_000_000, float),
        "users": (1, 100_000, int),
        "growth_pct": (1, 1_000, float),
    }
    out = {}
    for key, (low, high, cast) in bounds.items():
        try:
            number = cast(raw.get(key))
        except (TypeError, ValueError):
            raise StorageAdminError("Eşik değerleri sayı olmalı.") from None
        if number < low or number > high:
            raise StorageAdminError("Eşik değeri izin verilen aralıkta değil.")
        out[key] = number
    return out


async def load_thresholds(db) -> dict:
    doc = await _find_one(db, SETTINGS, {"_id": THRESHOLD_ID})
    return _thresholds_from(doc)


async def save_thresholds(db, raw: dict, actor: dict) -> dict:
    values = _check_thresholds(raw or {})
    await _save(db, SETTINGS, THRESHOLD_ID, {**values, "updated_at": _iso()})
    await _audit(db, actor, "", "thresholds", "kaydedildi")
    return values


async def reset_thresholds(db, actor: dict) -> dict:
    await _save(db, SETTINGS, THRESHOLD_ID, {**DEFAULT_THRESHOLDS, "updated_at": _iso()})
    await _audit(db, actor, "", "thresholds", "varsayılan")
    return dict(DEFAULT_THRESHOLDS)


def recommend(mode: str, records: int, data_mb: float, users: int, growth, thresholds: dict) -> dict:
    """Eşik aşımı dedicated önerir. Legacy ve eşik altı shared_v2'ye gider."""
    reasons = []
    if records > thresholds["records"]:
        reasons.append(f"Kayıt {fmt_int(records)} > {fmt_int(thresholds['records'])}")
    if data_mb > thresholds["data_mb"]:
        reasons.append(f"Veri {fmt_mb(data_mb)} > {fmt_mb(thresholds['data_mb'])} MB")
    if users > thresholds["users"]:
        reasons.append(f"Kullanıcı {int(users)} > {int(thresholds['users'])}")
    if growth is not None and float(growth) > thresholds["growth_pct"]:
        reasons.append(f"Büyüme %{fmt_mb(growth)} > %{fmt_mb(thresholds['growth_pct'])}")
    exceeded = bool(reasons)
    current = storage_router.public_mode(mode)
    if exceeded:
        target = storage_router.DEDICATED
    elif current == storage_router.LEGACY:
        target = storage_router.SHARED_V2
    else:
        target = current
    if not exceeded and current == storage_router.LEGACY:
        reason = "Legacy kaldırılıyor; eşik altında"
    elif not exceeded and current == storage_router.SHARED_V2:
        reason = "Ortak DB'de kalacak"
    elif not exceeded and current == storage_router.DEDICATED:
        reason = "Ayrı veritabanında; eşik altında"
    else:
        reason = " · ".join(reasons)
    suitable = target == current or (current == storage_router.LEGACY and target == storage_router.SHARED_V2 and not exceeded)
    return {"mode": target, "reason": reason, "suitable": suitable, "exceeded": exceeded}


def is_test_company(company: dict) -> bool:
    if company.get("is_demo") or company.get("is_test"):
        return True
    name = str(company.get("name") or "").strip().lower()
    return name.startswith("örnek") or name.startswith("ornek")


def _active_user(row: dict, company_id: str) -> bool:
    if row.get("is_super_admin"):
        return False
    if row.get("is_active") is False:
        return False
    ids = row.get("company_ids") or []
    if isinstance(ids, str):
        ids = [ids]
    if company_id in {str(item) for item in ids if item is not None}:
        return True
    return str(row.get("active_company_id") or row.get("company_id") or "") == company_id


async def _people(db, company_id: str) -> dict:
    users = []
    last = ""
    for row in await _all(db, "users"):
        if not _active_user(row, company_id):
            continue
        users.append(row)
        stamp = str(row.get("last_login_at") or "")
        if stamp > last:
            last = stamp
    return {"users": len(users), "last_login_at": last}


async def _files(db, company_id: str) -> dict:
    count = 0
    size = 0
    for row in await _all(db, "files"):
        if str(row.get("company_id") or "") != company_id or row.get("is_deleted"):
            continue
        count += 1
        try:
            size += int(row.get("size") or 0)
        except (TypeError, ValueError):
            continue
    return {"files": count, "file_bytes": size}


async def read_volume(db, company: dict) -> dict:
    """Kayıt ve bayt, firmanın güncel kipinden. Yönlendirici kapalıysa legacy."""
    cid = str(company.get("_id") or "")
    mode = storage_router.public_mode(company.get(storage_router.MODE_FIELD))
    read_mode = mode if storage_router.enabled() else storage_router.LEGACY
    try:
        names = await storage_move._names(db, read_mode, cid, company, read_mode)
    except Exception as exc:
        return {"collections": [], "error": storage_router.public_store_error(exc), "read_mode": read_mode}
    collections = []
    for name in names:
        if name in SKIP_VOLUME:
            continue
        try:
            docs = await storage_move._read(db, read_mode, cid, name, company)
        except Exception as exc:
            return {
                "collections": collections,
                "error": storage_router.public_store_error(exc),
                "read_mode": read_mode,
            }
        prepared = [
            storage_move._prepare(doc, cid, name)
            for doc in docs
            if isinstance(doc, dict) and doc.get("_id")
        ]
        collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": storage_move._bytes(prepared),
        })
    return {"collections": collections, "error": "", "read_mode": read_mode}


def _growth(current: int, past) -> Optional[float]:
    if past is None:
        return None
    baseline = int(past)
    if baseline <= 0:
        return 100.0 if current > 0 else 0.0
    return (current - baseline) / baseline * 100.0


async def _past_bytes(db, company_id: str, today: str) -> Optional[int]:
    cutoff = (datetime.fromisoformat(today) - timedelta(days=30)).date().isoformat()
    best_day = ""
    best = None
    for row in await _all(db, SNAPSHOTS):
        if str(row.get("company_id") or "") != company_id:
            continue
        day = str(row.get("day") or "")
        if not day or day > cutoff or day >= today:
            continue
        if day >= best_day:
            best_day = day
            try:
                best = int(row.get("bytes") or 0)
            except (TypeError, ValueError):
                best = 0
    return best


async def _prune_snapshots(db, today: str) -> None:
    cutoff = (datetime.fromisoformat(today) - timedelta(days=40)).date().isoformat()
    for row in await _all(db, SNAPSHOTS):
        day = str(row.get("day") or "")
        if day and day < cutoff:
            await db[SNAPSHOTS].delete_one({"_id": row.get("_id")})


async def measure_company(db, company: dict, thresholds: dict, *, today: Optional[str] = None) -> dict:
    cid = str(company.get("_id") or "")
    day = today or _now().date().isoformat()
    volume = await read_volume(db, company)
    people = await _people(db, cid)
    files = await _files(db, cid)
    records = sum(int(row.get("count") or 0) for row in volume["collections"])
    nbytes = sum(int(row.get("bytes") or 0) for row in volume["collections"])
    past = await _past_bytes(db, cid, day)
    growth = _growth(nbytes, past)
    data_mb = nbytes / (1024 * 1024)
    advice = recommend(
        storage_router.public_mode(company.get(storage_router.MODE_FIELD)),
        records, data_mb, people["users"], growth, thresholds,
    )
    largest = None
    for row in volume["collections"]:
        if largest is None or int(row.get("bytes") or 0) > int(largest.get("bytes") or 0):
            largest = {"name": row.get("name"), "bytes": int(row.get("bytes") or 0)}
    measured_at = _iso()
    summary = {
        "company_id": cid,
        "measured_at": measured_at,
        "records": records,
        "bytes": nbytes,
        "collections": volume["collections"],
        "largest": largest,
        "read_mode": volume.get("read_mode") or "",
        "measure_error": volume.get("error") or "",
        "users": people["users"],
        "last_login_at": people["last_login_at"],
        "files": files["files"],
        "file_bytes": files["file_bytes"],
        "growth_pct": growth,
        "recommended": advice["mode"],
        "reason": advice["reason"],
        "suitable": advice["suitable"],
    }
    previous = await _find_one(db, SUMMARIES, {"_id": cid})
    if previous and isinstance(previous.get("last_dry_run"), dict):
        summary["last_dry_run"] = previous["last_dry_run"]
    await _save(db, SUMMARIES, cid, summary)
    await _save(db, SNAPSHOTS, f"{cid}:{day}", {
        "company_id": cid,
        "day": day,
        "records": records,
        "bytes": nbytes,
        "users": people["users"],
        "files": files["files"],
        "file_bytes": files["file_bytes"],
        "created_at": measured_at,
    })
    return summary


async def measure_all(db, *, today: Optional[str] = None) -> dict:
    thresholds = await load_thresholds(db)
    rows = []
    for company in await _all(db, "companies"):
        if not company.get("_id"):
            continue
        rows.append(await measure_company(db, company, thresholds, today=today))
    day = today or _now().date().isoformat()
    await _prune_snapshots(db, day)
    stamp = _iso()
    await _save(db, SETTINGS, META_ID, {"measured_at": stamp, "companies": len(rows)})
    _logger().info("ölçüm firma=%s", len(rows))
    return {"measured_at": stamp, "companies": len(rows)}


def maintenance_window(now: Optional[datetime] = None) -> dict:
    current = (now or _now()).astimezone(ISTANBUL)
    start = current.replace(hour=2, minute=0, second=0, microsecond=0)
    if current >= start:
        start = start + timedelta(days=1)
    end = start.replace(hour=3, minute=30)
    if current.hour < 4 and start.date() != current.date():
        label = "Yarın 02:00–03:30 (en düşük kullanım)"
    else:
        label = "Bu gece 02:00–03:30 (en düşük kullanım)"
    return {"label": label, "start": start.isoformat(), "end": end.isoformat()}


def estimate_lock(nbytes: int, history: list) -> dict:
    rates = []
    for row in history or []:
        try:
            size = int(row.get("bytes") or 0)
            duration = int(row.get("duration_ms") or 0)
        except (TypeError, ValueError):
            continue
        if size > 0 and duration > 0:
            rates.append(size / duration)
    if rates:
        minutes = max(1.0, (int(nbytes or 0) / (sum(rates) / len(rates))) / 60000.0)
    else:
        minutes = max(1.0, int(nbytes or 0) / (8 * 1024 * 1024))
    low = max(1, int(round(minutes * 0.85)))
    high = max(low + 1, int(round(minutes * 1.15)))
    return {"low": low, "high": high, "label": f"≈ {low}-{high} dk"}


def _xml_warning(collections) -> str:
    for row in collections or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").lower()
        try:
            size = int(row.get("bytes") or 0)
        except (TypeError, ValueError):
            size = 0
        if "xml" in name and size >= 10 * 1024 * 1024:
            return "Büyük XML koleksiyonu kopyalaması uzun sürebilir"
    return ""


async def _audit(db, actor: dict, company_id: str, action: str, result: str) -> None:
    detail = f"{action} {result}"[:180]
    from storage_migrations.masking import scrub

    await db[AUDITS].insert_one({
        "_id": uuid.uuid4().hex,
        "company_id": company_id,
        "user_id": actor.get("id") or "",
        "user_name": actor.get("name") or "",
        "method": "POST",
        "path": f"/system/storage-admin/{action}",
        "module": "/sistem/veritabani-yonetimi",
        "status": 200 if result not in ("hata", "reddedildi") else 400,
        "detail": scrub(detail),
        "action": f"storage_admin.{action}",
        "result": scrub(str(result))[:80],
        "created_at": _iso(),
    })
    _logger().info(
        "işlem %s company=%s sonuç=%s",
        action,
        storage_router._safe_company(company_id),
        scrub(str(result))[:80],
    )


async def _running(db, now: Optional[datetime] = None) -> bool:
    """Süren iş veya kilit. Altı saati aşan panel işi bayat sayılır."""
    moment = now or _now()
    for row in await _all(db, JOBS):
        if row.get("status") != "running":
            continue
        started = _parse(row.get("started_at"))
        if started and (moment - started).total_seconds() > 6 * 3600:
            await db[JOBS].update_one({"_id": row["_id"]}, {"$set": {
                "status": "failed",
                "finished_at": _iso(moment),
                "error": "Süre doldu",
            }})
            continue
        return True
    for row in await _all(db, LOCKS):
        if row.get("status") == "running":
            return True
    return False


async def _busy(db) -> bool:
    if await _running(db):
        return True
    for row in await _all(db, JOBS):
        if row.get("status") == "queued":
            return True
    return False


async def _require_company(db, company_id: str) -> dict:
    company = await _find_one(db, "companies", {"_id": company_id})
    if not company:
        raise StorageAdminError("Firma bulunamadı.", status=404)
    return company


async def _remember_dry_run(db, company_id: str, report, files: dict) -> None:
    public = report.public()
    rows = [row for row in public.get("collections") or [] if isinstance(row, dict)]
    records = sum(int(row.get("count") or 0) for row in rows)
    nbytes = sum(int(row.get("bytes") or 0) for row in rows)
    dry = {
        "ok": bool(report.ok),
        "at": _iso(),
        "to_mode": report.to_mode,
        "from_mode": report.from_mode,
        "collections": len(rows),
        "collection_rows": rows,
        "records": records,
        "bytes": nbytes,
        "warning": _xml_warning(rows),
        "duration_ms": int(report.duration_ms or 0),
        "files": int(files.get("files") or 0),
        "file_bytes": int(files.get("file_bytes") or 0),
        "errors": list(public.get("errors") or [])[:8],
    }
    current = await _find_one(db, SUMMARIES, {"_id": company_id}) or {"company_id": company_id}
    current["last_dry_run"] = dry
    await _save(db, SUMMARIES, company_id, current)


def _offer(mode: str, advice: str, moving: bool, rollback_id: str) -> dict:
    if moving:
        return {"dry_run": False, "apply": False, "rollback": False, "prepare": False, "to_mode": advice, "rollback_move_id": ""}
    rollback = bool(rollback_id) and mode == storage_router.DEDICATED
    apply = (not rollback) and (mode == storage_router.LEGACY or advice != mode)
    dry = not rollback
    prepare = advice == storage_router.DEDICATED and mode != storage_router.DEDICATED
    target = advice if advice != mode else (
        storage_router.DEDICATED if mode != storage_router.DEDICATED else storage_router.SHARED_V2
    )
    return {
        "dry_run": dry,
        "apply": apply,
        "rollback": rollback,
        "prepare": prepare,
        "to_mode": target,
        "rollback_move_id": rollback_id if rollback else "",
    }


def _latest_rollback(company_id: str, mode: str, moves: list, jobs: list) -> str:
    found = []
    for row in moves:
        if row.get("company_id") != company_id or row.get("status") != "completed":
            continue
        if storage_router.public_mode(row.get("to_mode")) != mode:
            continue
        found.append((str(row.get("finished_at") or row.get("started_at") or ""), str(row.get("_id") or "")))
    for row in jobs:
        if row.get("company_id") != company_id or row.get("kind") != "apply" or row.get("status") != "completed":
            continue
        if storage_router.public_mode(row.get("to_mode")) != mode:
            continue
        found.append((str(row.get("finished_at") or ""), str(row.get("move_id") or "")))
    found = [item for item in found if item[1]]
    if not found:
        return ""
    found.sort()
    return found[-1][1]


def _job_for(company_id: str, jobs: list):
    open_jobs = [row for row in jobs if row.get("company_id") == company_id and row.get("status") in _OPEN]
    if not open_jobs:
        return None
    open_jobs.sort(key=lambda row: str(row.get("created_at") or ""))
    return open_jobs[-1]


def _progress(job: Optional[dict], move: Optional[dict]) -> dict:
    if job and job.get("status") == "scheduled":
        return {"pct": 0, "label": "planlandı"}
    if job and isinstance(job.get("progress"), dict) and job.get("status") in _ACTIVE:
        progress = job["progress"]
        pct = int(progress.get("pct") or 0)
        done = int(progress.get("done") or 0)
        total = int(progress.get("total") or 0)
        label = f"%{pct} · {done}/{total} koleksiyon" if total else f"%{pct}"
        return {"pct": pct, "label": label}
    status = (move or job or {}).get("status") or ""
    if status in ("completed",):
        return {"pct": 100, "label": "%100 · tamamlandı"}
    if status in ("rolled_back", "recovered"):
        return {"pct": 100, "label": "geri alındı" if status == "rolled_back" else "kurtarıldı"}
    if status == "failed":
        return {"pct": 100, "label": "başarısız"}
    if status == "cancelled":
        return {"pct": 0, "label": "iptal"}
    if status == "running":
        return {"pct": 1, "label": "sürüyor"}
    return {"pct": 0, "label": "—"}


def _lock_label(started, finished, duration_ms) -> str:
    try:
        ms = int(duration_ms or 0)
    except (TypeError, ValueError):
        ms = 0
    if ms <= 0:
        begin = _parse(started)
        end = _parse(finished) or _now()
        if begin:
            ms = max(0, int((end - begin).total_seconds() * 1000))
    if ms <= 0:
        return "—"
    minutes = max(1, int(round(ms / 60000)))
    return f"{minutes} dk"


def _checksum_view(checksums, counts) -> dict:
    if not isinstance(checksums, dict) or not checksums:
        return {"label": "bekleniyor", "ok": None}
    bad = set()
    for name, pair in checksums.items():
        if not isinstance(pair, dict) or pair.get("source") != pair.get("target"):
            bad.add(name)
        count = (counts or {}).get(name) if isinstance(counts, dict) else None
        if isinstance(count, dict) and count.get("source") != count.get("target"):
            bad.add(name)
    if bad:
        return {"label": f"{len(bad)} koleksiyon uyuşmadı", "ok": False}
    total = 0
    if isinstance(counts, dict):
        for count in counts.values():
            if isinstance(count, dict):
                try:
                    total += int(count.get("target") or 0)
                except (TypeError, ValueError):
                    continue
    if total:
        shown = fmt_int(total)
        return {"label": f"{shown} / {shown}", "ok": True}
    return {"label": "eşleşti", "ok": True}


def _history(companies: dict, moves: list, jobs: list) -> list:
    move_ids = {str(row.get("_id") or "") for row in moves}
    rows = []
    for move in moves:
        cid = str(move.get("company_id") or "")
        company = companies.get(cid) or {}
        job = None
        if move.get("status") == "running":
            job = _job_for(cid, jobs)
        progress = _progress(job, move)
        checksums = move.get("checksums") if isinstance(move.get("checksums"), dict) else {}
        counts = move.get("counts") if isinstance(move.get("counts"), dict) else {}
        if not checksums and job and isinstance(job.get("result"), dict):
            checksums = job["result"].get("checksums") or {}
            counts = job["result"].get("counts") or counts
        check = _checksum_view(checksums, counts)
        if move.get("status") == "running":
            check = {"label": "bekleniyor", "ok": None}
        rows.append({
            "move_id": str(move.get("_id") or ""),
            "job_id": (job or {}).get("_id") or "",
            "company_id": cid,
            "company_name": company.get("name") or cid,
            "test": bool(company.get("test")),
            "from_mode": storage_router.public_mode(move.get("from_mode")),
            "to_mode": storage_router.public_mode(move.get("to_mode")),
            "status": move.get("status") or "",
            "started_at": move.get("started_at") or "",
            "finished_at": move.get("finished_at") or "",
            "progress_pct": progress["pct"],
            "progress_label": progress["label"],
            "lock_label": _lock_label(move.get("started_at"), move.get("finished_at"), move.get("duration_ms")),
            "checksum_label": check["label"],
            "checksum_ok": check["ok"],
            "scheduled": False,
            "created_at": move.get("started_at") or "",
        })
    for job in jobs:
        if job.get("kind") == "dry_run":
            continue
        if str(job.get("move_id") or "") in move_ids:
            continue
        cid = str(job.get("company_id") or "")
        company = companies.get(cid) or {}
        result = job.get("result") if isinstance(job.get("result"), dict) else {}
        progress = _progress(job, None)
        check = _checksum_view(result.get("checksums"), result.get("counts"))
        if job.get("status") in _ACTIVE or job.get("status") == "scheduled":
            check = {"label": "bekleniyor", "ok": None}
        rows.append({
            "move_id": str(job.get("move_id") or job.get("_id") or ""),
            "job_id": job.get("_id") or "",
            "company_id": cid,
            "company_name": company.get("name") or cid,
            "test": bool(company.get("test")),
            "from_mode": storage_router.public_mode(job.get("from_mode") or result.get("from_mode")),
            "to_mode": storage_router.public_mode(job.get("to_mode") or result.get("to_mode")),
            "status": job.get("status") or "",
            "started_at": job.get("started_at") or job.get("scheduled_for") or "",
            "finished_at": job.get("finished_at") or "",
            "progress_pct": progress["pct"],
            "progress_label": progress["label"],
            "lock_label": _lock_label(job.get("started_at"), job.get("finished_at"), result.get("duration_ms")),
            "checksum_label": check["label"],
            "checksum_ok": check["ok"],
            "scheduled": job.get("status") == "scheduled",
            "created_at": job.get("created_at") or "",
        })
    rows.sort(key=lambda row: str(row.get("started_at") or row.get("created_at") or ""), reverse=True)
    return rows


def _speed_history(jobs: list) -> list:
    found = []
    for job in jobs:
        if job.get("status") != "completed" or job.get("kind") not in ("apply", "rollback"):
            continue
        result = job.get("result") if isinstance(job.get("result"), dict) else {}
        found.append({"bytes": result.get("bytes") or 0, "duration_ms": result.get("duration_ms") or 0})
    return found


async def overview(db) -> dict:
    companies = await _all(db, "companies")
    summaries = {str(row.get("_id") or row.get("company_id") or ""): row for row in await _all(db, SUMMARIES)}
    moves = await _all(db, MOVES)
    jobs = await _all(db, JOBS)
    thresholds = await load_thresholds(db)
    meta = await _find_one(db, SETTINGS, {"_id": META_ID}) or {}
    speeds = _speed_history(jobs)
    catalog = {}
    rows = []
    mode_counts = {storage_router.LEGACY: 0, storage_router.SHARED_V2: 0, storage_router.DEDICATED: 0}
    real = test = records = nbytes = files = file_bytes = 0
    running = None
    for company in companies:
        cid = str(company.get("_id") or "")
        if not cid:
            continue
        summary = summaries.get(cid) or {}
        mode = storage_router.public_mode(company.get(storage_router.MODE_FIELD))
        mode_counts[mode] = mode_counts.get(mode, 0) + 1
        test_account = is_test_company(company)
        if test_account:
            test += 1
        else:
            real += 1
        job = _job_for(cid, jobs)
        moving = bool(job and job.get("status") in _ACTIVE)
        scheduled = bool(job and job.get("status") == "scheduled")
        rollback_id = _latest_rollback(cid, mode, moves, jobs)
        advice = recommend(
            mode,
            int(summary.get("records") or 0),
            int(summary.get("bytes") or 0) / (1024 * 1024),
            int(summary.get("users") or 0),
            summary.get("growth_pct"),
            thresholds,
        )
        actions = _offer(mode, advice["mode"], moving or scheduled, rollback_id)
        dry = summary.get("last_dry_run") if isinstance(summary.get("last_dry_run"), dict) else None
        estimate = None
        if dry and dry.get("ok"):
            estimate = estimate_lock(int(dry.get("bytes") or 0), speeds)
        catalog[cid] = {"name": company.get("name") or cid, "test": test_account}
        row = {
            "id": cid,
            "name": company.get("name") or cid,
            "test": test_account,
            "mode": mode,
            "moving": moving,
            "scheduled": scheduled,
            "mode_to": (job or {}).get("to_mode") if (moving or scheduled) else "",
            "records": int(summary.get("records") or 0),
            "bytes": int(summary.get("bytes") or 0),
            "largest": summary.get("largest") if isinstance(summary.get("largest"), dict) else None,
            "files": int(summary.get("files") or 0),
            "file_bytes": int(summary.get("file_bytes") or 0),
            "users": int(summary.get("users") or 0),
            "last_login_at": summary.get("last_login_at") or "",
            "growth_pct": summary.get("growth_pct"),
            "recommended": advice["mode"],
            "suitable": advice["suitable"],
            "reason": advice["reason"],
            "has_dedicated_dsn": bool(str(company.get(storage_router.DSN_FIELD) or "").strip()),
            "measured_at": summary.get("measured_at") or "",
            "measure_error": summary.get("measure_error") or "",
            "last_dry_run": dry,
            "estimate": estimate,
            "actions": actions,
            "write_locked": bool(company.get(storage_router.WRITE_LOCK_FIELD)) or moving,
        }
        rows.append(row)
        records += row["records"]
        nbytes += row["bytes"]
        files += row["files"]
        file_bytes += row["file_bytes"]
        if moving and running is None:
            progress = _progress(job, None)
            running = {
                "company_id": cid,
                "name": row["name"],
                "pct": progress["pct"],
                "label": f"{row['name']} · %{progress['pct']} · yazma kilitli",
            }
    rows.sort(key=lambda item: (item["test"], str(item["name"]).lower()))
    history = _history(catalog, moves, jobs)
    return {
        "router_enabled": storage_router.enabled(),
        "measured_at": meta.get("measured_at") or "",
        "thresholds": thresholds,
        "maintenance": maintenance_window(),
        "totals": {
            "companies": len(rows),
            "real": real,
            "test": test,
            "modes": mode_counts,
            "records": records,
            "bytes": nbytes,
            "files": files,
            "file_bytes": file_bytes,
            "running": 1 if running else 0,
            "running_label": (running or {}).get("label") or "",
        },
        "companies": rows,
        "moves": history,
    }


async def enqueue(db, *, kind: str, company_id: str, actor: dict, to_mode: str = "", move_id: str = "", when: str = "now") -> dict:
    cid = str(company_id or "").strip()
    move_id = str(move_id or "").strip()
    if kind in ("rollback", "recover") and not cid:
        found = await _find_one(db, MOVES, {"_id": move_id})
        if not found:
            raise StorageAdminError("Taşıma kaydı yok.", status=404)
        cid = str(found.get("company_id") or "")
    cid = _company_id(cid)
    company = await _require_company(db, cid)
    if kind not in ("dry_run", "apply", "rollback", "recover"):
        raise StorageAdminError("İş türü geçersiz.")
    mode = ""
    scheduled_for = ""
    status = "queued"
    if kind in ("dry_run", "apply"):
        mode = _mode(to_mode)
        if kind == "apply":
            if not storage_router.enabled():
                raise StorageAdminError("Depolama yönlendiricisi kapalı. Taşıma yazılmaz.")
            summary = await _find_one(db, SUMMARIES, {"_id": cid}) or {}
            dry = summary.get("last_dry_run") if isinstance(summary.get("last_dry_run"), dict) else {}
            if not dry.get("ok") or dry.get("to_mode") != mode:
                raise StorageAdminError("Önce deneme çalıştırın. Deneme sonucu yok.")
        if kind == "apply" and when == "maintenance":
            scheduled_for = maintenance_window()["start"]
            status = "scheduled"
        elif kind == "apply" and when not in ("", "now"):
            parsed = _parse(when)
            if parsed is None:
                raise StorageAdminError("Plan saati okunamadı.")
            if parsed > _now():
                scheduled_for = parsed.isoformat()
                status = "scheduled"
    if kind in ("rollback", "recover"):
        if not storage_router.enabled():
            raise StorageAdminError("Depolama yönlendiricisi kapalı. Taşıma yazılmaz.")
        if not move_id:
            raise StorageAdminError("move_id gerekli.")
    summary = await _find_one(db, SUMMARIES, {"_id": cid}) or {}
    dry = summary.get("last_dry_run") if isinstance(summary.get("last_dry_run"), dict) else {}
    total = int(dry.get("collections") or 0) if dry.get("to_mode") == mode else 0
    job_id = uuid.uuid4().hex
    doc = {
        "_id": job_id,
        "kind": kind,
        "company_id": cid,
        "from_mode": storage_router.public_mode(company.get(storage_router.MODE_FIELD)),
        "to_mode": mode,
        "move_id": move_id,
        "status": status,
        "scheduled_for": scheduled_for,
        "created_at": _iso(),
        "started_at": "",
        "finished_at": "",
        "actor_id": actor.get("id") or "",
        "actor_name": actor.get("name") or "",
        "progress": {"collection": "", "done": 0, "total": total, "records": 0, "pct": 0},
        "result": {},
        "error": "",
    }
    if status == "queued" and await _busy(db):
        raise StorageAdminError("Aynı anda tek taşıma yapılabilir.", status=409)
    await db[JOBS].insert_one(doc)
    await _audit(db, actor, cid, kind, status)
    if status == "queued":
        kick(db)
    return {"job_id": job_id, "status": status, "company_id": storage_router._safe_company(cid), "scheduled_for": scheduled_for}


async def cancel_job(db, job_id: str, actor: dict) -> dict:
    job = await _find_one(db, JOBS, {"_id": str(job_id or "")})
    if not job:
        raise StorageAdminError("İş bulunamadı.", status=404)
    if job.get("status") != "scheduled":
        raise StorageAdminError("Yalnız planlanan taşıma iptal edilebilir.", status=409)
    await db[JOBS].update_one({"_id": job["_id"]}, {"$set": {"status": "cancelled", "finished_at": _iso()}})
    await _audit(db, actor, str(job.get("company_id") or ""), "cancel", "iptal")
    return {"job_id": job["_id"], "status": "cancelled"}


async def _set_progress(db, job_id: str, progress: dict) -> None:
    await db[JOBS].update_one({"_id": job_id}, {"$set": {"progress": progress}})


async def execute(db, job: dict) -> dict:
    kind = job.get("kind")
    cid = str(job.get("company_id") or "")
    actor = {"id": job.get("actor_id") or "", "name": job.get("actor_name") or ""}
    seen = []

    async def on_batch(name, count):
        if name not in seen:
            seen.append(name)
        total = int((job.get("progress") or {}).get("total") or 0) or len(seen)
        done = len(seen)
        pct = min(99, int(round(100 * done / total))) if total else 0
        try:
            records = int(count or 0)
        except (TypeError, ValueError):
            records = 0
        await _set_progress(db, job["_id"], {
            "collection": str(name or ""),
            "done": done,
            "total": total,
            "records": records,
            "pct": pct,
        })

    try:
        if kind == "dry_run":
            report = await storage_move.plan_move(db, cid, job.get("to_mode") or "")
            files = await _files(db, cid)
            await _remember_dry_run(db, cid, report, files)
        elif kind == "apply":
            report = await storage_move.apply_move(db, cid, job.get("to_mode") or "", on_batch=on_batch)
        elif kind == "rollback":
            report = await storage_move.rollback_move(db, job.get("move_id") or "", on_batch=on_batch)
        elif kind == "recover":
            report = await storage_move.recover_move(db, job.get("move_id") or "")
        else:
            raise StorageAdminError("İş türü geçersiz.")
        public = report.public()
        rows = [row for row in public.get("collections") or [] if isinstance(row, dict)]
        nbytes = sum(int(row.get("bytes") or 0) for row in rows)
        status = "completed" if report.ok else "failed"
        await db[JOBS].update_one({"_id": job["_id"]}, {"$set": {
            "status": status,
            "finished_at": _iso(),
            "move_id": report.move_id or job.get("move_id") or "",
            "from_mode": report.from_mode or job.get("from_mode") or "",
            "to_mode": report.to_mode or job.get("to_mode") or "",
            "result": {
                "ok": report.ok,
                "status": report.status,
                "move_id": report.move_id,
                "from_mode": report.from_mode,
                "to_mode": report.to_mode,
                "checksums": public.get("checksums") or {},
                "counts": public.get("counts") or {},
                "duration_ms": int(report.duration_ms or 0),
                "bytes": nbytes,
                "errors": list(public.get("errors") or [])[:8],
            },
            "error": "",
            "progress": {
                "collection": seen[-1] if seen else "",
                "done": len(rows) or len(seen),
                "total": len(rows) or len(seen) or int((job.get("progress") or {}).get("total") or 0),
                "records": 0,
                "pct": 100 if report.ok else int((job.get("progress") or {}).get("pct") or 0),
            },
        }})
        await _audit(db, actor, cid, kind, report.status or status)
        return public
    except Exception as exc:
        message = storage_router.public_store_error(exc) or "Taşıma tamamlanamadı."
        await db[JOBS].update_one({"_id": job["_id"]}, {"$set": {
            "status": "failed",
            "finished_at": _iso(),
            "error": message,
        }})
        await _audit(db, actor, cid, kind, "hata")
        return {"ok": False, "errors": [message]}


async def claim_next(db, now: Optional[datetime] = None):
    moment = now or _now()
    if await _running(db, moment):
        return None
    due = []
    for job in await _all(db, JOBS):
        status = job.get("status")
        if status == "queued":
            due.append(job)
            continue
        if status == "scheduled":
            when = _parse(job.get("scheduled_for"))
            if when is not None and when <= moment:
                due.append(job)
    if not due:
        return None
    due.sort(key=lambda row: (0 if row.get("status") == "queued" else 1, str(row.get("created_at") or "")))
    job = due[0]
    current = await _find_one(db, JOBS, {"_id": job["_id"]})
    if not current or current.get("status") not in ("queued", "scheduled"):
        return None
    if current.get("status") == "scheduled":
        when = _parse(current.get("scheduled_for"))
        if when is None or when > moment:
            return None
    if await _running(db, moment):
        return None
    await db[JOBS].update_one({"_id": job["_id"]}, {"$set": {"status": "running", "started_at": _iso(moment)}})
    current["status"] = "running"
    current["started_at"] = _iso(moment)
    return current


_worker_guard = False


async def worker(db, *, now: Optional[datetime] = None) -> int:
    global _worker_guard
    if _worker_guard:
        return 0
    _worker_guard = True
    done = 0
    try:
        while True:
            job = await claim_next(db, now=now)
            if not job:
                return done
            await execute(db, job)
            done += 1
    finally:
        _worker_guard = False


def kick(db) -> None:
    if not auto_kick():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(worker(db))


async def maybe_measure(db, *, now: Optional[datetime] = None) -> bool:
    meta = await _find_one(db, SETTINGS, {"_id": META_ID}) or {}
    stamp = _parse(meta.get("measured_at"))
    moment = now or _now()
    if stamp is not None and (moment - stamp).total_seconds() < measure_seconds():
        return False
    await measure_all(db, today=moment.date().isoformat())
    return True


async def tick(db, *, now: Optional[datetime] = None) -> dict:
    measured = await maybe_measure(db, now=now)
    ran = await worker(db, now=now)
    return {"measured": measured, "ran": ran}


async def scheduler_loop(db=None) -> None:
    target = db or _database()
    while True:
        try:
            with unscoped("veritabanı yönetimi ölçüm ve taşıma kuyruğu"):
                await tick(target)
        except Exception as exc:
            _logger().info("tur: %s", storage_router.public_store_error(exc) or type(exc).__name__)
        await asyncio.sleep(tick_seconds())


def admin_dsn_from_env() -> str:
    """Yalnız açıkça verilen yönetici DSN. Kök parolasına düşülmez."""
    return (os.environ.get(DBA_ENV) or "").strip()


def dedicated_names(company_id: str) -> tuple:
    safe = re.sub(r"[^a-z0-9]", "", str(company_id or "").lower())[:20] or "firma"
    if not safe[0].isalpha():
        safe = "f" + safe[:19]
    database = f"tk_{safe}"
    user = f"tku_{safe}"[:32]
    if not _IDENT.fullmatch(database) or not _IDENT.fullmatch(user):
        raise StorageAdminError("Dedicated ad üretilemedi.")
    return database, user


def dedicated_statements(database: str, user: str, password: str, host: str = "%") -> list:
    if not _IDENT.fullmatch(database) or not _IDENT.fullmatch(user):
        raise StorageAdminError("Dedicated ad geçersiz.")
    if host != "%" and not re.fullmatch(r"[A-Za-z0-9_.:%-]{1,64}", host):
        raise StorageAdminError("Dedicated kullanıcı konumu geçersiz.")
    grant = (
        "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, ALTER, INDEX, REFERENCES"
    )
    return [
        (f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", None),
        (f"CREATE USER IF NOT EXISTS `{user}`@`{host}` IDENTIFIED BY %s", (password,)),
        (f"GRANT {grant} ON `{database}`.* TO `{user}`@`{host}`", None),
    ]


def _parse_mysql_dsn(dsn: str) -> dict:
    from storage_migrations.masking import add_secret

    add_secret(dsn)
    text = str(dsn or "").strip()
    if text.startswith("mysql+") or text.startswith("mariadb+"):
        text = "mysql://" + text.split("://", 1)[1]
    elif text.startswith("mariadb://"):
        text = "mysql://" + text.split("://", 1)[1]
    parsed = urlparse(text)
    if parsed.scheme != "mysql" or not parsed.hostname or not parsed.username:
        raise StorageAdminError("Yönetici bağlantısı okunamadı.")
    return {
        "host": parsed.hostname,
        "port": int(parsed.port or 3306),
        "user": unquote(parsed.username),
        "password": unquote(parsed.password or ""),
        "database": (parsed.path or "").lstrip("/").split("?")[0],
    }


def build_app_dsn(admin_dsn: str, database: str, user: str, password: str) -> str:
    cfg = _parse_mysql_dsn(admin_dsn)
    return (
        f"mysql://{quote(user, safe='')}:"
        f"{quote(password, safe='')}@{cfg['host']}:{cfg['port']}/{database}"
    )


class _AdminConn:
    def __init__(self, raw):
        self.raw = raw

    def execute(self, sql: str, params=None) -> None:
        cur = self.raw.cursor()
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)

    def close(self) -> None:
        self.raw.close()


def connect_admin(dsn: str):
    """Yönetici bağlantısı. Çağıran DSN'i loglamaz. Yetki yükseltmez."""
    import db_ssl
    import pymysql

    cfg = _parse_mysql_dsn(dsn)
    mode, ca = db_ssl.resolve(cfg["host"])
    raw = pymysql.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"] or None,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
        **db_ssl.connect_kwargs({"ssl_mode": mode, "ssl_ca": ca}),
    )
    return _AdminConn(raw)


def apply_migrations(app_dsn: str) -> None:
    """Migration yalnız verilen hedefe uygulanır."""
    from storage_migrations.engine import apply as apply_schema
    from storage_migrations.session import connect

    session = connect(app_dsn, write=True)
    try:
        apply_schema(session, confirm=True, dry_run=False)
    finally:
        session.close()


def provision_dedicated_database(admin_dsn: str, company_id: str) -> str:
    """Yeni veritabanı, yalnız ona yetkili kullanıcı, migration ve mühür.

    Düz metin DSN dönmez. Hata iletisi de DSN taşımaz.
    """
    from storage_migrations.masking import add_secret

    database, user = dedicated_names(company_id)
    password = secrets.token_urlsafe(24)
    add_secret(password)
    try:
        app_dsn = build_app_dsn(admin_dsn, database, user, password)
        add_secret(app_dsn)
        add_secret(admin_dsn)
        statements = dedicated_statements(database, user, password)
        conn = connect_admin(admin_dsn)
        try:
            for sql, params in statements:
                conn.execute(sql, params)
        finally:
            conn.close()
        apply_migrations(app_dsn)
        return storage_router.seal_dedicated_dsn(app_dsn)
    except StorageAdminError:
        raise
    except Exception:
        raise StorageAdminError("Dedicated hedef hazırlanamadı.") from None


async def prepare_dedicated(db, company_id: str, *, confirm: bool, actor: dict) -> dict:
    if not confirm:
        raise StorageAdminError("Dedicated hazırlık ayrı onay ister.")
    cid = _company_id(company_id)
    company = await _require_company(db, cid)
    if str(company.get(storage_router.DSN_FIELD) or "").strip():
        await _audit(db, actor, cid, "prepare_dedicated", "hazır")
        return {"ok": True, "company_id": storage_router._safe_company(cid), "has_dedicated_dsn": True, "created": False}
    admin = admin_dsn_from_env()
    if not admin:
        raise StorageAdminError("Veritabanı yönetici yetkisi ortamda yok. Dedicated hedef hazırlanamadı.")
    try:
        sealed = await asyncio.to_thread(provision_dedicated_database, admin, cid)
    except StorageAdminError:
        await _audit(db, actor, cid, "prepare_dedicated", "hata")
        raise
    except Exception as exc:
        _logger().info("dedicated hazırlık: %s", storage_router.public_store_error(exc) or type(exc).__name__)
        await _audit(db, actor, cid, "prepare_dedicated", "hata")
        raise StorageAdminError("Dedicated hedef hazırlanamadı.") from None
    await db.companies.update_one({"_id": cid}, {"$set": {storage_router.DSN_FIELD: sealed}})
    await _audit(db, actor, cid, "prepare_dedicated", "oluştu")
    return {"ok": True, "company_id": storage_router._safe_company(cid), "has_dedicated_dsn": True, "created": True}


def _fail(exc: StorageAdminError) -> None:
    raise HTTPException(status_code=exc.status, detail=exc.message) from None


async def _run(fn, *args, **kwargs):
    try:
        with unscoped("veritabanı yönetimi"):
            return public_copy(await fn(*args, **kwargs))
    except StorageAdminError as exc:
        _fail(exc)


@router.get("/system/storage-admin")
async def storage_admin_overview(admin: dict = Depends(saas.require_super_admin)):
    return await _run(overview, _database())


@router.put("/system/storage-admin/thresholds")
async def storage_admin_thresholds(req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    return await _run(save_thresholds, _database(), req or {}, _actor(admin))


@router.post("/system/storage-admin/thresholds/reset")
async def storage_admin_thresholds_reset(admin: dict = Depends(saas.require_super_admin)):
    return await _run(reset_thresholds, _database(), _actor(admin))


@router.post("/system/storage-admin/companies/{company_id}/dry-run")
async def storage_admin_dry_run(company_id: str, req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    return await _run(
        enqueue, _database(), kind="dry_run", company_id=company_id, actor=_actor(admin),
        to_mode=(req or {}).get("to_mode") or "",
    )


@router.post("/system/storage-admin/companies/{company_id}/apply")
async def storage_admin_apply(company_id: str, req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    body = req or {}
    return await _run(
        enqueue, _database(), kind="apply", company_id=company_id, actor=_actor(admin),
        to_mode=body.get("to_mode") or "", when=str(body.get("when") or "now"),
    )


@router.post("/system/storage-admin/companies/{company_id}/rollback")
async def storage_admin_rollback(company_id: str, req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    return await _run(
        enqueue, _database(), kind="rollback", company_id=company_id, actor=_actor(admin),
        move_id=(req or {}).get("move_id") or "",
    )


@router.post("/system/storage-admin/moves/{move_id}/recover")
async def storage_admin_recover(move_id: str, admin: dict = Depends(saas.require_super_admin)):
    return await _run(
        enqueue, _database(), kind="recover", company_id="",
        actor=_actor(admin), move_id=move_id,
    )


@router.post("/system/storage-admin/jobs/{job_id}/cancel")
async def storage_admin_cancel(job_id: str, admin: dict = Depends(saas.require_super_admin)):
    return await _run(cancel_job, _database(), job_id, _actor(admin))


@router.post("/system/storage-admin/companies/{company_id}/prepare-dedicated")
async def storage_admin_prepare(company_id: str, req: Dict[str, Any], admin: dict = Depends(saas.require_super_admin)):
    return await _run(
        prepare_dedicated, _database(), company_id,
        confirm=bool((req or {}).get("confirm")), actor=_actor(admin),
    )
