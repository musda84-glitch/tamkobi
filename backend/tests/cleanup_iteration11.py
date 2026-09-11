"""Cleanup for iteration 11 test data: TEST_IT11 B2B orders + auto invoices, notifications, units/categories."""
import asyncio
import os

from dotenv import load_dotenv
from mysql_store import MySQLClient as AsyncIOMotorClient

load_dotenv("/app/backend/.env")


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    orders = await db.orders.find({"notes": {"$regex": "TEST_IT11"}}).to_list(200)
    for o in orders:
        if o.get("invoice_id"):
            r = await db.invoices.delete_one({"_id": o["invoice_id"]})
            print("invoice deleted", o["invoice_id"], r.deleted_count)
        await db.notifications.delete_many({"ref_id": o["_id"]})
        await db.orders.delete_one({"_id": o["_id"]})
        print("order deleted", o.get("order_number"))
    # stray invoices referencing B2B test orders
    nums = [o.get("order_number") for o in orders if o.get("order_number")]
    for n in nums:
        r = await db.invoices.delete_many({"notes": {"$regex": n}})
        if r.deleted_count:
            print("stray invoice removed for", n)
    await db.units.delete_many({"name": {"$in": ["Rulo", "Rulo2", "TEST_IT11_BIRIM"]}})
    await db.product_categories.delete_many({"name": {"$regex": "^TEST_IT11"}})
    for c in await db.cargo_configs.find({"carrier_code": "geliver"}).to_list(50):
        await db.cargo_configs.delete_one({"_id": c["_id"]})
        print("cargo geliver removed", c["_id"])
    print("orders now:", await db.orders.count_documents({"company_id": "comp_nexus_main_01"}))
    print("invoices now:", await db.invoices.count_documents({"company_id": "comp_nexus_main_01"}))


asyncio.run(main())
