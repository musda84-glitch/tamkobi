"""e-İrsaliye nakliye doğrulaması — sevk, kendi aracı veya taşıyıcı firma.

Gönderimden önce eksik alan 422 ile Türkçe döner. UBL, taşıyıcı yokken
satıcıyı 0000000000 VKN ile taşıyıcı gibi yazmaz.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
_PLATE_RE = re.compile(r"^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}\d{2,4}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}(:\d{2})?$")

_PATCH_KEYS = (
    "despatch_mode",
    "issue_date",
    "issue_time",
    "shipping_address",
    "despatch_plate",
    "despatch_trailer",
    "despatch_driver_first",
    "despatch_driver_last",
    "despatch_driver_tckn",
    "despatch_carrier_name",
    "despatch_carrier_vkn",
    "cargo_tracking_number",
)


def digits(value: Any) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def normalize_plate(value: Any) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().upper())


def plate_valid(value: Any) -> bool:
    return bool(_PLATE_RE.match(normalize_plate(value)))


def tckn_valid(value: Any) -> bool:
    raw = digits(value)
    if len(raw) != 11 or raw[0] == "0":
        return False
    nums = [int(c) for c in raw]
    odd = sum(nums[0:9:2])
    even = sum(nums[1:8:2])
    if nums[9] != ((odd * 7) - even) % 10:
        return False
    return nums[10] == sum(nums[:10]) % 10


def vkn_valid(value: Any) -> bool:
    raw = digits(value)
    if len(raw) != 10 or raw == "0000000000":
        return False
    nums = [int(c) for c in raw]
    total = 0
    for i in range(9):
        tmp = (nums[i] + (9 - i)) % 10
        if tmp == 9:
            contrib = 9
        else:
            contrib = (tmp * (2 ** (9 - i))) % 9
        total += contrib
    check = (10 - (total % 10)) % 10
    return nums[9] == check


def tax_id_valid(value: Any) -> bool:
    raw = digits(value)
    if len(raw) == 11:
        return tckn_valid(raw)
    if len(raw) == 10:
        return vkn_valid(raw)
    return False


def seller_tax_usable(value: Any) -> bool:
    """Kendi aracı: satıcının gerçek VKN/TCKN'si. 0000000000 sahte taşıyıcı değildir."""
    raw = digits(value)
    if len(raw) not in (10, 11):
        return False
    if set(raw) <= {"0"}:
        return False
    return True


def is_incoming_dispatch(inv: Optional[Mapping[str, Any]]) -> bool:
    if not inv:
        return False
    if inv.get("invoice_type") != "dispatch" and inv.get("e_type") != "e_dispatch":
        return False
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox" or inv.get("edoc_id"):
        return True
    gs = str(inv.get("gib_status") or "").lower()
    return "gelen" in gs


def is_uuid(value: Any) -> bool:
    return bool(_UUID_RE.match(str(value or "").strip()))


def despatch_gib_accepted(inv: Optional[Mapping[str, Any]]) -> bool:
    """GİB'in kabul ettiği giden irsaliye tekrar gönderilmez.

    Hata durumundaki UUID (şema reddi) kabul sayılmaz; belge düzeltilebilir.
    """
    if not inv or is_incoming_dispatch(inv):
        return False
    state = str(inv.get("einvoice_state") or "").strip().lower()
    gs = str(inv.get("gib_status") or "")
    code = str(inv.get("gib_status_code") or "").strip()
    uuid = str(inv.get("gib_uuid") or inv.get("gib_tracking_id") or "").strip()
    if state == "error" or re.match(r"^\s*hata\s*:", gs, re.I):
        return code == "1300" and is_uuid(uuid)
    if not is_uuid(uuid):
        return False
    if code == "1300":
        return True
    if state in ("sent", "accepted"):
        return True
    folded = gs.lower().replace("ı", "i")
    if "basariyla tamamland" in folded or "gib onay" in folded:
        return True
    return False


def _g(inv: Mapping[str, Any], *keys: str) -> str:
    nested = inv.get("despatch_defaults") if isinstance(inv.get("despatch_defaults"), dict) else {}
    for key in keys:
        if inv.get(key) not in (None, ""):
            return str(inv.get(key) or "").strip()
        if nested.get(key) not in (None, ""):
            return str(nested.get(key) or "").strip()
    return ""


