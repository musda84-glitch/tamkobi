"""Cleanup for iteration 12: remove the simulated bank connection + its synced transactions
created by test_iteration12.py and revert the bank account balance delta."""
import asyncio

from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")


async def main():
    client = AsyncIOMotorClient(env["MONGO_URL"])
    db = client[env["DB_NAME"]]
    conns = await db.bank_connections.find({}).to_list(100)
    for c in conns:
        acc_id = c.get("linked_account_id")
        txs = await db.bank_transactions.find({"account_id": acc_id, "source": "bank_sync", "is_simulated": True}).to_list(500)
        delta = 0.0
        for t in txs:
            delta += t["amount"] if t.get("type") == "inflow" else -t["amount"]
        if txs:
            await db.bank_transactions.delete_many({"_id": {"$in": [t["_id"] for t in txs]}})
            await db.bank_accounts.update_one({"_id": acc_id}, {"$inc": {"current_balance": -delta}})
            print(f"removed {len(txs)} simulated txs, reverted balance {-delta:.2f}")
        await db.bank_connections.delete_one({"_id": c["_id"]})
        print("removed bank connection", c["_id"])
    # b2b cart is browser-local only; b2b access left enabled (pre-existing seed state)


asyncio.run(main())
