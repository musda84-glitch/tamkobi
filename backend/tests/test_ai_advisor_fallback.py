"""Finans danışmanı yedeği sayaçlardan üretilir ve kaynağı işaretlenir.

Yapılandırma hatası (anahtar yok, AI kapalı) ile sağlayıcı hatası ayrıdır.
Ürün eşleştirme yedek veya config_error metnini JSON sanıp önermez.
"""
import asyncio
import copy
import os
import sys
from pathlib import Path

os.environ.setdefault("JWT_SECRET", "test-ai-advisor-fallback-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import ai_service  # noqa: E402
import server  # noqa: E402

CTX = {
    "company_id": "c1",
    "company_name": "Test A.Ş.",
    "total_bank_balance": 1250.5,
    "total_receivables": 3400.25,
    "total_payables": 890.75,
    "monthly_sales": 15000,
    "monthly_expenses": 4200.5,
    "pending_orders_count": 17,
    "low_stock_count": 23,
}
EXACT = "  Nakit notu.\nİkinci satır aynen."
FORBIDDEN = ("yeterli seviyededir", "optimize edilebilir")


def _run(coro):
    return asyncio.run(coro)


class _Chat:
    def __init__(self, text=None, error=None):
        self.text = text
        self.error = error
        self.seen = None

    async def send_message(self, message):
        self.seen = getattr(message, "text", None)
        if self.error is not None:
            raise self.error
        return self.text


def _patch_chat(monkeypatch, chat=None, error=None):
    holder = {"chat": chat}

    async def _make(*_args, **_kwargs):
        if error is not None:
            raise error
        return holder["chat"]

    monkeypatch.setattr(ai_service, "make_chat", _make)
    return holder


def _assert_counters(text):
    assert "1,250.50" in text
    assert "3,400.25" in text
    assert "890.75" in text
    assert "15,000.00" in text
    assert "4,200.50" in text
    assert "17" in text
    assert "23" in text
    assert "yanıt veremedi" in text
    for phrase in FORBIDDEN:
        assert phrase not in text


def test_financial_provider_exception_is_counter_fallback(monkeypatch):
    _patch_chat(monkeypatch, error=TimeoutError("gecici"))

    async def _go():
        result = await ai_service.get_financial_ai_advice_result(CTX, "nakit özeti")
        text = await ai_service.get_financial_ai_advice(CTX, "nakit özeti")
        return result, text

    result, text = _run(_go())
    assert result["source"] == "fallback"
    assert result["error"]
    _assert_counters(result["advice"])
    assert isinstance(text, str)
    assert text == result["advice"]


def test_financial_missing_key_is_config_error(monkeypatch):
    message = "Yapay zeka API anahtarı yapılandırılmamış. Platform Yönetimi → AI Entegrasyonu ekranından anahtar girin."
    _patch_chat(monkeypatch, error=RuntimeError(message))

    async def _go():
        result = await ai_service.get_financial_ai_advice_result(CTX, "nakit")
        text = await ai_service.get_financial_ai_advice(CTX, "nakit")
        return result, text

    result, text = _run(_go())
    assert result["source"] == "config_error"
    assert result["error"] == message
    assert "anahtar" in result["error"]
    assert result["advice"] == message
    assert text == message
    for phrase in FORBIDDEN:
        assert phrase not in result["advice"]


def test_financial_disabled_ai_is_config_error(monkeypatch):
    message = "AI entegrasyonu platform panelinden kapatılmış."
    _patch_chat(monkeypatch, error=RuntimeError(message))
    result = _run(ai_service.get_financial_ai_advice_result(CTX, "nakit"))
    assert result["source"] == "config_error"
    assert result["error"] == message


def test_financial_provider_runtime_error_is_fallback_not_config(monkeypatch):
    chat = _Chat(error=RuntimeError("OpenAI sunucusuna ulaşılamadı: timeout"))
    _patch_chat(monkeypatch, chat=chat)
    result = _run(ai_service.get_financial_ai_advice_result(CTX, "nakit"))
    assert result["source"] == "fallback"
    _assert_counters(result["advice"])
    assert "ulaşılamadı" not in result["advice"]


def test_financial_success_returns_model_text(monkeypatch):
    chat = _Chat(text=EXACT)
    _patch_chat(monkeypatch, chat=chat)

    async def _go():
        result = await ai_service.get_financial_ai_advice_result(CTX, "soru metni")
        text = await ai_service.get_financial_ai_advice(CTX, "soru metni")
        return result, text

    result, text = _run(_go())
    assert result["source"] == "ai"
    assert result["error"] is None
    assert result["advice"] == EXACT
    assert text == EXACT
    assert chat.seen == "soru metni"


def test_advisor_failure_does_not_log_prompt_or_key(monkeypatch, caplog):
    prompt = "GIZLI-ISTEM-METNI-xyz"
    _patch_chat(monkeypatch, error=Exception("sk-SECRETKEYVALUE"))
    with caplog.at_level("DEBUG"):
        result = _run(ai_service.get_financial_ai_advice_result(CTX, prompt))
    assert result["source"] == "fallback"
    assert prompt not in caplog.text
    assert "sk-SECRETKEYVALUE" not in caplog.text


def test_production_exception_stays_counter_fallback(monkeypatch):
    _patch_chat(monkeypatch, error=TimeoutError("gecici"))
    ctx = {"open_orders": 4, "in_production": 2, "missing_notifications": 1, "open_work_orders": 3, "paused_work_orders": 1, "recipes": 8}
    result = _run(ai_service.get_production_ai_advice_result(ctx, "özet"))
    assert result["source"] == "fallback"
    assert "4" in result["advice"]
    assert "AI sağlayıcı geçici yanıt veremedi" in result["advice"]
    assert isinstance(_run(ai_service.get_production_ai_advice(ctx, "özet")), str)


def test_production_missing_key_is_config_error(monkeypatch):
    message = "Yapay zeka API anahtarı yapılandırılmamış."
    _patch_chat(monkeypatch, error=RuntimeError(message))
    result = _run(ai_service.get_production_ai_advice_result({"open_orders": 1}, "özet"))
    assert result["source"] == "config_error"
    assert result["error"] == message


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, length=None):
        rows = list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    def _match(self, doc, query):
        for key, expected in (query or {}).items():
            if isinstance(expected, dict):
                continue
            if doc.get(key) != expected:
                return False
        return True

    def find(self, query=None, projection=None):
        return _Cursor([doc for doc in self.docs if self._match(doc, query)])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if self._match(doc, query):
                return copy.deepcopy(doc)
        return None


