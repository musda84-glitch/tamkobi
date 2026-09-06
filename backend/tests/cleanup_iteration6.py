"""Iteration 6 cleanup: reverts data mutated by iteration-6 UI/API tests.
NOT idempotent for balance reverts — run once."""
import asyncio
import os

import requests
from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

be = dotenv_values("/app/backend/.env")
fe = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or fe["REACT_APP_BACKEND_URL"]).rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


async def main():
    cl = AsyncIOMotorClient(be["MONGO_URL"])
    db = cl[be["DB_NAME"]]

    # 1) UI-created invoice with general discount + its contact
    inv = await db.invoices.find_one({"invoice_number": "NX202600000025"})
    if inv:
        await db.invoices.delete_one({"_id": inv["_id"]})
        print("deleted invoice NX202600000025")
    c = await db.contacts.find_one({"name": "TEST GİB AŞ"})
    if c:
        r = requests.delete(f"{BASE}/contacts/{c['_id']}")
        print("deleted contact TEST GİB AŞ:", r.status_code)

    # 2) revert paper issuance on NX202600000016
    r = await db.invoices.update_one({"invoice_number": "NX202600000016"},
                                     {"$set": {"status": "draft", "e_type": "e_archive", "gib_status": None, "gib_tracking_id": None}})
    print("reverted NX202600000016:", r.modified_count)

    # 3) revert installment plan + 400 TL payment on NX202600000020
    inv20 = await db.invoices.find_one({"invoice_number": "NX202600000020"})
    if inv20:
        paid = inv20.get("paid_amount", 0)
        await db.installments.delete_many({"invoice_id": inv20["_id"]})
        await db.invoices.update_one({"_id": inv20["_id"]}, {"$set": {"paid_amount": 0, "payment_status": "unpaid"}, "$unset": {"installment_plan": ""}})
        txs = await db.bank_transactions.find({"related_invoice_id": inv20["_id"]}).to_list(50)
        for t in txs:
            await db.bank_accounts.update_one({"_id": t["account_id"]}, {"$inc": {"current_balance": -t["amount"]}})
            await db.bank_transactions.delete_one({"_id": t["_id"]})
        if inv20.get("contact_id") and paid:
            await db.contacts.update_one({"_id": inv20["contact_id"]}, {"$inc": {"balance": paid}})
        print("reverted NX202600000020 plan + payment", paid, "tx:", len(txs))

    # 4) revert partner payment (100) on NX202600000024
    inv24 = await db.invoices.find_one({"invoice_number": "NX202600000024"})
    if inv24 and inv24.get("paid_amount"):
        amt = inv24["paid_amount"]
        await db.invoices.update_one({"_id": inv24["_id"]}, {"$set": {"paid_amount": 0, "payment_status": "unpaid"}})
        ptxs = await db.partner_transactions.find({"description": {"$regex": inv24["invoice_number"]}}).to_list(50)
        for t in ptxs:
            await db.partners.update_one({"_id": t["partner_id"]}, {"$inc": {"balance": t["amount"], "total_withdrawn": -t["amount"]}})
            await db.partner_transactions.delete_one({"_id": t["_id"]})
        if inv24.get("contact_id"):
            await db.contacts.update_one({"_id": inv24["contact_id"]}, {"$inc": {"balance": amt}})
        print("reverted NX202600000024 partner payment", amt, "ptx:", len(ptxs))

    # 5) remove quote payment plan created via UI
    r = await db.quotes.update_many({"quote_number": {"$in": ["TKF-2026-0003"]}}, {"$unset": {"payment_plan": ""}})
    print("quote plans removed:", r.modified_count)

    # 6) restore invoice print template layout to minimal (pre-test value)
    await db.companies.update_one({"_id": COMPANY}, {"$set": {"print_templates.invoice.layout": "minimal", "print_templates.quote.layout": "classic"}})
    print("print template layouts restored")

    cl.close()


asyncio.run(main())
