"""Iteration 29 – Label Template CRUD backend tests"""
import os, requests, pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://isletme-one.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
CID = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def _list(s):
    r = s.get(f"{API}/label-templates", params={"company_id": CID})
    assert r.status_code == 200
    return r.json()


def test_00_cleanup_pre(s):
    for t in _list(s):
        n = (t.get("name") or "").strip()
        if n.startswith("QA") or "(kopya)" in n:
            s.delete(f"{API}/label-templates/{t['id']}")


def test_01_create_template(s):
    payload = {
        "company_id": CID,
        "name": "QA Etiket",
        "width_mm": 50,
        "height_mm": 30,
        "elements": [{"id": "a", "type": "barcode", "x": 1, "y": 1, "w": 40, "h": 15}],
        "is_default": False,
    }
    r = s.post(f"{API}/label-templates", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "id" in d
    assert d["name"] == "QA Etiket"
    assert d["width_mm"] == 50 and d["height_mm"] == 30
    assert d["is_default"] is False
    assert len(d["elements"]) == 1
    pytest.tpl_id = d["id"]


def test_02_list_contains(s):
    ids = [t["id"] for t in _list(s)]
    assert pytest.tpl_id in ids


def test_03_put_is_default_true_undefaults_others(s):
    r = s.put(f"{API}/label-templates/{pytest.tpl_id}", json={"is_default": True})
    assert r.status_code == 200
    assert r.json()["is_default"] is True
    lst = _list(s)
    defaults = [t for t in lst if t.get("is_default")]
    assert len(defaults) == 1 and defaults[0]["id"] == pytest.tpl_id


def test_04_put_name_update(s):
    r = s.put(f"{API}/label-templates/{pytest.tpl_id}", json={"name": "QA Etiket 2"})
    assert r.status_code == 200
    assert r.json()["name"] == "QA Etiket 2"
    got = [t for t in _list(s) if t["id"] == pytest.tpl_id][0]
    assert got["name"] == "QA Etiket 2"


def test_05_delete(s):
    r = s.delete(f"{API}/label-templates/{pytest.tpl_id}")
    assert r.status_code == 200


def test_06_delete_again_404(s):
    r = s.delete(f"{API}/label-templates/{pytest.tpl_id}")
    assert r.status_code == 404


def test_99_cleanup_restore_default(s):
    # ensure no QA templates remain
    for t in _list(s):
        n = (t.get("name") or "").strip()
        if n.startswith("QA") or "(kopya)" in n:
            s.delete(f"{API}/label-templates/{t['id']}")
    # ensure Etiket 100×50 is default if it exists
    lst = _list(s)
    defaults = [t for t in lst if t.get("is_default")]
    if not defaults:
        target = next((t for t in lst if "100" in (t.get("name") or "") and "50" in (t.get("name") or "")), None)
        if target:
            r = s.put(f"{API}/label-templates/{target['id']}", json={"is_default": True})
            assert r.status_code == 200
