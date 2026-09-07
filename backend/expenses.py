"""Masraflar (Expenses) module: categorized expenses, payments via kasa/banka, receipts, recurring expenses."""
import uuid
from datetime import datetime, timezone, date, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException
from bank_guard import assert_manual_allowed

router = APIRouter(prefix="/api")
_db = None

DEFAULT_CATEGORIES = ["Kira", "Elektrik / Su / Doğalgaz", "İnternet / Telefon", "Yakıt", "Yemek", "Yol / Ulaşım", "Ofis Malzemesi", "Personel Masrafı", "Vergi / Harç / SGK", "Bakım / Onarım", "Pazarlama / Reklam", "Yazılım / Abonelik", "Kargo / Nakliye", "Muhasebe / Danışmanlık", "Diğer"]


def init(db):
    global _db
    _db = db


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(d):
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    return d


def _calc(data: Dict[str, Any]) -> Dict[str, Any]:
    amount = round(float(data.get("amount") or 0), 2)
    vat_rate = int(data.get("vat_rate") if data.get("vat_rate") is not None else 20)
    if data.get("vat_included"):
        total = amount
        amount = round(total / (1 + vat_rate / 100), 2)
    vat_amount = round(amount * vat_rate / 100, 2)
    return {"amount": amount, "vat_rate": vat_rate, "vat_amount": vat_amount, "total": round(amount + vat_amount, 2)}


async def _next_number(company_id: str) -> str:
    year = datetime.now(timezone.utc).strftime("%Y")
    n = await _db.expenses.count_documents({"company_id": company_id, "expense_number": {"$regex": f"^MSR-{year}"}}) + 1
    return f"MSR-{year}-{n:04d}"


async def _post_payment(exp: dict, account_id: str, pay_date: str):
    acc = await _db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
    await assert_manual_allowed(_db, account_id)
    await _db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -exp["total"]}})
    await _db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": exp["company_id"], "account_id": account_id, "account_name": acc.get("account_name"), "type": "outflow", "category": f"Masraf: {exp.get('category')}",
                                            "amount": exp["total"], "currency": acc.get("currency", "TRY"), "description": f"{exp['expense_number']} {exp.get('description', '')}", "source": "expense", "expense_id": exp["_id"], "date": pay_date, "created_at": _now()})
    return acc.get("account_name")


async def _reverse_payment(exp: dict):
    if exp.get("source") == "card_statement":
        return
    bt = await _db.bank_transactions.find_one({"expense_id": exp["_id"]})
    if bt:
        await _db.bank_accounts.update_one({"_id": bt["account_id"]}, {"$inc": {"current_balance": bt["amount"]}})
        await _db.bank_transactions.delete_one({"_id": bt["_id"]})


async def record_card_spend(
    company_id: str,
    *,
    date: str,
    category: str,
    description: str,
    amount: float,
    account_id: str,
    account_name: Optional[str] = None,
    contact_id: Optional[str] = None,
    contact_name: Optional[str] = None,
    bank_tx_id: Optional[str] = None,
) -> dict:
    """Paid expense already reflected on the card statement — do not post another bank payment."""
    calc = _calc({"amount": abs(float(amount or 0)), "vat_rate": 0, "vat_included": True})
    if calc["total"] <= 0:
        return {}
    contact = await _db.contacts.find_one({"_id": contact_id}) if contact_id else None
    cat = (category or "Diğer").strip() or "Diğer"
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "expense_number": await _next_number(company_id),
        "date": date,
        "category": cat,
        "description": (description or "Kart harcaması").strip()[:200],
        **calc,
        "currency": "TRY",
        "payment_status": "paid",
        "account_id": account_id,
        "account_name": account_name,
        "paid_date": date,
        "contact_id": contact["_id"] if contact else None,
        "contact_name": contact["name"] if contact else (contact_name or None),
        "employee_id": None,
        "employee_name": None,
        "document_no": "",
        "notes": "Kredi kartı ekstresinden aktarıldı. KDV oranı ekstreden tespit edilmedi; gerekirse düzenleyin.",
        "is_recurring": False,
        "recurrence": "monthly",
        "source": "card_statement",
        "bank_transaction_id": bank_tx_id,
        "created_at": _now(),
    }
    await _db.expenses.insert_one(doc)
    if cat not in DEFAULT_CATEGORIES:
        await add_category({"company_id": company_id, "name": cat})
    return _clean(doc)


