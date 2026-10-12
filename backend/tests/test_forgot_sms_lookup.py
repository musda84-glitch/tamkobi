"""Forgot-SMS phone lookup (normalize / phone_norm / employee→user) + neutral body."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from phone_norm import find_user_by_phone, phone_norm_of, phone_update_fields
from password_reset import (
    ERP_FORGOT_SMS_MSG,
    finalize_forgot_sms_result,
    generic_forgot_response,
    PUBLIC_FORGOT_KEYS,
)


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, n):
        return list(self._rows)[:n]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, q):
        for d in self.docs.values():
            if self._match(d, q):
                return dict(d)
        return None

    def find(self, q):
        return _Cursor([dict(d) for d in self.docs.values() if self._match(d, q)])

    async def update_one(self, filt, upd):
        doc = await self.find_one(filt)
        if not doc:
            return MagicMock(modified_count=0)
        _id = doc["_id"]
        if "$set" in upd:
            self.docs[_id].update(upd["$set"])
        return MagicMock(modified_count=1)

    def _match(self, doc, q):
        for k, v in (q or {}).items():
            if k == "$or":
                if not any(self._match(doc, clause) for clause in v):
                    return False
                continue
            if k == "$and":
                if not all(self._match(doc, clause) for clause in v):
                    return False
                continue
            dv = doc.get(k)
            if isinstance(v, dict):
                if "$exists" in v and v["$exists"] and k not in doc:
                    return False
                if "$ne" in v and dv == v["$ne"]:
                    return False
                if "$nin" in v and dv in v["$nin"]:
                    return False
                if "$in" in v and dv not in v["$in"]:
                    return False
            elif dv != v:
                return False
        return True


def test_phone_norm_formats():
    assert phone_norm_of("0530 212 06 84") == "5302120684"
    assert phone_norm_of("+90 530 212 0684") == "5302120684"
    assert phone_norm_of("05302120684") == "5302120684"
    assert phone_norm_of("bad") is None


def test_phone_update_fields_validates():
    assert phone_update_fields("0530 212 06 84")["phone_norm"] == "5302120684"
    assert phone_update_fields("")["phone_norm"] is None
    with pytest.raises(ValueError):
        phone_update_fields("123", allow_empty=False)
    with pytest.raises(ValueError):
        phone_update_fields("12")


def test_find_user_by_spaced_phone_and_plus90():
    user = {
        "_id": "u1",
        "phone": "0530 212 06 84",
        "phone_norm": None,
        "is_active": True,
        "password_hash": "x",
        "email": "a@b.com",
    }
    db = MagicMock()
    db.users = FakeColl([user])
    db.employees = FakeColl([])

    async def _run():
        found1 = await find_user_by_phone(db, "05302120684")
        found2 = await find_user_by_phone(db, "+90 530 212 0684")
        found3 = await find_user_by_phone(db, "0530 212 06 84")
        return found1, found2, found3

    a, b, c = asyncio.run(_run())
    assert a and a["_id"] == "u1"
    assert b and b["_id"] == "u1"
    assert c and c["_id"] == "u1"
    # healed
    assert db.users.docs["u1"].get("phone_norm") == "5302120684"


def test_find_user_via_employee_phone():
    user = {
        "_id": "u2",
        "phone": "",
        "is_active": True,
        "password_hash": "x",
        "email": "emp@b.com",
    }
    emp = {
        "_id": "e1",
        "phone": "+90 530 212 0684",
        "user_id": "u2",
    }
    db = MagicMock()
    db.users = FakeColl([user])
    db.employees = FakeColl([emp])

    found = asyncio.run(find_user_by_phone(db, "0530 212 06 84"))
    assert found and found["_id"] == "u2"


def test_forgot_sms_public_body_identical_keys():
    """Bulunan / bulunamayan için istemci gövdesi aynı anahtarlar (sızıntı yok)."""
    unknown = generic_forgot_response("sms")
    known = finalize_forgot_sms_result(
        {"status": "ok", "message": ERP_FORGOT_SMS_MSG, "reset_token": "secret", "reset_url": "https://x"},
        sms_status="sent",
        sms_detail="•••0684",
    )
    failed = finalize_forgot_sms_result(
        {"status": "ok", "message": ERP_FORGOT_SMS_MSG},
        sms_status="failed",
        sms_detail="netgsm 30",
    )
    assert unknown == known == failed
    assert set(unknown.keys()) == set(PUBLIC_FORGOT_KEYS)
    assert "sms_status" not in known
    assert "detail" not in known
    assert "reset_token" not in known
    assert known["message"] == ERP_FORGOT_SMS_MSG
