"""Cleanup for iteration 12: remove TEST_IT11_CONV B2B orders (and their converted invoices)
leaked by test_iteration11.py::TestConvertToInvoice, via the public API so stock/balances revert."""
import asyncio

import requests
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")
fe = dotenv_values("/app/frontend/.env")
API = fe["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"


async def main():
    db = AsyncIOMotorClient(env["MONGO_URL"])[env["DB_NAME"]]
    orders = await db.orders.find({"notes": "TEST_IT11_CONV"}).to_list(200)
    print("leaked test orders:", len(orders))
    for o in orders:
        inv_id = o.get("invoice_id")
        if inv_id:
            r = requests.delete(f"{API}/invoices/{inv_id}", timeout=30)
            print("  invoice", inv_id, r.status_code)
        r = requests.delete(f"{API}/orders/{o['_id']}", timeout=30)
        print("  order", o["order_number"], r.status_code)
    print("remaining:", await db.orders.count_documents({"notes": "TEST_IT11_CONV"}))


asyncio.run(main())
