"""Pazaryeri sipariş saati: UTC saklanır, 23:30 İstanbul aynı güne düşer."""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import marketplace_providers as mp  # noqa: E402
from order_time import (  # noqa: E402
    collect_order_date_fixes,
    ensure_utc_iso,
    order_local_day,
    order_timezone_name,
    plan_order_date_fix,
    relabel_utc_wall_as_local,
    trendyol_query_ms,
    trendyol_window_ms,
)

IST = ZoneInfo("Europe/Istanbul")


def _gmt3_epoch_ms(year, month, day, hour, minute, second=0) -> int:
    """Trendyol orderDate: yerel duvar saati UTC epoch'uymuş gibi kodlanır."""
    wall = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    return int(wall.timestamp() * 1000)


def _pkg(order_ms: int) -> dict:
    return {
        "orderNumber": "TY-TZ-1",
        "id": 501,
        "shipmentPackageStatus": "Created",
        "totalPrice": 100,
        "currencyCode": "TRY",
        "orderDate": order_ms,
        "lines": [{"productName": "Saat", "price": 100, "quantity": 1, "barcode": "1"}],
        "shipmentAddress": {"fullName": "Ayşe Gökmen"},
        "invoiceAddress": {},
        "customerFirstName": "Ayşe",
        "customerLastName": "Gökmen",
    }


def _assert_istanbul_2330(order_date: str):
    moment = datetime.fromisoformat(order_date)
    assert moment.tzinfo is not None
    assert moment.utcoffset().total_seconds() == 0
    local = moment.astimezone(IST)
    assert local.hour == 23 and local.minute == 30
    assert local.date().isoformat() == "2026-10-13"
    assert order_local_day(order_date) == "2026-10-13"


def test_trendyol_2330_is_utc_and_stays_on_istanbul_day():
    ms = _gmt3_epoch_ms(2026, 10, 13, 23, 30)
    doc = mp.map_trendyol_order(_pkg(ms), "c1", "trendyol")
    assert doc["order_date"] == "2026-10-13T20:30:00+00:00"
    assert doc["order_date_tz"] == "utc"
    _assert_istanbul_2330(doc["order_date"])
    # Eski yorum (epoch'u gerçek UTC sanmak) ertesi gün 02:30 gösterirdi.
    misread = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(IST)
    assert misread.day == 14 and misread.hour == 2


def test_shopphp_xml_2330_is_utc_and_stays_on_istanbul_day():
    root = ET.fromstring(
        """<SIPARISLER><SIPARIS>
            <SIPARIS_NO>9001</SIPARIS_NO>
            <TARIH>2026-10-13</TARIH>
            <ZAMAN>23:30:00</ZAMAN>
            <DURUM_NO>2</DURUM_NO>
            <NET_TOPLAM>10</NET_TOPLAM>
            <TeslimAlici>Ayşe Gökmen</TeslimAlici>
        </SIPARIS></SIPARISLER>"""
    )
    doc = mp.map_shopphp_xml_order(root.find("SIPARIS"), "c1", "shopphp")
    assert doc["order_date"] == "2026-10-13T20:30:00+00:00"
    assert doc["order_date_tz"] == "utc"
    _assert_istanbul_2330(doc["order_date"])


def test_shopphp_rest_2330_local_wall_and_dotted_date():
    doc = mp.map_shopphp_order(
        {"no": "42", "tarih": "2026-10-13 23:30:00", "adSoyad": "Ayşe", "toplam": "10"},
        "c1",
        "shopphp",
    )
    assert doc["order_date"] == "2026-10-13T20:30:00+00:00"
    _assert_istanbul_2330(doc["order_date"])

    dotted = mp.map_shopphp_order(
        {"SIPARIS_NO": "43", "siparisTarihi": "13.10.2026 23:30:00", "musteri": "Ayşe"},
        "c1",
        "shopphp",
    )
    assert dotted["order_date"] == "2026-10-13T20:30:00+00:00"
    assert order_local_day(dotted["order_date"]) == "2026-10-13"


def test_shopphp_explicit_offset_is_honored():
    doc = mp.map_shopphp_order(
        {"no": "7", "tarih": "2026-10-13T23:30:00+03:00", "adSoyad": "Ayşe"},
        "c1",
        "shopphp",
    )
    assert doc["order_date"] == "2026-10-13T20:30:00+00:00"


def test_trendyol_query_window_encodes_istanbul_wall_clock():
    moment = datetime(2026, 10, 13, 20, 30, tzinfo=timezone.utc)  # 23:30 İstanbul
    expected = int(datetime(2026, 10, 13, 23, 30, tzinfo=timezone.utc).timestamp() * 1000)
    assert trendyol_query_ms(moment) == expected


