"""Restore prod_01 variant v2 stock to 60 and clean TEST_ artefacts."""
import asyncio
import os

from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
MONGO = os.environ.get("MONGO_URL") or env["MONGO_URL"]
DB = os.environ.get("DB_NAME") or env["DB_NAME"]


async def main():
    db = AsyncIOMotorClient(MONGO)[DB]
    p = await db.products.find_one({"_id": "prod_01"})
    variants = p.get("variants", [])
    for v in variants:
        if v.get("variant_id") == "v2":
            v["stock"] = 60.0
    await db.products.update_one({"_id": "prod_01"}, {"$set": {"variants": variants, "stock_quantity": sum(v.get("stock", 0) for v in variants)}})
    print("prod_01 restored:", [(v["variant_id"], v["stock"]) for v in variants])
    for coll, q in [
        ("stock_counts", {"name": {"$regex": "^TEST"}}),
        ("leave_requests", {"reason": {"$regex": "TEST"}}),
        ("bonus_payments", {"note": {"$regex": "TEST"}}),
        ("stock_movements", {"reason": {"$regex": "TEST"}}),
        ("bank_transactions", {"description": {"$regex": "TEST"}}),
        ("invoices", {"invoice_number": {"$regex": "TEST"}}),
    ]:
        r = await db[coll].delete_many(q)
        print(coll, "deleted", r.deleted_count)
    # leaves created in tests (2026-08 range, reason empty)
    r = await db.leave_requests.delete_many({"start_date": {"$regex": "^2026-08"}})
    print("leave_requests aug2026 deleted", r.deleted_count)
    await db.employees.update_one({"_id": "emp_01"}, {"$set": {"used_leave_days": 4}})
    print("emp_01 used_leave_days reset to 4")


asyncio.run(main())
