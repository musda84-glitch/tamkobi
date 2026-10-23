"""Döngü gecikmesi yığını ve arka plan kirası. Canlı MySQL gerekmez."""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
import time
from types import SimpleNamespace

import pytest

import applog
import loop_lag
import platform_lease as pl
import storage_router


def test_stack_has_function_but_not_locals_or_long_digits():
    secret = "VKN12345678901"
    token = "super-secret-value"
    frame = sys._current_frames()[threading.get_ident()]
    text = loop_lag.format_stack(frame)
    assert "test_stack_has_function_but_not_locals_or_long_digits" in text
    assert secret not in text
    assert token not in text
    assert "12345678901" not in text
    assert loop_lag.scrub("abc12345678901xyz") == "abc#xyz"


def test_stall_line_names_endpoint_without_vkn():
    token = loop_lag.note_request("GET /api/companies/12345678901?token=secret")
    try:
        frame = sys._current_frames()[threading.get_ident()]
        text = loop_lag.describe_stall(6143, frame)
    finally:
        loop_lag.end_request(token)
    assert text.startswith("event loop gecikmesi 6143 ms")
    assert "istek=GET /api/companies/#" in text
    assert "12345678901" not in text
    assert "token=" not in text
    assert "secret" not in text
    assert loop_lag.inflight_text() == "-"


def test_request_middleware_registers_endpoint_until_return():
    seen = {}

    class Req:
        method = "POST"
        url = SimpleNamespace(path="/api/invoices/10987654321")

    async def call_next(request):
        seen["inflight"] = loop_lag.inflight_text()
        return SimpleNamespace(status_code=204)

    async def run():
        mw = applog.RequestLogMiddleware(app=None)
        response = await mw.dispatch(Req(), call_next)
        assert response.status_code == 204

    asyncio.run(run())
    assert seen["inflight"] == "POST /api/invoices/#"
    assert "10987654321" not in seen["inflight"]
    assert loop_lag.inflight_text() == "-"


def test_sampler_logs_stack_while_the_loop_is_blocked(monkeypatch):
    monkeypatch.setenv("LOOP_LAG_INTERVAL_S", "0.05")
    monkeypatch.setenv("LOOP_LAG_WARN_MS", "30")
    records = []

    class Grab(logging.Handler):
        def emit(self, record):
            records.append(record.getMessage())

    logger = logging.getLogger("tamkobi.loop")
    handler = Grab(level=logging.WARNING)
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        async def run():
            task = asyncio.create_task(loop_lag.watch())
            await asyncio.sleep(0)
            token = loop_lag.note_request("PUT /api/orders/12345678901")
            try:
                time.sleep(0.3)
            finally:
                loop_lag.end_request(token)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

        asyncio.run(run())
    finally:
        logger.removeHandler(handler)
    assert records, "gecikme sırasında yığın yazılmadı"
    text = "\n".join(records)
    assert "event loop gecikmesi" in text
    assert "istek=PUT /api/orders/#" in text
    assert "12345678901" not in text
    assert "test_sampler_logs_stack_while_the_loop_is_blocked" in text


def test_persist_record_does_not_block_the_loop(monkeypatch):
    monkeypatch.setenv("LOG_DB_PERSIST", "1")
    started = threading.Event()
    release = threading.Event()
    seen = {}

    def slow(rec):
        seen["ident"] = threading.get_ident()
        seen["event"] = rec.get("event")
        started.set()
        release.wait(2)

    monkeypatch.setattr(applog, "_persist_record_blocking", slow)

    async def run():
        applog.persist_record({"category": "event", "event": "ping"})
        assert started.wait(1)
        t0 = time.perf_counter()
        await asyncio.sleep(0)
        assert time.perf_counter() - t0 < 0.2
        release.set()
        await asyncio.sleep(0.05)

    try:
        asyncio.run(run())
    finally:
        release.set()
    assert seen["event"] == "ping"
    assert seen["ident"] != threading.get_ident()


def test_expired_router_cache_on_loop_skips_sync_sql(monkeypatch):
    storage_router.reset()
    called = {"sql": 0}

    def boom(*_args, **_kwargs):
        called["sql"] += 1
        return storage_router._UNREAD

    monkeypatch.setattr(storage_router, "_sql_company", boom)
    monkeypatch.setattr(storage_router, "_memory_doc", lambda *_a, **_k: storage_router._UNREAD)

    class DB:
        _settings = {"host": "127.0.0.1", "db": "tamkobi", "user": "u", "password": "secret"}

    storage_router._cache["co_loop"] = ("shared_v2", 0.0, 3, False)

    async def run():
        mode = storage_router.mode_for_handle(DB(), "co_loop")
        assert mode == "shared_v2"
        await asyncio.sleep(0.05)

    try:
        asyncio.run(run())
    finally:
        storage_router.reset()
    assert called["sql"] == 0


def _lease_fakes(monkeypatch, events, board):
    async def acquire(_db, name, owner, ttl_s=60):
        assert name == "bg.bank_sync"
        if board["owner"] in (None, owner):
            board["owner"] = owner
            return True
        return False

    async def release(_db, name, owner):
        events.append("release")
        if board["owner"] == owner:
            board["owner"] = None

    monkeypatch.setattr(pl, "try_acquire", acquire)
    monkeypatch.setattr(pl, "release", release)


def test_second_owner_waits_until_work_stops(monkeypatch):
    pl._reset_runtime_for_tests()
    events = []
    board = {"owner": None}
    _lease_fakes(monkeypatch, events, board)
    started = asyncio.Event()
    started2 = asyncio.Event()
    count = {"n": 0}

    async def job():
        count["n"] += 1
        who = count["n"]
        events.append(f"start-{who}")
        (started if who == 1 else started2).set()
        try:
            await asyncio.sleep(30)
        finally:
            events.append(f"stop-{who}")

    async def run():
        first = asyncio.create_task(pl.run_exclusive(None, "bg.bank_sync", job, wait_s=0.05))
        await asyncio.wait_for(started.wait(), 1)
        second = asyncio.create_task(pl.run_exclusive(None, "bg.bank_sync", job, wait_s=0.05))
        await asyncio.sleep(0.15)
        assert [item for item in events if item.startswith("start-")] == ["start-1"]
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        await asyncio.wait_for(started2.wait(), 1)
        assert events.index("stop-1") < events.index("release") < events.index("start-2")
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second

    try:
        asyncio.run(run())
    finally:
        pl._reset_runtime_for_tests()


def test_shutdown_releases_only_after_work_stops(monkeypatch, caplog):
    pl._reset_runtime_for_tests()
    events = []
    board = {"owner": None}
    _lease_fakes(monkeypatch, events, board)
    started = asyncio.Event()

    async def job():
        events.append("start")
        started.set()
        try:
            await asyncio.sleep(30)
        finally:
            events.append("stop")

    async def run():
        task = asyncio.create_task(pl.run_exclusive(None, "bg.bank_sync", job, wait_s=0.05))
        await asyncio.wait_for(started.wait(), 1)
        await asyncio.wait_for(pl.shutdown(), 2)
        assert task.done()
        assert events.index("stop") < events.index("release")
        events.clear()
        await pl.run_exclusive(None, "bg.trendyol", job, wait_s=0.05)
        assert events == []

    caplog.set_level(logging.INFO, logger="tamkobi.lease")
    try:
        asyncio.run(run())
    finally:
        pl._reset_runtime_for_tests()
    text = "\n".join(caplog.messages)
    assert "lease alındı bg.bank_sync owner=" in text
    assert "lease bırakıldı bg.bank_sync owner=" in text