class _DB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll([])
            self._cols[name] = coll
        return coll


def _user():
    return {
        "_id": "u1",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "is_super_admin": False,
        "role": "admin",
    }


def _seed_finance(db):
    db.companies.docs.append({"_id": "c1", "name": "Test A.Ş."})
    db.bank_accounts.docs.append({"_id": "b1", "company_id": "c1", "current_balance": 1250.5})
    db.contacts.docs.extend([
        {"_id": "ct1", "company_id": "c1", "balance": 3400.25},
        {"_id": "ct2", "company_id": "c1", "balance": -890.75},
    ])
    db.invoices.docs.extend([
        {"_id": "i1", "company_id": "c1", "invoice_type": "sales", "grand_total": 15000},
        {"_id": "i2", "company_id": "c1", "invoice_type": "purchase", "grand_total": 4200.5},
    ])
    db.orders.docs.append({"_id": "o1", "company_id": "c1", "order_status": "pending"})
    db.products.docs.append({
        "_id": "p-low", "company_id": "c1", "name": "Az", "sku": "AZ",
        "stock_quantity": 1, "min_stock_alert": 5, "track_stock": True,
    })


def test_financial_endpoint_marks_fallback_from_context(monkeypatch):
    _patch_chat(monkeypatch, error=TimeoutError("gecici"))
    db = _DB()
    _seed_finance(db)
    prev = server.db
    server.db = db

    async def _allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server.addons, "require", _allow)
    try:
        body = _run(server.ask_financial_ai(
            server.FinancialAIChatRequest(message="özet", company_id="c1"),
            _user(),
        ))
    finally:
        server.db = prev
    assert set(body) == {"advice", "metrics", "source", "fallback"}
    assert body["source"] == "fallback"
    assert body["fallback"] is True
    assert body["metrics"]["total_bank_balance"] == 1250.5
    assert body["metrics"]["total_receivables"] == 3400.25
    assert body["metrics"]["total_payables"] == 890.75
    assert body["metrics"]["monthly_sales"] == 15000
    assert body["metrics"]["monthly_expenses"] == 4200.5
    assert body["metrics"]["pending_orders_count"] == 1
    assert body["metrics"]["low_stock_count"] == 1
    assert "1,250.50" in body["advice"]
    assert "3,400.25" in body["advice"]
    assert "**Bekleyen sipariş:** 1" in body["advice"]
    assert "**Kritik stok:** 1" in body["advice"]
    for phrase in FORBIDDEN:
        assert phrase not in body["advice"]
    assert "yanıt veremedi" in body["advice"]


