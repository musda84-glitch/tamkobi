"""Fatura iptal / void durumu — listeler ve mali müşavir özetinden gizlenir."""

CANCELLED_STATUSES = frozenset({"cancelled", "canceled", "void"})


def _fold(value: str) -> str:
    return str(value or "").strip().lower().replace("ı", "i").replace("i̇", "i")


def is_cancelled_invoice(inv) -> bool:
    if not inv:
        return False
    if _fold(inv.get("status")) in CANCELLED_STATUSES:
        return True
    if _fold(inv.get("payment_status")) in CANCELLED_STATUSES:
        return True
    gs = _fold(inv.get("gib_status"))
    return "iptal" in gs
