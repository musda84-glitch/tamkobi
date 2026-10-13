"""Sipariş listesi filtreleri: her filtre tek başına, birlikte, sayfalama ve İstanbul günü."""
from datetime import datetime, timezone

import order_list_filter as olf
from order_list_filter import (
    ORDER_LIST_SCAN_CAP,
    OrderListFilter,
    fold_tr,
    is_shipped_order,
    needs_invoice_ebelge_filter,
    order_date_sql_range,
    order_display_amount,
    query_orders,
)


def _row(**kwargs):
    base = {
        "id": kwargs.get("order_number") or "id",
        "order_number": "B2B-1",
        "order_status": "pending",
        "channel": "b2b",
        "customer_name": "Ada",
        "customer_phone": "05320000000",
        "order_date": "2026-06-15T12:00:00Z",
        "total_amount": 10,
        "items": [{"product_name": "Kupa", "sku": "KUPA-1"}],
    }
    base.update(kwargs)
    return base


def _ids(result):
    return [o.get("order_number") for o in result["items"]]


def test_fold_tr_maps_turkish_letters():
    assert fold_tr("Şişe") == "sise"
    assert fold_tr("IĞDIR") == "igdir"
    assert fold_tr("ÇÖZÜM") == "cozum"
    assert fold_tr("İstanbul") == "istanbul"


def test_search_order_number():
    rows = [_row(order_number="SP-100"), _row(order_number="SP-200")]
    out = query_orders(rows, OrderListFilter(q="sp-100"))
    assert _ids(out) == ["SP-100"]
    assert out["total"] == 1


def test_search_customer_name_turkish_insensitive():
    rows = [
        _row(order_number="A", customer_name="Şişeci Ahmet"),
        _row(order_number="B", customer_name="Mehmet"),
    ]
    assert _ids(query_orders(rows, OrderListFilter(q="sise"))) == ["A"]
    assert _ids(query_orders(rows, OrderListFilter(q="ŞİŞE"))) == ["A"]


def test_search_phone():
    rows = [
        _row(order_number="A", customer_phone="05321112233"),
        _row(order_number="B", customer_phone="02120000000"),
    ]
    assert _ids(query_orders(rows, OrderListFilter(q="1112233"))) == ["A"]


def test_search_product_name_and_sku():
    rows = [
        _row(order_number="A", items=[{"product_name": "Çelik Tencere", "sku": "TNC-9"}]),
        _row(order_number="B", items=[{"product_name": "Bardak", "sku": "BRD-1"}]),
    ]
    assert _ids(query_orders(rows, OrderListFilter(q="celik"))) == ["A"]
    assert _ids(query_orders(rows, OrderListFilter(q="tnc-9"))) == ["A"]
    assert _ids(query_orders(rows, OrderListFilter(q="brd"))) == ["B"]


def test_search_cargo_tracking():
    rows = [
        _row(order_number="A", cargo_tracking_number="YK123456", order_status="shipped"),
        _row(order_number="B", cargo_tracking_number=""),
    ]
    assert _ids(query_orders(rows, OrderListFilter(q="yk123"))) == ["A"]


def test_status_all_hides_closed_but_exact_status_shows_them():
    rows = [
        _row(order_number="OK", order_status="pending"),
        _row(order_number="CAN", order_status="cancelled"),
        _row(order_number="RET", order_status="returned"),
        _row(order_number="PART", order_status="partially_returned"),
        _row(order_number="SHIP", order_status="shipped"),
    ]
    assert sorted(_ids(query_orders(rows, OrderListFilter(status="all")))) == ["OK", "SHIP"]
    assert _ids(query_orders(rows, OrderListFilter(status="cancelled"))) == ["CAN"]
    assert _ids(query_orders(rows, OrderListFilter(status="returned"))) == ["RET"]
    assert _ids(query_orders(rows, OrderListFilter(status="pending"))) == ["OK"]


def test_status_incoming_and_dispatched():
    rows = [
        _row(order_number="N1", order_status="approved"),
        _row(order_number="N2", order_status="pending"),
        _row(order_number="S1", order_status="shipped"),
        _row(order_number="S2", order_status="completed", cargo_tracking_number="YK1"),
        _row(order_number="S3", order_status="approved", cargo_tracking_number="YK2"),
        _row(order_number="X", order_status="cancelled", cargo_tracking_number="YK3"),
    ]
    incoming = query_orders(rows, OrderListFilter(status="incoming", sort="number_asc"))
    assert _ids(incoming) == ["N1", "N2", "S3"]
    dispatched = query_orders(rows, OrderListFilter(status="dispatched", sort="number_asc"))
    assert _ids(dispatched) == ["S1", "S2"]


