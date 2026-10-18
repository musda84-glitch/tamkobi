"""İsteğe bağlı geçici MongoDB 127.0.0.1:27999.

Canlı veritabanına ve 8021 portuna bağlanmaz. mongod yoksa ensure_mongod atlar.
Dashboard testleri bu süreci başlatmaz; bellek içi koleksiyon kullanır.
"""
from __future__ import annotations

import socket
import subprocess
import time
from pathlib import Path

import pytest

PORT = 27999
URL = f"mongodb://127.0.0.1:{PORT}"
DBPATH = Path("/tmp/tamkobi-mongo-27999")
LOG = Path("/tmp/tamkobi-mongo-27999.log")
MONGOD = Path("/tmp/mongodb/bin/mongod")


def _port_open() -> bool:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", PORT)) == 0


def ensure_mongod() -> str:
    if "8021" in URL:
        raise RuntimeError("test mongo must not use port 8021")
    if _port_open():
        return URL
    if not MONGOD.is_file():
        pytest.skip(f"mongod yok: {MONGOD}")
    DBPATH.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [
            str(MONGOD),
            "--port", str(PORT),
            "--dbpath", str(DBPATH),
            "--bind_ip", "127.0.0.1",
            "--logpath", str(LOG),
            "--fork",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    for _ in range(80):
        if _port_open():
            return URL
        time.sleep(0.1)
    raise RuntimeError(f"mongod {PORT} portunda açılmadı")
