"""Şirketi depolama kipleri arasında taşır.

Komut:
  python -m scripts.storage_move --company <id> --to <shared_v2|dedicated|legacy>
      [--dry-run] [--apply] [--rollback <move_id>]

Varsayılan dry-run: hiçbir şey yazılmaz. --apply kopyalar, sağlama
tutar, sonra router kataloğundaki kipi değiştirir. Kaynak veri silinmez.
Hata olursa kip değişmez, hedefe yazılanlar temizlenir, kilit açılır.
Sır, DSN, VKN ve ETTN loglanmaz. .env okunmaz.
"""
from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import inspect
import json
import logging
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402

BATCH = 50
_CATALOG = frozenset({
    "companies",
    "storage_moves",
    "users",
    "password_resets",
    "b2b_password_resets",
    "push_receipts_pending",
})
_ID_MAX = 191
_COMPANY_MAX = 64


class MoveError(RuntimeError):
    """Taşıma durdu. İleti sır taşımaz."""


@dataclass
class MoveReport:
    ok: bool = False
    wrote: bool = False
    dry_run: bool = True
    move_id: str = ""
    company_id: str = ""
    from_mode: str = ""
    to_mode: str = ""
    status: str = ""
    collections: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)
    checksums: dict = field(default_factory=dict)
    steps: list = field(default_factory=list)
    duration_ms: int = 0

    def public(self) -> dict:
        """Sır, DSN ve mühür içermeyen görünüm."""
        return {
            "ok": self.ok,
            "wrote": self.wrote,
            "dry_run": self.dry_run,
            "move_id": self.move_id,
            "company_id": storage_router._safe_company(self.company_id),
            "from_mode": self.from_mode,
            "to_mode": self.to_mode,
            "status": self.status,
            "collections": list(self.collections),
            "conflicts": list(self.conflicts),
            "errors": list(self.errors),
            "counts": self.counts,
            "checksums": self.checksums,
            "steps": list(self.steps),
            "duration_ms": self.duration_ms,
        }


def _logger() -> logging.Logger:
    log = logging.getLogger("storage_move")
    try:
        from storage_migrations.masking import RedactFilter
    except Exception:
        return log
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log


def _safe(exc: BaseException) -> str:
    return storage_router.public_store_error(exc)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _freeze(doc: dict) -> str:
    body = dict(doc)
    body.pop("_row_updated_at", None)
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _digest(docs) -> str:
    parts = sorted(_freeze(doc) for doc in docs)
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _bytes(docs) -> int:
    return sum(len(_freeze(doc).encode("utf-8")) for doc in docs)


def _chunks(items, size: int):
    step = max(1, int(size or 1))
    rows = list(items)
    for index in range(0, len(rows), step):
        yield rows[index:index + step]


def _skip(name: str) -> bool:
    if name in _CATALOG:
        return True
    from tenant_scope import collection_kind

    return collection_kind(name) in ("platform", "membership", "company", "token")


def _target_table(mode: str, name: str) -> str:
    if mode == storage_router.LEGACY:
        return name
    if mode == storage_router.SHARED_V2:
        import storage_tables

        spec = storage_tables.SPECS.get(name)
        if spec is not None:
            return spec.table
        return "docs_v2"
    return "storage_records"


def _dedicated_dsn(company: dict) -> str:
    sealed = (company or {}).get(storage_router.DSN_FIELD)
    if not isinstance(sealed, str) or not sealed.strip():
        raise MoveError("Dedicated DSN referansı yok.")
    from storage_migrations.masking import add_secret
    from storage_migrations.targets import unseal_dedicated_ref

    dsn = unseal_dedicated_ref(sealed)
    add_secret(dsn)
    return dsn


def _open(db, mode: str, company_id: str, name: str, company: dict):
    if mode == storage_router.LEGACY:
        return db[name]
    if mode == storage_router.SHARED_V2:
        return storage_router.collection_for_mode(db, mode, company_id, name)
    return storage_dedicated.DedicatedCollection(company_id, name, _dedicated_dsn(company))


