"""Personel kartı Sistem Kullanıcısı ↔ Firma Ayarları kullanıcı/rol senkronu."""
import asyncio
import inspect
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import DEFAULT_ROLES  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def test_default_roles_cover_user_tab_labels():
    names = {r["name"] for r in DEFAULT_ROLES}
    for expected in ("Personel", "Mali Müşavir", "Üretim", "Depo", "Satış", "Muhasebe", "Yönetici"):
        assert expected in names


def test_personnel_role_options_route_registered():
    import server

    paths = [getattr(r, "path", "") or "" for r in server.api_router.routes]
    assert any(p.endswith("/personnel/role-options") for p in paths)
    assert any(p.endswith("/create-user") for p in paths)


def test_list_users_enriches_employee_name_and_role_name():
    import rbac

    fake_roles = [{"code": "sales", "name": "Satış"}, {"code": "warehouse", "name": "Depo"}]
    fake_users = [
        {"_id": "u1", "email": "a@t.com", "name": "Ali", "role": "sales", "employee_id": "e1", "is_active": True},
        {"_id": "u2", "email": "b@t.com", "name": "Ayşe", "role": "warehouse", "is_active": True},
    ]
    fake_invites = [
        {"_id": "inv1", "email": "c@t.com", "role": "sales", "employee_id": "e2", "accepted_at": None},
    ]
    fake_emps = [
        {"_id": "e1", "full_name": "Ali Veli"},
        {"_id": "e2", "full_name": "Can Demir"},
    ]

    class _Cursor:
        def __init__(self, rows):
            self._rows = rows

        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            return list(self._rows)

        def __aiter__(self):
            self._i = 0
            return self

        async def __anext__(self):
            if self._i >= len(self._rows):
                raise StopAsyncIteration
            row = self._rows[self._i]
            self._i += 1
            return row

    db = MagicMock()
    db.roles.find = MagicMock(return_value=_Cursor(fake_roles))
    db.users.find = MagicMock(return_value=_Cursor(fake_users))
    db.user_invites.find = MagicMock(return_value=_Cursor(fake_invites))
    db.employees.find = MagicMock(return_value=_Cursor(fake_emps))

    with patch.object(rbac, "_db", db), patch.object(rbac, "ensure_roles", new=AsyncMock()), \
         patch("user_numbers.ensure_user_number", new=AsyncMock()):
        out = _run(rbac.list_users("comp_x"))

    by_email = {u["email"]: u for u in out["users"]}
    assert by_email["a@t.com"]["role_name"] == "Satış"
    assert by_email["a@t.com"]["employee_name"] == "Ali Veli"
    assert by_email["b@t.com"]["employee_name"] == ""
    assert by_email["b@t.com"]["role_name"] == "Depo"
    inv = out["invites"][0]
    assert inv["role_name"] == "Satış"
    assert inv["employee_name"] == "Can Demir"


def test_employee_card_user_payload_includes_role_name():
    import server

    src = inspect.getsource(server.employee_card)
    assert "role_name" in src
    assert "role_names" in src
