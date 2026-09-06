"""Iteration 17 cleanup: remove test attendance rows, simulated bank connection/sync data, restore defaults."""
import asyncio
import json
import os

from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
db = AsyncIOMotorClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[os.environ.get("DB_NAME") or env["DB_NAME"]]
CONN = "dd3876c4-a1b5-4e2a-a633-b426b32f0fa3"
DATES = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]
DEFAULT_WS = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4],
              "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15,
              "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul"}


async def main():
    r = await db.attendance.delete_many({"employee_id": {"$in": ["emp_01", "emp_02"]}, "date": {"$in": DATES}})
    print("attendance deleted:", r.deleted_count)
    if os.path.exists("/tmp/it17_backup_att.json"):
        doc = json.load(open("/tmp/it17_backup_att.json"))
        await db.attendance.update_one({"_id": doc["_id"]}, {"$set": doc}, upsert=True)
        print("restored backed-up record", doc["_id"], doc["date"])
    await db.users.update_one({"_id": "usr_admin_01"}, {"$set": {"employee_id": None}})
    await db.employees.update_many({"company_id": "comp_nexus_main_01"}, {"$set": {"work_schedule": None}})
    await db.companies.update_one({"_id": "comp_nexus_main_01"}, {"$set": {"work_schedule": DEFAULT_WS}})
    await db.notifications.delete_many({"type": "attendance_dispute"})
    print("admin unlinked, schedules restored, dispute notifications removed")

    # banking test data
    await db.bank_transactions.delete_one({"_id": "TEST_it17_bankmatch"})
    sync = await db.bank_transactions.find({"source": "bank_sync", "account_id": "bank_01"}).to_list(100)
    delta = sum((t["amount"] if t.get("type") in ("inflow", "in") else -t["amount"]) for t in sync)
    d = await db.bank_transactions.delete_many({"source": "bank_sync", "account_id": "bank_01"})
    await db.bank_connections.delete_one({"_id": CONN})
    if d.deleted_count:
        await db.bank_accounts.update_one({"_id": "bank_01"}, {"$inc": {"current_balance": -delta}})
    acc = await db.bank_accounts.find_one({"_id": "bank_01"})
    print("bank_sync tx deleted:", d.deleted_count, "balance reverted by", delta, "-> now", acc["current_balance"])


asyncio.run(main())
