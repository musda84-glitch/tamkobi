"""Proje dosyası: üretim adımları + müşteri görünürlüğü (eski reçete yolu)."""
import os
import sys
from types import ModuleType

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _stub_emergent():
    if "emergentintegrations" in sys.modules:
        return
    root = ModuleType("emergentintegrations")
    llm = ModuleType("emergentintegrations.llm")
    chat = ModuleType("emergentintegrations.llm.chat")

    class LlmChat:
        def __init__(self, *a, **k):
            pass

        async def send_message(self, *a, **k):
            return ""

    class UserMessage:
        def __init__(self, *a, **k):
            pass

    chat.LlmChat = LlmChat
    chat.UserMessage = UserMessage
    payments = ModuleType("emergentintegrations.payments")
    stripe_svc = ModuleType("emergentintegrations.payments.stripe")
    stripe_checkout = ModuleType("emergentintegrations.payments.stripe.checkout")

    class StripeCheckout:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionRequest:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionResponse:
        def __init__(self, *a, **k):
            pass

    stripe_checkout.StripeCheckout = StripeCheckout
    stripe_checkout.CheckoutSessionRequest = CheckoutSessionRequest
    stripe_checkout.CheckoutSessionResponse = CheckoutSessionResponse
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat
    sys.modules["emergentintegrations.payments"] = payments
    sys.modules["emergentintegrations.payments.stripe"] = stripe_svc
    sys.modules["emergentintegrations.payments.stripe.checkout"] = stripe_checkout


_stub_emergent()

from production_work_orders import customer_recipe_steps, customer_work_order_steps  # noqa: E402
from server import _public_project_view  # noqa: E402


def test_customer_recipe_steps_strips_cost_fields():
    recipe = {
        "materials": [
            {
                "product_name": "MDF",
                "steps": [{"name": "Kesim", "station": "HOLZHER", "note": "18mm", "duration_min": 10}],
            }
        ],
        "steps": [{"name": "Montaj", "station": "Montaj"}],
        "group_same_station": False,
    }
    steps = customer_recipe_steps(recipe)
    assert [s["name"] for s in steps] == ["Kesim", "Montaj"]
    assert steps[0]["station"] == "HOLZHER"
    assert steps[0]["note"] == "18mm"
    assert steps[0]["material_name"] == "MDF"
    assert "duration_min" not in steps[0]
    assert "images" not in steps[0]


def test_public_view_hides_production_steps_by_default():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "recipe_id": "r1",
        "recipe_name": "Mutfak dolabı",
        "show_production_steps": False,
        "production_steps": [{"no": 1, "name": "Kesim", "station": "CNC"}],
        "tasks": [],
    }
    view = _public_project_view(p, {"name": "Firma"}, [], [])
    assert "production_steps" not in view
    assert "recipe_id" not in view
    assert "recipe_name" not in view


def test_public_view_shows_production_steps_when_enabled():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "recipe_name": "Mutfak dolabı",
        "show_production_steps": True,
        "production_steps": [
            {"no": 1, "name": "Kesim", "station": "CNC", "note": "Ø8", "material_name": "MDF"},
            {"no": 2, "name": "Montaj", "station": "Montaj"},
        ],
        "tasks": [],
    }
    view = _public_project_view(p, {"name": "Firma"}, [], [])
    # Müşteri görünümü: yalnız istasyon + durum; malzeme/not/iç etiket yok.
    assert [s["station"] for s in view["production_steps"]] == ["CNC", "Montaj"]
    assert view["production_steps"][0]["status_label"] == "Başlamayı bekliyor"
    assert view["production_steps"][0]["current"] is True
    assert "name" not in view["production_steps"][0]
    assert "note" not in view["production_steps"][0]
    assert "material_name" not in view["production_steps"][0]
    assert "recipe_id" not in view
    assert "recipe_name" not in view


def test_customer_work_order_steps_empty():
    assert customer_work_order_steps([]) == []
    assert customer_work_order_steps(None) == []