def test_financial_endpoint_marks_config_error(monkeypatch):
    message = "Yapay zeka API anahtarı yapılandırılmamış."
    _patch_chat(monkeypatch, error=RuntimeError(message))
    db = _DB()
    prev = server.db
    server.db = db

    async def _allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server.addons, "require", _allow)
    try:
        body = _run(server.ask_financial_ai(
            server.FinancialAIChatRequest(message="özet", company_id="c1"),
            _user(),
        ))
    finally:
        server.db = prev
    assert body["source"] == "config_error"
    assert body["fallback"] is False
    assert body["advice"] == message
    assert "error" not in body


def test_financial_endpoint_success_keeps_model_text(monkeypatch):
    chat = _Chat(text=EXACT)
    _patch_chat(monkeypatch, chat=chat)
    db = _DB()
    prev = server.db
    server.db = db

    async def _allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server.addons, "require", _allow)
    try:
        body = _run(server.ask_financial_ai(
            server.FinancialAIChatRequest(message="soru", company_id="c1"),
            _user(),
        ))
    finally:
        server.db = prev
    assert body["source"] == "ai"
    assert body["fallback"] is False
    assert body["advice"] == EXACT


def _match_products():
    return [{
        "_id": "p1",
        "company_id": "c1",
        "name": "Mavi seramik kupa 250ml",
        "sku": "KUPA",
        "barcode": "8690000000001",
        "marketplace_aliases": [],
    }]


def _match_req():
    return {
        "company_id": "c1",
        "use_ai": True,
        "rows": [{"barcode": "BC-WEAK", "title": "Mavi kupa", "stock_code": ""}],
    }


def _call_match():
    db = _DB()
    db.products.docs.extend(_match_products())
    prev = server.db
    server.db = db
    try:
        return _run(server.suggest_marketplace_product_matches(_match_req(), _user()))
    finally:
        server.db = prev


def _reasons(body):
    return [hit.get("reason") for hit in (body["suggestions"].get("BC-WEAK") or [])]


def test_product_match_skips_fallback_even_if_text_looks_like_json(monkeypatch):
    payload = '{"matches":[{"barcode":"BC-WEAK","product_id":"p1","confidence":0.95}]}'

    async def _fake(*_args, **_kwargs):
        return {"advice": payload, "source": "fallback", "error": "provider down"}

    monkeypatch.setattr(server, "get_financial_ai_advice_result", _fake)
    body = _call_match()
    assert "suggestions" in body
    assert body["mode"] == "smart"
    assert "ai" not in _reasons(body)
    assert _reasons(body)  # kural tabanlı öneri durur


def test_product_match_skips_config_error_json(monkeypatch):
    payload = '{"matches":[{"barcode":"BC-WEAK","product_id":"p1","confidence":0.95}]}'

    async def _fake(*_args, **_kwargs):
        return {"advice": payload, "source": "config_error", "error": "anahtar yok"}

    monkeypatch.setattr(server, "get_financial_ai_advice_result", _fake)
    body = _call_match()
    assert body["mode"] == "smart"
    assert "ai" not in _reasons(body)


def test_product_match_real_provider_exception_returns_rule_suggestions(monkeypatch):
    _patch_chat(monkeypatch, error=TimeoutError("gecici"))
    body = _call_match()
    assert "suggestions" in body
    assert body["mode"] == "smart"
    assert "ai" not in _reasons(body)
    assert _reasons(body)


def test_product_match_applies_real_ai_json(monkeypatch):
    payload = '{"matches":[{"barcode":"BC-WEAK","product_id":"p1","confidence":0.91}]}'

    async def _fake(*_args, **_kwargs):
        return {"advice": payload, "source": "ai", "error": None}

    monkeypatch.setattr(server, "get_financial_ai_advice_result", _fake)
    body = _call_match()
    assert body["mode"] == "ai"
    assert _reasons(body)[0] == "ai"
    assert body["suggestions"]["BC-WEAK"][0]["product_id"] == "p1"