def test_shipped_uses_status_not_tracking_number():
    trendyol_created = _row(
        order_number="TY-C",
        order_status="pending",
        channel="trendyol",
        marketplace_status="Created",
        cargo_tracking_number="TY123456",
    )
    b2b_shipped = _row(order_number="B2B-S", order_status="shipped", channel="b2b")
    in_transit = _row(order_number="IT", order_status="approved", marketplace_status="InTransit")
    collection = _row(order_number="ACP", order_status="approved", marketplace_status="AtCollectionPoint")
    kargolandi = _row(order_number="KG", order_status="pending", marketplace_status="Kargolandı")
    assert is_shipped_order(trendyol_created) is False
    assert is_shipped_order(b2b_shipped) is True
    assert is_shipped_order(in_transit) is True
    assert is_shipped_order(collection) is True
    assert is_shipped_order(kargolandi) is True
    rows = [trendyol_created, b2b_shipped, in_transit, collection, kargolandi]
    assert sorted(_ids(query_orders(rows, OrderListFilter(cargo="yes"), page_size=20))) == [
        "ACP", "B2B-S", "IT", "KG",
    ]
    assert _ids(query_orders(rows, OrderListFilter(cargo="no"))) == ["TY-C"]
    assert "TY-C" not in _ids(query_orders(rows, OrderListFilter(status="dispatched")))
    assert "B2B-S" in _ids(query_orders(rows, OrderListFilter(status="dispatched")))


def test_channel_filter_and_empty_channel_counts_as_b2b():
    rows = [
        _row(order_number="B", channel=""),
        _row(order_number="T", channel="trendyol"),
        _row(order_number="H", channel="hepsiburada"),
    ]
    assert _ids(query_orders(rows, OrderListFilter(channel="b2b"))) == ["B"]
    assert _ids(query_orders(rows, OrderListFilter(channel="trendyol"))) == ["T"]
    assert sorted(_ids(query_orders(rows, OrderListFilter(channel="all")))) == ["B", "H", "T"]


def test_invoiced_yes_no_and_einvoice():
    rows = [
        _row(order_number="NONE"),
        _row(order_number="INV", invoice_id="inv1", is_invoiced=True),
        _row(order_number="GIB", invoice_id="inv2", is_invoiced=True, einvoice_state="sent", gib_invoice_id="GIB1"),
    ]
    assert _ids(query_orders(rows, OrderListFilter(invoiced="yes", sort="number_asc"))) == ["GIB", "INV"]
    assert _ids(query_orders(rows, OrderListFilter(invoiced="no"))) == ["NONE"]
    assert _ids(query_orders(rows, OrderListFilter(invoiced="einvoice"))) == ["GIB"]


def test_cargo_yes_no():
    rows = [
        _row(order_number="Y", cargo_tracking_number="TRK1", order_status="shipped"),
        _row(order_number="N", cargo_tracking_number=""),
    ]
    assert _ids(query_orders(rows, OrderListFilter(cargo="yes"))) == ["Y"]
    assert _ids(query_orders(rows, OrderListFilter(cargo="no"))) == ["N"]


def test_doc_status_each_value():
    rows = [
        _row(order_number="DRAFT", order_status="pending"),
        _row(order_number="IRS", order_status="approved", dispatch_number="IRS-1"),
        _row(order_number="FAT", order_status="approved", is_invoiced=True, invoice_id="i"),
        _row(order_number="IPT", order_status="cancelled", is_invoiced=True),
    ]
    assert _ids(query_orders(rows, OrderListFilter(doc_status=["draft"]))) == ["DRAFT"]
    assert _ids(query_orders(rows, OrderListFilter(doc_status=["dispatched"]))) == ["IRS"]
    assert _ids(query_orders(rows, OrderListFilter(doc_status=["invoiced"]))) == ["FAT"]
    assert _ids(query_orders(rows, OrderListFilter(status="cancelled", doc_status=["cancelled"]))) == ["IPT"]
    assert sorted(_ids(query_orders(rows, OrderListFilter(doc_status=None)))) == ["DRAFT", "FAT", "IRS"]


