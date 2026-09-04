"""Delete a dispatch (and its converted invoice) created during UI testing, unsetting source invoice links."""
import asyncio, os, sys
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
db = AsyncIOMotorClient(os.environ.get("MONGO_URL") or env["MONGO_URL"])[os.environ.get("DB_NAME") or env["DB_NAME"]]


async def main(numbers):
    for num in numbers:
        d = await db.invoices.find_one({"invoice_number": num})
        if not d:
            print("not found", num)
            continue
        if d.get("converted_invoice_id"):
            print("deleted converted invoice", d.get("converted_invoice_number"), (await db.invoices.delete_one({"_id": d["converted_invoice_id"]})).deleted_count)
        if d.get("invoice_id"):
            await db.invoices.update_one({"_id": d["invoice_id"]}, {"$unset": {"dispatch_id": "", "dispatch_number": ""}})
        await db.invoices.delete_one({"_id": d["_id"]})
        print("deleted dispatch", num)

asyncio.run(main(sys.argv[1:]))
