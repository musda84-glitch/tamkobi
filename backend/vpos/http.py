"""Sanal POS giden HTTP.

PayTR ve iyzico ``open_async_client`` ile ``httpx.AsyncClient`` açar
(zaman aşımı ~20 sn). Testler adaptöre sahte client enjekte eder; bu
fonksiyon o zaman çağrılmaz ve soket açılmaz. NestPay bu modülü kullanmaz.
"""
from __future__ import annotations

import httpx

DEFAULT_TIMEOUT = 20.0


def open_async_client(timeout: float = DEFAULT_TIMEOUT) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=timeout)
