"""Shared test configuration. Secrets/identifiers come from env or are resolved from the API at runtime."""
import os

import requests
from dotenv import dotenv_values

_frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
_backend_env = dotenv_values("/app/backend/.env") or dotenv_values("/workspace/backend/.env") or {}

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = BASE_URL.rstrip("/") + "/api"

TEST_COMPANY_ID = os.environ.get("TEST_COMPANY_ID") or _backend_env.get("TEST_COMPANY_ID") or "comp_nexus_main_01"
TEST_B2B_CONTACT_ID = os.environ.get("TEST_B2B_CONTACT_ID") or _backend_env.get("TEST_B2B_CONTACT_ID") or "cnt_01"
LEGAL_ACCEPT = {"accept_mss": True, "accept_obf": True, "accept_kvkk": True}


def with_legal(payload: dict) -> dict:
    return {**payload, **LEGAL_ACCEPT}


def resolve_b2b_token() -> str:
    """TEST_B2B_TOKEN env wins; otherwise ensure access for the test contact and read the token from the API."""
    token = os.environ.get("TEST_B2B_TOKEN") or _backend_env.get("TEST_B2B_TOKEN")
    if token:
        return token
    # Seeded Anadolu B2B token — avoids auth for public portal tests when contact API is unavailable
    fallback = "9a89e4fd1a0e451c8461f1bccd9f5028"
    try:
        r = requests.post(f"{API}/contacts/{TEST_B2B_CONTACT_ID}/b2b-access", json={"enabled": True, "discount": 5}, timeout=30)
        if r.status_code == 200 and r.json().get("b2b_token"):
            return r.json()["b2b_token"]
    except Exception:
        pass
    return fallback
