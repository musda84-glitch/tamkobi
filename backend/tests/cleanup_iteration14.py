"""Iteration 14 cleanup: unset dispatch links on source invoice, delete created docs, drop IT14 test data."""
import argparse
import asyncio
import os

from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
MONGO_URL = os.environ.get("MONGO_URL") or env.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME") or env.get("DB_NAME")


async def main(invoice_ids, delete_ids):
    db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
    for iid in invoice_ids:
        await db.invoices.update_one({"_id": iid}, {"$unset": {"dispatch_id": "", "dispatch_number": "", "converted_invoice_id": ""}})
    deleted = 0
    if delete_ids:
        deleted = (await db.invoices.delete_many({"_id": {"$in": delete_ids}})).deleted_count
    r1 = await db.expense_categories.delete_many({"name": {"$regex": "IT14"}})
    r2 = await db.expenses.delete_many({"description": {"$regex": "IT14"}})
    r3 = await db.bonus_payments.delete_many({"note": "IT14"})
    r4 = await db.contacts.delete_many({"name": {"$regex": "IT14"}})
    print(f"cleanup: unset={len(invoice_ids)} deleted_invoices={deleted} categories={r1.deleted_count} expenses={r2.deleted_count} bonuses={r3.deleted_count} contacts={r4.deleted_count}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--invoice-ids", nargs="*", default=[])
    ap.add_argument("--delete-ids", nargs="*", default=[])
    a = ap.parse_args()
    asyncio.run(main(a.invoice_ids, a.delete_ids))
