"""Logging helpers, redaction, and file rotation (no live MySQL required)."""
import json
import logging
import os
from pathlib import Path

import applog


def _reset(monkeypatch, tmp_path):
    monkeypatch.setenv("LOG_DIR", str(tmp_path))
    monkeypatch.setenv("LOG_MAX_BYTES", "200")
    monkeypatch.setenv("LOG_RETENTION_DAYS", "1")
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    applog._configured = False
    applog.LOG_MAX_BYTES = 200
    applog.LOG_RETENTION_DAYS = 1
    for name in (applog.APP_LOGGER, applog.AUTH_LOGGER, applog.ERROR_LOGGER, applog.SQL_LOGGER, applog.ROOT_APP):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = False
    return applog.setup_logging()


def test_setup_creates_files(monkeypatch, tmp_path):
    d = _reset(monkeypatch, tmp_path)
    applog.log_event("test_event", "hello")
    applog.log_auth("login_success", "admin@nexus.com signed in", email="admin@nexus.com", ip="127.0.0.1")
    applog.log_error("boom", "failed", error="x")
    applog.log_sql("INSERT", "invoices", doc_id="inv_1", duration_ms=12)
    for name in ("app.log", "auth.log", "error.log", "sql.log"):
        p = d / name
        assert p.exists(), name
        assert p.stat().st_size > 0, name
    auth = (d / "auth.log").read_text(encoding="utf-8")
    rec = json.loads(auth.strip().splitlines()[-1])
    assert rec["event"] == "login_success"
    assert rec["email"] == "admin@nexus.com"


def test_redact_secrets():
    out = applog.redact({
        "email": "a@b.com",
        "password": "secret",
        "token": "abc",
        "nested": {"refresh_token": "x", "ok": 1},
    })
    assert out["email"] == "a@b.com"
    assert out["password"] == "***"
    assert out["token"] == "***"
    assert out["nested"]["refresh_token"] == "***"
    assert out["nested"]["ok"] == 1


def test_sql_skips_noise_collections(monkeypatch, tmp_path):
    d = _reset(monkeypatch, tmp_path)
    applog.log_sql("INSERT", "activity_logs", doc_id="a1", duration_ms=5)
    sql = (d / "sql.log").read_text(encoding="utf-8")
    assert "activity_logs" not in sql


def test_rotate_copytruncates_and_gzips(monkeypatch, tmp_path):
    d = _reset(monkeypatch, tmp_path)
    target = d / "app.log"
    target.write_text("x" * 500, encoding="utf-8")
    result = applog.rotate_files(directory=d, max_bytes=200, retention_days=30)
    assert result["rotated"], result
    assert target.exists()
    assert target.stat().st_size == 0
    gz = Path(result["rotated"][0])
    assert gz.exists() and gz.suffix == ".gz"


def test_rotate_cli(monkeypatch, tmp_path, capsys):
    _reset(monkeypatch, tmp_path)
    (tmp_path / "auth.log").write_text("y" * 400, encoding="utf-8")
    applog.main(["rotate"])
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert payload["log_dir"] == str(tmp_path)
    assert payload["max_bytes"] == 200
