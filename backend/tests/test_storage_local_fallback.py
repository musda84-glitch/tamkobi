"""Yerel depolama fallback birim testleri."""
from __future__ import annotations

import os
from pathlib import Path

import pytest


@pytest.fixture()
def local_storage(tmp_path, monkeypatch):
    monkeypatch.delenv("EMERGENT_LLM_KEY", raising=False)
    monkeypatch.setenv("LOCAL_STORAGE_DIR", str(tmp_path))
    import importlib
    import storage_service as ss
    importlib.reload(ss)
    ss._backend = None
    ss.storage_key = None
    yield ss, tmp_path
    importlib.reload(ss)


def test_put_get_roundtrip_without_emergent_key(local_storage):
    ss, root = local_storage
    path = f"{ss.APP_NAME}/accounts/comp_demo/products/probe.jpg"
    out = ss.put_object(path, b"\xff\xd8fakejpeg", "image/jpeg")
    assert out["path"] == path
    assert out["backend"] == "local"
    assert out["size"] == 10
    data, ctype = ss.get_object(path)
    assert data == b"\xff\xd8fakejpeg"
    assert ctype == "image/jpeg"
    assert (root / ss.APP_NAME / "accounts" / "comp_demo" / "products" / "probe.jpg").is_file()


def test_empty_path_rejected(local_storage):
    ss, _ = local_storage
    with pytest.raises(ValueError):
        ss.put_object("", b"x", "text/plain")
    with pytest.raises(ValueError):
        ss.put_object("///", b"x", "text/plain")
    # ".." parçaları elenir; kök dışına çıkılmaz ve yol normalize edilir
    out = ss.put_object("../etc/passwd", b"x", "text/plain")
    assert out["path"] == "etc/passwd"
    data, _ = ss.get_object("etc/passwd")
    assert data == b"x"


def test_init_without_key_returns_none(local_storage):
    ss, _ = local_storage
    assert ss.init_storage() is None
    assert ss.storage_backend() == "local"