async def _collect(cursor):
    if hasattr(cursor, "to_list"):
        rows = cursor.to_list(None)
        if inspect.isawaitable(rows):
            rows = await rows
        return [dict(row) for row in list(rows or []) if isinstance(row, dict)]
    rows = []
    if hasattr(cursor, "__aiter__"):
        async for doc in cursor:
            if isinstance(doc, dict):
                rows.append(dict(doc))
        return rows
    return [dict(row) for row in list(cursor or []) if isinstance(row, dict)]


async def _read(db, mode: str, company_id: str, name: str, company: dict):
    coll = _open(db, mode, company_id, name, company)
    return await _collect(coll.find({"company_id": company_id}))


async def _legacy_names(db, company_id: str) -> list[str]:
    fn = getattr(db, "list_collection_names", None)
    listed = []
    if fn is not None:
        listed = fn()
        if inspect.isawaitable(listed):
            listed = await listed
    found = []
    for name in list(listed or []):
        text = str(name or "")
        if not text or _skip(text):
            continue
        docs = await _read(db, storage_router.LEGACY, company_id, text, {})
        if docs:
            found.append(text)
    return sorted(found)


async def _names(db, mode: str, company_id: str, company: dict) -> list[str]:
    if mode == storage_router.LEGACY:
        return await _legacy_names(db, company_id)
    if mode == storage_router.SHARED_V2:
        try:
            return list(storage_shared_v2.list_company_collections(company_id))
        except Exception as exc:
            raise MoveError(_safe(exc)) from None
    try:
        return list(storage_dedicated.list_collections(company_id, _dedicated_dsn(company)))
    except MoveError:
        raise
    except Exception as exc:
        raise MoveError(_safe(exc)) from None


async def _company(db, company_id: str):
    found = db.companies.find_one({"_id": company_id})
    if inspect.isawaitable(found):
        found = await found
    return found if isinstance(found, dict) else None


def _prepare(doc: dict, company_id: str) -> dict:
    body = copy.deepcopy(doc)
    body["_id"] = str(body.get("_id") or "")
    body["company_id"] = company_id
    return body


def _check_docs(name: str, docs, company_id: str):
    errors = []
    conflicts = []
    seen = set()
    if len(company_id) > _COMPANY_MAX:
        errors.append("company_id çok uzun")
    for doc in docs:
        if not isinstance(doc, dict) or not str(doc.get("_id") or "").strip():
            errors.append(f"{name}: _id yok")
            continue
        ident = str(doc.get("_id"))
        if ident in seen:
            conflicts.append(f"{name}: tekrar eden _id")
        seen.add(ident)
        if len(ident) > _ID_MAX:
            errors.append(f"{name}: _id çok uzun")
        current = doc.get("company_id")
        if current is not None and str(current) != company_id:
            errors.append(f"{name}: company_id uyuşmuyor")
    return errors, conflicts


async def _hook(on_batch, name: str, count: int) -> None:
    if on_batch is None:
        return
    result = on_batch(name, count)
    if inspect.isawaitable(result):
        await result


async def _insert_docs(coll, company_id: str, docs) -> list[str]:
    ids = []
    with storage_router.bypass_write_lock(company_id):
        for doc in docs:
            await coll.insert_one(doc)
            ids.append(str(doc["_id"]))
    return ids


async def _delete_ids(coll, company_id: str, ids) -> None:
    with storage_router.bypass_write_lock(company_id):
        for doc_id in ids:
            await coll.delete_one({"_id": doc_id, "company_id": company_id})


def _empty(company_id: str, to_mode: str, message: str, *, dry_run: bool) -> MoveReport:
    report = MoveReport(
        ok=False,
        wrote=False,
        dry_run=dry_run,
        company_id=company_id,
        to_mode=to_mode,
        status="reddedildi",
    )
    report.errors.append(message)
    return report


