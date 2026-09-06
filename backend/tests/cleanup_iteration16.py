"""Iteration 16 cleanup: inspect & revert test-created bank data."""
import os
import sys

import requests
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or fe["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
CID = "comp_nexus_main_01"
MY_CONN = "328e9228-95ae-4628-9e4a-65985c0e62f7"
CARD_ACC = "8826f561-7f23-4d7b-b568-548a70b71e04"

s = requests.Session()


def report():
    matched = s.get(f"{BASE}/banking/transactions/matched", params={"company_id": CID}).json()
    print("MATCHED:")
    for t in matched:
        print(" ", t["id"][:8], t["date"], t.get("account_name"), t.get("matched_via"), t.get("matched_at"),
              t.get("contact_name"), t.get("target_account_name"), t.get("related_invoice_number"), t["amount"])
    unm = s.get(f"{BASE}/banking/transactions/unmatched", params={"company_id": CID}).json()
    print("UNMATCHED:", [(t["id"][:8], t.get("account_name"), t["amount"]) for t in unm])
    rules = s.get(f"{BASE}/banking/match-rules", params={"company_id": CID}).json()
    print("RULES:")
    for r in rules:
        print(" ", r["id"][:8], repr(r["pattern"]), r.get("contact_name"), r.get("target_account_name"), r.get("created_at"), r.get("hits"))
    conns = s.get(f"{BASE}/banking/connections", params={"company_id": CID}).json()
    print("CONNS:", [(c["id"][:8], c["provider"], c["linked_account_name"]) for c in conns])




def cleanup():
    import asyncio
    from mysql_store import MySQLClient as AsyncIOMotorClient
    from dotenv import dotenv_values as dv
    be = dv("/app/backend/.env")

    # 1) unmatch everything matched by tests
    matched = s.get(f"{BASE}/banking/transactions/matched", params={"company_id": CID}).json()
    for t in matched:
        r = s.post(f"{BASE}/banking/transactions/{t['id']}/unmatch")
        print("unmatch", t["id"][:8], r.status_code)

    # 2) delete test connections
    for c in s.get(f"{BASE}/banking/connections", params={"company_id": CID}).json():
        print("del conn", c["id"][:8], s.delete(f"{BASE}/banking/connections/{c['id']}").status_code)

    # 3) delete rules created during this iteration
    for rid in ("2dac0ad3", "1cb5b928", "1bb4c8c4"):
        for r in s.get(f"{BASE}/banking/match-rules", params={"company_id": CID}).json():
            if r["id"].startswith(rid):
                print("del rule", rid, s.delete(f"{BASE}/banking/match-rules/{r['id']}").status_code)

    async def db_work():
        cl = AsyncIOMotorClient(be["MONGO_URL"])
        db = cl[be["DB_NAME"]]
        txs = await db.bank_transactions.find({"company_id": CID, "source": "bank_sync"}).to_list(1000)
        delta = {}
        for t in txs:
            d = t["amount"] if t["type"] == "inflow" else -t["amount"]
            delta[t["account_id"]] = delta.get(t["account_id"], 0) + d
        for acc, d in delta.items():
            await db.bank_accounts.update_one({"_id": acc}, {"$inc": {"current_balance": -d}})
            print("revert balance", acc, -d)
        res = await db.bank_transactions.delete_many({"company_id": CID, "source": "bank_sync"})
        print("deleted bank_sync txs:", res.deleted_count)
        res2 = await db.bank_transactions.delete_many({"company_id": CID, "source": "bank_match"})
        print("leftover bank_match txs deleted:", res2.deleted_count)
        cl.close()

    asyncio.run(db_work())

    # 4) delete test credit card account
    print("del card acc", s.delete(f"{BASE}/banking/accounts/{CARD_ACC}").status_code)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "report":
        report()
    elif len(sys.argv) > 1 and sys.argv[1] == "clean":
        cleanup()
        report()
