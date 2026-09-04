"""Iteration 16: bank integration guard, advanced bank matching, auto_match, custom roles, account delete.

RUN SERIALLY: `python -m pytest tests/test_iteration16.py -n 0` (classes share module-level `state`).
AFTER RUNNING: execute `python tests/cleanup_iteration16.py clean` — the suite creates bank
connections and simulated bank_sync transactions that change account/contact/invoice balances.
"""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
base = os.environ.get("REACT_APP_BACKEND_URL") or fe.get("REACT_APP_BACKEND_URL")
if not base:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base.rstrip("/") + "/api"
CID = "comp_nexus_main_01"

state = {}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def get_contact(api, cid_):
    rows = api.get(f"{BASE}/contacts", params={"company_id": CID}).json()
    rows = rows if isinstance(rows, list) else rows.get("contacts", [])
    return next(c for c in rows if c["id"] == cid_)


def get_invoice(api, inv_id):
    rows = api.get(f"{BASE}/invoices", params={"company_id": CID}).json()
    rows = rows if isinstance(rows, list) else rows.get("invoices", [])
    return next(i for i in rows if i["id"] == inv_id)


def accounts(api):
    r = api.get(f"{BASE}/banking/accounts", params={"company_id": CID})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- 1. accounts integration fields ----------
class TestAccountsIntegrationFields:
    def test_accounts_expose_integration_fields(self, api):
        accs = accounts(api)
        assert len(accs) > 0
        for a in accs:
            assert "is_integrated" in a and isinstance(a["is_integrated"], bool)
            assert "integration_provider" in a
            assert "connection_id" in a
            assert "_id" not in a
            if not a["is_integrated"]:
                assert a["integration_provider"] is None and a["connection_id"] is None

    def test_create_connection_marks_account_integrated(self, api):
        free_bank = [a for a in accounts(api) if a.get("type") == "bank" and not a["is_integrated"]]
        assert free_bank, "No non-integrated bank account available for test"
        acc = free_bank[0]
        state["int_acc"] = acc["id"]
        r = api.post(f"{BASE}/banking/connections", json={
            "company_id": CID, "provider": "kuveytturk", "mode": "sandbox",
            "linked_account_id": acc["id"]})
        assert r.status_code == 200, r.text
        conn = r.json()
        assert conn.get("status") == "simulated", conn
        state["conn"] = conn.get("id") or conn.get("_id")
        assert state["conn"]
        after = {a["id"]: a for a in accounts(api)}[acc["id"]]
        assert after["is_integrated"] is True
        assert after["integration_provider"]
        assert after["connection_id"] == state["conn"]


