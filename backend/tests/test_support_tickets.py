"""Support ticket helpers (no live DB)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import addons
import support_tickets as st


def test_addon_path_maps_support():
    assert addons.addon_for_path("/api/support/tickets") == "support.tickets"
    assert addons.addon_for_path("/api/support/tickets/abc/messages") == "support.tickets"


def test_sanitize_attachments_allows_files_urls_only():
    raw = [
        {"url": "/api/files/nexushesap/support_ticket/c1/a.png", "filename": "ekran.png", "content_type": "image/png", "size": 12},
        {"url": "https://evil.example/x.png", "filename": "nope.png", "content_type": "image/png"},
        {"url": "/api/files/ok.pdf", "filename": "a.pdf", "content_type": "application/pdf", "size": 9},
        {"url": "/api/files/x.exe", "filename": "x.exe", "content_type": "application/octet-stream"},
        "not-a-dict",
    ]
    out = st.sanitize_attachments(raw)
    assert [a["url"] for a in out] == [
        "/api/files/nexushesap/support_ticket/c1/a.png",
        "/api/files/ok.pdf",
    ]


def test_status_flow_on_replies():
    assert st.status_after_customer_reply("waiting_customer") == "open"
    assert st.status_after_customer_reply("resolved") == "open"
    assert st.status_after_customer_reply("in_progress") == "in_progress"
    assert st.status_after_staff_reply("open") == "in_progress"
    assert st.status_after_staff_reply("waiting_customer") == "in_progress"
    assert st.status_after_staff_reply("closed") == "in_progress"


def test_public_ticket_hides_internal_from_customer():
    doc = {
        "_id": "t1",
        "status": "open",
        "category": "teknik",
        "priority": "high",
        "messages": [
            {"id": "m1", "body": "müşteri", "is_internal": False},
            {"id": "m2", "body": "iç not", "is_internal": True},
        ],
    }
    cust = st.public_ticket(doc, staff=False)
    assert [m["body"] for m in cust["messages"]] == ["müşteri"]
    assert cust["status_label"] == "Açık"
    staff = st.public_ticket(doc, staff=True)
    assert len(staff["messages"]) == 2
    listed = st.public_ticket(doc, staff=False, include_messages=False)
    assert "messages" not in listed
    assert listed["message_count"] == 1
