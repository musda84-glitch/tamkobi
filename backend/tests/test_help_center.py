"""Unit tests for help-center schema, search, product tags, and assistant context."""
from help_center import (
    PRODUCT_TAMETICARET,
    PRODUCT_TAMKOBI,
    SEED_ARTICLES,
    STATUS_PUBLISHED,
    article_matches_query,
    build_assistant_context,
    filter_published,
    fold_text,
    normalize_assistant,
    normalize_page_keys,
    normalize_product_tags,
    public_article,
    slugify,
    _seed_doc,
)


def test_slugify_turkish():
    assert slugify("Satış Faturası Nasıl Kesilir?") == "satis-faturasi-nasil-kesilir"
    assert slugify("  ") == "makale"


def test_product_tags_default_and_filter():
    assert normalize_product_tags(None) == [PRODUCT_TAMKOBI]
    assert normalize_product_tags(["tameticaret", "tamkobi", "tamkobi", "other"]) == [
        PRODUCT_TAMETICARET,
        PRODUCT_TAMKOBI,
    ]


def test_page_keys_normalized():
    assert normalize_page_keys(["invoices", "/invoices", "/contacts"]) == ["/invoices", "/contacts"]


def test_search_matches_folded_turkish_and_keywords():
    doc = {
        "title": "e-Fatura bağlantısı",
        "summary": "İşNet VKN",
        "body_md": "Entegratör",
        "tags": ["gib"],
        "assistant": {"keywords": ["e-fatura"]},
        "page_keys": ["/settings"],
    }
    assert article_matches_query(doc, "efatura")
    assert article_matches_query(doc, "İŞNET")
    assert not article_matches_query(doc, "bordro")
    assert fold_text("ÇĞİÖŞÜ") == "cgiosu"


def test_filter_published_by_product_and_page():
    now = "2026-01-01T00:00:00+00:00"
    rows = [_seed_doc(s, now) for s in SEED_ARTICLES]
    tk = filter_published(rows, product=PRODUCT_TAMKOBI)
    te = filter_published(rows, product=PRODUCT_TAMETICARET)
    assert tk
    assert all(PRODUCT_TAMKOBI in d["product_tags"] for d in tk)
    assert te
    assert all(PRODUCT_TAMETICARET in d["product_tags"] for d in te)
    inv = filter_published(rows, product=PRODUCT_TAMKOBI, page_key="/invoices")
    assert inv
    assert all("/invoices" in d["page_keys"] for d in inv)
    videos = filter_published(rows, product=PRODUCT_TAMETICARET, content_type="video")
    assert videos and videos[0]["content_type"] == "video"


def test_public_article_hides_nothing_required_and_assistant_shape():
    doc = _seed_doc(SEED_ARTICLES[1], "2026-01-01T00:00:00+00:00")
    pub = public_article(doc, include_body=True)
    assert pub["slug"] == "fatura-nasil-kesilir"
    assert "body_md" in pub
    assert pub["assistant"]["intent"] == "create_invoice"
    listing = public_article(doc, include_body=False)
    assert "body_md" not in listing
    assert normalize_assistant(None)["suggested_prompts"] == []


def test_assistant_context_is_ai_ready():
    docs = [_seed_doc(SEED_ARTICLES[1], "2026-01-01T00:00:00+00:00")]
    ctx = build_assistant_context(
        product=PRODUCT_TAMKOBI,
        page_key="/invoices",
        page_summary="Faturalar ekranı",
        articles=docs,
    )
    assert ctx["chat_ready"] is False
    assert ctx["chat_endpoint"] == "/api/ai/help-chat"
    assert ctx["related_articles"][0]["slug"] == "fatura-nasil-kesilir"
    assert ctx["suggested_prompts"]
    assert "page_summary" in ctx


class _FakeCursor:
    def __init__(self, rows):
        self._rows = rows

    async def to_list(self, _n):
        return list(self._rows)


class _FakeColl:
    def __init__(self):
        self.docs = []

    async def find_one(self, q=None):
        q = q or {}
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                return d
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    def find(self, q=None):
        q = q or {}
        rows = []
        for d in self.docs:
            ok = True
            for k, v in q.items():
                val = d.get(k)
                if isinstance(val, list) and not isinstance(v, list):
                    if v not in val:
                        ok = False
                        break
                elif val != v:
                    ok = False
                    break
            if ok:
                rows.append(d)
        return _FakeCursor(rows)


def test_ensure_seeded_and_fetch(monkeypatch):
    import asyncio
    import help_center

    fake = type("DB", (), {"help_articles": _FakeColl()})()
    help_center.init(fake)

    async def run():
        n = await help_center.ensure_seeded(fake)
        assert n == len(help_center.SEED_ARTICLES)
        assert await help_center.ensure_seeded(fake) == 0
        rows = await help_center.fetch_published(product="tamkobi", q="fatura")
        assert any(r["slug"] == "fatura-nasil-kesilir" for r in rows)
        te = await help_center.fetch_published(product="tameticaret")
        assert te and all("tameticaret" in r["product_tags"] for r in te)

    asyncio.run(run())


def test_seed_covers_both_products():
    tags = set()
    for s in SEED_ARTICLES:
        tags.update(normalize_product_tags(s.get("product_tags")))
    assert PRODUCT_TAMKOBI in tags and PRODUCT_TAMETICARET in tags
    assert all(s.get("slug") for s in SEED_ARTICLES)
    statuses = {STATUS_PUBLISHED}
    assert statuses
