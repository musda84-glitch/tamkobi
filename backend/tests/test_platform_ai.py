"""Platform-wide AI provider settings (super admin)."""
import os

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
SALES_EMAIL = "satis@nexus.com"
SALES_PASS = "satis123"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestPlatformAiSettings:
    def test_requires_super_admin(self):
        r = requests.get(f"{API}/system/ai", timeout=20)
        assert r.status_code == 401
        sales = _login(SALES_EMAIL, SALES_PASS)
        r = sales.get(f"{API}/system/ai", timeout=20)
        assert r.status_code == 403, r.text[:200]

    def test_get_put_and_public_status(self):
        s = _login(ADMIN_EMAIL, ADMIN_PASS)
        me = s.get(f"{API}/auth/me", timeout=20).json()
        assert me["user"].get("is_super_admin") is True
        r = s.get(f"{API}/system/ai", timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["provider"] in ("emergent", "openai", "anthropic", "google")
        assert "catalog" in d and {c["id"] for c in d["catalog"]} >= {"emergent", "openai", "anthropic", "google"}
        assert "api_key" not in d and "api_key_enc" not in str(d)
        prev = {k: d[k] for k in ("enabled", "provider", "advisor_model", "extract_model")}
        r = s.put(f"{API}/system/ai", json={
            "enabled": True,
            "provider": "openai",
            "advisor_model": "gpt-4o",
            "extract_model": "gpt-4.1",
        }, timeout=20)
        assert r.status_code == 200, r.text[:300]
        d = r.json()
        assert d["provider"] == "openai"
        assert d["advisor_model"] == "gpt-4o"
        assert d["extract_model"] == "gpt-4.1"
        assert d["provider_label"] == "OpenAI"
        st = s.get(f"{API}/ai/status", timeout=20)
        assert st.status_code == 200, st.text
        pub = st.json()
        assert pub["provider"] == "openai"
        assert "OpenAI" in pub["badge"]
        assert "api_key" not in pub
        s.put(f"{API}/system/ai", json=prev, timeout=20)

    def test_clamps_model_to_provider(self):
        s = _login(ADMIN_EMAIL, ADMIN_PASS)
        prev = s.get(f"{API}/system/ai", timeout=20).json()
        r = s.put(f"{API}/system/ai", json={"provider": "google", "advisor_model": "gpt-5.4", "extract_model": "claude-sonnet-4-6"}, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["provider"] == "google"
        assert d["advisor_model"].startswith("gemini")
        assert d["extract_model"].startswith("gemini")
        s.put(f"{API}/system/ai", json={k: prev[k] for k in ("enabled", "provider", "advisor_model", "extract_model")}, timeout=20)
