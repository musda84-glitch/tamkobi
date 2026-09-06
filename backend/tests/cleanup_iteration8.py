"""Iteration 8 cleanup: remove test production orders/work orders, restore stock & prices, delete TEST_ artifacts."""
from dotenv import dotenv_values
from mysql_store import SyncMySQLClient as MongoClient

env = dotenv_values("/app/backend/.env")
db = MongoClient(env["MONGO_URL"])[env["DB_NAME"]]

KEEP = {"91e27ad3-b728-4057-af33-2609ea37af5e", "2be1e0e8-b7fa-45bc-a154-08e0c5def3e9"}
MINE = [o for o in db.production_orders.find({"recipe_id": "rec_01", "created_at": {"$gte": "2026-09-04T00:41:00"}}) if o["_id"] not in KEEP]
rec = db.recipes.find_one({"_id": "rec_01"})
finished_id = rec["finished_product_id"]

produced = sum(float(o.get("completed_quantity") or 0) for o in MINE)
print("test orders:", [(o["order_code"], o.get("status"), o.get("completed_quantity")) for o in MINE], "total produced:", produced)

if produced:
    db.products.update_one({"_id": finished_id}, {"$inc": {"stock_quantity": -produced}})
    for m in rec["materials"]:
        db.products.update_one({"_id": m["product_id"]}, {"$inc": {"stock_quantity": float(m["quantity"]) * produced}})

for o in MINE:
    db.work_orders.delete_many({"order_id": o["_id"]})
    db.production_orders.delete_one({"_id": o["_id"]})

# purchase_price of finished product was overwritten by finish_work_order(update_cost=True); restore seeded value
db.products.update_one({"_id": finished_id}, {"$set": {"purchase_price": 850.0}})

print("deleted TEST_ products:", db.products.delete_many({"name": {"$regex": "^TEST_Ürün_it8"}}).deleted_count)
print("deleted TEST_ recipes:", db.recipes.delete_many({"name": {"$regex": "^TEST_Reçete_it8"}}).deleted_count)
print("deleted TEST quote:", db.quotes.delete_many({"title": {"$regex": "^TEST_it8"}}).deleted_count)

fp = db.products.find_one({"_id": finished_id})
print("finished product now:", fp["stock_quantity"], fp["purchase_price"])
for m in rec["materials"]:
    p = db.products.find_one({"_id": m["product_id"]})
    print("raw", p["name"][:25], p["stock_quantity"])
print("remaining production orders:", db.production_orders.count_documents({}), "work orders:", db.work_orders.count_documents({}))