def test_trendyol_orders_window_is_gmt3_and_one_real_day():
    frozen = datetime(2026, 10, 13, 20, 30, tzinfo=timezone.utc)
    start, end = trendyol_window_ms(1, now=frozen)
    assert end == trendyol_query_ms(frozen)
    assert start == trendyol_query_ms(datetime(2026, 10, 12, 20, 30, tzinfo=timezone.utc))
    assert end - start == 24 * 3600 * 1000
    assert mp.trendyol_window_ms is trendyol_window_ms


def test_order_timezone_name_defaults_and_reads_company():
    assert order_timezone_name(None) == "Europe/Istanbul"
    assert order_timezone_name({"timezone": "Europe/Berlin"}) == "Europe/Berlin"
    assert order_timezone_name({"settings": {"timezone": "Europe/Athens"}}) == "Europe/Athens"
    assert order_timezone_name({"timezone": "Mars/Phobos"}) == "Europe/Istanbul"


def test_ensure_utc_iso_adds_offset_without_shifting_naive_clock():
    assert ensure_utc_iso("2026-10-13") == "2026-10-13"
    assert ensure_utc_iso("2026-10-13T20:30:00") == "2026-10-13T20:30:00+00:00"
    assert ensure_utc_iso("2026-10-13T20:30:00Z") == "2026-10-13T20:30:00+00:00"
    assert ensure_utc_iso("2026-10-13T23:30:00+03:00") == "2026-10-13T20:30:00+00:00"
    assert ensure_utc_iso("2026-10-13T20:30:00+00:00") == "2026-10-13T20:30:00+00:00"


def test_late_istanbul_evening_is_previous_utc_day_but_same_local_day():
    # 00:30 İstanbul = önceki gün 21:30 UTC. Filtre günü yerel takvimdir.
    assert order_local_day("2026-10-13T21:30:00+00:00") == "2026-10-14"
    assert order_local_day("2026-10-13T20:30:00+00:00") == "2026-10-13"


def test_plan_fixes_mislabeled_marketplace_rows_once():
    bad = {
        "_id": "ord1",
        "company_id": "c1",
        "channel": "Trendyol",
        "source": "marketplace_sync",
        "order_number": "1",
        "order_date": "2026-10-13T23:30:00+00:00",
    }
    patch = plan_order_date_fix(bad)
    assert patch["order_date"] == "2026-10-13T20:30:00+00:00"
    assert patch["order_date_tz"] == "utc"
    assert plan_order_date_fix({**bad, **patch}) is None
    assert plan_order_date_fix({**bad, "channel": "b2b"}) is None
    assert plan_order_date_fix({**bad, "is_simulated": True}) is None
    assert plan_order_date_fix({**bad, "source": "manual"}) is None
    shop = {**bad, "channel": "shopphp", "order_date": "2026-10-13 23:30:00"}
    assert relabel_utc_wall_as_local(shop["order_date"]) == "2026-10-13T20:30:00+00:00"
    assert plan_order_date_fix(shop)["order_date"] == "2026-10-13T20:30:00+00:00"


class _Orders:
    def __init__(self, docs):
        self.docs = docs
        self.updates = []

    def find(self, query, projection=None):
        self.query = query
        self.projection = projection
        return self

    async def to_list(self, length=None):
        return list(self.docs)

    async def update_one(self, query, update):
        self.updates.append((query, update))


class _DB:
    def __init__(self, docs):
        self.orders = _Orders(docs)


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def test_fix_script_dry_run_counts_without_writing():
    docs = [
        {
            "_id": "a",
            "company_id": "c1",
            "channel": "trendyol",
            "source": "marketplace_sync",
            "order_number": "TY1",
            "order_date": "2026-10-13T23:30:00+00:00",
        },
        {
            "_id": "b",
            "company_id": "c1",
            "channel": "shopphp",
            "source": "marketplace_sync",
            "order_number": "S1",
            "order_date": "2026-10-13T23:30:00+00:00",
        },
        {
            "_id": "c",
            "company_id": "c1",
            "channel": "trendyol",
            "source": "marketplace_sync",
            "order_number": "TY-OK",
            "order_date": "2026-10-13T20:30:00+00:00",
            "order_date_tz": "utc",
        },
        {
            "_id": "d",
            "company_id": "c2",
            "channel": "shopphp",
            "source": "marketplace_sync",
            "order_number": "S2",
            "order_date": "2026-10-13T23:30:00+00:00",
        },
    ]
    db = _DB(docs)
    report = _run(collect_order_date_fixes(db, apply=False))
    assert report["dry_run"] is True
    assert report["scanned"] == 4
    assert report["affected"] == 3
    assert report["updated"] == 0
    assert report["by_channel"] == {"trendyol": 1, "shopphp": 2}
    assert db.orders.updates == []

    scoped = _run(collect_order_date_fixes(db, company_id="c1", apply=True))
    assert scoped["affected"] == 2
    assert scoped["updated"] == 2
    assert scoped["dry_run"] is False
    assert len(db.orders.updates) == 2
    assert db.orders.updates[0][1]["$set"]["order_date"] == "2026-10-13T20:30:00+00:00"