def test_date_range_uses_istanbul_day_inclusive():
    rows = [
        _row(order_number="PREV", order_date="2026-10-12T20:59:59Z"),
        _row(order_number="START", order_date="2026-10-12T21:00:00Z"),
        _row(order_number="MID", order_date="2026-10-12T21:30:00Z"),
        _row(order_number="END", order_date="2026-10-13T20:59:59Z"),
        _row(order_number="NEXT", order_date="2026-10-13T21:00:00Z"),
        _row(order_number="EMPTY", order_date=""),
    ]
    out = query_orders(rows, OrderListFilter(date_from="2026-10-13", date_to="2026-10-13", sort="number_asc"))
    assert _ids(out) == ["END", "MID", "START"]
    assert out["total"] == 3


def test_date_only_string_is_istanbul_calendar_day():
    rows = [_row(order_number="D", order_date="2026-10-13")]
    assert query_orders(rows, OrderListFilter(date_from="2026-10-13", date_to="2026-10-13"))["total"] == 1
    assert query_orders(rows, OrderListFilter(date_to="2026-10-12"))["total"] == 0


def test_naive_timestamp_is_utc_then_istanbul():
    naive = datetime(2026, 10, 12, 21, 30, tzinfo=None)
    rows = [_row(order_number="N", order_date=naive)]
    assert query_orders(rows, OrderListFilter(date_from="2026-10-13", date_to="2026-10-13"))["total"] == 1


def test_combined_filters_are_and():
    hit = _row(
        order_number="HIT",
        customer_name="Şule",
        customer_phone="05329990000",
        order_status="pending",
        channel="trendyol",
        invoice_id="inv",
        is_invoiced=True,
        einvoice_state="accepted",
        cargo_tracking_number="",
        items=[{"product_name": "Ürün", "sku": "SKU-77"}],
        order_date="2026-10-13T10:00:00Z",
        total_amount=40,
    )
    miss_status = _row(order_number="ST", **{k: hit[k] for k in hit if k not in ("id", "order_number", "order_status")})
    miss_status["order_status"] = "shipped"
    miss_channel = dict(hit, order_number="CH", channel="n11", id="CH")
    miss_invoice = dict(hit, order_number="IV", invoice_id="", is_invoiced=False, einvoice_state="", id="IV")
    miss_date = dict(hit, order_number="DT", order_date="2026-09-01T10:00:00Z", id="DT")
    miss_q = dict(hit, order_number="QQ", customer_name="Ali", items=[{"product_name": "X", "sku": "NO"}], id="QQ")
    rows = [hit, miss_status, miss_channel, miss_invoice, miss_date, miss_q]
    filt = OrderListFilter(
        q="sku-77",
        status="pending",
        channel="trendyol",
        invoiced="einvoice",
        cargo="no",
        doc_status=["invoiced"],
        date_from="2026-10-13",
        date_to="2026-10-13",
    )
    out = query_orders(rows, filt)
    assert _ids(out) == ["HIT"]
    assert out["total"] == 1
    assert out["total_amount"] == 40


def test_match_beyond_legacy_500_cap_and_pagination_total():
    rows = [
        _row(order_number=f"N{i:04d}", customer_name="Diğer", total_amount=1, id=f"n{i}")
        for i in range(1000)
    ]
    rows.append(_row(order_number="LAST", customer_name="Eşsiz Müşteri", total_amount=7, id="last"))
    out = query_orders(rows, OrderListFilter(q="essiz"), page=1, page_size=50)
    assert out["total"] == 1
    assert _ids(out) == ["LAST"]
    assert out["total_amount"] == 7

    many = [_row(order_number=f"P{i:04d}", total_amount=2, id=f"p{i}", order_date=f"2026-01-01T00:{i % 60:02d}:00Z") for i in range(120)]
    page2 = query_orders(many, OrderListFilter(sort="number_asc"), page=2, page_size=50)
    assert page2["total"] == 120
    assert page2["total_amount"] == 240
    assert len(page2["items"]) == 50
    assert page2["has_more"] is True
    assert page2["items"][0]["order_number"] == "P0050"
    page3 = query_orders(many, OrderListFilter(sort="number_asc"), page=3, page_size=50)
    assert len(page3["items"]) == 20
    assert page3["has_more"] is False
    assert page3["total"] == 120


