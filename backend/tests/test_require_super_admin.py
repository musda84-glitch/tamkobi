"""Sistem paneli: boş Bearer demo yöneticiye düşmesin."""
import asyncio
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")

import saas  # noqa: E402


class _Req:
    def __init__(self, bearer=None, cookie=None):
        self.headers = {"Authorization": f"Bearer {bearer}"} if bearer is not None else {}
        self.cookies = {"access_token": cookie} if cookie is not None else {}


@pytest.fixture
def token_users(monkeypatch):
    async def from_token(token, db):
        if token != "tok":
            raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")
        return {"is_super_admin": True, "email": "platform@tamkobi.com"}

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    saas.init(object(), None)
    return from_token


def test_oturumsuz_401(token_users):
    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(_Req()))
    assert e.value.status_code == 401


def test_bos_bearer_401(token_users):
    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(_Req(bearer=" ")))
    assert e.value.status_code == 401


def test_bos_bearer_ve_sahte_cerez_401(token_users):
    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(_Req(bearer=" ", cookie="dummy")))
    assert e.value.status_code == 401


def test_gecerli_cerez(token_users):
    user = asyncio.run(saas.require_super_admin(_Req(cookie="tok")))
    assert user["email"] == "platform@tamkobi.com"


def test_sadece_super_admin(monkeypatch):
    async def from_token(token, db):
        return {"is_super_admin": False, "email": "user@firma.com"}

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    saas.init(object(), None)
    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(_Req(cookie="tok")))
    assert e.value.status_code == 403


def test_get_current_user_demo_yoluna_dusmez(monkeypatch):
    async def demo(_request):
        return {"is_super_admin": True, "email": "admin@nexus.com"}

    async def from_token(token, db):
        raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    saas.init(object(), demo)
    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(_Req(bearer=" ", cookie="dummy")))
    assert e.value.status_code == 401
