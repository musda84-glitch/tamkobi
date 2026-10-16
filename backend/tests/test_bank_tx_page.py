"""Hesap hareketi sayfası, istemcideki listeyle aynı küme ve sıra.

Dönem giriş/çıkış, tüm filtrelenmiş kümenin tx_signed_amount işaretidir
(iptal, havuz, ekstre, defter ve bakiyeye yazılmayan satır 0). Sayfa dilimi
toplamı değiştirmez.

MySQL karşılaştırması yalnız TAMKOBI_TEST_MYSQL_URL (yoksa yerel
tamkobi_pushdown). Ulaşılamazsa skip. MYSQL_URL / canlı veritabanı okunmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
import uuid
from datetime import datetime, time, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import account_balance  # noqa: E402
import bank_tx_page  # noqa: E402
from mysql_store import match_query  # noqa: E402

IST = ZoneInfo("Europe/Istanbul")
CID = "c-page-1"
OTHER = "c-page-2"
ACC = "acc-a"
POOL = "acc-pool"
CARD = "acc-card"

EXPECTED_ORDER = [
    "ist-next", "z-new", "ist-day", "ist-late", "dmy",
    "tie-b", "tie-a", "out-1", "tr-in", "same-early", "tr-out",
    "matched", "unmatched", "cancel", "stmt", "ledger", "unposted",
    "card-ptr", "via-card",
]
# İmzalı tam küme: giriş 167, çıkış 72. İptal/ekstre/defter/yazılmamış 0.
EXPECTED_INFLOW = 167.0
EXPECTED_OUTFLOW = 72.0


def _tx(**kwargs):
    doc = {
        "company_id": CID,
        "account_id": ACC,
        "type": "inflow",
        "amount": 0,
        "created_at": "2026-10-01T00:00:00Z",
        "date": "2026-10-01",
        "description": kwargs.get("type") or "hareket",
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed_docs():
    accounts = [
        {"_id": ACC, "company_id": CID, "type": "cash_box", "account_name": "Kasa", "current_balance": 1234.56},
        {
            "_id": CARD, "company_id": CID, "type": "credit_card", "account_name": "Kart",
            "current_balance": -80.0, "card_limit": 5000, "card_last4": "4242",
        },
        {
            "_id": POOL, "company_id": CID, "type": "credit_card", "is_customer_card_pool": True,
            "account_name": "Havuz", "current_balance": 0.0,
        },
        {"_id": "acc-foreign", "company_id": OTHER, "type": "bank", "account_name": "Yabancı", "current_balance": 9.0},
    ]
    txs = [
        _tx(_id="ist-next", date="2026-10-16T21:30:00Z", created_at="2026-10-16T21:30:00Z", amount=8, description="ertesi gün"),
        _tx(_id="z-new", date="2026-10-16", created_at="2026-10-16T12:00:00Z", amount=10, description="Özel damga tahsilat"),
        _tx(_id="ist-day", date="2026-10-16", created_at="2026-10-16T08:00:00Z", amount=2, description="gün"),
        _tx(_id="ist-late", date="2026-10-15T21:30:00Z", created_at="2026-10-15T21:30:00Z", amount=4, description="istanbul gecesi"),
        _tx(_id="dmy", date="15.10.2026", created_at="2026-10-15T01:00:00Z", amount=6, description="dmy"),
        _tx(_id="tie-b", date="2026-10-12", created_at="2026-10-12T10:00:00Z", amount=1, description="ayni"),
        _tx(_id="tie-a", date="2026-10-12", created_at="2026-10-12T10:00:00Z", amount=1, description="ayni"),
        _tx(_id="out-1", date="2026-10-12", created_at="2026-10-12T09:00:00Z", type="outflow", amount=40, description="cikis"),
        _tx(
            _id="tr-in", account_id="acc-b", target_account_id=ACC, date="2026-10-11",
            created_at="2026-10-11T18:00:00Z", type="transfer", amount=80, description="virman gelen",
        ),
        _tx(_id="same-early", date="2026-10-11", created_at="2026-10-11T09:00:00Z", amount=10, description="erken"),
        _tx(
            _id="tr-out", target_account_id="acc-b", date="2026-10-11",
            created_at="2026-10-11T08:00:00Z", type="transfer", amount=25, description="virman giden",
        ),
        _tx(
            _id="matched", date="2026-10-10", created_at="2026-10-10T12:00:00Z", amount=15,
            source="bank_sync", match_status="matched", description="eslesti",
        ),
        _tx(
            _id="unmatched", date="2026-10-10", created_at="2026-10-10T11:00:00Z", type="outflow", amount=7,
            source="bank_sync", match_status="unmatched", description="bekliyor",
        ),
        _tx(_id="cancel", date="2026-10-09", created_at="2026-10-09T00:00:00Z", amount=999, status="cancelled", description="iptal"),
        _tx(_id="stmt", date="2026-10-08", created_at="2026-10-08T00:00:00Z", type="outflow", amount=500, source="card_statement", description="ekstre"),
        _tx(_id="ledger", date="2026-10-07", created_at="2026-10-07T00:00:00Z", amount=777, source="ledger", description="defter"),
        _tx(_id="unposted", date="2026-10-06", created_at="2026-10-06T00:00:00Z", amount=200, balance_posted=False, description="yazilmadi"),
        _tx(
            _id="card-ptr", account_id="acc-other", customer_card_account_id=ACC, date="2026-10-05",
            created_at="2026-10-05T00:00:00Z", amount=3, description="kart isareti",
        ),
        _tx(
            _id="via-card", customer_card_account_id=POOL, via_customer_card=True, date="2026-10-04",
            created_at="2026-10-04T00:00:00Z", amount=30, description="musteri karti",
        ),
        _tx(
            _id="pool-led", account_id=POOL, customer_card_pool_ledger=True, date="2026-10-03",
            created_at="2026-10-03T00:00:00Z", amount=50, description="havuz",
        ),
        _tx(
            _id="stmt-card", account_id=CARD, date="2026-10-01", created_at="2026-10-01T00:00:00Z",
            type="outflow", amount=500, source="card_statement", description="kart ekstre",
        ),
        _tx(_id="other-acc", account_id="acc-z", date="2026-10-16", created_at="2026-10-16T00:00:00Z", amount=50, description="baska"),
        _tx(_id="foreign", company_id=OTHER, date="2026-10-16", created_at="2026-10-16T23:00:00Z", amount=10000, description="baska firma"),
    ]
    return accounts, txs


def _legacy_instant(value):
    """Europe/Istanbul. Tarih-only ve gg.aa.yyyy yerel gün; naif ISO UTC."""
    raw = str(value or "").strip()
    if not raw:
        return None
    dmy = bank_tx_page._DMY.match(raw)
    if dmy:
        ymd = f"{dmy.group(3)}-{int(dmy.group(2)):02d}-{int(dmy.group(1)):02d}"
        day = datetime.strptime(ymd, "%Y-%m-%d").date()
        return datetime.combine(day, time.min, tzinfo=IST)
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        day = datetime.strptime(raw, "%Y-%m-%d").date()
        return datetime.combine(day, time.min, tzinfo=IST)
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def _legacy_in_range(tx, date_from, date_to):
    if not date_from and not date_to:
        return True
    instant = _legacy_instant(tx.get("date"))
    if instant is None:
        return False
    if date_from:
        start = datetime.combine(datetime.strptime(date_from, "%Y-%m-%d").date(), time.min, tzinfo=IST)
        if instant < start:
            return False
    if date_to:
        end = datetime.combine(datetime.strptime(date_to, "%Y-%m-%d").date(), time.min, tzinfo=IST)
        end = end.replace(hour=0) + __import__("datetime").timedelta(days=1)
        # end was built at midnight; add a day for exclusive bound
        if instant >= end:
            return False
    return True


def _legacy_matches(tx, account_id):
    return (
        tx.get("account_id") == account_id
        or tx.get("target_account_id") == account_id
        or tx.get("customer_card_account_id") == account_id
    )


def _legacy_sort(rows):
    def key(tx):
        created = str(tx.get("created_at") or tx.get("matched_at") or "")
        return (bank_tx_page.date_sort_key(tx.get("date")), created, str(tx.get("_id") or tx.get("id") or ""))
    return sorted(rows, key=key, reverse=True)


def _legacy_flows(rows, account_id, account):
    inflow = outflow = 0.0
    for tx in rows:
        signed = account_balance.tx_signed_amount(tx, account_id, account)
        if signed > 0:
            inflow += signed
        elif signed < 0:
            outflow += -signed
    return round(inflow, 2), round(outflow, 2)


def _legacy_rows(all_txs, account, *, date_from="", date_to="", q="", tx_type="", matched="all"):
    aid = account["_id"]
    rows = [tx for tx in all_txs if tx.get("company_id") == account.get("company_id") and _legacy_matches(tx, aid)]
    kept = []
    for tx in rows:
        if not _legacy_in_range(tx, date_from, date_to):
            continue
        if tx_type and str(tx.get("type") or "") != tx_type:
            continue
        if matched == "yes" and str(tx.get("match_status") or "") != "matched":
            continue
        if matched == "no" and str(tx.get("match_status") or "") == "matched":
            continue
        if q and q.casefold() not in str(tx.get("description") or "").casefold():
            continue
        kept.append(tx)
    return _legacy_sort(kept)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else key
        return self

    async def to_list(self, length=None):
        from mysql_store import sort_docs
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, db, name, docs):
        self.db = db
        self.name = name
        self.docs = docs

    def _match(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        self.db.log.append(("find", self.name, copy.deepcopy(query)))
        return MemCursor(self._match(query))

    async def find_one(self, query=None, projection=None):
        self.db.log.append(("find_one", self.name, copy.deepcopy(query)))
        rows = self._match(query)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, *args, **kwargs):
        self.db.writes.append(("update", self.name))

    async def insert_one(self, *args, **kwargs):
        self.db.writes.append(("insert", self.name))

    async def delete_one(self, *args, **kwargs):
        self.db.writes.append(("delete", self.name))


class MemDB:
    def __init__(self, accounts, txs):
        self.log = []
        self.writes = []
        self.bank_accounts = MemColl(self, "bank_accounts", accounts)
        self.bank_transactions = MemColl(self, "bank_transactions", txs)

    def __getitem__(self, name):
        return getattr(self, name)


def _account(db, aid):
    return next(a for a in db.bank_accounts.docs if a["_id"] == aid)


def _run(coro):
    return asyncio.run(coro)


async def _collect(db, account, page_size=2, **filters):
    page = 1
    ids = []
    bodies = []
    while page < 50:
        body = await bank_tx_page.list_account_transactions(
            db, account, page=page, page_size=page_size, **filters,
        )
        bodies.append(body)
        ids.extend(item["id"] for item in body["items"])
        if not body["has_more"]:
            return ids, bodies
        page += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


def test_legs_push_order_by_limit_without_or():
    from mysql_store import plan_exact_page

    src = Path(__file__).resolve().parents[1].joinpath("bank_tx_page.py").read_text(encoding="utf-8")
    assert '"$or"' not in src and "'$or'" not in src
    server = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    assert 'db.bank_transactions.find(query).sort("date", -1).to_list(2000)' in server
    assert '"/banking/accounts/{account_id}/transactions"' in server
    for query in bank_tx_page.member_queries(CID, ACC):
        assert "$or" not in query
        plan = plan_exact_page(
            "bank_transactions", query, bank_tx_page.TX_SORT, 0, None, bank_tx_page.FETCH_CAP, None,
        )
        assert plan is not None
        assert "ORDER BY" in plan["sql"] and "LIMIT %s" in plan["sql"]
        assert plan["params"][-1] == bank_tx_page.FETCH_CAP
        sql = plan["sql"]
        assert not ("target_account_id" in sql and "customer_card_account_id" in sql)


def test_page_matches_client_set_order_and_signed_totals():
    accounts, txs = _seed_docs()
    db = MemDB(copy.deepcopy(accounts), copy.deepcopy(txs))
    account = _account(db, ACC)
    before = copy.deepcopy(accounts)
    before_txs = copy.deepcopy(txs)

    async def _go():
        ids, bodies = await _collect(db, account, page_size=2)
        tail = await bank_tx_page.list_account_transactions(db, account, page=99, page_size=2)
        wide = await bank_tx_page.list_account_transactions(db, account, page=1, page_size=999)
        focused = await bank_tx_page.list_account_transactions(
            db, account, page=1, page_size=2, focus_tx_id="ist-day",
        )
        day = await bank_tx_page.list_account_transactions(
            db, account, page=1, page_size=50, date_from="2026-10-16", date_to="2026-10-16",
        )
        only_matched = await bank_tx_page.list_account_transactions(
            db, account, page=1, page_size=50, matched="yes",
        )
        transfers = await bank_tx_page.list_account_transactions(
            db, account, page=1, page_size=50, tx_type="transfer",
        )
        searched = await bank_tx_page.list_account_transactions(
            db, account, page=1, page_size=50, q="özel damga",
        )
        pool = await bank_tx_page.list_account_transactions(db, _account(db, POOL), page=1, page_size=50)
        card = await bank_tx_page.list_account_transactions(db, _account(db, CARD), page=1, page_size=50)
        return ids, bodies, tail, wide, focused, day, only_matched, transfers, searched, pool, card

    ids, bodies, tail, wide, focused, day, only_matched, transfers, searched, pool, card = _run(_go())
    legacy = _legacy_rows(txs, account)
    assert [tx["_id"] for tx in legacy] == EXPECTED_ORDER
    assert ids == EXPECTED_ORDER
    assert _legacy_flows(legacy, ACC, account) == (EXPECTED_INFLOW, EXPECTED_OUTFLOW)
    for body in bodies:
        assert body["period_inflow"] == EXPECTED_INFLOW
        assert body["period_outflow"] == EXPECTED_OUTFLOW
        assert body["total"] == len(EXPECTED_ORDER)
    assert tail["items"] == []
    assert tail["period_inflow"] == EXPECTED_INFLOW
    assert tail["period_outflow"] == EXPECTED_OUTFLOW
    assert wide["page_size"] == 200
    assert len(wide["items"]) == len(EXPECTED_ORDER)
    assert focused["focus_page"] == 2
    assert [item["id"] for item in day["items"]] == ["z-new", "ist-day", "ist-late"]
    assert "ist-next" not in {item["id"] for item in day["items"]}
    assert day["period_inflow"] == 16.0
    assert day["period_outflow"] == 0.0
    assert [item["id"] for item in only_matched["items"]] == ["matched"]
    assert only_matched["period_inflow"] == 15.0
    assert [item["id"] for item in transfers["items"]] == ["tr-in", "tr-out"]
    assert transfers["period_inflow"] == 80.0
    assert transfers["period_outflow"] == 25.0
    assert [item["id"] for item in searched["items"]] == ["z-new"]
    cancel = next(item for item in wide["items"] if item["id"] == "cancel")
    assert cancel["balance_delta"] == 0.0 and cancel["side"] == "zero"
    incoming = next(item for item in wide["items"] if item["id"] == "tr-in")
    assert incoming["balance_delta"] == 80.0 and incoming["side"] == "in"
    assert [item["id"] for item in pool["items"]] == ["via-card", "pool-led"]
    assert pool["period_inflow"] == 0.0 and pool["period_outflow"] == 0.0
    assert [item["id"] for item in card["items"]] == ["stmt-card"]
    assert card["period_inflow"] == 0.0 and card["period_outflow"] == 0.0
    assert db.writes == []
    assert accounts == before
    assert txs == before_txs
    stored = {tx["_id"]: tx["amount"] for tx in txs}
    wide["items"][0]["amount"] = -1
    assert txs[0]["amount"] == stored[txs[0]["_id"]]


def test_queries_are_separate_equalities():
    accounts, txs = _seed_docs()
    db = MemDB(accounts, txs)

    async def _go():
        db.log.clear()
        await bank_tx_page.list_account_transactions(db, _account(db, ACC), page=1, page_size=50)
        return [entry for entry in db.log if entry[0] == "find"]

    finds = _run(_go())
    assert len(finds) == 3
    assert [q for _, _, q in finds] == bank_tx_page.member_queries(CID, ACC)
    assert all("$or" not in q for _, _, q in finds)


def test_other_company_is_404_and_page_size_caps():
    accounts, txs = _seed_docs()
    db = MemDB(accounts, txs)
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        from fastapi import HTTPException
        own = await bank_tx_page.list_account_transactions_for_user(db, user_c1, ACC, page=1, page_size=500)
        missing = foreign = None
        try:
            await bank_tx_page.list_account_transactions_for_user(db, user_c2, ACC, page=1, page_size=50)
        except HTTPException as exc:
            foreign = exc.status_code
        try:
            await bank_tx_page.list_account_transactions_for_user(db, user_c1, "yok", page=1, page_size=50)
        except HTTPException as exc:
            missing = exc.status_code
        bad = None
        try:
            await bank_tx_page.list_account_transactions(db, _account(db, ACC), matched="maybe")
        except HTTPException as exc:
            bad = exc.status_code
        return own, foreign, missing, bad

    own, foreign, missing, bad = _run(_go())
    assert own["page_size"] == 200
    assert own["total"] == len(EXPECTED_ORDER)
    assert foreign == 404
    assert missing == 404
    assert bad == 400
    assert db.writes == []
    assert next(a for a in accounts if a["_id"] == CARD)["current_balance"] == -80.0
    assert next(a for a in accounts if a["_id"] == CARD)["card_limit"] == 5000
    assert next(a for a in accounts if a["_id"] == ACC)["current_balance"] == 1234.56


def test_istanbul_boundary_is_not_utc_day():
    late = _legacy_instant("2026-10-15T21:30:00Z")
    nxt = _legacy_instant("2026-10-16T21:30:00Z")
    assert late.strftime("%Y-%m-%d %H:%M") == "2026-10-16 00:30"
    assert nxt.strftime("%Y-%m-%d %H:%M") == "2026-10-17 00:30"
    assert bank_tx_page.tx_in_istanbul_range({"date": "2026-10-15T21:30:00Z"}, "2026-10-16", "2026-10-16")
    assert not bank_tx_page.tx_in_istanbul_range({"date": "2026-10-16T21:30:00Z"}, "2026-10-16", "2026-10-16")
    assert bank_tx_page.tx_in_istanbul_range({"date": "2026-10-16"}, "2026-10-16", "2026-10-16")
    assert bank_tx_page.tx_in_istanbul_range({"date": "16.10.2026"}, "2026-10-16", "2026-10-16")


# --- MySQL: iki pushdown modu. Canlı DSN okunmaz. -------------------------

_LOCAL = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "tamkobi",
    "password": "tamkobi",
    "db": "tamkobi_pushdown",
}


def _mysql_settings():
    url = (os.environ.get("TAMKOBI_TEST_MYSQL_URL") or "").strip()
    if not url:
        return dict(_LOCAL)
    if url.startswith("mysql+"):
        url = "mysql://" + url.split("://", 1)[1]
    if not url.startswith("mysql://"):
        blocked = dict(_LOCAL)
        blocked["db"] = url
        return blocked
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or "tamkobi"),
        "password": unquote(parsed.password or ""),
        "db": (parsed.path or "").lstrip("/").split("?")[0],
        "charset": "utf8mb4",
        "autocommit": True,
    }


def _require_mysql():
    settings = _mysql_settings()
    name = str(settings.get("db") or "").lower()
    if "test" not in name and "pushdown" not in name:
        pytest.skip("hedef veritabanı adı test veya pushdown içermiyor")
    import pymysql
    try:
        conn = pymysql.connect(
            host=settings["host"],
            port=int(settings["port"]),
            user=settings["user"],
            password=settings["password"],
            database=settings["db"],
            charset="utf8mb4",
            connect_timeout=3,
        )
    except (pymysql.err.OperationalError, ConnectionRefusedError, ConnectionError, OSError):
        pytest.skip("MySQL test sunucusu yok")
    else:
        conn.close()
    return settings


def test_mysql_pushdown_on_and_off_match_legacy():
    settings = _require_mysql()
    from mysql_store import MySQLDatabase

    accounts, txs = _seed_docs()
    cid = "c-page-" + uuid.uuid4().hex[:10]
    aid = "acc-" + uuid.uuid4().hex[:8]
    pool_id = "pool-" + uuid.uuid4().hex[:8]
    id_map = {ACC: aid, POOL: pool_id}

    def _rewrite(doc):
        row = copy.deepcopy(doc)
        if row.get("company_id") == CID:
            row["company_id"] = cid
        for key in ("_id", "account_id", "target_account_id", "customer_card_account_id"):
            if row.get(key) in id_map:
                row[key] = id_map[row[key]]
        return row

    accounts = [_rewrite(a) for a in accounts if a["company_id"] == CID]
    txs = [_rewrite(t) for t in txs if t["company_id"] == CID]
    account = next(a for a in accounts if a["_id"] == aid)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        try:
            for doc in accounts:
                await db.bank_accounts.insert_one(doc)
            for doc in txs:
                await db.bank_transactions.insert_one(doc)
            before_acc = await db.bank_accounts.find_one({"_id": aid})
            before_card = await db.bank_accounts.find_one({"_id": CARD})
            before_tx = await db.bank_transactions.find_one({"_id": txs[0]["_id"]})
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                sqls = []
                orig = db.bank_transactions._fetch_rows

                async def _wrap(sql, params, _orig=orig, _sqls=sqls):
                    _sqls.append(" ".join(sql.split()))
                    return await _orig(sql, params)

                db.bank_transactions._fetch_rows = _wrap
                try:
                    ids, bodies = await _collect(db, account, page_size=2)
                finally:
                    db.bank_transactions._fetch_rows = orig
                results.append((flag, ids, bodies[0], sqls))
            after_acc = await db.bank_accounts.find_one({"_id": aid})
            after_card = await db.bank_accounts.find_one({"_id": CARD})
            after_tx = await db.bank_transactions.find_one({"_id": txs[0]["_id"]})
            return results, before_acc, after_acc, before_card, after_card, before_tx, after_tx
        finally:
            await db.bank_accounts.delete_many({"company_id": cid})
            await db.bank_transactions.delete_many({"company_id": cid})
            await db.close()

    results, before_acc, after_acc, before_card, after_card, before_tx, after_tx = _run(_go())
    legacy_ids = [tx["_id"] for tx in _legacy_rows(txs, account)]
    assert legacy_ids
    seen = {}
    for flag, ids, first, sqls in results:
        assert ids == legacy_ids
        assert first["period_inflow"] == _legacy_flows(_legacy_rows(txs, account), aid, account)[0]
        assert first["period_outflow"] == _legacy_flows(_legacy_rows(txs, account), aid, account)[1]
        seen[flag] = (ids, first["period_inflow"], first["period_outflow"])
        if flag == "1":
            pages = [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
            assert pages, sqls
            for statement in pages:
                named = [
                    "target_account_id" in statement,
                    "customer_card_account_id" in statement,
                    "account_id = %s" in statement or "account_id=%s" in statement,
                ]
                assert sum(named) == 1, statement
        else:
            assert not [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
    assert seen["0"] == seen["1"]
    assert before_acc["current_balance"] == after_acc["current_balance"] == 1234.56
    assert before_tx["amount"] == after_tx["amount"]
    assert before_card["current_balance"] == after_card["current_balance"] == -80.0
    assert before_card["card_limit"] == after_card["card_limit"] == 5000
