"""Doğrudan sağlayıcı (Gemini / OpenAI / Anthropic) HTTP istemcisi.

Platform panelinde "Google Gemini" seçilip kendi API anahtarı girildiğinde istek
emergentintegrations SDK'sına değil doğrudan sağlayıcıya gider; imajda SDK kurulu
olmasa da bağlantı testi çalışmalıdır.
"""
import asyncio
import json
import os
import sys

import httpx
import pytest

_BACKEND = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _BACKEND)
sys.path.insert(0, os.path.join(_BACKEND, "docker", "stubs"))
import ai_service  # noqa: E402
from emergentintegrations.llm.chat import UserMessage  # noqa: E402


def run(coro):
    return asyncio.run(coro)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload or {}, ensure_ascii=False)

    def json(self):
        if self._payload is None:
            raise ValueError("yanıt JSON değil")
        return self._payload


def _patch(monkeypatch, response=None, raises=None):
    """httpx.AsyncClient'ı taklit et; yapılan çağrıları döndür."""
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def post(self, url, headers=None, json=None):  # noqa: A002
            calls.append({"url": url, "headers": headers or {}, "body": json or {}})
            if raises is not None:
                raise raises
            return response

    monkeypatch.setattr(ai_service.httpx, "AsyncClient", FakeClient)
    return calls


def _gemini_ok(text="OK"):
    return FakeResponse(200, {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]})


def _settings(monkeypatch, provider, advisor, extract=None, key="k", enabled=True):
    async def fake():
        return {"enabled": enabled, "provider": provider, "advisor_model": advisor, "extract_model": extract or advisor, "api_key": key}

    monkeypatch.setattr(ai_service, "load_ai_settings", fake)


class TestRequestShape:
    def test_gemini_url_key_header_and_system_instruction(self, monkeypatch):
        calls = _patch(monkeypatch, _gemini_ok("OK"))
        chat = ai_service.DirectChat("google", "gemini-2.5-flash", "AIzaTEST", "Kısa yanıt ver")
        assert run(chat.send_message(UserMessage(text="OK yaz"))) == "OK"
        call = calls[0]
        assert call["url"].endswith("/models/gemini-2.5-flash:generateContent")
        assert call["url"].startswith("https://generativelanguage.googleapis.com/")
        assert call["headers"]["x-goog-api-key"] == "AIzaTEST"
        assert "Authorization" not in call["headers"]
        assert call["body"]["systemInstruction"]["parts"][0]["text"] == "Kısa yanıt ver"
        assert call["body"]["contents"][0]["parts"][0]["text"] == "OK yaz"

    def test_gemini_joins_multiple_parts(self, monkeypatch):
        _patch(monkeypatch, FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "{\"a\":"}, {"text": "1}"}]}}]}))
        chat = ai_service.DirectChat("google", "gemini-2.5-pro", "k", "")
        assert run(chat.send_message(UserMessage(text="x"))) == '{"a":1}'

    def test_openai_bearer_and_messages(self, monkeypatch):
        calls = _patch(monkeypatch, FakeResponse(200, {"choices": [{"message": {"content": "OK"}}]}))
        chat = ai_service.DirectChat("openai", "gpt-4o", "sk-TEST", "sistem")
        assert run(chat.send_message(UserMessage(text="soru"))) == "OK"
        call = calls[0]
        assert call["url"].endswith("/chat/completions")
        assert call["headers"]["Authorization"] == "Bearer sk-TEST"
        assert call["body"]["model"] == "gpt-4o"
        assert [m["role"] for m in call["body"]["messages"]] == ["system", "user"]

    def test_anthropic_key_version_and_system_field(self, monkeypatch):
        calls = _patch(monkeypatch, FakeResponse(200, {"content": [{"type": "text", "text": "OK"}]}))
        chat = ai_service.DirectChat("anthropic", "claude-sonnet-4-6", "sk-ant", "sistem")
        assert run(chat.send_message(UserMessage(text="soru"))) == "OK"
        call = calls[0]
        assert call["url"].endswith("/messages")
        assert call["headers"]["x-api-key"] == "sk-ant"
        assert call["headers"]["anthropic-version"] == ai_service.ANTHROPIC_VERSION
        assert call["body"]["system"] == "sistem"
        assert call["body"]["max_tokens"] > 0

    def test_no_system_message_is_omitted(self, monkeypatch):
        calls = _patch(monkeypatch, _gemini_ok())
        run(ai_service.DirectChat("google", "gemini-2.5-flash", "k", "").send_message(UserMessage(text="x")))
        assert "systemInstruction" not in calls[0]["body"]

    def test_with_model_overrides_model(self, monkeypatch):
        calls = _patch(monkeypatch, _gemini_ok())
        chat = ai_service.DirectChat("google", "gemini-2.5-pro", "k", "")
        run(chat.with_model("gemini", "gemini-2.5-flash").send_message(UserMessage(text="x")))
        assert "gemini-2.5-flash:generateContent" in calls[0]["url"]


