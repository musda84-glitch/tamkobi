"""Iteration 17 helper: inspect / clean attendance + bank_match rows."""
import asyncio
import os
import sys

from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
MONGO = os.environ.get("MONGO_URL") or env["MONGO_URL"]
DB = os.environ.get("DB_NAME") or env["DB_NAME"]


async def main(cmd):
    db = AsyncIOMotorClient(MONGO)[DB]
    if cmd == "inspect":
        print("bank_match tx:", await db.bank_transactions.count_documents({"source": "bank_match"}))
        print("attendance 2026-09:", await db.attendance.count_documents({"date": {"$regex": "^2026-09"}}))
        rows = await db.attendance.find({"source": "self"}).sort("date", -1).to_list(5)
        for r in rows:
            print("self:", r["_id"], r["date"], r.get("check_in"), r.get("check_out"))
        u = await db.users.find_one({"email": "admin@nexus.com"})
        print("admin employee_id:", u.get("employee_id"))
        e = await db.employees.find_one({"work_schedule": {"$ne": None}})
        print("employee override:", e and e.get("full_name"), e and e.get("work_schedule"))
        c = await db.companies.find_one({"_id": "comp_nexus_main_01"})
        print("company ws:", c.get("work_schedule"))
        print("company loc:", c.get("location"))
    elif cmd == "del_today":
        # delete today's (Istanbul) self attendance rows to re-run self check-in test
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Istanbul")).strftime("%Y-%m-%d")
        r = await db.attendance.delete_many({"date": today, "source": "self"})
        print("deleted today self:", r.deleted_count, today)
    elif cmd == "cleanup":
        r = await db.attendance.delete_many({"date": {"$in": ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-06"]}})
        print("deleted test attendance:", r.deleted_count)
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Istanbul")).strftime("%Y-%m-%d")
        r2 = await db.attendance.delete_many({"date": today, "source": "self"})
        print("deleted today self:", r2.deleted_count)
        await db.users.update_one({"email": "admin@nexus.com"}, {"$set": {"employee_id": None}})
        await db.employees.update_many({}, {"$set": {"work_schedule": None}})
        await db.companies.update_one({"_id": "comp_nexus_main_01"}, {"$set": {"work_schedule": {
            "start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4],
            "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15,
            "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul"}}})
        await db.notifications.delete_many({"type": "attendance_dispute"})
        print("restored defaults")


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "inspect"))