@router.get("/expenses/categories")
async def list_categories(company_id: str = "comp_nexus_main_01"):
    custom = [c["name"] for c in await _db.expense_categories.find({"company_id": company_id}).to_list(200)]
    return [{"name": n, "is_default": True} for n in DEFAULT_CATEGORIES] + [{"name": n, "is_default": False} for n in custom if n not in DEFAULT_CATEGORIES]


@router.post("/expenses/categories")
async def add_category(req: Dict[str, Any]):
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Kategori adı boş olamaz.")
    company_id = req.get("company_id", "comp_nexus_main_01")
    if name not in DEFAULT_CATEGORIES and not await _db.expense_categories.find_one({"company_id": company_id, "name": name}):
        await _db.expense_categories.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "name": name, "created_at": _now()})
    return {"name": name}


@router.get("/expenses")
async def list_expenses(company_id: str = "comp_nexus_main_01", date_from: Optional[str] = None, date_to: Optional[str] = None, category: Optional[str] = None, status: Optional[str] = None, employee_id: Optional[str] = None, q: Optional[str] = None):
    query: Dict[str, Any] = {"company_id": company_id}
    if date_from or date_to:
        query["date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
    if category and category != "all":
        query["category"] = category
    if status and status != "all":
        query["payment_status"] = status
    if employee_id:
        query["employee_id"] = employee_id
    if q:
        query["$or"] = [{"description": {"$regex": q, "$options": "i"}}, {"expense_number": {"$regex": q, "$options": "i"}}, {"contact_name": {"$regex": q, "$options": "i"}}, {"notes": {"$regex": q, "$options": "i"}}]
    rows = [_clean(x) for x in await _db.expenses.find(query).sort("date", -1).to_list(2000)]
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    all_rows = rows if not (date_from or date_to or category or status or employee_id or q) else [_clean(x) for x in await _db.expenses.find({"company_id": company_id}).to_list(5000)]
    by_cat: Dict[str, float] = {}
    for r in rows:
        by_cat[r.get("category", "Diğer")] = round(by_cat.get(r.get("category", "Diğer"), 0) + r.get("total", 0), 2)
    summary = {"count": len(rows), "total": round(sum(r.get("total", 0) for r in rows), 2), "vat_total": round(sum(r.get("vat_amount", 0) for r in rows), 2),
               "unpaid_total": round(sum(r.get("total", 0) for r in rows if r.get("payment_status") != "paid"), 2), "unpaid_count": sum(1 for r in rows if r.get("payment_status") != "paid"),
               "this_month_total": round(sum(r.get("total", 0) for r in all_rows if (r.get("date") or "").startswith(month)), 2),
               "recurring_count": sum(1 for r in all_rows if r.get("is_recurring")),
               "by_category": sorted([{"category": k, "total": v} for k, v in by_cat.items()], key=lambda x: -x["total"])}
    return {"expenses": rows, "summary": summary}


@router.post("/expenses")
async def create_expense(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    if not (req.get("description") or "").strip():
        raise HTTPException(status_code=400, detail="Açıklama zorunlu.")
    calc = _calc(req)
    if calc["total"] <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı.")
    contact = await _db.contacts.find_one({"_id": req["contact_id"]}) if req.get("contact_id") else None
    emp = await _db.employees.find_one({"_id": req["employee_id"]}) if req.get("employee_id") else None
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "expense_number": await _next_number(company_id), "date": req.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"), "category": req.get("category") or "Diğer",
           "description": req["description"].strip(), **calc, "currency": "TRY", "payment_status": "unpaid", "account_id": None, "account_name": None, "paid_date": None,
           "contact_id": contact["_id"] if contact else None, "contact_name": contact["name"] if contact else (req.get("contact_name") or None), "employee_id": emp["_id"] if emp else None, "employee_name": emp["full_name"] if emp else None,
           "document_no": req.get("document_no") or "", "notes": req.get("notes") or "", "is_recurring": bool(req.get("is_recurring")), "recurrence": req.get("recurrence") or "monthly", "receipt_url": req.get("receipt_url"), "created_at": _now()}
    if req.get("is_recurring"):
        d = date.fromisoformat(doc["date"])
        doc["next_date"] = (d.replace(day=1) + timedelta(days=32)).replace(day=min(d.day, 28)).isoformat()
    await _db.expenses.insert_one(doc)
    if req.get("account_id"):
        doc["account_name"] = await _post_payment(doc, req["account_id"], doc["date"])
        doc.update({"payment_status": "paid", "account_id": req["account_id"], "paid_date": doc["date"]})
        await _db.expenses.update_one({"_id": doc["_id"]}, {"$set": {"payment_status": "paid", "account_id": req["account_id"], "account_name": doc["account_name"], "paid_date": doc["date"]}})
    if req.get("category") and req["category"] not in DEFAULT_CATEGORIES:
        await add_category({"company_id": company_id, "name": req["category"]})
    b = await _db.expense_budgets.find_one({"company_id": company_id, "category": doc["category"]})
    out = _clean(doc)
    if b and b.get("monthly_limit"):
        month = doc["date"][:7]
        sp = sum([e.get("total", 0) async for e in _db.expenses.find({"company_id": company_id, "category": doc["category"], "date": {"$regex": f"^{month}"}}, {"total": 1})])
        pct = round(sp / b["monthly_limit"] * 100, 1)
        out["budget"] = {"monthly_limit": b["monthly_limit"], "spent": round(sp, 2), "pct": pct, "status": "over" if pct >= 100 else "warning" if pct >= 80 else "ok"}
    return out


@router.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, req: Dict[str, Any]):
    exp = await _db.expenses.find_one({"_id": expense_id})
    if not exp:
        raise HTTPException(status_code=404, detail="Masraf bulunamadı.")
    upd = {k: req[k] for k in ("date", "category", "description", "document_no", "notes", "is_recurring", "recurrence", "receipt_url", "contact_name") if k in req}
    if any(k in req for k in ("amount", "vat_rate", "vat_included")):
        upd.update(_calc({**exp, **req}))
    if "employee_id" in req:
        emp = await _db.employees.find_one({"_id": req["employee_id"]}) if req["employee_id"] else None
        upd["employee_id"] = emp["_id"] if emp else None
        upd["employee_name"] = emp["full_name"] if emp else None
    if "contact_id" in req:
        c = await _db.contacts.find_one({"_id": req["contact_id"]}) if req["contact_id"] else None
        upd["contact_id"] = c["_id"] if c else None
        upd["contact_name"] = c["name"] if c else upd.get("contact_name")
    merged = {**exp, **upd}
    if exp.get("source") != "card_statement" and exp.get("payment_status") == "paid" and (merged["total"] != exp["total"] or req.get("account_id") and req["account_id"] != exp.get("account_id")):
        await _reverse_payment(exp)
        acc_id = req.get("account_id") or exp["account_id"]
        upd["account_name"] = await _post_payment(merged, acc_id, exp.get("paid_date") or merged["date"])
        upd["account_id"] = acc_id
    upd["updated_at"] = _now()
    await _db.expenses.update_one({"_id": expense_id}, {"$set": upd})
    return _clean(await _db.expenses.find_one({"_id": expense_id}))


