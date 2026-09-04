"""Cleanup for iteration-9 tests: removes production orders + work orders created by
tests/test_iteration9.py (no DELETE /api/production/orders endpoint exists) and restores
seed stock levels for prod_01 / prod_raw_01..03.

Usage: python /app/backend/tests/cleanup_iteration9.py <order_id> [<order_id> ...]
"""
import asyncio
import sys

from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
SEED_STOCK = {"prod_01": 143.0, "prod_raw_01": 450, "prod_raw_02": 520, "prod_raw_03": 380}
SEED_PURCHASE_PRICE = {"prod_01": 850.0}


async def main(order_ids):
    cl = AsyncIOMotorClient(env["MONGO_URL"])
    db = cl[env["DB_NAME"]]
    if order_ids:
        wo = await db.work_orders.delete_many({"order_id": {"$in": order_ids}})
        po = await db.production_orders.delete_many({"_id": {"$in": order_ids}})
        print(f"work_orders deleted={wo.deleted_count} production_orders deleted={po.deleted_count}")
    for pid, qty in SEED_STOCK.items():
        await db.products.update_one({"_id": pid}, {"$set": {"stock_quantity": qty}})
    for pid, price in SEED_PURCHASE_PRICE.items():
        await db.products.update_one({"_id": pid}, {"$set": {"purchase_price": price}})
    await db.recipes.delete_many({"name": {"$regex": "^TEST_"}})
    print("stock/purchase_price restored, TEST_ recipes removed")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