async def _inspect(db, company, company_id: str, to_mode: str) -> MoveReport:
    report = MoveReport(dry_run=True, wrote=False, company_id=company_id, to_mode=to_mode)
    if not company_id:
        report.errors.append("company_id boş")
        report.status = "reddedildi"
        return report
    if to_mode not in storage_router.KNOWN_MODES:
        report.errors.append("Hedef kip bilinmiyor.")
        report.status = "reddedildi"
        return report
    if not company:
        report.errors.append("Şirket bulunamadı.")
        report.status = "reddedildi"
        return report
    source = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
    report.from_mode = source
    if source not in storage_router.KNOWN_MODES:
        report.errors.append("Kaynak kip bilinmiyor.")
        report.status = "reddedildi"
        return report
    if source == to_mode:
        report.errors.append("Şirket zaten bu kipte.")
        report.status = "reddedildi"
        return report
    if storage_router.DEDICATED in (source, to_mode):
        sealed = company.get(storage_router.DSN_FIELD)
        if not isinstance(sealed, str) or not sealed.strip():
            report.errors.append("Dedicated DSN referansı yok.")
    if report.errors:
        report.status = "reddedildi"
        return report
    try:
        names = await _names(db, source, company_id, company)
    except MoveError as exc:
        report.errors.append(str(exc))
        report.status = "reddedildi"
        return report
    for name in names:
        try:
            docs = await _read(db, source, company_id, name, company)
            target_docs = await _read(db, to_mode, company_id, name, company)
        except MoveError as exc:
            report.errors.append(str(exc))
            continue
        except Exception as exc:
            report.errors.append(_safe(exc))
            continue
        doc_errors, doc_conflicts = _check_docs(name, docs, company_id)
        report.errors.extend(doc_errors)
        report.conflicts.extend(doc_conflicts)
        if target_docs:
            report.conflicts.append(f"{name}: hedefte kayıt var")
        prepared = [_prepare(doc, company_id) for doc in docs if doc.get("_id")]
        report.collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": _bytes(prepared),
            "target": _target_table(to_mode, name),
            "target_count": len(target_docs),
        })
        report.counts[name] = {"source": len(prepared), "target": len(target_docs)}
        report.checksums[name] = {"source": _digest(prepared), "target": ""}
    if report.errors or report.conflicts:
        report.ok = False
        report.status = "reddedildi"
        return report
    report.ok = True
    report.status = "dry-run"
    return report


async def plan_move(db, company_id: str, to_mode: str) -> MoveReport:
    """Dry-run. Yazmaz, kilitlemez."""
    cid = str(company_id or "").strip()
    mode = storage_router.normalize_mode(to_mode)
    company = await _company(db, cid) if cid else None
    if cid and company is None and mode in storage_router.KNOWN_MODES:
        report = _empty(cid, mode, "Şirket bulunamadı.", dry_run=True)
        return report
    try:
        report = await _inspect(db, company, cid, mode if mode in storage_router.KNOWN_MODES else str(to_mode or ""))
    except Exception as exc:
        report = _empty(cid, str(to_mode or ""), _safe(exc), dry_run=True)
    report.dry_run = True
    report.wrote = False
    _logger().info(
        "taşıma company=%s durum=%s",
        storage_router._safe_company(cid),
        "dry-run" if report.ok else "reddedildi",
    )
    return report


async def _flag(db, company_id: str, locked: bool) -> None:
    await db.companies.update_one(
        {"_id": company_id},
        {"$set": {storage_router.WRITE_LOCK_FIELD: bool(locked)}},
    )


async def _save_move(db, company_id: str, doc: dict) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        with storage_router.bypass_write_lock(company_id):
            await db.storage_moves.insert_one(doc)


async def _patch_move(db, company_id: str, move_id: str, fields: dict) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        with storage_router.bypass_write_lock(company_id):
            await db.storage_moves.update_one({"_id": move_id}, {"$set": fields})


async def _load_move(db, move_id: str):
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        found = db.storage_moves.find_one({"_id": move_id})
        if inspect.isawaitable(found):
            found = await found
    return found if isinstance(found, dict) else None


async def _set_mode(db, company_id: str, mode: str) -> None:
    await db.companies.update_one(
        {"_id": company_id},
        {"$set": {storage_router.MODE_FIELD: mode}},
    )
    storage_router.forget_mode(company_id)


async def _wipe(db, company, company_id: str, mode: str, copied: dict) -> None:
    for name, ids in copied.items():
        if not ids:
            continue
        coll = _open(db, mode, company_id, name, company)
        await _delete_ids(coll, company_id, ids)