# ---------- 2. manual transaction guard ----------
class TestManualGuard:
    def test_bank_tx_on_integrated_blocked(self, api):
        r = api.post(f"{BASE}/banking/transactions", json={
            "company_id": CID, "account_id": state["int_acc"], "type": "inflow",
            "account_name": "TEST", "category": "TEST_", "amount": 100, "description": "TEST_manual guard", "date": "2026-07-01"})
        assert r.status_code == 400, r.text
        assert "entegrasyonuna" in r.json().get("detail", "")

    def test_bank_tx_on_free_account_allowed(self, api):
        free = [a for a in accounts(api) if not a["is_integrated"]][0]
        r = api.post(f"{BASE}/banking/transactions", json={
            "company_id": CID, "account_id": free["id"], "type": "inflow",
            "account_name": free["account_name"], "category": "TEST_", "amount": 12.5, "description": "TEST_regression tx", "date": "2026-07-01"})
        assert r.status_code == 200, r.text
        tx = r.json()
        assert tx["amount"] == 12.5
        d = api.delete(f"{BASE}/banking/transactions/{tx['id']}")
        assert d.status_code == 200, d.text

    def test_virman_blocked_source_and_target(self, api):
        free = [a for a in accounts(api) if not a["is_integrated"]][0]
        r1 = api.post(f"{BASE}/banking/virman", json={"company_id": CID, "source_account_id": state["int_acc"],
                                                      "target_account_id": free["id"], "amount": 50})
        r2 = api.post(f"{BASE}/banking/virman", json={"company_id": CID, "source_account_id": free["id"],
                                                      "target_account_id": state["int_acc"], "amount": 50})
        assert r1.status_code == 400 and "entegrasyonuna" in r1.json()["detail"], r1.text
        assert r2.status_code == 400 and "entegrasyonuna" in r2.json()["detail"], r2.text

    def test_expense_payment_blocked(self, api):
        c = api.post(f"{BASE}/expenses", json={"company_id": CID, "description": "TEST_guard masraf",
                                               "amount": 100, "vat_rate": 0, "date": "2026-07-01"})
        assert c.status_code == 200, c.text
        eid = c.json()["id"]
        try:
            r = api.post(f"{BASE}/expenses/{eid}/pay", json={"account_id": state["int_acc"], "date": "2026-07-01"})
            assert r.status_code == 400, r.text
            assert "entegrasyonuna" in r.json().get("detail", ""), r.text
            free = [a for a in accounts(api) if not a["is_integrated"]][0]
            ok = api.post(f"{BASE}/expenses/{eid}/pay", json={"account_id": free["id"], "date": "2026-07-01"})
            assert ok.status_code == 200, ok.text
            assert ok.json()["payment_status"] == "paid"
        finally:
            api.delete(f"{BASE}/expenses/{eid}")

    def test_loan_installment_payment_blocked(self, api):
        c = api.post(f"{BASE}/loans", json={"company_id": CID, "name": "TEST_Guard Kredi", "bank": "TEST Bank",
                                            "principal": 1000, "term_months": 1,
                                            "installments": [{"no": 1, "due_date": "2026-08-01", "amount": 500}]})
        assert c.status_code == 200, c.text
        lid = c.json()["id"]
        try:
            r = api.post(f"{BASE}/loans/{lid}/installments/1/pay", json={"account_id": state["int_acc"], "date": "2026-07-01"})
            assert r.status_code == 400, r.text
            assert "entegrasyonuna" in r.json().get("detail", ""), r.text
        finally:
            api.delete(f"{BASE}/loans/{lid}")


# ---------- 3. sync + unmatched ----------
class TestSyncAndUnmatched:
    def test_sync_creates_simulated_txs(self, api):
        r = api.post(f"{BASE}/banking/connections/{state['conn']}/sync", params={"days": 7})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["simulated"] is True
        assert d["inserted"] >= 1, d
        state["inserted"] = d["inserted"]

    def test_unmatched_list(self, api):
        r = api.get(f"{BASE}/banking/transactions/unmatched", params={"company_id": CID})
        assert r.status_code == 200, r.text
        txs = [t for t in r.json() if t["account_id"] == state["int_acc"]]
        assert len(txs) >= 1
        state["txs"] = txs


