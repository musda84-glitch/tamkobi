"""WhatsApp phone_number_id çakışma raporu: salt okuma, bağlantı yok."""
from __future__ import annotations

import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))

import scripts.report_whatsapp_phone_number_id as report  # noqa: E402

SCRIPT = _BACKEND / "scripts" / "report_whatsapp_phone_number_id.py"
TOKEN = "wa-access-token-plain-9f3a"
SECRET = "wa-app-secret-plain-77c1"
VERIFY = "verify-token-gizli-57a6"
PHONE = "905321112233"
BODY = "GIZLI-MESAJ-METNI"


def _row(setting_id, company_id, phone_number_id, **extra):
    row = {
        "_id": setting_id,
        "company_id": company_id,
        "phone_number_id": phone_number_id,
        "verify_token": VERIFY,
        "access_token": TOKEN,
        "access_token_enc": "enc-" + TOKEN,
        "app_secret": SECRET,
        "app_secret_enc": "enc-" + SECRET,
        "phone": PHONE,
        "message": BODY,
    }
    row.update(extra)
    return row


def test_cli_without_json_opens_nothing(capsys):
    assert report.main([]) == 0
    out = capsys.readouterr().out
    assert "bağlantı açılmadı" in out
    assert "yazım yok" in out
    assert report.main(["--apply", "--json", "x.json"]) == 2
    assert "--apply" in capsys.readouterr().err


def test_script_does_not_write_or_call_graph():
    text = SCRIPT.read_text(encoding="utf-8")
    assert "update_one" not in text
    assert "delete_one" not in text
    assert "insert_one" not in text
    assert "mysql_store" not in text
    assert "graph.facebook" not in text
    assert "httpx" not in text


def test_duplicate_phone_number_id_is_reported_without_secrets(tmp_path, capsys):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps([
        _row("setA", "comp-a", "pnA"),
        _row("setDup", "comp-dup", "pnA"),
        _row("setB", "comp-b", "pnB"),
        _row("emptyA", "comp-a", ""),
        _row("emptyB", "comp-b", ""),
        _row("blankSpace", "comp-a", " "),
        _row("num", "comp-a", 12),
        _row("missing", "comp-c", None),
    ]), encoding="utf-8")
    before = path.read_bytes()
    assert report.main(["--json", str(path), "--dry-run"]) == 0
    printed = capsys.readouterr().out
    assert "dry-run" in printed
    assert "yazım yok" in printed
    assert "pnA" in printed
    assert "comp-a" in printed and "comp-dup" in printed
    assert "setA" in printed and "setDup" in printed
    assert "pnB" not in printed
    for secret in (TOKEN, SECRET, VERIFY, PHONE, BODY, "enc-" + TOKEN, "enc-" + SECRET):
        assert secret not in printed
    assert path.read_bytes() == before

    found = report.find_conflicts(json.loads(path.read_text(encoding="utf-8")))
    assert found["dry_run"] is True
    assert found["wrote"] is False
    assert found["duplicate_groups"] == 1
    group = found["groups"][0]
    assert group["phone_number_id"] == "pnA"
    assert group["copies"] == 2
    assert group["company_ids"] == ["comp-a", "comp-dup"]
    assert group["setting_ids"] == ["setA", "setDup"]
    assert set(group) == {"phone_number_id", "copies", "company_ids", "setting_ids"}


def test_company_filter_keeps_the_other_side_of_the_clash():
    rows = [
        _row("setA", "comp-a", "pnA"),
        _row("setB", "comp-b", "pnA"),
        _row("setC", "comp-c", "pnC"),
        _row("setD", "comp-d", "pnC"),
    ]
    only = report.find_conflicts(rows, company_id="comp-b")
    assert only["company_id"] == "comp-b"
    assert only["duplicate_groups"] == 1
    assert only["groups"][0]["company_ids"] == ["comp-a", "comp-b"]
    assert report.find_conflicts(rows, company_id="comp-yok")["duplicate_groups"] == 0


def test_same_company_two_rows_still_conflict():
    rows = [
        _row("set1", "comp-a", "pnA"),
        _row("set2", "comp-a", "pnA"),
    ]
    found = report.find_conflicts(rows)
    assert found["duplicate_groups"] == 1
    assert found["groups"][0]["copies"] == 2
    assert found["groups"][0]["company_ids"] == ["comp-a"]
    assert found["groups"][0]["setting_ids"] == ["set1", "set2"]


def test_whitespace_phone_number_id_is_indexed_when_duplicated():
    rows = [
        _row("s1", "comp-a", " "),
        _row("s2", "comp-b", " "),
    ]
    found = report.find_conflicts(rows)
    assert found["duplicate_groups"] == 1
    assert found["groups"][0]["phone_number_id"] == " "
    assert report.indexed_phone_number_id({"phone_number_id": ""}) == ""
    assert report.indexed_phone_number_id({"phone_number_id": None}) == ""
    assert report.indexed_phone_number_id({"phone_number_id": 12}) == ""
    assert report.indexed_phone_number_id({"phone_number_id": "pnA"}) == "pnA"