class TestErrors:
    @pytest.mark.parametrize("code,needle", [(401, "kabul etmedi"), (403, "kabul etmedi"), (404, "model"), (429, "sınır")])
    def test_http_errors_are_turkish_and_keep_provider_detail(self, monkeypatch, code, needle):
        _patch(monkeypatch, FakeResponse(code, {"error": {"message": "API key not valid"}}))
        chat = ai_service.DirectChat("google", "gemini-2.5-flash", "bozuk", "")
        with pytest.raises(RuntimeError) as ei:
            run(chat.send_message(UserMessage(text="x")))
        msg = str(ei.value)
        assert "Google Gemini" in msg
        assert str(code) in msg
        assert needle in msg
        assert "API key not valid" in msg

    def test_non_json_error_body_falls_back_to_text(self, monkeypatch):
        _patch(monkeypatch, FakeResponse(500, None, text="<html>gateway</html>"))
        with pytest.raises(RuntimeError, match="gateway"):
            run(ai_service.DirectChat("openai", "gpt-4o", "k", "").send_message(UserMessage(text="x")))

    def test_network_failure_says_unreachable(self, monkeypatch):
        _patch(monkeypatch, raises=httpx.ConnectTimeout("timed out"))
        with pytest.raises(RuntimeError, match="ulaşılamadı"):
            run(ai_service.DirectChat("google", "gemini-2.5-flash", "k", "").send_message(UserMessage(text="x")))

    def test_safety_block_is_reported(self, monkeypatch):
        _patch(monkeypatch, FakeResponse(200, {"promptFeedback": {"blockReason": "SAFETY"}, "candidates": []}))
        with pytest.raises(RuntimeError, match="SAFETY"):
            run(ai_service.DirectChat("google", "gemini-2.5-flash", "k", "").send_message(UserMessage(text="x")))

    def test_truncated_answer_is_reported(self, monkeypatch):
        _patch(monkeypatch, FakeResponse(200, {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": []}}]}))
        with pytest.raises(RuntimeError, match="tamamlanmadı"):
            run(ai_service.DirectChat("google", "gemini-2.5-flash", "k", "").send_message(UserMessage(text="x")))

    def test_empty_openai_answer_is_reported(self, monkeypatch):
        _patch(monkeypatch, FakeResponse(200, {"choices": [{"message": {"content": ""}}]}))
        with pytest.raises(RuntimeError, match="boş yanıt"):
            run(ai_service.DirectChat("openai", "gpt-4o", "k", "").send_message(UserMessage(text="x")))


class TestEnvKeys:
    def test_each_provider_reads_its_own_variable(self, monkeypatch):
        for name in ("EMERGENT_LLM_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("EMERGENT_LLM_KEY", "emg")
        monkeypatch.setenv("GEMINI_API_KEY", "aiza")
        assert ai_service.env_key("emergent") == "emg"
        assert ai_service.env_key("google") == "aiza"
        assert ai_service.env_key("openai") == ""
        assert ai_service.env_key("anthropic") == ""

    def test_google_falls_back_to_google_api_key(self, monkeypatch):
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setenv("GOOGLE_API_KEY", "alt")
        assert ai_service.env_key("google") == "alt"
        assert ai_service.env_var_name("google") == "GEMINI_API_KEY"

    def test_emergent_key_is_not_leaked_to_gemini(self, monkeypatch):
        """Gemini'ye Emergent anahtarı gönderilirse 400 alırız; sağlayıcılar ayrı olmalı."""
        monkeypatch.setenv("EMERGENT_LLM_KEY", "emg")
        for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
            monkeypatch.delenv(name, raising=False)
        assert ai_service.env_key("google") == ""


class TestMakeChat:
    @pytest.mark.parametrize("provider,model", [("google", "gemini-2.5-pro"), ("openai", "gpt-4o"), ("anthropic", "claude-sonnet-4-6")])
    def test_direct_providers_bypass_the_sdk(self, monkeypatch, provider, model):
        _settings(monkeypatch, provider, model)
        chat = run(ai_service.make_chat("s", "sys", purpose="advisor"))
        assert isinstance(chat, ai_service.DirectChat)
        assert chat.provider == provider and chat.model == model

    def test_emergent_still_uses_the_sdk(self, monkeypatch):
        _settings(monkeypatch, "emergent", "gpt-5.4")
        assert not isinstance(run(ai_service.make_chat("s", "sys", purpose="advisor")), ai_service.DirectChat)

    def test_missing_key_raises_before_any_request(self, monkeypatch):
        _settings(monkeypatch, "google", "gemini-2.5-pro", key="")
        with pytest.raises(RuntimeError, match="anahtarı"):
            run(ai_service.make_chat("s", "sys"))

    def test_disabled_integration_raises(self, monkeypatch):
        _settings(monkeypatch, "google", "gemini-2.5-pro", enabled=False)
        with pytest.raises(RuntimeError, match="kapatılmış"):
            run(ai_service.make_chat("s", "sys"))

    def test_purpose_selects_the_right_model(self, monkeypatch):
        _settings(monkeypatch, "google", "gemini-2.5-pro", extract="gemini-2.5-flash")
        assert run(ai_service.make_chat("s", "sys", purpose="extract")).model == "gemini-2.5-flash"
        assert run(ai_service.make_chat("s", "sys", purpose="advisor")).model == "gemini-2.5-pro"

    def test_system_message_is_carried_into_the_request(self, monkeypatch):
        _settings(monkeypatch, "google", "gemini-2.5-flash")
        calls = _patch(monkeypatch, _gemini_ok())
        chat = run(ai_service.make_chat("s", "SEN BİR ASİSTANSIN"))
        run(chat.send_message(UserMessage(text="x")))
        assert calls[0]["body"]["systemInstruction"]["parts"][0]["text"] == "SEN BİR ASİSTANSIN"
