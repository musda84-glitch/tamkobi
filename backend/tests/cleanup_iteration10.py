"""Iteration 10 cleanup: remove TEST_it10 order + its auto invoice and any leftover cargo_integrations."""
import asyncio
import sys
from mysql_store import MySQLClient as AsyncIOMotorClient
from dotenv import dotenv_values

env = dotenv_values("/app/backend/.env")


async def main():
    cli = AsyncIOMotorClient(env["MONGO_URL"])
    db = cli[env["DB_NAME"]]
    orders = await db.orders.find({"order_number": {"$regex": "^TEST-IT10"}}).to_list(50)
    for o in orders:
        if o.get("invoice_id"):
            print("del invoice", o["invoice_id"], (await db.invoices.delete_one({"_id": o["invoice_id"]})).deleted_count)
        print("del order", o["order_number"], (await db.orders.delete_one({"_id": o["_id"]})).deleted_count)
    # notifications created by b2b test orders
    r = await db.notifications.delete_many({"type": "b2b_order", "message": {"$regex": "TEST_it10"}})
    print("notifications removed:", r.deleted_count)
    ci = await db.cargo_integrations.find({}).to_list(50)
    if "--purge-cargo" in sys.argv:
        for c in ci:
            print("del cargo", c["_id"], (await db.cargo_integrations.delete_one({"_id": c["_id"]})).deleted_count)
    else:
        print("cargo_integrations left:", [c["_id"] for c in ci])
    print("invoices with TEST_it10 notes:", await db.invoices.count_documents({"notes": {"$regex": "TEST-IT10"}}))
    for inv in await db.invoices.find({"notes": {"$regex": "TEST-IT10"}}).to_list(50):
        print("del stray invoice", inv["_id"], (await db.invoices.delete_one({"_id": inv["_id"]})).deleted_count)


asyncio.run(main())