async def _copy(db, company, company_id: str, source: str, target: str, copied: dict, *, batch_size: int, on_batch):
    names = await _names(db, source, company_id, company)
    counts = {}
    checksums = {}
    steps = [{"name": "kilitle", "status": "tamam"}]
    collections = []
    for name in names:
        docs = await _read(db, source, company_id, name, company)
        prepared = [_prepare(doc, company_id) for doc in docs if doc.get("_id")]
        doc_errors, doc_conflicts = _check_docs(name, prepared, company_id)
        if doc_errors or doc_conflicts:
            raise MoveError("Kaynak doğrulanamadı.")
        existing = await _read(db, target, company_id, name, company)
        if existing:
            raise MoveError(f"{name}: hedefte kayıt var")
        coll = _open(db, target, company_id, name, company)
        copied[name] = []
        written = 0
        for batch in _chunks(prepared, batch_size):
            ids = await _insert_docs(coll, company_id, batch)
            copied[name].extend(ids)
            written += len(ids)
            await _hook(on_batch, name, written)
        loaded = await _read(db, target, company_id, name, company)
        source_sum = _digest(prepared)
        target_sum = _digest(loaded)
        if len(loaded) != len(prepared) or source_sum != target_sum:
            raise MoveError("sağlama uyuşmadı")
        counts[name] = {"source": len(prepared), "target": len(loaded)}
        checksums[name] = {"source": source_sum, "target": target_sum}
        collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": _bytes(prepared),
            "target": _target_table(target, name),
            "target_count": len(loaded),
        })
        steps.append({"name": f"kopyala:{name}", "status": "tamam", "count": len(prepared)})
        steps.append({"name": f"sağlama:{name}", "status": "tamam"})
    return counts, checksums, steps, collections


