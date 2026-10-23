"""Şirket bazlı değişiklik kanalı (SSE).

nginx /api proxy'sinin arkasında çalışır: WebSocket yükseltmesi gerekmez,
`X-Accel-Buffering: no` ile tampon kapanır, 15 sn'de bir yorum satırı
proxy_read_timeout'u (120 sn) açık tutar.

Olay yükü yalnız tür + id. Tutar, ad veya başka veri yok.
Abone yalnızca kendi şirketinin olayını görür; oturum mevcut token audience
kontrolünden geçer.

Tek worker değişikliği bellek kuyruğundan hemen iletilir. Birden fazla
worker bellek paylaşmadığı için diğer sürecin olayı 1.5 sn'de bir DB'den okunur.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncIterator, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

import tenant_access

logger = logging.getLogger("company_events")

router = APIRouter(prefix="/api")

EVENTS_COLLECTION = "company_events"
HEARTBEAT_SEC = 15
POLL_SEC = 1.5
RETAIN_MINUTES = 10
_WORKERS_FLAG = re.compile(r"(?:^|\s)--workers(?:=|\s+)(\d+)\b")

# Koleksiyon → olay türü. banka/ortak satırında tahsilat ve virman ayrılır.
_COLLECTION_KIND = {
    "bank_accounts": "bank_account",
    "partners": "partner",
    "contacts": "contact",
    "invoices": "invoice",
    "orders": "order",
    "products": "stock",
    "stock_movements": "stock",
}

_db = None
_user_dep = None
_pending: list = []
_subs: Dict[str, set] = {}
_flush_task: Optional[asyncio.Task] = None
_flush_ticks = 0


def change_kind(collection: str, doc: Optional[dict]) -> Optional[str]:
    """Yazılan kaydın olay türü. Eşleşmezse None (yayın yok)."""
    if not doc or collection == EVENTS_COLLECTION:
        return None
    if collection == "bank_transactions":
        src = str(doc.get("source") or "").lower()
        if src == "virman":
            return "transfer"
        if doc.get("contact_id") or src in {"payment", "collection", "contact", "invoice"}:
            return "payment"
        if src == "partner" or doc.get("partner_tx_id"):
            return "partner_transaction"
        return "bank_transaction"
    if collection == "partner_transactions":
        if doc.get("contact_id"):
            return "payment"
        return "partner_transaction"
    return _COLLECTION_KIND.get(collection)


def wire_event(event: dict) -> dict:
    """İstemciye giden gövde: yalnız değişti + tür + id."""
    return {
        "event": "changed",
        "type": str(event.get("type") or ""),
        "id": str(event.get("id") or ""),
    }


def events_for_company(rows, company_id: str, since: str) -> list:
    """Başka şirketin satırını ve cursor'dan eski kayıtları düşür."""
    cid = str(company_id or "")
    cutoff = since or ""
    out = []
    for row in rows or []:
        if str(row.get("company_id") or "") != cid:
            continue
        created = str(row.get("created_at") or "")
        if cutoff and created <= cutoff:
            continue
        out.append(row)
    out.sort(key=lambda r: str(r.get("created_at") or ""))
    return out


def note_change(collection: str, doc: Optional[dict]) -> None:
    """Yazma sonrası çağrılır. Veri kopyalanmaz; yalnız tür + id kuyruğa girer."""
    kind = change_kind(collection, doc)
    if not kind or not doc:
        return
    company_id = str(doc.get("company_id") or "").strip()
    entity_id = str(doc.get("_id") or doc.get("id") or "").strip()
    if not company_id or not entity_id:
        return
    event = {
        "_id": str(uuid4()),
        "company_id": company_id,
        "type": kind,
        "id": entity_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if _db is not None:
        _pending.append(event)
        if len(_pending) > 8000:
            del _pending[:4000]
    for queue in list(_subs.get(company_id) or ()):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            pass


def subscribe(company_id: str) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subs.setdefault(str(company_id), set()).add(queue)
    return queue


def unsubscribe(company_id: str, queue: asyncio.Queue) -> None:
    bucket = _subs.get(str(company_id))
    if not bucket:
        return
    bucket.discard(queue)
    if not bucket:
        _subs.pop(str(company_id), None)


def init(db, get_current_user=None) -> None:
    """Her worker kendi kuyruğunu DB'ye yazar; SSE diğer worker'ı DB'den okur."""
    global _db, _user_dep, _flush_task
    _db = db
    if get_current_user is not None:
        _user_dep = get_current_user
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if _flush_task is not None and not _flush_task.done():
        return
    _flush_task = loop.create_task(flush_loop())


def reset_for_tests() -> None:
    global _db, _user_dep, _flush_ticks, _flush_task
    _db = None
    _user_dep = None
    _pending.clear()
    _subs.clear()
    _flush_ticks = 0
    task = _flush_task
    _flush_task = None
    if task is not None and not task.done():
        task.cancel()


async def flush_once() -> int:
    global _flush_ticks
    if _db is None or not _pending:
        return 0
    batch = _pending[:]
    del _pending[: len(batch)]
    merged: Dict[tuple, dict] = {}
    for event in batch:
        merged[(event["company_id"], event["type"], event["id"])] = event
    written = 0
    for event in merged.values():
        try:
            await _db.company_events.insert_one(dict(event))
            written += 1
        except Exception:
            logger.exception("company event persist failed")
    _flush_ticks += 1
    if _flush_ticks % 40 == 0:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=RETAIN_MINUTES)).isoformat()
        try:
            await _db.company_events.delete_many({"created_at": {"$lt": cutoff}})
        except Exception:
            logger.exception("company event cleanup failed")
    return written