@router.post("/expenses/{expense_id}/pay")
async def pay_expense(expense_id: str, req: Dict[str, Any]):
    exp = await _db.expenses.find_one({"_id": expense_id})
    if not exp:
        raise HTTPException(status_code=404, detail="Masraf bulunamadı.")
    if exp.get("payment_status") == "paid":
        raise HTTPException(status_code=400, detail="Bu masraf zaten ödendi.")
    if not req.get("account_id"):
        raise HTTPException(status_code=400, detail="Kasa/Banka hesabı seçin.")
    pay_date = req.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name = await _post_payment(exp, req["account_id"], pay_date)
    await _db.expenses.update_one({"_id": expense_id}, {"$set": {"payment_status": "paid", "account_id": req["account_id"], "account_name": name, "paid_date": pay_date}})
    return _clean(await _db.expenses.find_one({"_id": expense_id}))


@router.post("/expenses/{expense_id}/unpay")
async def unpay_expense(expense_id: str):
    exp = await _db.expenses.find_one({"_id": expense_id})
    if not exp or exp.get("payment_status") != "paid":
        raise HTTPException(status_code=400, detail="Ödenmiş masraf bulunamadı.")
    if exp.get("source") == "card_statement":
        raise HTTPException(status_code=400, detail="Kart ekstresi masrafının ödemesi kart hareketinden gelir; geri alınamaz.")
    await _reverse_payment(exp)
    await _db.expenses.update_one({"_id": expense_id}, {"$set": {"payment_status": "unpaid", "account_id": None, "account_name": None, "paid_date": None}})
    return _clean(await _db.expenses.find_one({"_id": expense_id}))


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str):
    exp = await _db.expenses.find_one({"_id": expense_id})
    if not exp:
        raise HTTPException(status_code=404, detail="Masraf bulunamadı.")
    if exp.get("payment_status") == "paid":
        await _reverse_payment(exp)
    import trash
    await trash.soft_delete("expenses", exp, "expense", f"{exp.get('expense_number')} · {exp.get('description') or exp.get('category')}", note=f"{float(exp.get('total') or 0):,.2f} ₺ · {exp.get('payment_status')}")
    return {"status": "success", "message": "Masraf çöp kutusuna taşındı" + (", kasa/banka hareketi geri alındı." if exp.get("payment_status") == "paid" else ".")}


