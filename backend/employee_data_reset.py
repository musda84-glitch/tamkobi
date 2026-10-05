"""Personel kartı: ödemeler, masraflar, fazla mesai, giriş-çıkış ve puantaj sıfırlama."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional

class ConfirmRequired(ValueError):
    """Sıfırlama onayı verilmedi."""


EMP_LOCATION_UNSET = (
    "location_last_inside",
    "location_last_ok",
    "location_last_at",
    "location_inside_at",
    "location_left_at",
)

RESET_HINT = (
    "Ödemeler, masraflar, fazla mesai, giriş-çıkış ve puantaj kayıtları silinir. "
    "Personel kartı, belgeler ve sistem kullanıcısı durur."
)


def truthy_confirm(v: Any) -> bool:
    if v is True:
        return True
    if isinstance(v, (int, float)) and v == 1:
        return True
    return str(v or "").strip().lower() in ("1", "true", "yes", "on", "evet")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


async def _to_list(coll, query: dict, cap: int = 8000) -> list:
    if coll is None:
        return []
    cur = coll.find(query)
    if hasattr(cur, "to_list"):
        return await cur.to_list(cap)
    return list(cur or [])


async def _delete_emp(coll, emp_id: str) -> int:
    if coll is None:
        return 0
    res = await coll.delete_many({"employee_id": emp_id})
    return int(getattr(res, "deleted_count", 0) or 0)


async def _inc_balance(db, account_id: Optional[str], amount: float) -> None:
    if not account_id or amount == 0:
        return
    coll = getattr(db, "bank_accounts", None)
    if coll is None:
        return
    await coll.update_one({"_id": account_id}, {"$inc": {"current_balance": amount}})


async def _reverse_partner(db, query: dict) -> None:
    try:
        import partner_pay
        await partner_pay.reverse_one(db, query)
    except Exception:
        return


async def _delete_bank_tx(db, query: dict) -> int:
    coll = getattr(db, "bank_transactions", None)
    if coll is None:
        return 0
    res = await coll.delete_many(query)
    return int(getattr(res, "deleted_count", 0) or 0)


async def reverse_paid_payroll(db, row: dict) -> None:
    if (row or {}).get("status") != "paid":
        return
    pid = row.get("_id") or row.get("id")
    amount = _num(row.get("final_payable") or row.get("net_salary"))
    if row.get("partner_id"):
        await _reverse_partner(db, {"payroll_id": pid})
    elif row.get("account_id"):
        await _inc_balance(db, row.get("account_id"), amount)
    if pid:
        await _delete_bank_tx(db, {"payroll_id": pid})


async def reverse_paid_bonus(db, row: dict) -> None:
    if (row or {}).get("status") != "paid":
        return
    bid = row.get("_id") or row.get("id")
    amount = _num(row.get("amount"))
    if row.get("partner_id"):
        await _reverse_partner(db, {"bonus_id": bid})
    elif row.get("account_id"):
        await _inc_balance(db, row.get("account_id"), amount)
    if bid:
        await _delete_bank_tx(db, {"bonus_id": bid})


async def reverse_paid_expense(db, row: dict) -> None:
    if (row or {}).get("payment_status") != "paid":
        return
    if (row or {}).get("source") in ("card_statement", "bank_statement"):
        return
    eid = row.get("_id") or row.get("id")
    amount = _num(row.get("total") or row.get("amount"))
    if row.get("partner_id"):
        await _reverse_partner(db, {"expense_id": eid})
    elif row.get("account_id"):
        await _inc_balance(db, row.get("account_id"), amount)
    if eid:
        await _delete_bank_tx(db, {"expense_id": eid})


async def reset_operational_data(db, emp: dict, confirm: Any = False) -> Dict[str, int]:
    """Personel operasyonel kayıtlarını siler. Kart / kullanıcı / belgeler kalır."""
    if not truthy_confirm(confirm):
        raise ConfirmRequired("Personel verilerini sıfırlamak için onay gerekli.")
    if not emp or not emp.get("_id"):
        raise ValueError("Çalışan bulunamadı.")
    emp_id = emp["_id"]

    payrolls = await _to_list(getattr(db, "payrolls", None), {"employee_id": emp_id})
    bonuses = await _to_list(getattr(db, "bonus_payments", None), {"employee_id": emp_id})
    expenses = await _to_list(getattr(db, "expenses", None), {"employee_id": emp_id})

    for row in payrolls:
        await reverse_paid_payroll(db, row)
    for row in bonuses:
        await reverse_paid_bonus(db, row)
    for row in expenses:
        await reverse_paid_expense(db, row)

    counts = {
        "payrolls": await _delete_emp(getattr(db, "payrolls", None), emp_id),
        "bonuses": await _delete_emp(getattr(db, "bonus_payments", None), emp_id),
        "expenses": await _delete_emp(getattr(db, "expenses", None), emp_id),
        "attendance": await _delete_emp(getattr(db, "attendance", None), emp_id),
    }

    emp_coll = getattr(db, "employees", None)
    if emp_coll is not None:
        await emp_coll.update_one(
            {"_id": emp_id},
            {"$unset": {k: "" for k in EMP_LOCATION_UNSET}, "$set": {"updated_at": _now()}},
        )
    return counts


def reset_message(emp: dict, counts: Dict[str, int]) -> str:
    name = (emp or {}).get("full_name") or "Personel"
    n = sum(int(v or 0) for v in (counts or {}).values())
    if n <= 0:
        return f"{name} için silinecek personel kaydı yoktu."
    return (
        f"{name} için personel verileri sıfırlandı "
        f"({counts.get('payrolls', 0)} ödeme, {counts.get('bonuses', 0)} prim/avans, "
        f"{counts.get('expenses', 0)} masraf, {counts.get('attendance', 0)} puantaj)."
    )
