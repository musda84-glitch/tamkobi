"""Event loop gecikmesi. Her worker kendi döngüsünü ölçer.

Uyarı, sleep döndükten sonra değil, gecikme sürerken yazılır. Aksi halde
yığın çoktan `watch` karesine dönmüş olur. Ayrı iş parçacığı, döngü
iş parçacığının yığınını `sys._current_frames` ile okur. Yerel değişken
ve sorgu dizesi yazılmaz; 10+ haneli diziler (VKN/TCKN) silinir.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import sys
import threading
import time
import traceback

log = logging.getLogger("tamkobi.loop")

_DIGITS = re.compile(r"\d{10,}")
_inflight_guard = threading.Lock()
_inflight: dict[int, str] = {}
_inflight_seq = 0


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


def scrub(text: str) -> str:
    """10+ haneli dizileri sil. Sorgu, gövde ve yerel değişken buraya girmez."""
    return _DIGITS.sub("#", str(text or ""))


def note_request(label: str) -> int:
    """İstek döngü dışındaki örnekleyiciye görünsün. ContextVar orada boştur.

    Sorgu dizesi atılır. 10+ haneli diziler silinir.
    """
    global _inflight_seq
    clean = str(label or "").split("?", 1)[0]
    clean = scrub(clean)[:180]
    with _inflight_guard:
        _inflight_seq += 1
        token = _inflight_seq
        _inflight[token] = clean
    return token


def end_request(token: int) -> None:
    with _inflight_guard:
        _inflight.pop(int(token), None)


def inflight_text() -> str:
    with _inflight_guard:
        labels = list(_inflight.values())
    if not labels:
        return "-"
    text = ",".join(labels[:4])
    if len(labels) > 4:
        text += f",+{len(labels) - 4}"
    return scrub(text)[:180]


def format_stack(frame, limit: int = 8) -> str:
    """dosya:satır:fonksiyon. Kaynak satırı ve yerel değişken yok."""
    if frame is None:
        return "-"
    try:
        summary = traceback.extract_stack(frame, limit=limit)
    except Exception:
        return "-"
    parts = []
    for item in summary:
        name = os.path.basename(item.filename) or "?"
        parts.append(f"{name}:{item.lineno}:{item.name}")
    if not parts:
        return "-"
    return scrub(" < ".join(reversed(parts)))[:500]


def describe_stall(lag_ms: float, frame) -> str:
    return "event loop gecikmesi %.0f ms istek=%s stack=%s" % (
        lag_ms,
        inflight_text(),
        format_stack(frame),
    )


def _sample(state: dict, stop: threading.Event, warn_s: float) -> None:
    """Döngü geç kalırken bir kez uyar. Uyku normalde `due` gelecektedir."""
    latched = False
    poll = 0.05 if warn_s >= 0.05 else max(0.01, warn_s / 2)
    while not stop.wait(poll):
        late = time.monotonic() - float(state.get("due") or 0.0)
        if late < warn_s:
            latched = False
            continue
        if latched:
            continue
        latched = True
        frames = sys._current_frames()
        frame = frames.get(state.get("ident"))
        log.warning("%s", describe_stall(late * 1000.0, frame))


async def watch() -> None:
    interval = _interval()
    if interval <= 0:
        return
    warn_s = _warn_ms() / 1000.0
    if warn_s < 0:
        warn_s = 0.0
    state = {"due": time.monotonic() + interval, "ident": threading.get_ident()}
    stop = threading.Event()
    sampler = threading.Thread(
        target=_sample,
        args=(state, stop, warn_s),
        name="loop-lag",
        daemon=True,
    )
    sampler.start()
    try:
        while True:
            state["due"] = time.monotonic() + interval
            await asyncio.sleep(interval)
    finally:
        stop.set()
