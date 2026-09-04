"""Restore state after iteration-14 test leftovers (orphan bank tx + dispatch/invoice created by a failed run)."""
import asyncio, os
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
db = AsyncIOMotorClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[os.environ.get("DB_NAME") or env["DB_NAME"]]


async def main():
    bt = await db.bank_transactions.find_one({"description": {"$regex": "IT14"}, "source": "expense"})
    if bt:
        await db.bank_accounts.update_one({"_id": bt["account_id"]}, {"$inc": {"current_balance": bt["amount"]}})
        await db.bank_transactions.delete_one({"_id": bt["_id"]})
        print("restored balance", bt["amount"], "on", bt["account_id"])
    d = await db.invoices.find_one({"invoice_number": "IRS-2026-0009"})
    if d:
        if d.get("converted_invoice_id"):
            print("deleted converted invoice", (await db.invoices.delete_one({"_id": d["converted_invoice_id"]})).deleted_count)
        if d.get("invoice_id"):
            await db.invoices.update_one({"_id": d["invoice_id"]}, {"$unset": {"dispatch_id": "", "dispatch_number": ""}})
        await db.invoices.delete_one({"_id": d["_id"]})
        print("deleted dispatch IRS-2026-0009")
    acc = await db.bank_accounts.find_one({"_id": "bank_01"})
    print("bank_01 balance now", acc.get("current_balance"))

asyncio.run(main())
