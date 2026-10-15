"""Çok siteli vitrin: migration, host, tamkobi davranışı, form hız sınırı."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import public_sites
import saas


class FakeColl:
    def __init__(self):
        self.docs = {}

    def _match(self, doc, query):
        for key, val in (query or {}).items():
            if key.startswith("$"):
                continue
            if isinstance(val, dict):
                if "$ne" in val and doc.get(key) == val["$ne"]:
                    return False
                continue
            if doc.get(key) != val:
                return False
        return True

    async def find_one(self, query, *args, **kwargs):
        for doc in self.docs.values():
            if self._match(doc, query):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, query, upd, upsert=False):
        found = None
        for doc in self.docs.values():
            if self._match(doc, query):
                found = doc
                break
        if found is None:
            if not upsert:
                return MagicMock(modified_count=0)
            found = {"_id": query.get("_id") or f"id_{len(self.docs)}"}
            self.docs[found["_id"]] = found
        if "$set" in upd:
            found.update(upd["$set"])
        if "$inc" in upd:
            for key, val in upd["$inc"].items():
                found[key] = int(found.get(key) or 0) + int(val)
        self.docs[found["_id"]] = found
        return MagicMock(modified_count=1)

    def find(self, query=None):
        query = query or {}
        matched = [dict(d) for d in self.docs.values() if self._match(d, query)]

        class Cur:
            def __init__(self, rows):
                self.rows = rows

            def sort(self, *args, **kwargs):
                return self

            async def to_list(self, limit=100):
                return self.rows[:limit]

        return Cur(matched)


class FakeDB:
    def __init__(self):
        self.platform_settings = FakeColl()
        self.sites = FakeColl()
        self.site_content = FakeColl()
        self.site_inquiries = FakeColl()
        self.site_inquiry_rate = FakeColl()


def _client(db, *, admin=False):
    public_sites.init(db)
    app = FastAPI()
    app.include_router(public_sites.router)
    app.include_router(public_sites.seo_router)
    if admin:
        app.dependency_overrides[saas.require_super_admin] = lambda: {"_id": "sa", "is_super_admin": True}
    return TestClient(app)


@pytest.fixture
def db(monkeypatch):
    monkeypatch.setattr(public_sites, "RATE_MAX", 5)
    fake = FakeDB()
    public_sites.init(fake)
    return fake


def test_migration_copies_tamkobi_and_does_not_overwrite(db):
    async def run():
        await db.platform_settings.insert_one({
            "_id": "platform",
            "brand_name": "Özel Marka",
            "public_url": "https://tamkobi.com",
        })
        await public_sites.ensure_seeded()
        site = await db.sites.find_one({"_id": "site_tamkobi"})
        assert site["slug"] == "tamkobi"
        assert site["brand_name"] == "Özel Marka"
        assert site["public_url"] == "https://tamkobi.com"
        assert site["theme"] == "vitrin"
        assert site["active"] is True
        assert "tamkobi.com" in site["hosts"]
        assert "www.tamkobi.com" in site["hosts"]
        tai = await db.sites.find_one({"slug": "tai"})
        assert tai["brand_name"] == "TAI Yazılım"
        assert tai["public_url"] == "https://taiyazilim.com"
        assert tai["theme"] == "corporate"
        assert "ynt.taiyazilim.com" not in tai["hosts"]
        content = await db.site_content.find_one({"_id": "site_tai"})
        assert any(p["id"] == "prd_tamkobi" for p in content["products"])
        await db.platform_settings.update_one({"_id": "platform"}, {"$set": {"brand_name": "Başka"}})
        await public_sites.ensure_seeded()
        again = await db.sites.find_one({"_id": "site_tamkobi"})
        assert again["brand_name"] == "Özel Marka"

    import asyncio
    asyncio.run(run())


def test_host_serves_matching_site(db):
    c = _client(db)
    tam = c.get("/api/public/site", headers={"host": "tamkobi.com"})
    assert tam.status_code == 200
    body = tam.json()
    assert body["slug"] == "tamkobi"
    assert body["theme"] == "vitrin"
    assert body["content"] is None
    www = c.get("/api/public/site", headers={"host": "www.tamkobi.com"})
    assert www.json()["slug"] == "tamkobi"
    tai = c.get("/api/public/site", headers={"host": "taiyazilim.com"})
    assert tai.status_code == 200
    tai_body = tai.json()
    assert tai_body["slug"] == "tai"
    assert tai_body["theme"] == "corporate"
    assert tai_body["colors"]["navy"] == "#13295B"
    assert tai_body["colors"]["red"] == "#CC1F26"
    assert tai_body["logo"].endswith("/brand/tai/logo-v1.svg")
    assert any(p["title"] == "TamKobi" for p in tai_body["content"]["products"])
    wtai = c.get("/api/public/site", headers={"host": "www.taiyazilim.com"})
    assert wtai.json()["slug"] == "tai"
    ynt = c.get("/api/public/site", headers={"host": "ynt.taiyazilim.com"})
    assert ynt.status_code == 404
    preview = c.get("/api/public/site?slug=tai", headers={"host": "ynt.taiyazilim.com"})
    assert preview.status_code == 200
    assert preview.json()["slug"] == "tai"


def test_tamkobi_robots_and_sitemap_stay_on_vitrin(db):
    c = _client(db)
    robots = c.get("/robots.txt", headers={"host": "tamkobi.com"})
    assert robots.status_code == 200
    text = robots.text
    assert "Allow: /web" in text
    assert "Sitemap: https://tamkobi.com/sitemap.xml" in text
    assert "Allow: /hakkimizda" not in text
    sm = c.get("/sitemap.xml", headers={"host": "www.tamkobi.com"})
    assert "https://tamkobi.com/web" in sm.text
    assert "https://tamkobi.com/kayit" in sm.text
    assert "/hakkimizda" not in sm.text
    app = c.get("/robots.txt", headers={"host": "app.tamkobi.com"})
    assert "Disallow: /" in app.text
    ynt = c.get("/robots.txt", headers={"host": "ynt.taiyazilim.com"})
    assert "Disallow: /" in ynt.text


def test_tai_sitemap_is_separate(db):
    c = _client(db)
    robots = c.get("/robots.txt", headers={"host": "taiyazilim.com"})
    assert "Allow: /hakkimizda" in robots.text
    assert "Sitemap: https://taiyazilim.com/sitemap.xml" in robots.text
    sm = c.get("/sitemap.xml", headers={"host": "www.taiyazilim.com"})
    assert "https://taiyazilim.com/iletisim" in sm.text
    assert "https://tamkobi.com/web" not in sm.text


def test_hidden_card_drops_from_public_site(db):
    c = _client(db, admin=True)
    c.get("/api/public/site", headers={"host": "taiyazilim.com"})
    current = c.get("/api/system/sites/tai").json()["content"]
    current["services"][0]["published"] = False
    saved = c.put("/api/system/sites/tai/content", json=current)
    assert saved.status_code == 200
    public = c.get("/api/public/site", headers={"host": "taiyazilim.com"}).json()
    titles = [row["title"] for row in public["content"]["services"]]
    assert current["services"][0]["title"] not in titles
    blocked = c.put("/api/system/sites/tamkobi/content", json=current)
    assert blocked.status_code == 400


def test_contact_honeypot_rate_limit_and_general_mailbox(db, monkeypatch):
    sent = {}

    async def fake_resolve(purpose=None):
        sent["purpose"] = purpose
        return {"email": "info@taiyazilim.com", "mailbox_id": "pmb_1", "display_name": "TAI"}

    async def fake_send(account, to, subject, body, html=None):
        sent["to"] = list(to)
        sent["subject"] = subject
        sent["reply_to"] = account.get("reply_to")

    monkeypatch.setattr("platform_mail.resolve_smtp_account", fake_resolve)
    monkeypatch.setattr("comm_service.smtp_send", fake_send)
    monkeypatch.setattr(public_sites, "RATE_MAX", 2)
    c = _client(db)
    headers = {"host": "taiyazilim.com", "x-forwarded-for": "198.51.100.20"}
    honey = c.post("/api/public/site/contact", json={
        "name": "Bot", "email": "bot@ornek.com", "message": "spam mesajı", "hp_company": "http://spam.example",
    }, headers=headers)
    assert honey.status_code == 200
    assert db.site_inquiries.docs == {}
    ok = c.post("/api/public/site/contact", json={
        "name": "Ayşe", "email": "ayse@ornek.com", "phone": "0500", "message": "Proje hakkında",
    }, headers=headers)
    assert ok.status_code == 200
    assert ok.json()["mail_status"] == "sent"
    assert sent["purpose"] == "general"
    assert "info@taiyazilim.com" in sent["to"]
    assert sent["reply_to"] == "ayse@ornek.com"
    c.post("/api/public/site/contact", json={
        "name": "Ayşe", "email": "ayse@ornek.com", "message": "İkinci mesaj yeter",
    }, headers=headers)
    limited = c.post("/api/public/site/contact", json={
        "name": "Ayşe", "email": "ayse@ornek.com", "message": "Üçüncü mesaj olmaz",
    }, headers=headers)
    assert limited.status_code == 429
    assert len(db.site_inquiries.docs) == 2
    other = c.post("/api/public/site/contact", json={
        "name": "Veli", "email": "veli@ornek.com", "message": "Başka IP geçer",
    }, headers={"host": "www.taiyazilim.com", "x-forwarded-for": "198.51.100.21"})
    assert other.status_code == 200
    tam = c.post("/api/public/site/contact", json={
        "name": "Veli", "email": "veli@ornek.com", "message": "Tamkobi formu yok",
    }, headers={"host": "tamkobi.com"})
    assert tam.status_code == 404


def test_only_super_admin_edits(db, monkeypatch):
    open_client = _client(db)
    assert open_client.get("/api/system/sites").status_code == 401

    async def tenant(*args, **kwargs):
        return {"_id": "u1", "is_super_admin": False, "email": "a@b.com"}

    monkeypatch.setattr(saas, "get_user_from_token", tenant)
    monkeypatch.setattr(saas, "session_token", lambda request: "tok")
    denied = _client(db)
    res = denied.put("/api/system/sites/tai", json={"brand_name": "Hack"})
    assert res.status_code == 403

    admin = _client(db, admin=True)
    saved = admin.put("/api/system/sites/tamkobi", json={"brand_name": "TamKobi Özel", "public_url": "https://tamkobi.com"})
    assert saved.status_code == 200
    assert saved.json()["brand_name"] == "TamKobi Özel"
    assert saved.json()["theme"] == "vitrin"
    mirrored = db.platform_settings.docs["platform"]["brand_name"]
    assert mirrored == "TamKobi Özel"
