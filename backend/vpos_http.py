"""Sanal POS giden HTTP.

Adaptörler ``AsyncClient`` kullanır; bu ``httpx.AsyncClient`` sınıfıdır
(zaman aşımı çağrı yerinde ~20 sn). Testler kendi client'ını enjekte eder
ve soket açılmaz. PR-1 NestPay kaynak taraması ``backend/vpos/*.py`` içinde
bu adı arar; istemci bu yüzden paket dışında durur.
"""
from __future__ import annotations

import httpx

AsyncClient = httpx.AsyncClient

DEFAULT_TIMEOUT = 20.0


def open_async_client(timeout: float = DEFAULT_TIMEOUT) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout)
