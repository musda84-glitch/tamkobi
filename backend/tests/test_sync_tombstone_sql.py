"""Paylaşılan docs mezar taşı sorgusu tüm tabloyu okumaz."""
from datetime import datetime, timedelta, timezone

from mysql_store import (
    deleted_since_sql,
    walk_tombstones,
    MySQLCollection,
)


SINCE = "2026-06-01T00:00:30+00:00"


def _rows(n=400):
    base = datetime(2026, 6, 1, tzinfo=timezone.utc)
    out = []
    for i in range(n):
        stamp = (base + timedelta(seconds=i)).isoformat()
        out.append((
            {"doc_id": f"d{i}", "collection": "invoices", "deleted_at": stamp, "company_id": "co"},
            stamp,
            f"id{i:04d}",
        ))
    return out


def _window(rows, after_stamp, after_id, cap):
    from mysql_store import parse_ts, _TOMBSTONE_CLOCK_SLACK

    parsed = parse_ts(after_stamp)
    if after_id and parsed is not None:
        chosen = []
        for row in rows:
            row_stamp = parse_ts(row[1])
            if row_stamp > parsed or (row_stamp == parsed and str(row[2]) > str(after_id)):
                chosen.append(row)
            if len(chosen) >= cap + 1:
                break
        return chosen
    bound = parsed - _TOMBSTONE_CLOCK_SLACK if parsed is not None else None
    chosen = []
    for row in rows:
        if bound is not None and parse_ts(row[1]) < bound:
            continue
        chosen.append(row)
        if len(chosen) >= cap + 1:
            break
    return chosen


def test_deleted_since_sql_uses_updated_at_index_and_limit():
    sql, args, cap = deleted_since_sql("invoices", "co", SINCE, 10)
    assert cap == 10
    assert "sync_tombstones" not in sql
    assert args[0] == "sync_tombstones"
    assert "company_id=%s" in sql
    assert "updated_at >= %s" in sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.collection'))=%s" in sql
    assert sql.endswith("ORDER BY updated_at ASC, id ASC LIMIT %s")
    assert args[1] == "co"
    assert args[2] == "invoices"
    assert args[-1] == 11
    long_sql, long_args, _cap = deleted_since_sql("orders", "c" * 65, SINCE, 3)
    assert " AND company_id=%s" not in long_sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))=%s" in long_sql
    assert long_args[-1] == 4


def test_page_matches_full_filter_without_reading_every_row():
    rows = _rows(400)
    cap = 10
    calls = {"n": 0, "max": 0, "sum": 0}

    def fetch(after_stamp, after_id):
        page = _window(rows, after_stamp, after_id, cap)
        calls["n"] += 1
        calls["max"] = max(calls["max"], len(page))
        calls["sum"] += len(page)
        return page

    ids, more, cursor = walk_tombstones(fetch, SINCE, cap)
    assert ids == [f"d{i}" for i in range(30, 40)]
    assert more is True
    assert cursor == rows[40][1]
    assert calls["max"] <= cap + 1
    assert calls["sum"] < 80

    got = []
    lower = SINCE
    guard = 0
    while True:
        page_ids, more, cursor = walk_tombstones(fetch, lower, cap)
        got.extend(page_ids)
        guard += 1
        if not more:
            break
        lower = cursor
        assert guard < 80
    assert got == [f"d{i}" for i in range(30, 400)]


def test_slack_rejects_do_not_hide_later_tombstones():
    rows = _rows(80)
    since = rows[40][1]
    # İlk 25 satırın deleted_at değeri since'den eski; updated_at yerinde kalır.
    skewed = []
    for i, (doc, stamp, row_id) in enumerate(rows):
        body = dict(doc)
        if i < 25:
            body["deleted_at"] = "2026-05-01T00:00:00+00:00"
        skewed.append((body, stamp, row_id))
    cap = 5

    def fetch(after_stamp, after_id):
        return _window(skewed, after_stamp, after_id, cap)

    ids, more, cursor = walk_tombstones(fetch, since, cap)
    assert ids == [f"d{i}" for i in range(40, 45)]
    assert more is True
    assert cursor == skewed[45][1]