def test_filter_change_page_one_does_not_keep_previous_page_rows():
    rows = [_row(order_number=f"P{i:04d}", id=f"p{i}") for i in range(80)]
    first = query_orders(rows, OrderListFilter(status="all"), page=2, page_size=50)
    assert first["page"] == 2
    assert first["items"][0]["order_number"] != rows[0]["order_number"]
    reset = query_orders(rows, OrderListFilter(status="pending", q="yokboyle"), page=1, page_size=50)
    assert reset["page"] == 1
    assert reset["items"] == []
    assert reset["total"] == 0


def test_active_cart_excluded_unless_requested_held_cart_stays():
    rows = [
        _row(order_number="ACT", order_status="active_cart", source="b2b_active_cart"),
        _row(order_number="HELD", order_status="held_cart"),
        _row(order_number="OK", order_status="pending"),
    ]
    assert sorted(_ids(query_orders(rows, OrderListFilter(status="all")))) == ["HELD", "OK"]
    assert _ids(query_orders(rows, OrderListFilter(status="active_cart"))) == ["ACT"]
    assert query_orders(rows, OrderListFilter())["open_count"] == 2
    assert "active_cart" not in [o["order_number"] for o in query_orders(rows, OrderListFilter(channel="b2b"))["items"]]


def test_sort_is_global_not_page_local():
    rows = [
        _row(order_number="OLD", order_date="2026-01-01T00:00:00Z", total_amount=5),
        _row(order_number="NEW", order_date="2026-08-01T00:00:00Z", total_amount=1),
    ]
    assert _ids(query_orders(rows, OrderListFilter(sort="date_desc"))) == ["NEW", "OLD"]
    assert _ids(query_orders(rows, OrderListFilter(sort="amount_desc"))) == ["OLD", "NEW"]


def test_customer_exact_and_summary_counts():
    rows = [
        _row(order_number="A", customer_name="Ersay", contact_id=""),
        _row(order_number="B", customer_name="Ersay Ltd", contact_id="c1", order_status="cancelled"),
        _row(order_number="C", customer_name="Diğer", channel="shopphp", contact_id="c2", order_status="shipped"),
    ]
    assert _ids(query_orders(rows, OrderListFilter(customer="Ersay"))) == ["A"]
    summary = query_orders(rows, OrderListFilter())
    assert summary["closed_count"] == 1
    assert summary["missing_contact"] == 1
    assert summary["open_count"] == 2
    assert "shopphp" in summary["channels"]
    assert summary["counts"]["incoming"] == 1


def test_aware_end_of_istanbul_day_included():
    end = datetime(2026, 10, 13, 23, 59, 59, tzinfo=olf.IST).astimezone(timezone.utc)
    rows = [_row(order_number="E", order_date=end)]
    assert query_orders(rows, OrderListFilter(date_from="2026-10-13", date_to="2026-10-13"))["total"] == 1


def test_scan_cap_is_above_legacy_500_window():
    assert ORDER_LIST_SCAN_CAP >= 1000
    assert olf.ORDER_LIST_EXPORT_MAX >= 1000
    assert olf.ORDER_LIST_PAGE_MAX >= 50


def test_total_amount_uses_local_total_for_fx_orders():
    try_row = _row(order_number="TRY", currency="TRY", grand_total=100, total_amount=80)
    usd_local = _row(
        order_number="USD", currency="USD", grand_total=100, fx_rate=40, local_total=4000, total_amount=100,
    )
    eur_rate = _row(order_number="EUR", currency="EUR", grand_total=50, fx_rate=36, total_amount=50)
    assert order_display_amount(try_row) == 100
    assert order_display_amount(usd_local) == 4000
    assert order_display_amount(eur_rate) == 1800
    out = query_orders([try_row, usd_local], OrderListFilter(status="all"))
    assert out["total_amount"] == 4100


def test_order_date_sql_range_pads_istanbul_day():
    bounds = order_date_sql_range("2026-10-13", "2026-10-13")
    assert bounds["$gte"] <= "2026-10-12"
    assert bounds["$lt"] >= "2026-10-14"
    assert order_date_sql_range("", "") is None


def test_needs_invoice_ebelge_only_for_einvoice_or_doc_filter():
    assert needs_invoice_ebelge_filter("einvoice", None) is True
    assert needs_invoice_ebelge_filter("all", ["invoiced"]) is True
    assert needs_invoice_ebelge_filter("yes", None) is False
    assert needs_invoice_ebelge_filter("all", None) is False
