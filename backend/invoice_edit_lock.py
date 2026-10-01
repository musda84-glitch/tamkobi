"""Fatura düzenleme kilidi — GİB'e iletilmiş e-belgelerde kalem/tarih kilitli."""
from __future__ import annotations

from typing import Any, Mapping, Optional


def invoice_gib_locked(inv: Optional[Mapping[str, Any]]) -> bool:
    """GİB'e iletilmiş e-belge: kalem/tarih/tür kilitli; yalnız vade/not.

    Yerel onay (status=approved) ama henüz GİB'e gitmemiş faturalar kilitlenmez.
    """
    if not inv:
        return False
    if inv.get("status") == "draft":
        return False
    state = str(inv.get("einvoice_state") or "").strip().lower()
    if state in ("sent", "queued"):
        return True
    if inv.get("gib_tracking_id") or inv.get("gib_uuid"):
        return True
    code = str(inv.get("gib_status_code") or "").strip()
    if code.isdigit() and int(code) >= 1000:
        return True
    gs = str(inv.get("gib_status") or "").lower()
    if "hata" in gs:
        return False
    if any(
        k in gs
        for k in (
            "başarıyla tamamland",
            "basariyla tamamland",
            "ileti",
            "kuyrukta",
            "zarf ",
            "hedeften",
            "matbu",
        )
    ):
        return True
    if "gib onay" in gs.replace("ı", "i"):
        return True
    return False