@router.post("/expenses/run-recurring")
async def run_recurring(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    created = []
    async for src in _db.expenses.find({"company_id": company_id, "is_recurring": True, "next_date": {"$lte": today}}):
        d = date.fromisoformat(src["next_date"])
        new = {**src, "_id": str(uuid.uuid4()), "expense_number": await _next_number(company_id), "date": src["next_date"], "payment_status": "unpaid", "account_id": None, "account_name": None, "paid_date": None, "is_recurring": False, "receipt_url": None, "recurring_parent_id": src["_id"], "created_at": _now()}
        new.pop("next_date", None)
        await _db.expenses.insert_one(new)
        await _db.expenses.update_one({"_id": src["_id"]}, {"$set": {"next_date": (d.replace(day=1) + timedelta(days=32)).replace(day=min(d.day, 28)).isoformat()}})
        created.append(_clean(new))
    return {"created": created, "message": f"{len(created)} tekrarlayan masraf oluşturuldu."}


@router.get("/expense-budgets")
async def get_budgets(company_id: str = "comp_nexus_main_01", month: Optional[str] = None):
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    budgets = {b["category"]: b for b in await _db.expense_budgets.find({"company_id": company_id}).to_list(200)}
    spent: Dict[str, float] = {}
    async for e in _db.expenses.find({"company_id": company_id, "date": {"$regex": f"^{month}"}}, {"category": 1, "total": 1}):
        spent[e.get("category", "Diğer")] = round(spent.get(e.get("category", "Diğer"), 0) + e.get("total", 0), 2)
    cats = list(dict.fromkeys(DEFAULT_CATEGORIES + [c["name"] for c in await _db.expense_categories.find({"company_id": company_id}).to_list(200)] + list(spent.keys()) + list(budgets.keys())))
    rows = []
    for c in cats:
        limit = float(budgets.get(c, {}).get("monthly_limit") or 0)
        sp = spent.get(c, 0.0)
        pct = round(sp / limit * 100, 1) if limit else None
        rows.append({"category": c, "monthly_limit": limit, "spent": sp, "remaining": round(limit - sp, 2) if limit else None, "pct": pct, "status": "over" if pct is not None and pct >= 100 else "warning" if pct is not None and pct >= 80 else "ok" if limit else "none"})
    total_limit = round(sum(r["monthly_limit"] for r in rows), 2)
    total_spent = round(sum(r["spent"] for r in rows if r["monthly_limit"]), 2)
    return {"month": month, "rows": rows, "warnings": [r for r in rows if r["status"] in ("warning", "over")], "totals": {"limit": total_limit, "spent": total_spent, "pct": round(total_spent / total_limit * 100, 1) if total_limit else None}}


@router.put("/expense-budgets")
async def set_budgets(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    items = req.get("budgets") or []
    for it in items:
        cat = (it.get("category") or "").strip()
        if not cat:
            continue
        limit = float(it.get("monthly_limit") or 0)
        if limit <= 0:
            await _db.expense_budgets.delete_one({"company_id": company_id, "category": cat})
        else:
            await _db.expense_budgets.update_one({"company_id": company_id, "category": cat}, {"$set": {"monthly_limit": limit, "updated_at": _now()}, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "category": cat}}, upsert=True)
    return await get_budgets(company_id)