# ---------- 4. match: cash-box virman ----------
class TestMatchVirman:
    def test_match_to_cash_box_updates_balances(self, api):
        accs = accounts(api)
        cash = next(a for a in accs if a.get("type") == "cash_box" and not a["is_integrated"])
        tx = state["txs"][0]
        before = cash["current_balance"]
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/match",
                     json={"target_account_id": cash["id"], "learn": True})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["match_status"] == "matched"
        assert m["target_account_name"] == cash["account_name"]
        assert m["category"] == "Hesaplar Arası Virman"
        assert m["matched_via"] == "manual"
        after = {a["id"]: a for a in accounts(api)}[cash["id"]]["current_balance"]
        expected = before + (-tx["amount"] if tx["type"] == "inflow" else tx["amount"])
        assert round(after, 2) == round(expected, 2), f"{before} -> {after} expected {expected}"
        counter = [t for t in api.get(f"{BASE}/banking/transactions", params={"company_id": CID, "account_id": cash["id"]}).json()
                   if t.get("related_bank_tx_id") == tx["id"]]
        assert len(counter) == 1, "counter bank_match tx not created"
        assert counter[0]["source"] == "bank_match"
        state["virman_tx"] = tx
        state["cash"] = cash

    def test_rematch_rejected(self, api):
        tx = state["virman_tx"]
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/match", json={"category": "X"})
        assert r.status_code == 400
        assert "zaten eşleştirilmiş" in r.json()["detail"]

    def test_rule_learned_with_target(self, api):
        r = api.get(f"{BASE}/banking/match-rules", params={"company_id": CID})
        assert r.status_code == 200
        rules = [x for x in r.json() if x.get("target_account_id") == state["cash"]["id"]]
        assert rules, "learned rule with target_account_id not found"
        assert rules[0]["target_account_name"] == state["cash"]["account_name"]

    def test_unmatch_reverts_virman(self, api):
        tx = state["virman_tx"]
        cash_before = {a["id"]: a for a in accounts(api)}[state["cash"]["id"]]["current_balance"]
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/unmatch")
        assert r.status_code == 200, r.text
        assert r.json()["match_status"] == "unmatched"
        assert not r.json().get("target_account_id")
        cash_after = {a["id"]: a for a in accounts(api)}[state["cash"]["id"]]["current_balance"]
        delta = -tx["amount"] if tx["type"] == "inflow" else tx["amount"]
        assert round(cash_after, 2) == round(cash_before - delta, 2)
        counter = [t for t in api.get(f"{BASE}/banking/transactions", params={"company_id": CID, "account_id": state["cash"]["id"]}).json()
                   if t.get("related_bank_tx_id") == tx["id"]]
        assert counter == [], "counter tx not deleted on unmatch"

    def test_unmatch_on_unmatched_rejected(self, api):
        r = api.post(f"{BASE}/banking/transactions/{state['virman_tx']['id']}/unmatch")
        assert r.status_code == 400
        assert "eşleştirilmemiş" in r.json()["detail"]

    def test_target_same_account_rejected(self, api):
        tx = state["virman_tx"]
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/match", json={"target_account_id": state["int_acc"]})
        assert r.status_code == 400, r.text
        assert "kendi hesabı" in r.json()["detail"]

    def test_target_integrated_account_rejected(self, api):
        # create second connection on another free bank account
        free = [a for a in accounts(api) if a.get("type") == "bank" and not a["is_integrated"]]
        if not free:
            pytest.skip("no second free bank account")
        r = api.post(f"{BASE}/banking/connections", json={"company_id": CID, "provider": "enpara",
                                                          "mode": "sandbox", "linked_account_id": free[0]["id"]})
        assert r.status_code == 200, r.text
        conn2 = r.json().get("id") or r.json().get("_id")
        state["conn2"] = conn2
        m = api.post(f"{BASE}/banking/transactions/{state['virman_tx']['id']}/match",
                     json={"target_account_id": free[0]["id"]})
        assert m.status_code == 400, m.text
        assert "entegrasyon" in m.json()["detail"]
        api.delete(f"{BASE}/banking/connections/{conn2}")
        state.pop("conn2", None)


# ---------- 5. match: contact + invoice ----------
class TestMatchInvoice:
    def test_match_with_contact_and_invoice(self, api):
        txs = [t for t in api.get(f"{BASE}/banking/transactions/unmatched", params={"company_id": CID}).json()
               if t["account_id"] == state["int_acc"]]
        assert len(txs) >= 1
        invs = api.get(f"{BASE}/invoices", params={"company_id": CID}).json()
        rows = invs if isinstance(invs, list) else invs.get("invoices", [])
        inv = next((i for i in rows if i.get("payment_status") != "paid" and i.get("contact_id") and i.get("status") != "draft"), None)
        assert inv, "no unpaid invoice found"
        tx = txs[0]
        c_before = get_contact(api, inv["contact_id"])["balance"]
        paid_before = inv.get("paid_amount", 0)
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/match",
                     json={"contact_id": inv["contact_id"], "invoice_id": inv["id"], "learn": False})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["related_invoice_number"] == inv["invoice_number"]
        assert m["contact_id"] == inv["contact_id"]
        inv_after = get_invoice(api, inv["id"])
        assert round(inv_after["paid_amount"], 2) == round(paid_before + tx["amount"], 2)
        c_after = get_contact(api, inv["contact_id"])["balance"]
        exp = c_before + (-tx["amount"] if tx["type"] == "inflow" else tx["amount"])
        assert round(c_after, 2) == round(exp, 2)
        state["inv_tx"] = tx
        state["inv"] = inv
        state["paid_before"] = paid_before
        state["c_before"] = c_before

    def test_matched_list_has_matched_via(self, api):
        r = api.get(f"{BASE}/banking/transactions/matched", params={"company_id": CID})
        assert r.status_code == 200, r.text
        rows = [t for t in r.json() if t["id"] == state["inv_tx"]["id"]]
        assert rows, "matched tx not listed"
        assert rows[0]["matched_via"] in ("manual", "rule", "auto", "suggestion")

    def test_unmatch_reverts_invoice_and_contact(self, api):
        r = api.post(f"{BASE}/banking/transactions/{state['inv_tx']['id']}/unmatch")
        assert r.status_code == 200, r.text
        inv_after = get_invoice(api, state["inv"]["id"])
        assert round(inv_after["paid_amount"], 2) == round(state["paid_before"], 2)
        c_after = get_contact(api, state["inv"]["contact_id"])["balance"]
        assert round(c_after, 2) == round(state["c_before"], 2)