def transport_from(inv: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    inv = inv or {}
    plate = normalize_plate(_g(inv, "despatch_plate", "plate", "vehicle_plate"))
    trailer = normalize_plate(_g(inv, "despatch_trailer", "trailer"))
    driver_first = _g(inv, "despatch_driver_first", "driver_first", "driver_name")
    driver_last = _g(inv, "despatch_driver_last", "driver_last")
    if driver_first and not driver_last and " " in driver_first:
        parts = driver_first.split(None, 1)
        driver_first, driver_last = parts[0], parts[1]
    driver_tckn = digits(_g(inv, "despatch_driver_tckn", "driver_tckn"))
    carrier_name = _g(inv, "despatch_carrier_name", "carrier_name", "cargo_carrier")
    carrier_vkn = digits(_g(inv, "despatch_carrier_vkn", "carrier_vkn"))
    tracking = _g(inv, "cargo_tracking_number", "tracking_number", "tracking")
    mode = str(inv.get("despatch_mode") or "").strip().lower()
    nested = inv.get("despatch_defaults") if isinstance(inv.get("despatch_defaults"), dict) else {}
    if mode not in ("own", "carrier"):
        mode = str(nested.get("mode") or nested.get("despatch_mode") or "").strip().lower()
    if mode not in ("own", "carrier"):
        if carrier_vkn and carrier_name and not plate:
            mode = "carrier"
        else:
            mode = "own"
    issue_time = str(inv.get("issue_time") or "").strip()
    if len(issue_time) == 5 and issue_time[2] == ":":
        issue_time = f"{issue_time}:00"
    return {
        "mode": mode,
        "issue_date": str(inv.get("issue_date") or "").strip()[:10],
        "issue_time": issue_time[:8],
        "shipping_address": str(inv.get("shipping_address") or inv.get("address") or "").strip(),
        "plate": plate,
        "trailer": trailer,
        "driver_first": driver_first,
        "driver_last": driver_last,
        "driver_tckn": driver_tckn,
        "carrier_name": carrier_name,
        "carrier_vkn": carrier_vkn,
        "tracking": tracking,
    }


def shipment_problems(inv: Optional[Mapping[str, Any]], seller: Optional[Mapping[str, Any]] = None) -> List[str]:
    """Eksik veya biçimi bozuk alanların Türkçe mesajları (sıralı)."""
    t = transport_from(inv)
    problems: List[str] = []
    if not _DATE_RE.match(t["issue_date"]):
        problems.append("Sevk tarihi eksik.")
    if not _TIME_RE.match(t["issue_time"]):
        problems.append("Sevk saati eksik.")
    if not t["shipping_address"] or t["shipping_address"] in ("-", "."):
        problems.append("Teslim adresi eksik.")
    if t["mode"] == "carrier":
        if not t["carrier_vkn"]:
            problems.append("Taşıyıcı VKN/TCKN eksik.")
        elif not tax_id_valid(t["carrier_vkn"]):
            problems.append("Taşıyıcı VKN/TCKN geçersiz.")
        if not t["carrier_name"]:
            problems.append("Taşıyıcı ünvan eksik.")
    else:
        if not t["plate"]:
            problems.append("Araç plakası eksik.")
        elif not plate_valid(t["plate"]):
            problems.append("Araç plakası biçimi geçersiz.")
        if not t["driver_first"]:
            problems.append("Şoför adı eksik.")
        if not t["driver_last"]:
            problems.append("Şoför soyadı eksik.")
        if not t["driver_tckn"]:
            problems.append("Şoför TCKN eksik.")
        elif not tckn_valid(t["driver_tckn"]):
            problems.append("Şoför TCKN geçersiz.")
        if seller is not None:
            tax = (seller.get("tax_number") or seller.get("tax_id") or "")
            if not seller_tax_usable(tax):
                problems.append("Satıcı VKN/TCKN geçersiz; sahte taşıyıcı yazılmaz.")
    return problems


def shipment_error_message(inv: Optional[Mapping[str, Any]], seller: Optional[Mapping[str, Any]] = None) -> str:
    return " ".join(shipment_problems(inv, seller))


def normalize_issue_time(value: Any) -> str:
    raw = str(value or "").strip()
    if len(raw) == 5 and raw[2] == ":":
        raw = f"{raw}:00"
    return raw[:8]


def shipment_patch_from_request(req: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    """İstek gövdesindeki nakliye alanlarını belgeye yazılacak hale getirir."""
    req = req or {}
    out: Dict[str, Any] = {}
    if "despatch_mode" in req:
        out["despatch_mode"] = "carrier" if str(req.get("despatch_mode") or "").strip().lower() == "carrier" else "own"
    if "issue_date" in req:
        out["issue_date"] = str(req.get("issue_date") or "").strip()[:10]
    if "issue_time" in req:
        out["issue_time"] = normalize_issue_time(req.get("issue_time"))
    if "shipping_address" in req:
        out["shipping_address"] = str(req.get("shipping_address") or "").strip()
    if "despatch_plate" in req:
        out["despatch_plate"] = normalize_plate(req.get("despatch_plate"))
    if "despatch_trailer" in req:
        out["despatch_trailer"] = normalize_plate(req.get("despatch_trailer"))
    if "despatch_driver_first" in req:
        out["despatch_driver_first"] = str(req.get("despatch_driver_first") or "").strip()
    if "despatch_driver_last" in req:
        out["despatch_driver_last"] = str(req.get("despatch_driver_last") or "").strip()
    if "despatch_driver_tckn" in req:
        out["despatch_driver_tckn"] = digits(req.get("despatch_driver_tckn"))
    if "despatch_carrier_name" in req:
        out["despatch_carrier_name"] = str(req.get("despatch_carrier_name") or "").strip()
    if "despatch_carrier_vkn" in req:
        out["despatch_carrier_vkn"] = digits(req.get("despatch_carrier_vkn"))
    if "cargo_tracking_number" in req:
        out["cargo_tracking_number"] = str(req.get("cargo_tracking_number") or "").strip()
    return {k: v for k, v in out.items() if k in _PATCH_KEYS}
