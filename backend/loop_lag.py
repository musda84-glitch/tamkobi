"""Event loop gecikmesi. Her worker kendi döngüsünü ölçer."""
from __future__ import annotations

import asyncio
import logging
import os

log = logging.getLogger("tamkobi.loop")


def _interval() -> float:
    try:
        value = float(os.environ.get("LOOP_LAG_INTERVAL_S", "1"))
    except (TypeError, ValueError):
        value = 1.0
    return value


def _warn_ms() -> float:
    try:
        value = float(os.environ.get("LOOP_LAG_WARN_MS", "200"))
    except (TypeError, ValueError):
        value = 200.0
    return value


async def watch() -> None:
    interval = _interval()
    if interval <= 0:
        return
    warn = _warn_ms()
    loop = asyncio.get_running_loop()
    expected = loop.time() + interval
    while True:
        await asyncio.sleep(interval)
        now = loop.time()
        lag_ms = (now - expected) * 1000
        expected = now + interval
        if lag_ms >= warn:
            log.warning("event loop gecikmesi %.0f ms", lag_ms)
