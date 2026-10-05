"""İrsaliye ↔ fatura bağlama: varsa yeni fatura açılmaz, mevcut satış faturasına bağlanır."""
from __future__ import annotations

from typing import Any, Dict, Optional


def _is_sales_invoice(inv: Optional[Dict[str, Any]]) -> bool:
    if not inv:
        return False
    if inv.get("invoice_type") == "dispatch":
        return False
    if inv.get("invoice_type") not in (None, "sales"):
        return False
    status = str(inv.get("status") or "").lower()
    if status in ("cancelled", "canceled", "void"):
        return False
    return True


async def find_existing_invoice_for_dispatch(db, dispatch: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """İrsaliyeye zaten bağlı veya aynı siparişten üretilmiş satış faturasını bul."""
    if not dispatch:
        return None
    cid = dispatch.get("company_id")
    did = dispatch.get("_id") or dispatch.get("id")

    async def load_ok(iid: Any) -> Optional[Dict[str, Any]]:
        if not iid:
            return None
        inv = await db.invoices.find_one({"_id": iid})
        return inv if _is_sales_invoice(inv) else None

    for key in ("converted_invoice_id", "invoice_id"):
        found = await load_ok(dispatch.get(key))
        if found:
            return found

    ref = str(dispatch.get("invoice_ref_number") or dispatch.get("converted_invoice_number") or "").strip()
    if ref and cid:
        inv = await db.invoices.find_one(
            {"company_id": cid, "invoice_number": ref, "invoice_type": {"$ne": "dispatch"}}
        )
        if _is_sales_invoice(inv):
            return inv

    if did:
        inv = await db.invoices.find_one({"dispatch_id": did, "invoice_type": {"$ne": "dispatch"}})
        if _is_sales_invoice(inv):
            return inv

    oid = dispatch.get("order_id")
    if oid:
        order = await db.orders.find_one({"_id": oid})
        if order:
            found = await load_ok(order.get("invoice_id"))
            if found:
                return found
        inv = await db.invoices.find_one(
            {"order_id": oid, "invoice_type": {"$ne": "dispatch"}, "status": {"$ne": "cancelled"}}
        )
        if _is_sales_invoice(inv):
            return inv
    return None


async def link_dispatch_to_invoice(db, dispatch: Dict[str, Any], invoice: Dict[str, Any]) -> Dict[str, Any]:
    """İrsaliye ve faturayı karşılıklı bağla; siparişte fatura yoksa yaz."""
    did = dispatch.get("_id") or dispatch.get("id")
    iid = invoice.get("_id") or invoice.get("id")
    dnum = dispatch.get("invoice_number")
    inum = invoice.get("invoice_number")
    await db.invoices.update_one(
        {"_id": did},
        {
            "$set": {
                "converted_invoice_id": iid,
                "converted_invoice_number": inum,
                "invoice_id": iid,
                "invoice_ref_number": inum,
                "dispatch_status": "invoiced",
            }
        },
    )
    inv_patch = {}
    existing_disp = invoice.get("dispatch_id")
    if not existing_disp or existing_disp == did:
        inv_patch["dispatch_id"] = did
        inv_patch["dispatch_number"] = dnum
    elif not invoice.get("dispatch_number"):
        inv_patch["dispatch_number"] = dnum
    if inv_patch:
        await db.invoices.update_one({"_id": iid}, {"$set": inv_patch})
    oid = dispatch.get("order_id") or invoice.get("order_id")
    if oid:
        await db.orders.update_one(
            {"_id": oid, "invoice_id": None},
            {"$set": {"invoice_id": iid, "invoice_number": inum}},
        )
    return await db.invoices.find_one({"_id": iid}) or invoice
