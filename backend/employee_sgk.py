"""SGK / IBAN validation helpers for employee updates."""
from typing import Optional


def norm_iban(v: Optional[str]) -> str:
    return "".join(ch for ch in str(v or "").upper() if ch.isalnum())


def sgk_iban_update_error(existing: Optional[dict], upd: Optional[dict]) -> Optional[str]:
    """SGK/IBAN kuralını yalnız bu alanlar değişirken uygula.

    Eski kayıtlarda SGK var / IBAN yokken yıllık izin gibi diğer alanların
    güncellenmesini engellememek için.
    """
    existing = existing or {}
    upd = upd or {}
    if "sgk_number" not in upd and "iban" not in upd:
        return None
    final_sgk = upd["sgk_number"] if "sgk_number" in upd else existing.get("sgk_number")
    final_iban = upd["iban"] if "iban" in upd else existing.get("iban")
    if str(final_sgk or "").strip() and not norm_iban(final_iban):
        return "SGK sicil numarası girildiğinde personel IBAN zorunludur (maaş yalnız bankadan ödenir)."
    return None
