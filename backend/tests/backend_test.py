"""Iteration 2 backend regression tests for TamKobi.

Covers: products (images/variants/barcode/stock adjust), partners account,
bank live-data connections + matching rules, comm SMS (simulated), comm mail
(graceful IMAP failure), contact location fields.
"""
import io
import os
import struct
import zlib

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


def tiny_png() -> bytes:
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    return sess


# ---------------- PRODUCTS ----------------
class TestProducts:
    def test_list_products_have_ids(self, s):
        r = s.get(f"{BASE}/products", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) > 0
        missing = [p.get("name") for p in data if not p.get("id")]
        assert not missing, f"products missing id: {missing}"

    def test_barcode_variant_lookup(self, s):
        r = s.get(f"{BASE}/products/barcode/8680001234013", timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["id"] == "prod_01", d.get("id")
        mv = d.get("matched_variant")
        assert mv and mv.get("variant_id") == "v2", mv

    def test_barcode_not_found(self, s):
        r = s.get(f"{BASE}/products/barcode/0000000000000", timeout=30)
        assert r.status_code == 404

    def test_image_upload_and_serve(self, s):
        png = tiny_png()
        r = s.post(f"{BASE}/products/prod_01/image",
                   files={"file": ("TEST_img.png", io.BytesIO(png), "image/png")}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        url = d["image_url"]
        assert url.startswith("/api/files/"), url
        assert url in d["product"].get("images", [])
        g = s.get(base_url.rstrip("/") + url, timeout=60)
        assert g.status_code == 200, g.text[:300]
        assert g.headers.get("content-type", "").startswith("image/png")
        assert g.content == png

    def test_image_wrong_content_type(self, s):
        r = s.post(f"{BASE}/products/prod_01/image",
                   files={"file": ("TEST_bad.txt", io.BytesIO(b"hello"), "text/plain")}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_update_cover_images(self, s):
        cur = s.get(f"{BASE}/products/prod_01", timeout=30).json()
        imgs = cur.get("images") or []
        if not imgs:
            pytest.skip("no images available")
        r = s.put(f"{BASE}/products/prod_01/images", json={"images": imgs, "image_url": imgs[-1]}, timeout=30)
        assert r.status_code == 200
        assert r.json()["image_url"] == imgs[-1]
        g = s.get(f"{BASE}/products/prod_01", timeout=30).json()
        assert g["image_url"] == imgs[-1]

    def test_variants_autofill_and_stock_sum(self, s):
        body = {
            "variant_options": [{"name": "Renk", "values": ["Siyah", "Beyaz"]}],
            "variants": [
                {"variant_id": "a1", "name": "Siyah", "sku": "", "barcode": "", "stock": 5, "price": 100,
                 "attributes": {"Renk": "Siyah"}},
                {"variant_id": "a2", "name": "Beyaz", "sku": "", "barcode": "", "stock": 7, "price": 110,
                 "attributes": {"Renk": "Beyaz"}},
            ],
        }
        r = s.put(f"{BASE}/products/prod_02/variants", json=body, timeout=30)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["has_variants"] is True
        assert len(d["variants"]) == 2
        for v in d["variants"]:
            assert v["sku"], "sku not autofilled"
            assert v["barcode"], "barcode not autofilled"
        assert d["stock_quantity"] == 12, d["stock_quantity"]
        assert d["variant_options"][0]["name"] == "Renk"
        # persistence
        g = s.get(f"{BASE}/products/prod_02", timeout=30).json()
        assert g["stock_quantity"] == 12

    def test_variants_duplicate_sku_400(self, s):
        body = {"variant_options": [], "variants": [
            {"variant_id": "d1", "name": "A", "sku": "DUP-1", "stock": 1, "price": 1},
            {"variant_id": "d2", "name": "B", "sku": "DUP-1", "stock": 1, "price": 1}]}
        r = s.put(f"{BASE}/products/prod_02/variants", json=body, timeout=30)
        assert r.status_code == 400, r.status_code

    def test_quick_stock_adjust_variant(self, s):
        before = s.get(f"{BASE}/products/prod_02", timeout=30).json()
        v = before["variants"][0]
        r = s.post(f"{BASE}/products/quick-stock-adjust",
                   json={"product_id": "prod_02", "variant_id": v["variant_id"], "quantity_change": 3}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["new_variant_stock"] == v["stock"] + 3
        assert d["new_stock"] == before["stock_quantity"] + 3
        after = s.get(f"{BASE}/products/prod_02", timeout=30).json()
        assert after["stock_quantity"] == before["stock_quantity"] + 3

    def test_quick_stock_adjust_bad_variant(self, s):
        r = s.post(f"{BASE}/products/quick-stock-adjust",
                   json={"product_id": "prod_02", "variant_id": "nope", "quantity_change": 1}, timeout=30)
        assert r.status_code == 404


# ---------------- PARTNERS ----------------
class TestPartners:
    def test_list_partners_seeded(self, s):
        r = s.get(f"{BASE}/banking/partners", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d) >= 2
        shares = sorted(p["share_percent"] for p in d)
        assert shares == [40, 60], shares
        assert all(p.get("id") for p in d)

    def test_partners_summary(self, s):
        r = s.get(f"{BASE}/banking/partners/summary", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["partner_count"] >= 2
        assert d["total_share_percent"] == 100

    def test_create_partner_over_100(self, s):
        r = s.post(f"{BASE}/banking/partners",
                   json={"company_id": COMPANY, "name": "TEST_Ortak", "share_percent": 50}, timeout=30)
        assert r.status_code == 400, r.status_code

    def test_capital_in_updates_balances(self, s):
        partner = s.get(f"{BASE}/banking/partners", timeout=30).json()[0]
        acc_before = next(a for a in s.get(f"{BASE}/banking/accounts", timeout=30).json() if a["id"] == "bank_03")
        r = s.post(f"{BASE}/banking/partners/transactions",
                   json={"partner_id": partner["id"], "type": "capital_in", "amount": 1000,
                         "account_id": "bank_03", "description": "TEST_capital"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        tx = r.json()
        assert tx["type"] == "capital_in" and tx["amount"] == 1000
        p_after = next(p for p in s.get(f"{BASE}/banking/partners", timeout=30).json() if p["id"] == partner["id"])
        assert round(p_after["balance"] - partner["balance"], 2) == 1000
        acc_after = next(a for a in s.get(f"{BASE}/banking/accounts", timeout=30).json() if a["id"] == "bank_03")
        assert round(acc_after["current_balance"] - acc_before["current_balance"], 2) == 1000
        txs = s.get(f"{BASE}/banking/transactions", timeout=30).json()
        assert any(t.get("source") == "partner" and t.get("category") == "Ortak Sermaye Girişi" for t in txs)

    def test_withdrawal(self, s):
        partner = s.get(f"{BASE}/banking/partners", timeout=30).json()[0]
        r = s.post(f"{BASE}/banking/partners/transactions",
                   json={"partner_id": partner["id"], "type": "withdrawal", "amount": 250,
                         "account_id": "bank_03"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        p_after = next(p for p in s.get(f"{BASE}/banking/partners", timeout=30).json() if p["id"] == partner["id"])
        assert round(partner["balance"] - p_after["balance"], 2) == 250

    def test_invalid_partner_tx_type(self, s):
        partner = s.get(f"{BASE}/banking/partners", timeout=30).json()[0]
        r = s.post(f"{BASE}/banking/partners/transactions",
                   json={"partner_id": partner["id"], "type": "bogus", "amount": 10, "account_id": "bank_03"}, timeout=30)
        assert r.status_code == 400

    def test_distribute_profit_accrual(self, s):
        before = {p["id"]: p["balance"] for p in s.get(f"{BASE}/banking/partners", timeout=30).json()}
        r = s.post(f"{BASE}/banking/partners/distribute-profit",
                   json={"company_id": COMPANY, "total_profit": 10000, "pay_now": False}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        amounts = sorted(x["amount"] for x in d["distribution"])
        assert amounts == [4000.0, 6000.0], amounts
        after = {p["id"]: p["balance"] for p in s.get(f"{BASE}/banking/partners", timeout=30).json()}
        for pid, bal in before.items():
            assert round(after[pid] - bal, 2) in (4000.0, 6000.0)

    def test_distribute_profit_pay_now(self, s):
        accs = s.get(f"{BASE}/banking/accounts", timeout=30).json()
        acc = max(accs, key=lambda a: a.get("current_balance", 0))
        r = s.post(f"{BASE}/banking/partners/distribute-profit",
                   json={"company_id": COMPANY, "total_profit": 10000, "pay_now": True, "account_id": acc["id"]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["pay_now"] is True and len(d["distribution"]) >= 2
        acc_after = next(a for a in s.get(f"{BASE}/banking/accounts", timeout=30).json() if a["id"] == acc["id"])
        assert round(acc["current_balance"] - acc_after["current_balance"], 2) == 10000

    def test_delete_partner_with_balance_400(self, s):
        partner = next(p for p in s.get(f"{BASE}/banking/partners", timeout=30).json() if abs(p["balance"]) > 0.01)
        r = s.delete(f"{BASE}/banking/partners/{partner['id']}", timeout=30)
        assert r.status_code == 400, r.status_code

    def test_create_and_delete_zero_balance_partner(self, s):
        r = s.post(f"{BASE}/banking/partners",
                   json={"company_id": COMPANY, "name": "TEST_Sifir", "share_percent": 0}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        pid = r.json()["id"]
        d = s.delete(f"{BASE}/banking/partners/{pid}", timeout=30)
        assert d.status_code == 200
        assert not any(p["id"] == pid for p in s.get(f"{BASE}/banking/partners", timeout=30).json())


# ---------------- BANK CONNECTIONS ----------------
class TestBankConnections:
    conn_id = None

    def test_providers(self, s):
        r = s.get(f"{BASE}/banking/providers", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d) == 4, len(d)
        codes = {p["code"] for p in d}
        assert {"kuveytturk", "enpara", "finfree"} <= codes, codes
        assert "qnb" in codes
        assert any(p["code"] == "enpara" and "api.enpara.com" in (p.get("live_url") or "") for p in r.json())

    def test_create_connection_simulated(self, s):
        r = s.post(f"{BASE}/banking/connections",
                   json={"company_id": COMPANY, "provider": "kuveytturk", "provider_name": "",
                         "linked_account_id": "bank_01"}, timeout=60)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["status"] == "simulated", d["status"]
        assert d["test_result"].get("simulated") is True
        assert d["provider_name"]
        TestBankConnections.conn_id = d["id"]

    def test_create_connection_bad_provider(self, s):
        r = s.post(f"{BASE}/banking/connections",
                   json={"company_id": COMPANY, "provider": "nope", "provider_name": "",
                         "linked_account_id": "bank_01"}, timeout=30)
        assert r.status_code == 400

    def test_create_connection_bad_account(self, s):
        r = s.post(f"{BASE}/banking/connections",
                   json={"company_id": COMPANY, "provider": "kuveytturk", "provider_name": "",
                         "linked_account_id": "nope"}, timeout=30)
        assert r.status_code == 404

    def test_test_endpoint(self, s):
        r = s.post(f"{BASE}/banking/connections/{TestBankConnections.conn_id}/test", timeout=60)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "simulated"

    def test_sync_inserts_then_skips(self, s):
        r1 = s.post(f"{BASE}/banking/connections/{TestBankConnections.conn_id}/sync", timeout=90)
        assert r1.status_code == 200, r1.text[:400]
        d1 = r1.json()
        assert d1["simulated"] is True
        assert d1["inserted"] > 0, d1
        r2 = s.post(f"{BASE}/banking/connections/{TestBankConnections.conn_id}/sync", timeout=90)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["skipped"] >= d1["inserted"], d2

    def test_unmatched_list_flags(self, s):
        r = s.get(f"{BASE}/banking/transactions/unmatched", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d) > 0
        for t in d:
            assert t["source"] == "bank_sync"
            assert t["match_status"] == "unmatched"
            assert t.get("id")
        assert any(t.get("is_simulated") for t in d)

    def test_secrets_masked(self, s):
        s.put(f"{BASE}/banking/connections/{TestBankConnections.conn_id}",
              json={"client_id": "enparaClientId99", "client_secret": "supersecret1234",
                    "access_token": "liveAccessTok", "refresh_token": "liveRefreshTok"}, timeout=30)
        conns = s.get(f"{BASE}/banking/connections", timeout=30).json()
        c = next(x for x in conns if x["id"] == TestBankConnections.conn_id)
        assert c["client_secret"].startswith("••••"), c["client_secret"]
        assert "supersecret" not in c["client_secret"]
        assert c["client_id"].startswith("••••"), c["client_id"]
        assert "enparaClientId99" not in c["client_id"]
        assert c["access_token"].startswith("••••"), c["access_token"]
        assert "liveAccessTok" not in c["access_token"]
        assert c["refresh_token"].startswith("••••"), c["refresh_token"]
        assert "liveRefreshTok" not in c["refresh_token"]

    def test_match_transaction_and_learn_rule(self, s):
        tx = s.get(f"{BASE}/banking/transactions/unmatched", timeout=30).json()[0]
        contact = s.get(f"{BASE}/contacts", timeout=30).json()[0]
        r = s.post(f"{BASE}/banking/transactions/{tx['id']}/match",
                   json={"contact_id": contact["id"]}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["match_status"] == "matched"
        assert d["contact_id"] == contact["id"]
        c_after = next(c for c in s.get(f"{BASE}/contacts", timeout=30).json() if c["id"] == contact["id"])
        delta = -tx["amount"] if tx["type"] == "inflow" else tx["amount"]
        assert round(c_after["balance"] - contact["balance"], 2) == round(delta, 2)
        rules = s.get(f"{BASE}/banking/match-rules", timeout=30).json()
        assert any(r_["contact_id"] == contact["id"] for r_ in rules), rules
        # re-match should fail
        r2 = s.post(f"{BASE}/banking/transactions/{tx['id']}/match", json={"contact_id": contact["id"]}, timeout=30)
        assert r2.status_code == 400, r2.status_code

    def test_manual_rule_and_auto_match(self, s):
        unmatched = s.get(f"{BASE}/banking/transactions/unmatched", timeout=30).json()
        if not unmatched:
            pytest.skip("no unmatched tx")
        target = unmatched[0]
        words = [w for w in (target["description"] or "").split() if len(w) > 3][:2]
        pattern = " ".join(words)
        # remove pre-existing identical rule (re-creating one currently 500s, see test below)
        for ex in s.get(f"{BASE}/banking/match-rules", timeout=30).json():
            if ex["pattern"] == pattern.lower():
                s.delete(f"{BASE}/banking/match-rules/{ex['id']}", timeout=30)
        r = s.post(f"{BASE}/banking/match-rules",
                   json={"company_id": COMPANY, "pattern": pattern, "category": "TEST_Kategori"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        rule_id = r.json()["id"]
        am = s.post(f"{BASE}/banking/transactions/auto-match", timeout=60)
        assert am.status_code == 200, am.text[:300]
        d = am.json()
        assert d["matched"] >= 1, d
        still = s.get(f"{BASE}/banking/transactions/unmatched", timeout=30).json()
        assert not any(t["id"] == target["id"] for t in still)
        dl = s.delete(f"{BASE}/banking/match-rules/{rule_id}", timeout=30)
        assert dl.status_code == 200
        assert not any(x["id"] == rule_id for x in s.get(f"{BASE}/banking/match-rules", timeout=30).json())

    def test_create_duplicate_rule_pattern(self, s):
        body = {"company_id": COMPANY, "pattern": "TEST_dupe pattern", "category": "TEST_Kat"}
        r1 = s.post(f"{BASE}/banking/match-rules", json=body, timeout=30)
        assert r1.status_code == 200, r1.text[:300]
        r2 = s.post(f"{BASE}/banking/match-rules", json=body, timeout=30)
        s.delete(f"{BASE}/banking/match-rules/{r1.json()['id']}", timeout=30)
        assert r2.status_code == 200, f"duplicate pattern upsert failed: {r2.status_code} {r2.text[:200]}"

    def test_empty_rule_pattern_400(self, s):
        r = s.post(f"{BASE}/banking/match-rules", json={"company_id": COMPANY, "pattern": "  "}, timeout=30)
        assert r.status_code == 400

    def test_sync_all(self, s):
        r = s.post(f"{BASE}/banking/sync-all", timeout=120)
        assert r.status_code == 200, r.text[:300]
        assert "results" in r.json()

    def test_zz_delete_connection(self, s):
        r = s.delete(f"{BASE}/banking/connections/{TestBankConnections.conn_id}", timeout=30)
        assert r.status_code == 200
        assert not any(c["id"] == TestBankConnections.conn_id
                       for c in s.get(f"{BASE}/banking/connections", timeout=30).json())


# ---------------- COMM SMS ----------------
class TestNetgsmPayload:
    """Netgsm REST v2 gövde — canlı API yok; kod 70’ü tetikleyen alanları engelle."""

    def test_minimal_payload_omits_iys_and_appname(self):
        from comm_service import build_netgsm_send_payload
        payload, err = build_netgsm_send_payload(
            {"msgheader": "TAMKOBI"},
            [{"no": "0532 111 22 33", "msg": "Merhaba"}],
        )
        assert err is None, err
        assert payload["msgheader"] == "TAMKOBI"
        assert payload["encoding"] == "TR"
        assert payload["messages"] == [{"msg": "Merhaba", "no": "5321112233"}]
        assert "iysfilter" not in payload
        assert "appname" not in payload

    def test_payload_rejects_empty_message(self):
        from comm_service import build_netgsm_send_payload
        payload, err = build_netgsm_send_payload(
            {"msgheader": "TAMKOBI"},
            [{"no": "5321112233", "msg": "  "}],
        )
        assert payload is None
        assert err

    def test_payload_optional_iysfilter(self):
        from comm_service import build_netgsm_send_payload
        payload, err = build_netgsm_send_payload(
            {"msgheader": "TAMKOBI", "iysfilter": "0"},
            [{"no": "5321112233", "msg": "x"}],
        )
        assert err is None
        assert payload["iysfilter"] == "0"

    def test_balance_payload_uses_body_auth(self):
        from comm_service import build_netgsm_balance_payload
        body = build_netgsm_balance_payload({"usercode": "8503090297", "password": "secret"}, stip=3)
        assert body == {"usercode": "8503090297", "password": "secret", "stip": 3}
        assert "auth" not in body


class TestCommSms:
    def test_providers_list(self, s):
        r = s.get(f"{BASE}/comm/sms/providers", timeout=30)
        assert r.status_code == 200, r.text[:300]
        ids = {p["id"] for p in r.json()}
        assert {"netgsm", "iletimerkezi", "verimor"} <= ids

    def test_settings_roundtrip_no_password_leak(self, s):
        r = s.put(f"{BASE}/comm/sms/settings",
                  json={"company_id": COMPANY, "provider": "netgsm", "usercode": "TEST8503", "msgheader": "TAMKOBI", "is_active": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["usercode"] == "TEST8503"
        assert d.get("provider") == "netgsm"
        assert d.get("provider_name") == "Netgsm"
        assert "password" not in d and "password_enc" not in d
        assert d["has_password"] is False
        assert d.get("verified") is False
        g = s.get(f"{BASE}/comm/sms/settings", timeout=30).json()
        assert g["msgheader"] == "TAMKOBI"
        assert "password" not in g
        assert len(g.get("providers") or []) >= 3

    def test_settings_provider_iletimerkezi(self, s):
        r = s.put(f"{BASE}/comm/sms/settings",
                  json={"company_id": COMPANY, "provider": "iletimerkezi", "usercode": "KEY123", "msgheader": "TAMKOBI", "is_active": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["provider"] == "iletimerkezi"
        assert d["provider_name"] == "İleti Merkezi"

    def test_settings_normalizes_msgheader_spaces(self, s):
        r = s.put(f"{BASE}/comm/sms/settings",
                  json={"company_id": COMPANY, "usercode": "TEST8503", "msgheader": "  TAMKOBI  ", "is_active": True}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        assert r.json()["msgheader"] == "TAMKOBI"

    def test_settings_rejects_long_msgheader(self, s):
        r = s.put(f"{BASE}/comm/sms/settings",
                  json={"company_id": COMPANY, "usercode": "TEST8503", "msgheader": "COKUZUNBASLIKX", "is_active": True}, timeout=30)
        assert r.status_code == 400, r.text[:300]

    def test_balance_simulated(self, s):
        r = s.get(f"{BASE}/comm/sms/balance", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["simulated"] is True
        assert "SİMÜLE" in d["message"]

    def test_send_simulated(self, s):
        r = s.post(f"{BASE}/comm/sms/send",
                   json={"company_id": COMPANY, "phone": "0532 111 22 33", "message": "TEST_mesaj"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["simulated"] is True
        assert d["status"] == "success"
        assert d["sent"] == 1 and d["failed"] == 0
        logs = s.get(f"{BASE}/comm/sms/logs", timeout=30).json()
        assert logs[0]["status"] == "simulated"
        assert logs[0]["to"] == "5321112233", logs[0]["to"]

    def test_send_invalid_phone(self, s):
        r = s.post(f"{BASE}/comm/sms/send", json={"phone": "123", "message": "TEST_bad"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["failed"] == 1 and d["sent"] == 0, d

    def test_send_empty_message_400(self, s):
        r = s.post(f"{BASE}/comm/sms/send", json={"phone": "05321112233", "message": "  "}, timeout=30)
        assert r.status_code == 400

    def test_send_no_recipient_400(self, s):
        r = s.post(f"{BASE}/comm/sms/send", json={"message": "TEST"}, timeout=30)
        assert r.status_code == 400

    def test_seeded_contacts_have_mobile_numbers(self, s):
        """Quick-message / campaign SMS only works with 5xx GSM numbers."""
        contacts = s.get(f"{BASE}/contacts", timeout=30).json()
        seeded = [c for c in contacts if str(c["id"]).startswith("cnt_")]
        bad = [(c["name"], c.get("phone")) for c in seeded
               if not str(c.get("phone") or "").replace(" ", "").lstrip("0").startswith("5")]
        assert not bad, f"seeded contacts have non-GSM phones, SMS always fails: {bad}"

    def test_campaign_personalizes(self, s):
        c = s.post(f"{BASE}/contacts", json={"company_id": COMPANY, "name": "TEST_Kampanya Cari",
                                             "type": "customer", "phone": "0532 444 55 66",
                                             "tax_number_or_id": "TEST9990001"}, timeout=30)
        assert c.status_code == 200, c.text[:300]
        ids = [c.json()["id"]]
        r = s.post(f"{BASE}/comm/sms/campaign",
                   json={"company_id": COMPANY, "contact_ids": ids, "message": "Sayın {ad} bakiye {bakiye}"}, timeout=60)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["sent"] + d["failed"] == len(ids)
        logs = s.get(f"{BASE}/comm/sms/logs", timeout=30).json()
        camp = [l for l in logs if l.get("context") == "campaign"][:len(ids)]
        assert camp, "no campaign logs"
        assert "{ad}" not in camp[0]["message"]
        assert camp[0]["contact_name"] and camp[0]["contact_name"] in camp[0]["message"]
        assert d["sent"] == 1 and d["failed"] == 0, d
        s.delete(f"{BASE}/contacts/{ids[0]}", timeout=30)

    def test_campaign_empty_400(self, s):
        r = s.post(f"{BASE}/comm/sms/campaign", json={"contact_ids": [], "message": "x"}, timeout=30)
        assert r.status_code == 400

    def test_comm_history_by_contact(self, s):
        contact = [c for c in s.get(f"{BASE}/contacts", timeout=30).json() if c.get("phone")][0]
        r = s.get(f"{BASE}/comm/history", params={"contact_id": contact["id"]}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert isinstance(d, list)
        assert all(x.get("channel") in ("sms", "email") for x in d)


# ---------------- COMM MAIL ----------------
class TestCommMail:
    def test_presets(self, s):
        r = s.get(f"{BASE}/comm/mail/presets", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d) == 5, len(d)
        assert all("imap_host" in p and "smtp_port" in p for p in d)

    def test_account_null_initially(self, s):
        s.delete(f"{BASE}/comm/mail/account", timeout=30)
        r = s.get(f"{BASE}/comm/mail/account", timeout=30)
        assert r.status_code == 200
        assert r.json() is None

    def test_folders_without_account_404(self, s):
        r = s.get(f"{BASE}/comm/mail/folders", timeout=30)
        assert r.status_code == 404, r.status_code

    def test_save_bogus_account_graceful(self, s):
        r = s.put(f"{BASE}/comm/mail/account",
                  json={"company_id": COMPANY, "provider": "gmail", "email": "test@example.com",
                        "password": "x", "display_name": "TEST"}, timeout=120)
        assert r.status_code == 200, r.text[:400]
        d = r.json()
        assert d["test_result"]["ok"] is False
        assert d["status"] == "error", d.get("status")
        assert d.get("has_password") is True
        assert "password_enc" not in d and "password" not in d

    def test_folders_502(self, s):
        r = s.get(f"{BASE}/comm/mail/folders", timeout=120)
        assert r.status_code == 502, r.status_code
        # NOTE: the Cloudflare edge replaces 5xx origin bodies with an HTML error page,
        # so JSON detail is only observable from the origin.
        assert "detail" in requests.get("http://localhost:8001/api/comm/mail/folders", timeout=120).json()

    def test_send_502(self, s):
        r = s.post(f"{BASE}/comm/mail/send",
                   data={"company_id": COMPANY, "to": "someone@example.com", "subject": "TEST",
                         "body": "TEST"}, timeout=120)
        assert r.status_code == 502, r.status_code
        logs = s.get(f"{BASE}/comm/mail/logs", timeout=30).json()
        assert logs and logs[0]["status"] == "failed"

    def test_send_no_recipient_400(self, s):
        r = s.post(f"{BASE}/comm/mail/send", data={"company_id": COMPANY, "to": " ", "subject": "T"}, timeout=60)
        assert r.status_code == 400, r.status_code

    def test_zz_delete_account(self, s):
        r = s.delete(f"{BASE}/comm/mail/account", timeout=30)
        assert r.status_code == 200
        assert s.get(f"{BASE}/comm/mail/account", timeout=30).json() is None


# ---------------- CONTACTS LOCATION ----------------
class TestContactLocation:
    def test_location_persist(self, s):
        contact = s.get(f"{BASE}/contacts", timeout=30).json()[0]
        payload = {"latitude": 41.01, "longitude": 28.97, "location_url": "https://maps.google.com/?q=41.01,28.97"}
        r = s.put(f"{BASE}/contacts/{contact['id']}", json=payload, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["latitude"] == 41.01 and d["longitude"] == 28.97
        lst = s.get(f"{BASE}/contacts", timeout=30).json()
        got = next(c for c in lst if c["id"] == contact["id"])
        assert got["latitude"] == 41.01
        assert got["location_url"] == payload["location_url"]


# ---------------- AUTH (playbook checks) ----------------
class TestAuth:
    def test_login_success_and_cookie(self, s):
        sess = requests.Session()
        r = sess.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=30)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d.get("user", {}).get("email") == "admin@nexus.com"
        cookies = {c.name: c for c in sess.cookies}
        assert cookies, "no cookies set on login"

    def test_login_invalid(self, s):
        r = requests.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "wrong"}, timeout=30)
        assert r.status_code == 401, f"expected 401 got {r.status_code}"
