"""Proje dosyası: üretim emri adımları."""
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

from production_work_orders import customer_work_order_steps  # noqa: E402
from server import _public_project_view  # noqa: E402


def test_customer_work_order_steps_from_wos():
    steps = customer_work_order_steps([
        {"step_no": 2, "step_name": "Montaj", "station": "Montaj", "material_name": ""},
        {"step_no": 1, "step_name": "Kesim", "station": "CNC", "step_note": "18mm", "material_name": "MDF"},
    ])
    assert [s["name"] for s in steps] == ["Kesim", "Montaj"]
    assert steps[0]["station"] == "CNC"
    assert steps[0]["note"] == "18mm"
    assert steps[0]["material_name"] == "MDF"


def test_public_view_shows_production_order_label():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "production_order_id": "po1",
        "production_order_code": "URT-2026-1",
        "recipe_name": "URT-2026-1 · Mutfak dolabı",
        "show_production_steps": True,
        "production_steps": [{"no": 1, "name": "Kesim", "station": "CNC"}],
        "tasks": [],
    }
    view = _public_project_view(
        p,
        {"name": "Firma"},
        [],
        [],
        work_orders=[{
            "step_no": 1,
            "station": "CNC",
            "status": "in_progress",
            "started_at": "2026-03-07T08:45:00+00:00",
        }],
    )
    assert "recipe_name" not in view
    step = view["production_steps"][0]
    assert step["station"] == "CNC"
    assert step["status"] == "in_progress"
    assert step["status_label"] == "İşlemde"
    assert step["current"] is True
    assert step["at"] == "07.03.2026 11:45"
    assert "name" not in step