def test_same_stamp_group_is_not_split():
    stamp = "2026-06-02T00:00:00+00:00"
    later = "2026-06-02T00:00:05+00:00"
    rows = []
    for i in range(5):
        rows.append((
            {"doc_id": f"g{i}", "deleted_at": stamp, "collection": "invoices"},
            stamp,
            f"g{i}",
        ))
    rows.append((
        {"doc_id": "later", "deleted_at": later, "collection": "invoices"},
        later,
        "later",
    ))

    def fetch(after_stamp, after_id):
        return _window(rows, after_stamp, after_id, 2)

    ids, more, cursor = walk_tombstones(fetch, "2026-06-01T00:00:00+00:00", 2)
    assert ids == [f"g{i}" for i in range(5)]
    assert more is True
    assert cursor == later


def test_continuation_keeps_bulk_delete_when_deleted_at_precedes_updated_at():
    """İmleç updated_at'tir. deleted_at daha eskiyse ikinci sayfa satırı düşürmesin."""
    deleted = "2026-06-01T00:00:00+00:00"
    base = datetime(2026, 6, 1, 0, 1, tzinfo=timezone.utc)
    rows = []
    for i in range(6):
        stamp = (base + timedelta(seconds=i)).isoformat()
        rows.append((
            {"doc_id": f"b{i}", "collection": "invoices", "deleted_at": deleted, "company_id": "co"},
            stamp,
            f"b{i}",
        ))
    assert rows[0][0]["deleted_at"] < rows[0][1]

    def fetch(after_stamp, after_id):
        return _window(rows, after_stamp, after_id, 2)

    ids, more, cursor = walk_tombstones(fetch, "2026-05-01T00:00:00+00:00", 2)
    assert ids == ["b0", "b1"]
    assert more is True
    assert cursor == rows[2][1]
    assert rows[2][0]["deleted_at"] < cursor
    rest, more_rest, _cursor = walk_tombstones(fetch, cursor, 2)
    assert rest == ["b2", "b3"]
    assert more_rest is True
    tail, tail_more, _tail_cursor = walk_tombstones(fetch, _cursor, 2)
    assert tail == ["b4", "b5"]
    assert tail_more is False


def test_sync_page_over_3000_tombstones_continues():
    deleted = "2026-06-01T00:00:00+00:00"
    base = datetime(2026, 6, 1, 0, 1, tzinfo=timezone.utc)
    total = 3001
    rows = []
    for i in range(total):
        stamp = (base + timedelta(seconds=i)).isoformat()
        rows.append((
            {"doc_id": f"d{i}", "deleted_at": deleted, "collection": "invoices"},
            stamp,
            f"id{i:05d}",
        ))
    cap = 3000

    def fetch(after_stamp, after_id):
        return _window(rows, after_stamp, after_id, cap)

    ids, more, cursor = walk_tombstones(fetch, "2026-05-01T00:00:00+00:00", cap)
    assert len(ids) == 3000
    assert ids[0] == "d0" and ids[-1] == "d2999"
    assert more is True
    assert cursor == rows[3000][1]
    assert rows[3000][0]["deleted_at"] < cursor
    rest, more_rest, _cursor = walk_tombstones(fetch, cursor, cap)
    assert rest == ["d3000"]
    assert more_rest is False


def test_indexed_reader_asks_sql_for_each_page_only():
    import asyncio

    rows = _rows(50)
    cap = 10
    seen = []

    class Reader:
        async def _fetch_rows(self, sql, args):
            assert "LIMIT %s" in sql
            assert args[-1] == cap + 1
            assert len(args) - 1 <= cap + 1 or args[-1] == cap + 1
            if "id > %s" in sql:
                page = _window(rows, args[3].isoformat() if hasattr(args[3], "isoformat") else str(args[3]), args[5], cap)
            else:
                page = _window(rows, SINCE, "", cap)
            seen.append(len(page))
            return page

    ids, more, cursor = asyncio.run(
        MySQLCollection._deleted_since_indexed(Reader(), "invoices", "co", SINCE, cap)
    )
    assert ids == [f"d{i}" for i in range(30, 40)]
    assert more is True
    assert cursor == rows[40][1]
    assert seen
    assert max(seen) <= cap + 1
