"""Iteration 7 cleanup: revert test data created by test_iteration7.py and UI tests."""
import asyncio
import os
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from mysql_store import MySQLClient as AsyncIOMotorClient

COMP = "comp_nexus_main_01"


async def main():
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    log = []

    # 1) balance installments (invoice_id None) created by tests
    r = await db.installments.delete_many({"invoice_id": None, "invoice_number": "AÇIK BAKİYE"})
    log.append(f"balance installments deleted: {r.deleted_count}")

    # 2) test production orders (recipe based, created by tests) -> reverse stock then delete
    orders = await db.production_orders.find({"company_id": COMP, "completed_quantity": {"$gt": 0}, "order_code": {"$regex": "^URT-2026"}}).to_list(100)
    for o in orders:
        recipe = await db.recipes.find_one({"_id": o.get("recipe_id")})
        qty = float(o.get("completed_quantity", 0))
        if recipe and qty:
            factor = qty / float(recipe.get("target_quantity", 1) or 1)
            for m in recipe.get("materials", []):
                needed = round(float(m.get("quantity", 0)) * factor * (1 + float(m.get("wastage_percent", 0)) / 100), 3)
                await db.products.update_one({"_id": m["product_id"]}, {"$inc": {"stock_quantity": needed}})
            await db.products.update_one({"_id": o.get("finished_product_id")}, {"$inc": {"stock_quantity": -qty}})
        await db.production_orders.delete_one({"_id": o["_id"]})
        log.append(f"production order reverted+deleted: {o.get('order_code')} qty={qty}")
    r = await db.production_orders.delete_many({"company_id": COMP, "order_code": {"$regex": "^URT-2026"}, "completed_quantity": {"$in": [0, None]}})
    log.append(f"other test production orders deleted: {r.deleted_count}")

    # 3) test recipes
    r = await db.recipes.delete_many({"name": {"$regex": "TEST_"}})
    log.append(f"test recipes deleted: {r.deleted_count}")

    # 4) restore prod_01 purchase price (production complete overwrites it with recipe unit cost)
    await db.products.update_one({"_id": "prod_01"}, {"$set": {"purchase_price": 850.0, "has_recipe": True}})
    log.append("prod_01 purchase_price restored to 850.0")

    # 5) test categories / products / quotes / invoices / bank tx
    for coll, q, label in [
        (db.product_categories, {"name": {"$regex": "^TEST_"}}, "categories"),
        (db.products, {"name": {"$regex": "^TEST_"}}, "products"),
        (db.quotes, {"title": {"$regex": "TEST_"}}, "quotes"),
        (db.invoices, {"items.name": {"$regex": "^TEST_"}}, "invoices"),
        (db.bank_transactions, {"description": {"$regex": "TEST_"}}, "bank transactions"),
        (db.notifications, {"message": {"$regex": "Ali Veli"}}, "notifications"),
    ]:
        res = await coll.delete_many(q)
        log.append(f"{label} deleted: {res.deleted_count}")

    # 6) reset cnt_01 terms
    await db.contacts.update_one({"_id": "cnt_01"}, {"$set": {"payment_term_days": 0, "late_fee_rate": 0}})
    log.append("cnt_01 terms reset")

    # 7) brute force login attempts
    r = await db.login_attempts.delete_many({"identifier": {"$regex": "bf_faz7|bruteforce"}})
    log.append(f"login_attempts deleted: {r.deleted_count}")

    print("\n".join(log))


asyncio.run(main())
