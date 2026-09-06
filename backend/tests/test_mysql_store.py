"""Unit tests for the MySQL document-store query/update engine (no live DB required)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mysql_store import (
    apply_update,
    match_query,
    mysql_settings_from_env,
    project_doc,
    sort_docs,
)


def test_eq_and_array_contains():
    doc = {"_id": "u1", "email": "a@b.com", "company_ids": ["c1", "c2"], "role": "admin"}
    assert match_query(doc, {"email": "a@b.com"})
    assert match_query(doc, {"company_ids": "c1"})
    assert not match_query(doc, {"company_ids": "c9"})
    assert match_query(doc, {"role": {"$ne": "sales"}})
    assert match_query(doc, {"missing": None})


def test_in_nin_exists_regex():
    doc = {"name": "Acme A.Ş.", "status": "draft", "sku": "ABC-1"}
    assert match_query(doc, {"status": {"$in": ["draft", "sent"]}})
    assert match_query(doc, {"status": {"$nin": ["cancelled"]}})
    assert match_query(doc, {"name": {"$regex": "acme", "$options": "i"}})
    assert match_query(doc, {"tax": {"$exists": False}})
    assert not match_query(doc, {"name": {"$exists": False}})


def test_or_and_dotted():
    doc = {"company_id": "c1", "approval": {"token": "tok-9"}, "variants": [{"variant_id": "v1", "sku": "S"}, {"variant_id": "v2"}]}
    assert match_query(doc, {"$or": [{"company_id": "x"}, {"approval.token": "tok-9"}]})
    assert match_query(doc, {"variants.variant_id": "v2"})
    assert not match_query(doc, {"variants.variant_id": "v9"})


def test_expr_low_stock():
    low = {"stock_quantity": 2, "min_stock_alert": 5, "track_stock": True}
    ok = {"stock_quantity": 20, "min_stock_alert": 5, "track_stock": True}
    missing = {"stock_quantity": 1, "track_stock": True}
    q = {"$expr": {"$lte": ["$stock_quantity", {"$ifNull": ["$min_stock_alert", 5]}]}}
    assert match_query(low, q)
    assert not match_query(ok, q)
    assert match_query(missing, q)


def test_apply_set_inc_push_addtoset_positional():
    doc = {"_id": "p1", "hits": 1, "images": ["a"], "variants": [{"variant_id": "v1", "image_url": None}, {"variant_id": "v2"}]}
    out = apply_update(doc, {"$inc": {"hits": 2}, "$push": {"images": "b"}, "$addToSet": {"tags": "x"}}, {"_id": "p1"})
    assert out["hits"] == 3
    assert out["images"] == ["a", "b"]
    assert out["tags"] == ["x"]
    out2 = apply_update(doc, {"$set": {"variants.$.image_url": "/img"}}, {"_id": "p1", "variants.variant_id": "v2"})
    assert out2["variants"][1]["image_url"] == "/img"
    assert out2["variants"][0]["image_url"] is None


def test_set_on_insert_and_nested():
    out = apply_update({}, {"$set": {"name": "A"}, "$setOnInsert": {"_id": "n1", "hits": 0}}, {}, is_insert=True)
    assert out["_id"] == "n1" and out["name"] == "A" and out["hits"] == 0
    out2 = apply_update({"preferences": {}}, {"$set": {"preferences.theme": "dark"}})
    assert out2["preferences"]["theme"] == "dark"


def test_project_and_sort():
    docs = [{"_id": "2", "name": "B", "n": 2}, {"_id": "1", "name": "A", "n": 1}]
    s = sort_docs(docs, [("n", 1)])
    assert [d["_id"] for d in s] == ["1", "2"]
    p = project_doc(docs[0], {"name": 1})
    assert p["name"] == "B" and "n" not in p and p["_id"] == "2"


def test_mysql_settings_from_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("MYSQL_URL", "mysql://alice:s3cret@db.example:3307/nexus")
    s = mysql_settings_from_env()
    assert s["host"] == "db.example"
    assert s["port"] == 3307
    assert s["user"] == "alice"
    assert s["password"] == "s3cret"
    assert s["db"] == "nexus"


def test_database_url_sqlalchemy_style(monkeypatch):
    monkeypatch.delenv("MYSQL_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "mysql+pymysql://bob:pw@127.0.0.1:3306/tamkobi")
    s = mysql_settings_from_env()
    assert s["host"] == "127.0.0.1"
    assert s["user"] == "bob"
    assert s["password"] == "pw"
    assert s["db"] == "tamkobi"