# ---------- 6. match: category only ----------
class TestMatchCategory:
    def test_category_only_match(self, api):
        tx = state["inv_tx"]
        r = api.post(f"{BASE}/banking/transactions/{tx['id']}/match", json={"category": "Banka Masrafı", "learn": False})
        assert r.status_code == 200, r.text
        m = r.json()
        assert m["match_status"] == "matched" and m["category"] == "Banka Masrafı"
        u = api.post(f"{BASE}/banking/transactions/{tx['id']}/unmatch")
        assert u.status_code == 200


# ---------- 7. match rules CRUD & auto match ----------
class TestRulesAndAutoMatch:
    def test_create_rule_with_target(self, api):
        cash = next(a for a in accounts(api) if a.get("type") == "cash_box" and not a["is_integrated"])
        r = api.post(f"{BASE}/banking/match-rules", json={"company_id": CID, "pattern": "TESTPATTERN" + uuid.uuid4().hex[:5],
                                                          "target_account_id": cash["id"]})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["target_account_id"] == cash["id"]
        assert d["target_account_name"] == cash["account_name"]
        state["rule_id"] = d.get("id") or d.get("_id")

    def test_auto_match_endpoint(self, api):
        r = api.post(f"{BASE}/banking/transactions/auto-match", params={"company_id": CID})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "matched" in d and "skipped" in d
        assert "otomatik işlendi" in d["message"]
        state["auto_matched"] = d["matched"]

    def test_toggle_auto_match_on_connection(self, api):
        r = api.put(f"{BASE}/banking/connections/{state['conn']}", json={"auto_match": True})
        assert r.status_code == 200, r.text
        assert r.json().get("auto_match") is True
        r2 = api.post(f"{BASE}/banking/connections/{state['conn']}/sync", params={"days": 30})
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert "auto_matched" in d
        if d["inserted"] > 0 and d["auto_matched"] > 0:
            assert "otomatik işlendi" in d["message"]
        r3 = api.put(f"{BASE}/banking/connections/{state['conn']}", json={"auto_match": False})
        assert r3.json().get("auto_match") is False


# ---------- 8. account delete retest ----------
class TestAccountDelete:
    def test_delete_account_with_transactions_rejected(self, api):
        accs = accounts(api)
        with_tx = None
        for a in accs:
            txs = api.get(f"{BASE}/banking/transactions", params={"company_id": CID, "account_id": a["id"]}).json()
            if txs:
                with_tx = a
                break
        assert with_tx
        r = api.delete(f"{BASE}/banking/accounts/{with_tx['id']}")
        assert r.status_code == 400, r.text
        assert "Hareketi olan" in r.json()["detail"]

    def test_delete_empty_account_ok(self, api):
        c = api.post(f"{BASE}/banking/accounts", json={"company_id": CID, "account_name": "TEST_Silinecek Kasa", "bank_name": "TEST Kasa",
                                                       "type": "cash_box", "currency": "TRY", "current_balance": 0})
        assert c.status_code == 200, c.text
        aid = c.json()["id"]
        d = api.delete(f"{BASE}/banking/accounts/{aid}")
        assert d.status_code == 200, d.text
        assert aid not in [a["id"] for a in accounts(api)]

    def test_delete_missing_account_404(self, api):
        r = api.delete(f"{BASE}/banking/accounts/nope-{uuid.uuid4().hex[:6]}")
        assert r.status_code == 404


