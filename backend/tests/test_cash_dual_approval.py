"""Dual approval for non-integrated cash/bank operations (company policy)."""
import uuid

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
CID = TEST_COMPANY_ID


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _ensure_user(admin, email, password, role, name):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    if r.status_code == 200:
        return _login(email, password)
    inv = admin.post(
        f"{API}/users/invite",
        json={"company_id": CID, "email": email, "name": name, "role": role, "base_url": "http://127.0.0.1"},
        timeout=20,
    )
    if inv.status_code != 200:
        users = admin.get(f"{API}/users", params={"company_id": CID}, timeout=20).json().get("users") or []
        u = next((x for x in users if x.get("email") == email), None)
        assert u, inv.text
        pw = admin.put(f"{API}/users/{u['id']}", json={"password": password}, timeout=20)
        assert pw.status_code == 200, pw.text
        return _login(email, password)
    token = inv.json()["id"]
    s = requests.Session()
    acc = s.post(f"{API}/public/invites/{token}/accept", json={"password": password, "name": name}, timeout=20)
    assert acc.status_code == 200, acc.text
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def accountant(admin):
    return _ensure_user(admin, f"dual_acc_{uuid.uuid4().hex[:8]}@nexus.test", "dualpass1", "accountant", "Dual Onayci")


@pytest.fixture(scope="module")
def warehouse(admin):
    return _ensure_user(admin, f"dual_wh_{uuid.uuid4().hex[:8]}@nexus.test", "dualpass1", "warehouse", "Dual Depo")


@pytest.fixture
def policy_on(admin):
    r = admin.put(f"{API}/roles/policies", json={"company_id": CID, "cash_dual_approval": True}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["policies"]["cash_dual_approval"] is True
    yield True
    admin.put(f"{API}/roles/policies", json={"company_id": CID, "cash_dual_approval": False}, timeout=20)


def test_policy_default_off_and_toggle(admin):
    r = admin.get(f"{API}/roles", params={"company_id": CID}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "policies" in d
    assert d["policies"]["cash_dual_approval"] in (True, False)
    feats = d.get("features")
    assert isinstance(feats, list) and len(feats) == 5
    off = admin.put(f"{API}/roles/policies", json={"company_id": CID, "cash_dual_approval": False}, timeout=20)
    assert off.status_code == 200
    assert off.json()["policies"]["cash_dual_approval"] is False
    listed = admin.get(f"{API}/roles", params={"company_id": CID}, timeout=20).json()
    assert listed["policies"]["cash_dual_approval"] is False


def test_flag_off_distribute_still_immediate(admin):
    admin.put(f"{API}/roles/policies", json={"company_id": CID, "cash_dual_approval": False}, timeout=20)
    accs = admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json()
    acc = max((a for a in accs if not a.get("is_integrated")), key=lambda a: a.get("current_balance", 0))
    r = admin.post(
        f"{API}/banking/partners/distribute-profit",
        json={"company_id": CID, "total_profit": 20, "pay_now": True, "account_id": acc["id"]},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "success"
    assert r.json().get("pay_now") is True


def test_pay_now_queues_requester_cannot_approve(admin, accountant, warehouse, policy_on):
    accs = admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json()
    acc = next(a for a in accs if a["id"] == "bank_03")
    before = acc["current_balance"]
    r = admin.post(
        f"{API}/banking/partners/distribute-profit",
        json={"company_id": CID, "total_profit": 30, "pay_now": True, "account_id": "bank_03", "period": "2026-09"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "pending_approval", d
    rid = d["request_id"]
    after = next(a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if a["id"] == "bank_03")
    assert round(after["current_balance"] - before, 2) == 0

    mine = admin.get(f"{API}/banking/cash-approvals", params={"company_id": CID, "status": "pending"}, timeout=20)
    assert mine.status_code == 200, mine.text
    row = next(x for x in mine.json() if x["id"] == rid)
    assert row["can_approve"] is False
    assert row["kind"] == "distribute_profit"

    self_ok = admin.post(f"{API}/banking/cash-approvals/{rid}/approve", timeout=20)
    assert self_ok.status_code == 400, self_ok.text

    pending = accountant.get(f"{API}/banking/cash-approvals", params={"company_id": CID, "status": "pending"}, timeout=20).json()
    acc_row = next(x for x in pending if x["id"] == rid)
    assert acc_row["can_approve"] is True

    blocked = warehouse.post(f"{API}/banking/cash-approvals/{rid}/approve", timeout=20)
    assert blocked.status_code == 403, blocked.text

    ok = accountant.post(f"{API}/banking/cash-approvals/{rid}/approve", timeout=20)
    assert ok.status_code == 200, ok.text
    acc_after = next(a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if a["id"] == "bank_03")
    assert round(before - acc_after["current_balance"], 2) == 30


def test_accrual_skips_approval(admin, policy_on):
    r = admin.post(
        f"{API}/banking/partners/distribute-profit",
        json={"company_id": CID, "total_profit": 10, "pay_now": False},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("status") == "success"
    assert r.json().get("pay_now") is False


def test_partner_tx_reject_does_not_move_money(admin, accountant, policy_on):
    partner = admin.get(f"{API}/banking/partners", params={"company_id": CID}, timeout=20).json()[0]
    acc = next(a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if a["id"] == "bank_03")
    before = acc["current_balance"]
    r = admin.post(
        f"{API}/banking/partners/transactions",
        json={"partner_id": partner["id"], "type": "capital_in", "amount": 75, "account_id": "bank_03", "description": "dual-approval-test"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending_approval"
    rid = r.json()["request_id"]
    rej = accountant.post(f"{API}/banking/cash-approvals/{rid}/reject", timeout=20)
    assert rej.status_code == 200, rej.text
    acc_after = next(a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if a["id"] == "bank_03")
    assert round(acc_after["current_balance"] - before, 2) == 0


def test_virman_queues_then_approves(admin, accountant, policy_on):
    accs = [a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if not a.get("is_integrated")]
    src, dst = accs[0], accs[1]
    src_before, dst_before = src["current_balance"], dst["current_balance"]
    r = admin.post(
        f"{API}/banking/virman",
        json={"company_id": CID, "source_account_id": src["id"], "target_account_id": dst["id"], "amount": 12, "description": "dual-approval-virman"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending_approval"
    rid = r.json()["request_id"]
    mid_src = next(a for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json() if a["id"] == src["id"])
    assert round(mid_src["current_balance"] - src_before, 2) == 0
    ok = accountant.post(f"{API}/banking/cash-approvals/{rid}/approve", timeout=20)
    assert ok.status_code == 200, ok.text
    after = {a["id"]: a["current_balance"] for a in admin.get(f"{API}/banking/accounts", params={"company_id": CID}, timeout=20).json()}
    assert round(src_before - after[src["id"]], 2) == 12
    assert round(after[dst["id"]] - dst_before, 2) == 12
