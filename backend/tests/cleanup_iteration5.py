"""Cleanup of iteration-5 test artefacts."""
import asyncio
from mysql_store import MySQLClient as AsyncIOMotorClient
from dotenv import dotenv_values

e = dotenv_values('/app/backend/.env')


async def main():
    db = AsyncIOMotorClient(e['MONGO_URL'])[e['DB_NAME']]
    # 1) mapping created by UI test
    print("mappings:", (await db.marketplace_mappings.delete_many({"marketplace_sku": {"$in": ["TEST-UI-SKU", "TEST-SKU", "TEST-SKU-2"]}})).raw_result)
    # 2) whatsapp logs created by tests + settings reset
    print("wa logs:", (await db.whatsapp_logs.delete_many({"$or": [
        {"wa_message_id": "wamid.TEST1"}, {"message": {"$regex": "^TEST_"}}]})).raw_result)
    await db.whatsapp_settings.update_many({}, {"$set": {"phone_number_id": "", "verify_token": ""}, "$unset": {"access_token_enc": ""}})
    print("wa settings:", await db.whatsapp_settings.find_one({}, {"_id": 0}))
    # 3) attendance rows created today by tests
    print("attendance:", (await db.attendance.delete_many({"employee_id": "emp_01", "date": "2026-09-03"})).raw_result)
    # 4) test invoice NX202600000015 (TEST_Cari) -> remove, revert cnt_01 balance (+120 from PUT)
    inv = await db.invoices.find_one({"contact_name": "TEST_Cari"})
    if inv:
        await db.invoices.delete_one({"_id": inv["_id"]})
        await db.contacts.update_one({"_id": "cnt_01"}, {"$inc": {"balance": -120.0}})
        print("deleted test invoice", inv["invoice_number"])
    # 5) revert NX202600000010 draft edited via UI (qty 3 -> 1) and balance -240
    d = await db.invoices.find_one({"invoice_number": "NX202600000010"})
    if d and abs(d.get("grand_total", 0) - 360) < 0.01:
        items = d.get("items", [])
        items[0].update({"quantity": 1, "total": 100})
        await db.invoices.update_one({"_id": d["_id"]}, {"$set": {"items": items, "subtotal": 100, "vat_total": 20, "grand_total": 120, "e_type": "paper"}})
        await db.contacts.update_one({"_id": "cnt_01"}, {"$inc": {"balance": -240.0}})
        print("reverted NX202600000010")
    # 6) returns + order statuses + stock
    for r in await db.returns.find({"reason": {"$regex": "TEST"}}).to_list(50):
        for it in r.get("items", []):
            if it.get("product_id"):
                await db.products.update_one({"_id": it["product_id"]}, {"$inc": {"stock_quantity": -float(it.get("quantity", 0))}})
        await db.stock_movements.delete_many({"reason": f"İade: {r['order_number']}"})
        await db.orders.update_one({"_id": r["order_id"]}, {"$set": {"order_status": "pending"}, "$unset": {"return_id": "", "approved_at": "", "cargo_carrier": ""}})
        await db.returns.delete_one({"_id": r["_id"]})
        print("reverted return", r["order_number"])
    # 7) dispatch invoice created by tests
    for disp in await db.invoices.find({"invoice_type": "dispatch"}).to_list(50):
        await db.orders.update_one({"_id": disp.get("order_id")}, {"$unset": {"dispatch_id": "", "dispatch_number": ""}})
        await db.invoices.delete_one({"_id": disp["_id"]})
        print("deleted dispatch", disp.get("invoice_number"))
    c = await db.contacts.find_one({"_id": "cnt_01"})
    print("cnt_01 balance:", c.get("balance"))
    for p in await db.products.find({"sku": "NX-BT-PRO"}).to_list(5):
        print("stock NX-BT-PRO:", p.get("stock_quantity"))


asyncio.run(main())
