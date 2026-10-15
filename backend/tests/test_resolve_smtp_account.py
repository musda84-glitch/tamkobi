"""resolve_smtp_account: purpose, sonra varsayılan, transactional, en eski aktif kutu."""
import asyncio

import platform_mail


def _run(coro):
    return asyncio.run(coro)


def _match(doc, query):
    for key, cond in (query or {}).items():
        if isinstance(cond, dict) and "$ne" in cond:
            if doc.get(key) == cond["$ne"]:
                return False
            continue
        if doc.get(key) != cond:
            return False
    return True


class _Col:
    def __init__(self, rows=None):
        self.rows = {r["_id"]: dict(r) for r in (rows or [])}

    async def find_one(self, query, projection=None):
        for row in self.rows.values():
            if _match(row, query):
                return dict(row)
        return None

    def find(self, query=None, projection=None):
        rows = [dict(r) for r in self.rows.values() if _match(r, query or {})]

        class _Cursor:
            def __init__(self):
                self._rows = rows

            async def to_list(self, n=None):
                out = self._rows if n is None else self._rows[:n]
                return [dict(r) for r in out]

        return _Cursor()


def _server(sid="pms_ok", active=True):
    return {
        "_id": sid,
        "smtp_host": "smtp.example",
        "smtp_port": 587,
        "smtp_user": "smtp@example",
        "is_active": active,
    }


def _box(bid, email, purposes, created, *, server="pms_ok", is_default=False, is_active=True, password="secret"):
    return {
        "_id": bid,
        "email": email,
        "display_name": email,
        "server_id": server,
        "purposes": list(purposes),
        "is_default": is_default,
        "is_active": is_active,
        "created_at": created,
        "password_enc": password,
    }


def _use(boxes, servers):
    prev = platform_mail._db
    db = type("DB", (), {})()
    db.platform_mailboxes = _Col(boxes)
    db.platform_mail_servers = _Col(servers)
    platform_mail.init(db)
    return prev


def _restore(prev):
    platform_mail._db = prev


def test_billing_purpose_beats_default_notification():
    boxes = [
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
        _box("pmb_bill", "fatura@tamkobi.com", ["billing"], "2024-06-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "fatura@tamkobi.com"
    assert account["email"] != "bildirim@tamkobi.com"


def test_no_purpose_match_uses_default():
    boxes = [
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
        _box("pmb_info", "info@tamkobi.com", ["general"], "2019-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "bildirim@tamkobi.com"


def test_without_default_uses_transactional_not_older_box():
    boxes = [
        _box("pmb_old", "info@tamkobi.com", ["general"], "2018-01-01T00:00:00+00:00"),
        _box("pmb_tx", "bildirim@tamkobi.com", ["transactional"], "2021-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "bildirim@tamkobi.com"


def test_passive_match_server_falls_through_to_next_candidate():
    boxes = [
        _box("pmb_bill", "fatura@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00", server="pms_down"),
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
    ]
    prev = _use(boxes, [_server("pms_down", active=False), _server("pms_ok", active=True)])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "bildirim@tamkobi.com"


def test_missing_match_server_falls_through_to_next_candidate():
    boxes = [
        _box("pmb_bill", "fatura@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00", server="pms_gone"),
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "bildirim@tamkobi.com"


def test_multiple_purpose_matches_prefer_default_then_oldest():
    boxes = [
        _box("pmb_old", "eski@tamkobi.com", ["billing"], "2019-01-01T00:00:00+00:00"),
        _box("pmb_new_default", "yeni@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00", is_default=True),
        _box("pmb_mid", "orta@tamkobi.com", ["billing"], "2022-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "yeni@tamkobi.com"


def test_multiple_purpose_matches_without_default_use_oldest():
    boxes = [
        _box("pmb_new", "yeni@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00"),
        _box("pmb_old", "eski@tamkobi.com", ["billing"], "2019-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "eski@tamkobi.com"


def test_passive_purpose_match_uses_older_sibling_before_default():
    boxes = [
        _box("pmb_new", "yeni@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00", server="pms_down"),
        _box("pmb_old", "eski@tamkobi.com", ["billing"], "2019-01-01T00:00:00+00:00"),
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True, server="pms_ok"),
    ]
    prev = _use(boxes, [_server("pms_down", active=False), _server("pms_ok")])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "eski@tamkobi.com"


def test_no_default_and_no_transactional_uses_oldest_active():
    boxes = [
        _box("pmb_new", "yeni@tamkobi.com", ["general"], "2024-01-01T00:00:00+00:00"),
        _box("pmb_old", "eski@tamkobi.com", ["support"], "2017-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "eski@tamkobi.com"


def test_inactive_billing_box_is_not_selected():
    boxes = [
        _box("pmb_bill", "fatura@tamkobi.com", ["billing"], "2024-01-01T00:00:00+00:00", is_active=False),
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
    ]
    prev = _use(boxes, [_server()])
    try:
        account = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert account["email"] == "bildirim@tamkobi.com"


def test_password_reset_still_prefers_support_box():
    """Şifre sıfırlama seçimi (resolve_password_reset_sender) purpose önceliğinden bağımsız kalır."""
    boxes = [
        _box("pmb_note", "bildirim@tamkobi.com", ["transactional"], "2020-01-01T00:00:00+00:00", is_default=True),
        _box("pmb_bill", "fatura@tamkobi.com", ["billing"], "2024-06-01T00:00:00+00:00"),
        _box("pmb_sup", "destek@tamkobi.com", ["support"], "2023-01-01T00:00:00+00:00"),
    ]
    prev = _use(boxes, [_server()])
    try:
        billing = _run(platform_mail.resolve_smtp_account("billing"))
        sender = _run(platform_mail.resolve_password_reset_sender())
    finally:
        _restore(prev)
    assert billing["email"] == "fatura@tamkobi.com"
    assert sender["email"] == "destek@tamkobi.com"
    assert sender["source"] == "support"