# ---------- 9. roles ----------
class TestRoles:
    def test_create_role_copy_permissions(self, api):
        rr = api.get(f"{BASE}/roles", params={"company_id": CID})
        assert rr.status_code == 200, rr.text
        data = rr.json()
        assert data["modules"] and data["levels"]
        tmpl = next(r for r in data["roles"] if r["code"] == "sales")
        r = api.post(f"{BASE}/roles", json={"company_id": CID, "name": "TEST_Saha Satış", "permissions": tmpl["permissions"]})
        assert r.status_code == 200, r.text
        role = r.json()
        assert role["name"] == "TEST_Saha Satış"
        assert role["is_system"] is False
        for k, _ in [(m["key"], m["label"]) for m in data["modules"]]:
            assert role["permissions"][k] == tmpl["permissions"].get(k, "none")
        state["role_id"] = role["id"]
        state["modules"] = [m["key"] for m in data["modules"]]

    def test_rename_custom_role(self, api):
        r = api.put(f"{BASE}/roles/{state['role_id']}", json={"name": "TEST_Saha Satış 2"})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "TEST_Saha Satış 2"
        got = next(x for x in api.get(f"{BASE}/roles", params={"company_id": CID}).json()["roles"] if x["id"] == state["role_id"])
        assert got["name"] == "TEST_Saha Satış 2"

    def test_system_role_name_unchanged(self, api):
        roles = api.get(f"{BASE}/roles", params={"company_id": CID}).json()["roles"]
        sysr = next(r for r in roles if r.get("is_system") and r["code"] == "warehouse")
        r = api.put(f"{BASE}/roles/{sysr['id']}", json={"name": "TEST_Değişti"})
        assert r.status_code == 200, r.text
        assert r.json()["name"] == sysr["name"], "system role name should not change"

    def test_set_all_permissions_view(self, api):
        perms = {k: "view" for k in state["modules"]}
        r = api.put(f"{BASE}/roles/{state['role_id']}", json={"permissions": perms})
        assert r.status_code == 200, r.text
        assert all(v == "view" for v in r.json()["permissions"].values())

    def test_admin_permissions_locked(self, api):
        roles = api.get(f"{BASE}/roles", params={"company_id": CID}).json()["roles"]
        adm = next(r for r in roles if r["code"] == "admin")
        r = api.put(f"{BASE}/roles/{adm['id']}", json={"permissions": {k: "none" for k in state["modules"]}})
        assert r.status_code == 400

    def test_delete_custom_role(self, api):
        r = api.delete(f"{BASE}/roles/{state['role_id']}")
        assert r.status_code == 200, r.text
        assert state["role_id"] not in [x["id"] for x in api.get(f"{BASE}/roles", params={"company_id": CID}).json()["roles"]]

    def test_delete_system_role_rejected(self, api):
        roles = api.get(f"{BASE}/roles", params={"company_id": CID}).json()["roles"]
        sysr = next(r for r in roles if r.get("is_system"))
        r = api.delete(f"{BASE}/roles/{sysr['id']}")
        assert r.status_code == 400
        assert "Sistem rolleri" in r.json()["detail"]


# ---------- 10. company location ----------
class TestCompanyLocation:
    def test_geocode_search(self, api):
        r = api.get(f"{BASE}/geocode", params={"q": "Kadıköy İstanbul"})
        if r.status_code == 502:
            pytest.skip("geocode service unreachable from sandbox")
        assert r.status_code == 200, r.text
        res = r.json()
        assert isinstance(res, list) and res
        assert "latitude" in res[0] and "longitude" in res[0]

    def test_set_location_validation(self, api):
        r = api.put(f"{BASE}/companies/{CID}/location", json={"latitude": "abc"})
        assert r.status_code == 400
