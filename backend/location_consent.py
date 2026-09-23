"""Personel konum paylaşımı + KVKK (K / KK) onayı."""

from __future__ import annotations

from typing import Any, Optional

CONSENT_WARNING = "Bu sözleşmeleri işaretlediğinizde personel paneli (Mesaim) kullanıma açılır."

KVKK_TITLE = "KVKK aydınlatması (K)"
KVKK_TEXT = (
    "İşveren, 6698 sayılı KVKK kapsamında mesai takibi için cihazınızın konum verisini "
    "(GPS) işler. Veri giriş-çıkış ve görev/iş yeri kontrolü için kullanılır; yasal süre boyunca saklanır."
)

SHARE_TITLE = "Konum paylaşımı sözleşmesi (KK)"
SHARE_TEXT = (
    "Mesai süresince konumumun alınmasına ve konum alınamadığında yöneticimin haberdar edilmesine izin veriyorum."
)


def normalize_location_consent(raw: Any = None) -> dict:
    row = raw if isinstance(raw, dict) else {}
    kvkk = bool(row.get("accept_kvkk") or row.get("kvkk"))
    share = bool(row.get("accept_share") or row.get("kk") or row.get("location"))
    accepted = kvkk and share
    at = str(row.get("accepted_at") or "").strip() or None
    return {
        "accept_kvkk": kvkk,
        "accept_share": share,
        "accepted": accepted,
        "accepted_at": at if accepted else None,
        "required": True,
        "warning": CONSENT_WARNING,
        "kvkk_title": KVKK_TITLE,
        "kvkk_text": KVKK_TEXT,
        "share_title": SHARE_TITLE,
        "share_text": SHARE_TEXT,
    }


def location_consent_accepted(emp: Optional[dict] = None) -> bool:
    return bool(normalize_location_consent((emp or {}).get("location_consent")).get("accepted"))


def validate_location_consent(req: Optional[dict] = None) -> Optional[str]:
    row = req if isinstance(req, dict) else {}
    kvkk = bool(row.get("accept_kvkk") or row.get("kvkk"))
    share = bool(row.get("accept_share") or row.get("kk"))
    if not kvkk or not share:
        return "KVKK (K) ve konum paylaşımı (KK) sözleşmelerini işaretleyin."
    return None


def location_consent_store(req: dict, accepted_at: str) -> dict:
    return {
        "accept_kvkk": True,
        "accept_share": True,
        "accepted_at": accepted_at,
    }


def location_signal_view(emp: Optional[dict] = None) -> dict:
    row = emp or {}
    ok = row.get("location_last_ok")
    if ok is True:
        label, tone = "Konum alındı", "green"
        flag = True
    elif ok is False:
        label, tone = "Konum alınamadı", "red"
        flag = False
    else:
        label, tone = "Konum bekleniyor", "amber"
        flag = None
    return {"ok": flag, "at": row.get("location_last_at"), "label": label, "tone": tone}


def location_consent_denied_detail() -> str:
    return "KVKK ve konum paylaşımı sözleşmesini kabul etmeden Mesaim kullanılamaz."
