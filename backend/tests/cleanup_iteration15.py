"""Iteration 15 cleanup: loan-related residue + bank_01 balance restore."""
from dotenv import dotenv_values
from pymongo import MongoClient

e = dotenv_values("/app/backend/.env")
db = MongoClient(e["MONGO_URL"])[e["DB_NAME"]]
BASELINE = 249812.5

restore = 0.0
for t in db.bank_transactions.find({"loan_id": {"$exists": True}}):
    if t.get("type") == "outflow":
        restore += float(t.get("amount", 0))
    else:
        restore -= float(t.get("amount", 0))
print("loan tx to remove:", db.bank_transactions.count_documents({"loan_id": {"$exists": True}}), "restore:", restore)
db.bank_transactions.delete_many({"loan_id": {"$exists": True}})
print("loan expenses removed:", db.expenses.delete_many({"loan_id": {"$exists": True}}).deleted_count)
print("IT15 expenses removed:", db.expenses.delete_many({"description": {"$regex": "^IT15 "}}).deleted_count)
print("IT15 loans removed:", db.loans.delete_many({"name": {"$regex": "IT15"}}).deleted_count)
db.expense_budgets.delete_many({"category": "Yakıt"})
db.bank_accounts.delete_many({"account_name": "IT15 Kart"})
db.bank_accounts.update_one({"_id": "bank_01"}, {"$set": {"current_balance": BASELINE}})
print("bank_01:", db.bank_accounts.find_one({"_id": "bank_01"}, {"current_balance": 1}))