async def flush_loop() -> None:
    while True:
        try:
            await flush_once()
        except Exception:
            logger.exception("company event flush")
        await asyncio.sleep(1.0)


def _cmdline(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            raw = fh.read()
    except OSError:
        return ""
    return raw.replace(b"\x00", b" ").decode("utf-8", "replace")


def worker_count() -> int:
    """Kaç uvicorn worker. Süreç satırı gerçek sayı; env yalnız yedek."""
    for pid in (os.getpid(), os.getppid()):
        match = _WORKERS_FLAG.search(_cmdline(pid))
        if match:
            return max(1, int(match.group(1)))
    for key in ("TAMKOBI_WORKERS", "WEB_CONCURRENCY"):
        raw = (os.environ.get(key) or "").strip()
        if raw.isdigit():
            return max(1, int(raw))
    return 1


def _db_fanout() -> bool:
    """Tek worker aboneliği bellek kuyruğundan görür. DB yalnız diğer worker için."""
    return worker_count() > 1


def _format_sse(event: dict) -> str:
    data = json.dumps(wire_event(event), ensure_ascii=False, separators=(",", ":"))
    return f"event: changed\ndata: {data}\n\n"


async def _poll(company_id: str, since: str) -> list:
    if not _db_fanout() or _db is None:
        return []
    try:
        rows = await _db.company_events.find(
            {"company_id": company_id, "created_at": {"$gt": since}}
        ).to_list(300)
    except Exception:
        logger.exception("company event poll")
        return []
    return events_for_company(rows, company_id, since)


async def iter_company_events(company_id: str, request: Request) -> AsyncIterator[str]:
    queue = subscribe(company_id)
    since = datetime.now(timezone.utc).isoformat()
    seen: set = set()
    loop = asyncio.get_running_loop()
    last_ping = loop.time()
    next_db = loop.time()

    def accept(event: dict) -> Optional[str]:
        nonlocal since
        key = event.get("_id") or (event.get("type"), event.get("id"), event.get("created_at"))
        created = str(event.get("created_at") or "")
        if created > since:
            since = created
        if key in seen:
            return None
        seen.add(key)
        return _format_sse(event)

    try:
        yield ": ok\n\n"
        while True:
            if await request.is_disconnected():
                break
            emitted = False
            while True:
                try:
                    event = queue.get_nowait()
                except asyncio.QueueEmpty:
                    break
                chunk = accept(event)
                if chunk:
                    yield chunk
                    emitted = True
            now = loop.time()
            if _db_fanout() and now >= next_db:
                for row in await _poll(company_id, since):
                    chunk = accept(row)
                    if chunk:
                        yield chunk
                        emitted = True
                next_db = loop.time() + POLL_SEC
            if len(seen) > 2000:
                seen.clear()
            now = loop.time()
            if now - last_ping >= HEARTBEAT_SEC:
                yield ": ping\n\n"
                last_ping = now
            if emitted:
                await asyncio.sleep(0)
                continue
            timeout = POLL_SEC
            if _db_fanout():
                timeout = min(POLL_SEC, max(0.0, next_db - loop.time()))
            try:
                event = await asyncio.wait_for(queue.get(), timeout=timeout)
            except asyncio.TimeoutError:
                continue
            chunk = accept(event)
            if chunk:
                yield chunk
            await asyncio.sleep(0)
    finally:
        unsubscribe(company_id, queue)


@router.get("/events/stream")
async def stream_company_events(request: Request, company_id: Optional[str] = None):
    """Şirket olay akışı. Auth + token audience, mevcut oturum bağımlılığı ile."""
    if _user_dep is None:
        raise HTTPException(status_code=500, detail="Olay kanalı bağlanmadı.")
    user = await _user_dep(request)
    cid = tenant_access.resolve_company_id(user, company_id)
    return StreamingResponse(
        iter_company_events(cid, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
