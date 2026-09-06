"""Cleanup of iteration-4 UI test artefacts (TEST_ prefixed quotes/projects/surveys,
their generated invoices, product tag, contact balance restore)."""
import asyncio
import os

from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
client = AsyncIOMotorClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])
db = client[os.environ.get("DB_NAME") or env["DB_NAME"]]


async def main():
    removed_total = 0.0
    # quotes created by UI/API tests
    async for q in db.quotes.find({"$or": [{"title": {"$regex": "TEST_"}}, {"contact_name": {"$regex": "^TEST_"}}]}):
        if q.get("invoice_id"):
            inv = await db.invoices.find_one({"_id": q["invoice_id"]})
            if inv:
                removed_total += inv.get("grand_total", 0)
                await db.invoices.delete_one({"_id": inv["_id"]})
                print("deleted invoice", inv.get("invoice_number"))
        await db.quotes.delete_one({"_id": q["_id"]})
        print("deleted quote", q.get("quote_number"), q.get("title"))
    # quote generated from TEST survey
    async for s in db.surveys.find({"address": {"$regex": "TEST_"}}):
        if s.get("quote_id"):
            await db.quotes.delete_one({"_id": s["quote_id"]})
            print("deleted survey quote", s["quote_id"])
        await db.surveys.delete_one({"_id": s["_id"]})
        print("deleted survey", s.get("survey_number"))
    async for p in db.projects.find({"name": {"$regex": "TEST_"}}):
        await db.projects.delete_one({"_id": p["_id"]})
        print("deleted project", p.get("project_number"))
    # invoices created directly by tests
    async for inv in db.invoices.find({"contact_name": {"$regex": "^TEST_"}}):
        removed_total += inv.get("grand_total", 0)
        await db.invoices.delete_one({"_id": inv["_id"]})
        print("deleted test invoice", inv.get("invoice_number"))
    if removed_total:
        await db.contacts.update_one({"_id": "cnt_01"}, {"$inc": {"balance": -removed_total}})
        print("cnt_01 balance decreased by", removed_total)
    # product tag / vat restore
    r = await db.products.update_one({"sku": "NX-BT-PRO"}, {"$pull": {"tags": "TEST_ETIKET"}})
    await db.products.update_one({"sku": "NX-BT-PRO"}, {"$set": {"purchase_vat_rate": 20}})
    print("product tag pulled:", r.modified_count)
    # e-invoice settings back to simulated
    await db.einvoice_settings.update_one({"company_id": "comp_nexus_main_01"},
                                         {"$set": {"provider": "", "username": "", "status": "simulated"}, "$unset": {"password_enc": ""}})
    print("einvoice settings reset to simulated")
    c = await db.contacts.find_one({"_id": "cnt_01"})
    print("cnt_01 balance now:", c.get("balance"))
    print("quotes:", await db.quotes.count_documents({}), "projects:", await db.projects.count_documents({}), "surveys:", await db.surveys.count_documents({}))


asyncio.run(main())