async def apply_move(db, company_id: str, to_mode: str, *, batch_size: int = BATCH, on_batch=None) -> MoveReport:
    """Kopyalar ve kipi değiştirir. --apply olmadan çağrılmaz. Kaynak silinmez."""
    cid = str(company_id or "").strip()
    mode = storage_router.normalize_mode(to_mode)
    if not storage_router.enabled():
        return _empty(cid, mode, "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    acquired = False
    locked = False
    flagged = False
    started = time.monotonic()
    move_id = ""
    copied: dict = {}
    company = None
    try:
        storage_router.try_begin_move(cid)
        acquired = True
        company = await _company(db, cid)
        storage_router.lock_company_writes(cid)
        locked = True
        report = await _inspect(db, company, cid, mode)
        report.dry_run = False
        if not report.ok:
            return report
        running = await _running_move(db, cid)
        if running:
            raise storage_router.StorageMoveBusy("Başka bir depolama taşıması sürüyor. İkincisi başlatılamaz.")
        source = report.from_mode
        await _flag(db, cid, True)
        flagged = True
        move_id = uuid.uuid4().hex
        await _save_move(db, cid, {
            "_id": move_id,
            "company_id": cid,
            "from_mode": source,
            "to_mode": mode,
            "status": "running",
            "steps": [{"name": "kilitle", "status": "tamam"}],
            "counts": {},
            "checksums": {},
            "started_at": _now(),
            "finished_at": "",
            "duration_ms": 0,
            "error": "",
        })
        try:
            counts, checksums, steps, collections = await _copy(
                db, company, cid, source, mode, copied, batch_size=batch_size, on_batch=on_batch,
            )
        except Exception as exc:
            await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            failed = MoveReport(
                ok=False,
                wrote=False,
                dry_run=False,
                move_id=move_id,
                company_id=cid,
                from_mode=source,
                to_mode=mode,
                status="failed",
                errors=[_safe(exc)],
                duration_ms=_elapsed(started),
            )
            _logger().info(
                "taşıma company=%s durum=failed error=%s",
                storage_router._safe_company(cid),
                _safe(exc),
            )
            return failed
        try:
            await _set_mode(db, cid, mode)
        except Exception as exc:
            await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            return MoveReport(
                ok=False,
                wrote=False,
                dry_run=False,
                move_id=move_id,
                company_id=cid,
                from_mode=source,
                to_mode=mode,
                status="failed",
                errors=[_safe(exc)],
                duration_ms=_elapsed(started),
            )
        steps.append({"name": "kip", "status": "tamam"})
        duration = _elapsed(started)
        await _patch_move(db, cid, move_id, {
            "status": "completed",
            "steps": steps,
            "counts": counts,
            "checksums": checksums,
            "finished_at": _now(),
            "duration_ms": duration,
            "error": "",
        })
        done = MoveReport(
            ok=True,
            wrote=True,
            dry_run=False,
            move_id=move_id,
            company_id=cid,
            from_mode=source,
            to_mode=mode,
            status="completed",
            collections=collections,
            counts=counts,
            checksums=checksums,
            steps=steps,
            duration_ms=duration,
        )
        _logger().info(
            "taşıma company=%s durum=completed",
            storage_router._safe_company(cid),
        )
        return done
    finally:
        if locked:
            storage_router.unlock_company_writes(cid)
        if flagged:
            try:
                await _flag(db, cid, False)
            except Exception:
                _logger().info(
                    "taşıma company=%s durum=kilit",
                    storage_router._safe_company(cid),
                )
        if acquired:
            storage_router.end_move(cid)


async def _running_move(db, company_id: str):
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        cursor = db.storage_moves.find({"status": "running"})
        rows = await _collect(cursor)
    for row in rows:
        if str(row.get("company_id") or "") == company_id or row.get("status") == "running":
            return row
    return None


def _elapsed(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


async def _fail_copy(db, company, company_id: str, mode: str, move_id: str, copied: dict, exc, started: float) -> None:
    try:
        await _wipe(db, company, company_id, mode, copied)
    except Exception as wipe_exc:
        _logger().info(
            "taşıma company=%s durum=temizlik error=%s",
            storage_router._safe_company(company_id),
            _safe(wipe_exc),
        )
    if not move_id:
        return
    try:
        await _patch_move(db, company_id, move_id, {
            "status": "failed",
            "finished_at": _now(),
            "duration_ms": _elapsed(started),
            "error": _safe(exc),
        })
    except Exception:
        _logger().info(
            "taşıma company=%s durum=kayit",
            storage_router._safe_company(company_id),
        )


async def _source_intact(db, company, company_id: str, mode: str, counts: dict) -> bool:
    try:
        live = await _names(db, mode, company_id, company)
    except Exception:
        return False
    recorded = sorted(counts or [])
    if sorted(live) != recorded:
        return False
    for name in recorded:
        docs = await _read(db, mode, company_id, name, company)
        expected = int((counts.get(name) or {}).get("source") or 0)
        if len(docs) != expected:
            return False
    return True


async def _restore(db, company, company_id: str, mode: str, journal: list) -> None:
    for name, doc_id, previous, action in reversed(journal):
        coll = _open(db, mode, company_id, name, company)
        with storage_router.bypass_write_lock(company_id):
            if action in ("insert", "replace"):
                await coll.delete_one({"_id": doc_id, "company_id": company_id})
            if action in ("delete", "replace") and previous is not None:
                await coll.insert_one(_prepare(previous, company_id))


async def _reverse(db, company, company_id: str, source_mode: str, current_mode: str, *, batch_size: int, on_batch):
    """Güncel kipi eski kipe eşitler. Güncel taraftaki veri silinmez."""
    current_names = await _names(db, current_mode, company_id, company)
    source_names = await _names(db, source_mode, company_id, company)
    names = sorted(set(current_names) | set(source_names))
    journal = []
    checksums = {}
    counts = {}
    steps = [{"name": "kilitle", "status": "tamam"}]
    collections = []
    for name in names:
        current_docs = await _read(db, current_mode, company_id, name, company)
        previous_docs = await _read(db, source_mode, company_id, name, company)
        current_prepared = [_prepare(doc, company_id) for doc in current_docs if doc.get("_id")]
        previous_by_id = {str(doc.get("_id")): doc for doc in previous_docs if doc.get("_id")}
        current_by_id = {str(doc.get("_id")): doc for doc in current_prepared}
        coll = _open(db, source_mode, company_id, name, company)
        pending = []
        for doc_id, doc in current_by_id.items():
            old = previous_by_id.get(doc_id)
            if old is not None and _freeze(_prepare(old, company_id)) == _freeze(doc):
                continue
            action = "replace" if old is not None else "insert"
            pending.append((doc_id, doc, copy.deepcopy(old) if old is not None else None, action))
        for doc_id, old in previous_by_id.items():
            if doc_id not in current_by_id:
                pending.append((doc_id, None, copy.deepcopy(old), "delete"))
        written = 0
        for batch in _chunks(pending, batch_size):
            for doc_id, doc, old, action in batch:
                journal.append((name, doc_id, old, action))
                with storage_router.bypass_write_lock(company_id):
                    if action in ("replace", "delete"):
                        await coll.delete_one({"_id": doc_id, "company_id": company_id})
                    if doc is not None:
                        await coll.insert_one(doc)
                written += 1
            if pending:
                await _hook(on_batch, name, written)
        loaded = await _read(db, source_mode, company_id, name, company)
        fresh = await _read(db, current_mode, company_id, name, company)
        left = _digest([_prepare(doc, company_id) for doc in loaded])
        right = _digest([_prepare(doc, company_id) for doc in fresh])
        if len(loaded) != len(fresh) or left != right:
            raise MoveError("sağlama uyuşmadı")
        counts[name] = {"source": len(loaded), "target": len(fresh)}
        checksums[name] = {"source": left, "target": right}
        collections.append({
            "name": name,
            "count": len(fresh),
            "bytes": _bytes([_prepare(doc, company_id) for doc in fresh]),
            "target": _target_table(source_mode, name),
            "target_count": len(loaded),
        })
        steps.append({"name": f"geri:{name}", "status": "tamam", "count": len(fresh)})
        steps.append({"name": f"sağlama:{name}", "status": "tamam"})
    return journal, counts, checksums, steps, collections


async def rollback_move(db, move_id: str, *, batch_size: int = BATCH, on_batch=None) -> MoveReport:
    """Tamamlanmış taşımayı, kaynak duruyorsa eski kipe döndürür."""
    mid = str(move_id or "").strip()
    if not storage_router.enabled():
        return _empty("", "", "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    record = await _load_move(db, mid) if mid else None
    if not record:
        return _empty("", "", "Taşıma kaydı yok.", dry_run=False)
    cid = str(record.get("company_id") or "")
    source = storage_router.normalize_mode(record.get("from_mode"))
    current = storage_router.normalize_mode(record.get("to_mode"))
    if record.get("status") != "completed":
        report = _empty(cid, source, "Yalnız tamamlanmış taşıma geri alınır.", dry_run=False)
        report.move_id = mid
        report.from_mode = source
        return report
    acquired = False
    locked = False
    started = time.monotonic()
    journal: list = []
    company = None
    try:
        storage_router.try_begin_move(cid)
        acquired = True
        company = await _company(db, cid)
        if not company:
            return _empty(cid, source, "Şirket bulunamadı.", dry_run=False)
        live_mode = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
        if live_mode != current:
            report = _empty(cid, source, "Kip kayıtla uyuşmuyor.", dry_run=False)
            report.move_id = mid
            report.from_mode = current
            return report
        counts = record.get("counts") if isinstance(record.get("counts"), dict) else {}
        if not await _source_intact(db, company, cid, source, counts):
            report = _empty(cid, source, "Kaynak veri durmuyor.", dry_run=False)
            report.move_id = mid
            report.from_mode = current
            return report
        await _flag(db, cid, True)
        storage_router.lock_company_writes(cid)
        locked = True
        try:
            journal, new_counts, checksums, steps, collections = await _reverse(
                db, company, cid, source, current, batch_size=batch_size, on_batch=on_batch,
            )
        except Exception as exc:
            try:
                await _restore(db, company, cid, source, journal)
            except Exception as restore_exc:
                _logger().info(
                    "taşıma company=%s durum=geri-temizlik error=%s",
                    storage_router._safe_company(cid),
                    _safe(restore_exc),
                )
            _logger().info(
                "taşıma company=%s durum=geri-failed error=%s",
                storage_router._safe_company(cid),
                _safe(exc),
            )
            failed = MoveReport(
                ok=False,
                wrote=False,
                dry_run=False,
                move_id=mid,
                company_id=cid,
                from_mode=current,
                to_mode=source,
                status="completed",
                errors=[_safe(exc)],
                duration_ms=_elapsed(started),
            )
            return failed
        await _set_mode(db, cid, source)
        steps.append({"name": "kip", "status": "tamam"})
        duration = _elapsed(started)
        previous_steps = list(record.get("steps") or [])
        await _patch_move(db, cid, mid, {
            "status": "rolled_back",
            "steps": previous_steps + steps,
            "checksums": checksums,
            "finished_at": _now(),
            "duration_ms": int(record.get("duration_ms") or 0) + duration,
            "error": "",
        })
        _logger().info(
            "taşıma company=%s durum=rolled_back",
            storage_router._safe_company(cid),
        )
        return MoveReport(
            ok=True,
            wrote=True,
            dry_run=False,
            move_id=mid,
            company_id=cid,
            from_mode=current,
            to_mode=source,
            status="rolled_back",
            collections=collections,
            counts=new_counts,
            checksums=checksums,
            steps=steps,
            duration_ms=duration,
        )
    finally:
        if locked:
            storage_router.unlock_company_writes(cid)
            try:
                await _flag(db, cid, False)
            except Exception:
                pass
        if acquired:
            storage_router.end_move(cid)


def render(report: MoveReport) -> str:
    """Operatör raporu. DSN, sır, VKN ve ETTN yazılmaz."""
    lines = [
        f"taşıma: {report.status or ('dry-run' if report.dry_run else 'apply')}",
        f"şirket: {storage_router._safe_company(report.company_id)}",
        f"kaynak: {report.from_mode or '-'}",
        f"hedef: {report.to_mode or '-'}",
    ]
    if report.move_id:
        lines.append(f"kayıt: {report.move_id}")
    if not report.collections:
        lines.append("koleksiyon yok")
    for row in report.collections:
        lines.append(
            f"{row.get('name')} sayı={row.get('count')} bayt={row.get('bytes')} hedef={row.get('target')}"
        )
    for item in report.conflicts:
        lines.append(f"çakışma: {item}")
    for item in report.errors:
        lines.append(f"hata: {item}")
    if report.dry_run or not report.wrote:
        lines.append("yazılmadı")
    else:
        lines.append(f"süre_ms: {report.duration_ms}")
    from storage_migrations.masking import scrub

    return scrub("\n".join(lines) + "\n")


def main(argv=None, catalog=None) -> int:
    from storage_migrations.masking import scrub, secret_scope

    with secret_scope():
        try:
            return _main(argv, catalog)
        except storage_router.StorageMoveBusy as exc:
            sys.stderr.write(scrub(str(exc)) + "\n")
            return 1
        except Exception as exc:
            sys.stderr.write(scrub(_safe(exc)) + "\n")
            return 1


def _main(argv, catalog) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.storage_move")
    parser.add_argument("--company", default="", help="company_id")
    parser.add_argument("--to", default="", help="shared_v2, dedicated veya legacy")
    parser.add_argument("--dry-run", action="store_true", help="yazma; varsayılan budur")
    parser.add_argument("--apply", action="store_true", help="kopyala ve kipi değiştir")
    parser.add_argument("--rollback", default="", help="tamamlanmış taşıma kaydı")
    args = parser.parse_args(argv)
    if catalog is None:
        sys.stderr.write("Firma kataloğu yok.\n")
        return 2
    if args.rollback and args.apply:
        sys.stderr.write("Geri alma ve apply birlikte kullanılmaz.\n")
        return 2
    if args.rollback:
        report = asyncio.run(rollback_move(catalog, args.rollback))
    elif args.apply and not args.dry_run:
        if not str(args.company or "").strip() or not str(args.to or "").strip():
            sys.stderr.write("Apply için --company ve --to gerekir.\n")
            return 2
        report = asyncio.run(apply_move(catalog, args.company, args.to))
    else:
        if not str(args.company or "").strip() or not str(args.to or "").strip():
            sys.stderr.write("Dry-run için --company ve --to gerekir.\n")
            return 2
        report = asyncio.run(plan_move(catalog, args.company, args.to))
    sys.stdout.write(render(report))
    if report.ok:
        return 0
    if report.status == "failed":
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
