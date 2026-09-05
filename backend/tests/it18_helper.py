"""Iteration 18 helper: reset alert dedupe rows, inspect, or full cleanup of iteration-18 test data."""
import asyncio
import os
import sys

from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
MONGO = os.environ.get("MONGO_URL") or env["MONGO_URL"]
DB = os.environ.get("DB_NAME") or env["DB_NAME"]
CID = "comp_nexus_main_01"
TEST_DATES = ["2026-09-01", "2026-09-05", "2026-09-06", "2026-09-07"]
DEFAULT_WS = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "days": {},
              "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False,
              "require_geo": True, "timezone": "Europe/Istanbul", "overtime_method": "legal",
              "overtime_multiplier": 1.5, "holiday_multiplier": 2.0, "monthly_hours_divisor": 225,
              "notify_missing_checkin": True, "notify_late_checkin": True}


async def main(cmd):
    db = AsyncIOMotorClient(MONGO)[DB]
    if cmd == "reset_alerts":
        print("alerts deleted:", (await db.attendance_alerts.delete_many({})).deleted_count)
        print("notifications deleted:", (await db.notifications.delete_many({"type": {"$in": ["attendance_missing", "attendance_late"]}})).deleted_count)
    elif cmd == "inspect":
        c = await db.companies.find_one({"_id": CID})
        print("company ws:", c.get("work_schedule"))
        print("company loc:", c.get("location"))
        e = await db.employees.find_one({"_id": "emp_01"})
        print("emp_01:", {k: e.get(k) for k in ("payroll_salary", "second_salary", "overtime_method", "overtime_hourly_rate", "work_schedule", "salary")})
        print("attendance 2026-09:", await db.attendance.count_documents({"date": {"$regex": "^2026-09"}}))
        print("payrolls 2026-09:", await db.payrolls.count_documents({"period": "2026-09"}))
        u = await db.users.find_one({"email": "admin@nexus.com"})
        print("admin employee_id:", u.get("employee_id"))
        print("rules:", [r["pattern"] for r in await db.bank_match_rules.find({"company_id": CID}).to_list(50)])
    elif cmd == "cleanup":
        print("attendance deleted:", (await db.attendance.delete_many({"date": {"$in": TEST_DATES}})).deleted_count)
        print("alerts deleted:", (await db.attendance_alerts.delete_many({})).deleted_count)
        print("notifications deleted:", (await db.notifications.delete_many({"type": {"$in": ["attendance_missing", "attendance_late"]}})).deleted_count)
        await db.employees.update_many({"company_id": CID}, {"$set": {"payroll_salary": None, "second_salary": 0, "overtime_method": None, "overtime_hourly_rate": None, "work_schedule": None}})
        await db.companies.update_one({"_id": CID}, {"$set": {"work_schedule": DEFAULT_WS}})
        await db.users.update_many({"email": "admin@nexus.com"}, {"$unset": {"employee_id": ""}})
        print("payrolls 2026-09 pending deleted:", (await db.payrolls.delete_many({"period": "2026-09", "status": "pending"})).deleted_count)
        print("cleanup done")
    elif cmd == "link_admin":
        u = await db.users.find_one({"email": "admin@nexus.com"})
        await db.users.update_one({"_id": u["_id"]}, {"$set": {"employee_id": "emp_01"}})
        print("linked", u["_id"], "-> emp_01")
    elif cmd == "unlink_admin":
        await db.users.update_many({"email": "admin@nexus.com"}, {"$unset": {"employee_id": ""}})
        print("unlinked")
    elif cmd == "seed_bank":
        # 3 unmatched bank_sync transactions sharing one description pattern (rule-suggestion test data)
        from datetime import datetime, timezone
        acc = await db.bank_accounts.find_one({"company_id": CID, "type": "bank"})
        for i in range(3):
            await db.bank_transactions.insert_one({
                "_id": f"tx_it18_{i}", "company_id": CID, "account_id": acc["_id"], "account_name": acc.get("account_name"),
                "type": "outflow", "category": "Banka Giden Ödeme", "amount": 100.0 + i, "currency": "TRY",
                "description": "TEST_ABONELIK SUNUCU KIRASI", "external_id": f"SIM-IT18-{i}", "source": "bank_sync",
                "is_simulated": True, "match_status": "unmatched", "date": "2026-09-02",
                "created_at": datetime.now(timezone.utc).isoformat()})
        print("seeded 3 bank_sync txs on", acc["_id"])
    elif cmd == "clean_bank":
        print("txs deleted:", (await db.bank_transactions.delete_many({"_id": {"$regex": "^tx_it18_"}})).deleted_count)
        print("counter txs deleted:", (await db.bank_transactions.delete_many({"description": {"$regex": "TEST_ABONELIK"}})).deleted_count)
        print("rules deleted:", (await db.bank_match_rules.delete_many({"pattern": {"$regex": "test_abonelik"}})).deleted_count)
    elif cmd == "del_today":
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Istanbul")).strftime("%Y-%m-%d")
        print("today rows deleted:", (await db.attendance.delete_many({"date": today, "employee_id": "emp_01"})).deleted_count, today)


asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "inspect"))
