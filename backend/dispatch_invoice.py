"""İrsaliye ↔ fatura bağlama ve giden irsaliyeleri tek satış faturasında birleştirme."""
from __future__ import annotations

import contextlib
import contextvars
import functools
import inspect
from typing import Any, Dict, List, Optional, Sequence

_block_new_orders: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "dispatch_invoice_block_new_orders", default=False,
)

ORDER_CREATE_BLOCKED = (
    "İrsaliye birleştirme veya faturaya dönüşüm sırasında yeni sipariş açılamaz."
)


def order_insert_blocked() -> bool:
    return bool(_block_new_orders.get())


@contextlib.contextmanager
def forbid_new_orders():
    """Birleştirme ve irsaliye→fatura süresince satış siparişi insert'ini kapatır."""
    token = _block_new_orders.set(True)
    try:
        yield
    finally:
        _block_new_orders.reset(token)


def guard_no_new_orders(fn):
    """Uç noktayı, gövdesindeki sorgular aynı fonksiyonda kalacak şekilde sarar."""
    signature = inspect.signature(fn)

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        with forbid_new_orders():
            return await fn(*args, **kwargs)

    wrapper.__signature__ = signature
    return wrapper


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
    cid = str(dispatch.get("company_id") or "").strip()
    if not cid:
        return None
    did = dispatch.get("_id") or dispatch.get("id")

    async def load_ok(iid: Any) -> Optional[Dict[str, Any]]:
        if not iid:
            return None
        inv = await db.invoices.find_one({"_id": iid, "company_id": cid})
        return inv if _is_sales_invoice(inv) else None

    for key in ("converted_invoice_id", "invoice_id"):
        found = await load_ok(dispatch.get(key))
        if found:
            return found

    ref = str(dispatch.get("invoice_ref_number") or dispatch.get("converted_invoice_number") or "").strip()
    if ref:
        inv = await db.invoices.find_one(
            {"company_id": cid, "invoice_number": ref, "invoice_type": {"$ne": "dispatch"}}
        )
        if _is_sales_invoice(inv):
            return inv

    if did:
        inv = await db.invoices.find_one(
            {"company_id": cid, "dispatch_id": did, "invoice_type": {"$ne": "dispatch"}}
        )
        if _is_sales_invoice(inv):
            return inv

    oid = dispatch.get("order_id")
    if oid:
        order = await db.orders.find_one({"_id": oid, "company_id": cid})
        if order:
            found = await load_ok(order.get("invoice_id"))
            if found:
                return found
        inv = await db.invoices.find_one(
            {
                "company_id": cid,
                "order_id": oid,
                "invoice_type": {"$ne": "dispatch"},
                "status": {"$ne": "cancelled"},
            }
        )
        if _is_sales_invoice(inv):
            return inv
    return None


