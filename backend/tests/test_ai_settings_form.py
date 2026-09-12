"""AI settings form: OpenAI model catalog and unsaved-key test overrides."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "docker", "stubs"))

import ai_service


def test_openai_catalog_uses_real_openai_models():
    ids = [m["id"] for m in ai_service.AI_PROVIDERS["openai"]["models"]]
    assert ids[0] == "gpt-4o"
    assert "gpt-5.4" not in ids
    assert "gpt-4o-mini" in ids


def test_normalize_clamps_unknown_openai_model_to_gpt4o():
    cfg = ai_service.normalize_ai({"provider": "openai", "advisor_model": "gpt-5.4", "extract_model": "nope"})
    assert cfg["provider"] == "openai"
    assert cfg["advisor_model"] == "gpt-4o"
    assert cfg["extract_model"] == "gpt-4o"


def test_make_chat_signature_accepts_key_override():
    import inspect
    sig = inspect.signature(ai_service.make_chat)
    for name in ("api_key", "provider", "advisor_model", "extract_model", "base_url"):
        assert name in sig.parameters