async def link_dispatch_to_invoice(db, dispatch: Dict[str, Any], invoice: Dict[str, Any]) -> Dict[str, Any]:
    """İrsaliye ve faturayı karşılıklı bağla; siparişte fatura yoksa yaz."""
    if not dispatch or not invoice:
        return invoice
    cid = str(dispatch.get("company_id") or "").strip()
    if not cid or str(invoice.get("company_id") or "") != cid:
        return invoice
    did = dispatch.get("_id") or dispatch.get("id")
    iid = invoice.get("_id") or invoice.get("id")
    dnum = dispatch.get("invoice_number")
    inum = invoice.get("invoice_number")
    await db.invoices.update_one(
        {"_id": did, "company_id": cid},
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
        await db.invoices.update_one({"_id": iid, "company_id": cid}, {"$set": inv_patch})
    oid = dispatch.get("order_id") or invoice.get("order_id")
    if oid:
        await db.orders.update_one(
            {"_id": oid, "company_id": cid, "invoice_id": None},
            {"$set": {"invoice_id": iid, "invoice_number": inum}},
        )
    return await db.invoices.find_one({"_id": iid, "company_id": cid}) or invoice


class MergeBlocked(Exception):
    """Birleştirme engeli. status_code 409 (veya 400); detail Türkçe."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = int(status_code)
        self.detail = detail


def _doc_id(doc: Dict[str, Any]) -> str:
    return str(doc.get("_id") or doc.get("id") or "")


def order_ids_of(inv: Optional[Dict[str, Any]]) -> List[str]:
    ids: List[str] = []
    if not inv:
        return ids
    for raw in list(inv.get("order_ids") or []) + [inv.get("order_id")]:
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    return ids


def dispatch_posted_stock(dispatch: Optional[Dict[str, Any]]) -> bool:
    """İrsaliye stoğu düşürdüyse birleşik faturada stok bir daha düşmesin.

    Bugün irsaliye stoğa dokunmaz. İleride effects_applied / stock_effects_applied
    yazılırsa fatura `stock_effects_from_dispatch` ile stok adımını atlar.
    """
    if not dispatch:
        return False
    if dispatch.get("stock_effects_applied") is True:
        return True
    if dispatch.get("effects_applied") is True and dispatch.get("stock_effects_applied") is not False:
        return True
    return False


def dispatch_still_draft(dispatch: Optional[Dict[str, Any]]) -> bool:
    """GİB'e gitmemiş giden irsaliye. Taslak ve gönderilmiş birlikte birleşir; kesimde taslak uyarılır."""
    if not dispatch:
        return False
    from despatch_shipment import despatch_gib_accepted, is_incoming_dispatch

    if is_incoming_dispatch(dispatch):
        return False
    if despatch_gib_accepted(dispatch):
        return False
    if str(dispatch.get("dispatch_status") or "").lower() == "sent":
        return False
    state = str(dispatch.get("einvoice_state") or "").lower()
    if state in ("sent", "queued", "accepted"):
        return False
    if dispatch.get("gib_uuid") or dispatch.get("gib_tracking_id"):
        return False
    return True


def _cancelled(dispatch: Dict[str, Any]) -> bool:
    status = str(dispatch.get("status") or "").lower()
    dstatus = str(dispatch.get("dispatch_status") or "").lower()
    return status in ("cancelled", "canceled", "void") or dstatus == "cancelled"


def _already_invoiced(dispatch: Dict[str, Any]) -> bool:
    if str(dispatch.get("converted_invoice_id") or "").strip():
        return True
    return str(dispatch.get("dispatch_status") or "").lower() == "invoiced"


def validate_merge_dispatches(dispatches: Sequence[Dict[str, Any]], company_id: str) -> None:
    if not dispatches:
        raise MergeBlocked(400, "Birleştirilecek irsaliye seçin.")
    cid = str(company_id or "")
    for d in dispatches:
        num = d.get("invoice_number") or _doc_id(d)
        if d.get("invoice_type") != "dispatch":
            raise MergeBlocked(404, "İrsaliye bulunamadı.")
        if str(d.get("company_id") or "") != cid:
            raise MergeBlocked(404, "İrsaliye bulunamadı.")
        from despatch_shipment import is_incoming_dispatch

        if is_incoming_dispatch(d):
            raise MergeBlocked(409, f"Gelen irsaliye satış faturasına birleştirilemez: {num}.")
        if _cancelled(d):
            raise MergeBlocked(409, f"İptal edilmiş irsaliye birleştirilemez: {num}.")
        if _already_invoiced(d):
            raise MergeBlocked(409, f"İrsaliye zaten faturalanmış: {num}.")
        if not str(d.get("contact_id") or "").strip():
            raise MergeBlocked(400, "İrsaliyede cari bağlı değil; önce cari seçin.")
    contacts = {str(d.get("contact_id") or "") for d in dispatches}
    if len(contacts) > 1:
        raise MergeBlocked(409, "Farklı carilere ait irsaliyeler tek faturada birleştirilemez.")
    currencies = {(str(d.get("currency") or "TRY").upper()) for d in dispatches}
    if len(currencies) > 1:
        raise MergeBlocked(409, "Farklı para birimindeki irsaliyeler tek faturada birleştirilemez.")


def vat_rate_for_line(item: Dict[str, Any], products: Dict[str, Any]) -> int:
    """KDV ürün kartından gelir. Kart yoksa satırdaki oran; açık 0 korunur, boşsa %20."""
    pid = item.get("product_id")
    prod = products.get(pid) if pid else None
    if prod is not None and prod.get("vat_rate") not in (None, ""):
        try:
            return int(round(float(prod.get("vat_rate"))))
        except (TypeError, ValueError):
            pass
    explicit = item.get("vat_rate")
    if explicit not in (None, ""):
        try:
            return int(round(float(explicit)))
        except (TypeError, ValueError):
            pass
    return 20


def build_merge_lines(dispatches: Sequence[Dict[str, Any]], products: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Satır sırası: irsaliye sırası, her irsaliyenin kendi kalem sırası."""
    lines: List[Dict[str, Any]] = []
    for d in dispatches:
        did = _doc_id(d)
        for it in d.get("items") or []:
            disc = float(it.get("discount_rate") or it.get("discount_percent") or 0)
            oid = str(it.get("order_id") or d.get("order_id") or "").strip()
            row: Dict[str, Any] = {
                "product_id": it.get("product_id"),
                "name": it.get("name") or it.get("product_name") or "Kalem",
                "quantity": float(it.get("quantity") or 1),
                "unit": it.get("unit") or "Adet",
                "unit_price": float(it.get("unit_price") or 0),
                "vat_rate": vat_rate_for_line(it, products),
                "discount_rate": disc,
                "discount_percent": disc,
                "total": float(it.get("total") or 0),
                "sku": it.get("sku") or "",
                "barcode": it.get("barcode") or "",
                "dispatch_id": did,
            }
            if it.get("unit_price_incl") not in (None, ""):
                row["unit_price_incl"] = float(it.get("unit_price_incl") or 0)
            if it.get("price_includes_vat") not in (None, ""):
                row["price_includes_vat"] = bool(it.get("price_includes_vat"))
            if it.get("note"):
                row["note"] = it.get("note")
            if oid:
                row["order_id"] = oid
            lines.append(row)
    return lines


def _shared_money(dispatches: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    currency = (str(dispatches[0].get("currency") or "TRY").upper())
    rates = []
    for d in dispatches:
        if d.get("fx_rate") not in (None, ""):
            try:
                rates.append(float(d.get("fx_rate") or 0))
            except (TypeError, ValueError):
                pass
    fx_rate = rates[0] if rates else 1.0
    sources = [str(d.get("fx_source")) for d in dispatches if d.get("fx_source")]
    fx_source = sources[0] if sources else None
    gd_rates = [float(d.get("general_discount_rate") or 0) for d in dispatches]
    gd_amts = [float(d.get("general_discount_amount") or 0) for d in dispatches]
    if len(set(gd_rates)) == 1 and len(set(gd_amts)) == 1:
        gd_rate, gd_amt = gd_rates[0], gd_amts[0]
    else:
        gd_rate, gd_amt = 0.0, 0.0
    return {
        "currency": currency,
        "fx_rate": fx_rate or 1.0,
        "fx_source": fx_source,
        "general_discount_rate": gd_rate,
        "general_discount_amount": gd_amt,
    }


def _notes_for(dispatches: Sequence[Dict[str, Any]]) -> str:
    nums = [str(d.get("invoice_number") or "").strip() for d in dispatches]
    nums = [n for n in nums if n]
    orders = []
    for d in dispatches:
        on = str(d.get("order_number") or "").strip()
        if on and on not in orders:
            orders.append(on)
    if len(dispatches) == 1:
        text = f"İrsaliye: {nums[0] if nums else ''}"
    else:
        text = "İrsaliyeler: " + ", ".join(nums)
    if orders:
        text += " · Sipariş: " + ", ".join(orders)
    return text.strip()


def official_despatch_ref(dispatch: Optional[Dict[str, Any]]) -> Optional[tuple]:
    """GİB'e gitmiş irsaliyenin resmi numarası ve tarihi. Taslakta veya GİB no yoksa None."""
    if not dispatch or dispatch_still_draft(dispatch):
        return None
    gid = str(dispatch.get("gib_invoice_id") or "").strip()
    if not gid:
        return None
    raw = (
        dispatch.get("gib_issue_date")
        or dispatch.get("gib_date")
        or dispatch.get("issue_date")
        or dispatch.get("issued_at")
        or ""
    )
    return gid, str(raw)[:10]


def _marketplace_sale(dispatches: Sequence[Dict[str, Any]], orders: Sequence[Dict[str, Any]]) -> bool:
    from marketplace_providers import VAT_INCL_CHANNELS

    for row in list(dispatches) + list(orders):
        channel = str((row or {}).get("source_channel") or (row or {}).get("channel") or "").strip().lower()
        if channel in VAT_INCL_CHANNELS:
            return True
    return False


def _first_text(rows: Sequence[Dict[str, Any]], *keys: str) -> str:
    for row in rows:
        if not row:
            continue
        for key in keys:
            text = str(row.get(key) or "").strip()
            if text and text != "-":
                return text
    return ""


def party_carry(
    dispatches: Sequence[Dict[str, Any]],
    orders: Sequence[Dict[str, Any]],
    contact: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Birleşik faturaya cari, adres, ödeme ve pazaryeri alanlarını taşır."""
    rows: List[Dict[str, Any]] = [d for d in dispatches if d] + [o for o in orders if o]
    if contact:
        rows.append({
            "contact_tax_office": contact.get("tax_office") or contact.get("contact_tax_office"),
            "shipping_address": contact.get("address"),
            "city": contact.get("city"),
            "customer_phone": contact.get("phone"),
        })
    out: Dict[str, Any] = {
        "contact_tax_office": _first_text(rows, "contact_tax_office", "tax_office"),
        "shipping_address": _first_text(rows, "shipping_address", "address"),
        "city": _first_text(rows, "city"),
        "customer_phone": _first_text(rows, "customer_phone", "phone"),
        "payment_method": _first_text(rows, "payment_method"),
        "payment_type": _first_text(rows, "payment_type"),
    }
    numbers: List[str] = []
    for row in list(dispatches) + list(orders):
        raw = str((row or {}).get("customer_order_number") or (row or {}).get("po_number") or "").strip()
        if raw and raw not in numbers:
            numbers.append(raw)
    if numbers:
        out["customer_order_number"] = ", ".join(numbers)
    if _marketplace_sale(dispatches, orders):
        out["internet_sale"] = "EVET"
    return {key: value for key, value in out.items() if value not in ("", None)}


def _dispatch_link_ids(inv: Optional[Dict[str, Any]]) -> List[str]:
    ids: List[str] = []
    if not inv or inv.get("invoice_type") == "dispatch":
        return ids
    for raw in list(inv.get("dispatch_ids") or []):
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    one = str(inv.get("dispatch_id") or "").strip()
    if one and one not in ids:
        ids.append(one)
    return ids


async def _idempotent_merged_invoice(db, dispatches: Sequence[Dict[str, Any]], company_id: str) -> Optional[Dict[str, Any]]:
    """Tüm irsaliyeler aynı satış faturasına bağlıysa onu döndür."""
    ids: List[str] = []
    for dispatch in dispatches:
        iid = str(dispatch.get("converted_invoice_id") or "").strip()
        if not iid or str(dispatch.get("dispatch_status") or "").lower() != "invoiced":
            return None
        ids.append(iid)
    if len(set(ids)) != 1:
        return None
    inv = await db.invoices.find_one({"_id": ids[0], "company_id": company_id})
    return inv if _is_sales_invoice(inv) else None


def _order_invoice_blocked(inv: Dict[str, Any]) -> bool:
    status = str(inv.get("status") or "draft").lower()
    state = str(inv.get("einvoice_state") or "draft").lower()
    if status != "draft":
        return True
    return state in ("sent", "queued", "accepted")


async def _orders_for_merge(db, dispatches: Sequence[Dict[str, Any]], company_id: str):
    """Sipariş kesilmişse veya faturası taslak değilse 409. Geliş taslaklarını döndür."""
    oids: List[str] = []
    for dispatch in dispatches:
        for oid in order_ids_of(dispatch):
            if oid not in oids:
                oids.append(oid)
    orders: List[Dict[str, Any]] = []
    drafts: List[Dict[str, Any]] = []
    seen_draft = set()
    for oid in oids:
        order = await db.orders.find_one({"_id": oid, "company_id": company_id})
        if not order:
            continue
        orders.append(order)
        label = str(order.get("order_number") or oid)
        if order.get("is_invoiced"):
            raise MergeBlocked(409, f"Sipariş zaten faturalanmış: {label}.")
        iid = str(order.get("invoice_id") or "").strip()
        if not iid or iid in seen_draft:
            continue
        inv = await db.invoices.find_one({"_id": iid, "company_id": company_id})
        if not inv or not _is_sales_invoice(inv):
            continue
        if _order_invoice_blocked(inv):
            raise MergeBlocked(409, f"Sipariş faturası taslak değil: {inv.get('invoice_number') or iid}.")
        seen_draft.add(iid)
        drafts.append(inv)
    return orders, drafts


async def _contact_for_merge(db, dispatches: Sequence[Dict[str, Any]], company_id: str) -> Optional[Dict[str, Any]]:
    contact_id = str((dispatches[0] or {}).get("contact_id") or "").strip() if dispatches else ""
    contacts = getattr(db, "contacts", None)
    if not contact_id or contacts is None:
        return None
    return await contacts.find_one({"_id": contact_id, "company_id": company_id})


async def _point_orders(db, orders: Sequence[Dict[str, Any]], company_id: str, invoice_id: str, invoice_number: str) -> None:
    for order in orders:
        oid = order.get("_id") or order.get("id")
        if not oid:
            continue
        await db.orders.update_one(
            {"_id": oid, "company_id": company_id},
            {"$set": {"invoice_id": invoice_id, "invoice_number": invoice_number}},
        )


async def _restore_order_invoices(db, snapshots: Sequence[Dict[str, Any]], company_id: str) -> None:
    for prev in snapshots:
        oid = prev.get("_id") or prev.get("id")
        if not oid:
            continue
        await db.orders.update_one(
            {"_id": oid, "company_id": company_id},
            {"$set": {
                "invoice_id": prev.get("invoice_id"),
                "invoice_number": prev.get("invoice_number"),
            }},
        )


async def _retire_intake_drafts(db, drafts: Sequence[Dict[str, Any]], company_id: str, keep_id: str, removed: List[Dict[str, Any]]) -> None:
    for draft in drafts:
        did = str(draft.get("_id") or draft.get("id") or "")
        if not did or did == keep_id:
            continue
        res = await db.invoices.delete_one({
            "_id": did,
            "company_id": company_id,
            "invoice_type": "sales",
            "status": "draft",
        })
        if int(getattr(res, "deleted_count", 0) or 0) == 1:
            removed.append(draft)
            continue
        fresh = await db.invoices.find_one({"_id": did, "company_id": company_id})
        if fresh and _is_sales_invoice(fresh) and _order_invoice_blocked(fresh):
            raise MergeBlocked(409, f"Sipariş faturası taslak değil: {fresh.get('invoice_number') or did}.")


async def _restore_intake_drafts(db, drafts: Sequence[Dict[str, Any]], company_id: str) -> None:
    for draft in drafts:
        did = str(draft.get("_id") or draft.get("id") or "")
        if not did:
            continue
        existing = await db.invoices.find_one({"_id": did, "company_id": company_id})
        if existing:
            continue
        body = dict(draft)
        body["company_id"] = company_id
        await db.invoices.insert_one({**body, "company_id": company_id})


async def attach_official_despatch_refs(db, inv: Dict[str, Any]) -> Dict[str, Any]:
    """Kesimde irsaliyeleri yeniden oku. Taslak veya GİB numarası yoksa kesimi durdur."""
    if not inv or inv.get("invoice_type") == "dispatch" or db is None:
        return inv
    ids = _dispatch_link_ids(inv)
    if not ids:
        return inv
    cid = str(inv.get("company_id") or "").strip()
    if not cid:
        return inv
    invoices = getattr(db, "invoices", None)
    if invoices is None:
        return inv
    gib_ids: List[str] = []
    gib_dates: List[str] = []
    drafts: List[str] = []
    missing: List[str] = []
    for did in ids:
        row = await invoices.find_one({"_id": did, "company_id": cid})
        label = str((row or {}).get("invoice_number") or did)
        if not row:
            missing.append(label)
            continue
        if dispatch_still_draft(row):
            drafts.append(label)
            continue
        ref = official_despatch_ref(row)
        if not ref:
            missing.append(label)
            continue
        gib_ids.append(ref[0])
        gib_dates.append(ref[1])
    if drafts:
        nums = ", ".join(drafts)
        raise MergeBlocked(
            409,
            f"Bağlı irsaliye henüz GİB'e gönderilmemiş: {nums}. Önce irsaliyeyi GİB'e iletin.",
        )
    if missing:
        nums = ", ".join(missing)
        raise MergeBlocked(
            409,
            f"İrsaliyenin GİB numarası yok: {nums}. Kesim için GİB irsaliye numarası gerekli.",
        )
    updated = {**inv, "despatch_gib_ids": gib_ids, "despatch_gib_dates": gib_dates}
    iid = inv.get("_id") or inv.get("id")
    if iid:
        await invoices.update_one(
            {"_id": iid, "company_id": cid},
            {"$set": {"despatch_gib_ids": gib_ids, "despatch_gib_dates": gib_dates}},
        )
    return updated


def merge_header(dispatches: Sequence[Dict[str, Any]], invoice_id: str, invoice_number: str) -> Dict[str, Any]:
    ids = [_doc_id(d) for d in dispatches]
    numbers = [d.get("invoice_number") or "" for d in dispatches]
    dates = [d.get("issue_date") or "" for d in dispatches]
    oids: List[str] = []
    onums: List[str] = []
    for d in dispatches:
        oid = str(d.get("order_id") or "").strip()
        if oid and oid not in oids:
            oids.append(oid)
            if d.get("order_number"):
                onums.append(d.get("order_number"))
    first = dispatches[0]
    header: Dict[str, Any] = {
        "e_type": "e_archive",
        "gib_status": "Taslak",
        "einvoice_state": "draft",
        "dispatch_id": ids[0],
        "dispatch_number": numbers[0],
        "dispatch_ids": ids,
        "dispatch_numbers": numbers,
        "dispatch_dates": dates,
        "stock_effects_from_dispatch": any(dispatch_posted_stock(d) for d in dispatches),
    }
    gib_ids: List[str] = []
    gib_dates: List[str] = []
    for d in dispatches:
        ref = official_despatch_ref(d)
        if not ref:
            continue
        gib_ids.append(ref[0])
        gib_dates.append(ref[1])
    header["despatch_gib_ids"] = gib_ids
    header["despatch_gib_dates"] = gib_dates
    if oids:
        header["order_id"] = oids[0]
        header["order_ids"] = oids
    if onums:
        header["order_number"] = onums[0]
        header["order_numbers"] = onums
    elif first.get("order_number"):
        header["order_number"] = first.get("order_number")
    return header


def _claim_query(dispatch_id: str, company_id: str) -> Dict[str, Any]:
    return {
        "_id": dispatch_id,
        "company_id": company_id,
        "converted_invoice_id": None,
        "dispatch_status": {"$ne": "invoiced"},
    }


async def _claim_dispatch(db, dispatch: Dict[str, Any], company_id: str, invoice_id: str, invoice_number: str) -> bool:
    did = _doc_id(dispatch)
    if not str(company_id or "").strip() or not did:
        return False
    prev = str(dispatch.get("dispatch_status") or "draft")
    if prev == "invoiced":
        prev = "draft"
    upd = {"$set": {
        "converted_invoice_id": invoice_id,
        "converted_invoice_number": invoice_number,
        "dispatch_status": "invoiced",
        "dispatch_status_before_invoice": prev,
    }}
    coll = db.invoices
    atomic = getattr(coll, "update_one_atomic", None)
    q = {**_claim_query(did, company_id), "company_id": company_id}
    if atomic is not None:
        res = await atomic(q, upd)
    else:
        res = await coll.update_one(q, upd)
    return int(getattr(res, "matched_count", 0) or 0) == 1


async def _release_one(db, dispatch_id: str, invoice_id: str, previous_status: str, *, company_id: str) -> None:
    cid = str(company_id or "").strip()
    if not cid or not dispatch_id:
        return
    prev = previous_status if previous_status and previous_status != "invoiced" else "draft"
    await db.invoices.update_one(
        {"_id": dispatch_id, "company_id": cid, "converted_invoice_id": invoice_id},
        {"$set": {"dispatch_status": prev}, "$unset": {
            "converted_invoice_id": "",
            "converted_invoice_number": "",
            "dispatch_status_before_invoice": "",
        }},
    )


_CARRY_KEYS = (
    "payment_method", "payment_type", "customer_order_number", "internet_sale",
    "contact_tax_office", "shipping_address", "city", "customer_phone",
)


@guard_no_new_orders
async def merge_loaded_dispatches(db, dispatches: Sequence[Dict[str, Any]], *, company_id: str, products: Dict[str, Any], create_invoice) -> Dict[str, Any]:
    """Doğrulanmış irsaliyelerden tek TASLAK satış faturası. Aynı irsaliye ikinci faturaya girmez."""
    cid = str(company_id or "").strip()
    if not cid:
        raise MergeBlocked(404, "İrsaliye bulunamadı.")
    existing = await _idempotent_merged_invoice(db, dispatches, cid)
    if existing:
        return existing
    validate_merge_dispatches(dispatches, cid)
    orders, drafts = await _orders_for_merge(db, dispatches, cid)
    contact = await _contact_for_merge(db, dispatches, cid)
    carry = party_carry(dispatches, orders, contact)
    lines = build_merge_lines(dispatches, products or {})
    if not lines:
        raise MergeBlocked(400, "İrsaliyede kalem yok.")
    first = dispatches[0]
    money = _shared_money(dispatches)
    spec = {
        "company_id": cid,
        "contact_id": first.get("contact_id"),
        "contact_name": first.get("contact_name") or "",
        "contact_tax_id": first.get("contact_tax_id") or "",
        "contact_tax_office": carry.get("contact_tax_office") or first.get("contact_tax_office") or "",
        "shipping_address": carry.get("shipping_address") or "",
        "city": carry.get("city") or "",
        "customer_phone": carry.get("customer_phone") or "",
        "items": lines,
        "notes": _notes_for(dispatches),
        "source_channel": first.get("source_channel") or "manual",
        **money,
    }
    created = await create_invoice(spec)
    invoice_id = str((created or {}).get("id") or (created or {}).get("_id") or "")
    invoice_number = (created or {}).get("invoice_number") or ""
    if not invoice_id:
        raise MergeBlocked(500, "Satış faturası oluşturulamadı.")
    header = merge_header(dispatches, invoice_id, invoice_number)
    for key in _CARRY_KEYS:
        if carry.get(key):
            header[key] = carry[key]
    await db.invoices.update_one({"_id": invoice_id, "company_id": cid}, {"$set": header})
    claimed: List[tuple] = []
    removed: List[Dict[str, Any]] = []
    snapshots = [dict(order) for order in orders]
    pointed = False
    try:
        for d in dispatches:
            prev = str(d.get("dispatch_status") or "draft")
            ok = await _claim_dispatch(db, d, cid, invoice_id, invoice_number)
            if not ok:
                num = d.get("invoice_number") or _doc_id(d)
                raise MergeBlocked(409, f"İrsaliye zaten faturalanmış: {num}.")
            claimed.append((_doc_id(d), prev))
        await _point_orders(db, orders, cid, invoice_id, invoice_number)
        pointed = True
        await _retire_intake_drafts(db, drafts, cid, invoice_id, removed)
    except Exception:
        if pointed:
            try:
                await _restore_order_invoices(db, snapshots, cid)
            except Exception:
                pass
        try:
            await _restore_intake_drafts(db, removed, cid)
        except Exception:
            pass
        for did, prev in claimed:
            try:
                await _release_one(db, did, invoice_id, prev, company_id=cid)
            except Exception:
                pass
        try:
            await db.invoices.delete_one({"_id": invoice_id, "company_id": cid})
        except Exception:
            pass
        raise
    fresh = await db.invoices.find_one({"_id": invoice_id, "company_id": cid})
    return fresh or {**(created or {}), "_id": invoice_id, "invoice_number": invoice_number, **header}


async def mark_orders_invoiced(db, inv: Dict[str, Any]) -> None:
    """Onay veya e-belge kesiminde bağlı siparişlerin hepsi is_invoiced olur."""
    ids = order_ids_of(inv)
    if not ids or db is None:
        return
    orders = getattr(db, "orders", None)
    if orders is None:
        return
    iid = inv.get("_id") or inv.get("id")
    payload = {
        "is_invoiced": True,
        "invoice_id": iid,
        "invoice_number": inv.get("invoice_number"),
    }
    for oid in ids:
        await orders.update_one({"_id": oid}, {"$set": payload})


async def draft_dispatch_warning(db, inv: Dict[str, Any]) -> Optional[str]:
    """Fatura kesilirken bağlı irsaliye hâlâ taslaksa açık Türkçe uyarı."""
    if not inv or db is None:
        return None
    ids: List[str] = []
    for raw in list(inv.get("dispatch_ids") or []):
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    one = str(inv.get("dispatch_id") or "").strip()
    if one and one not in ids and inv.get("invoice_type") != "dispatch":
        ids.append(one)
    if not ids:
        return None
    invoices = getattr(db, "invoices", None)
    if invoices is None:
        return None
    drafts = []
    for did in ids:
        row = await invoices.find_one({"_id": did})
        if row and dispatch_still_draft(row):
            drafts.append(row.get("invoice_number") or did)
    if not drafts:
        return None
    nums = ", ".join(str(n) for n in drafts)
    return (
        f"Bağlı irsaliyeler hâlâ taslak (GİB'e gönderilmemiş): {nums}. "
        "Fatura kesildi; irsaliyeyi de GİB'e iletin."
    )


async def release_invoice_dispatches(db, inv: Dict[str, Any]) -> None:
    """Fatura taslağı silinince veya iptal edilince irsaliye bağını geri al."""
    if not inv or not db:
        return
    if inv.get("invoice_type") == "dispatch" or inv.get("e_type") == "e_dispatch":
        return
    invoice_id = inv.get("_id") or inv.get("id")
    if not invoice_id:
        return
    cid = str(inv.get("company_id") or "").strip()
    if not cid:
        return
    ids: List[str] = []
    for raw in list(inv.get("dispatch_ids") or []):
        sid = str(raw or "").strip()
        if sid and sid not in ids:
            ids.append(sid)
    one = str(inv.get("dispatch_id") or "").strip()
    if one and one not in ids:
        ids.append(one)
    if not ids:
        return
    for did in ids:
        row = await db.invoices.find_one({"_id": did, "company_id": cid})
        if not row or row.get("converted_invoice_id") != invoice_id:
            continue
        prev = str(row.get("dispatch_status_before_invoice") or "draft")
        await _release_one(db, did, invoice_id, prev, company_id=cid)
