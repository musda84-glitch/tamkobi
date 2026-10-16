"""Personel GET listelerinde satır filtresi.

RBAC middleware GET'te modül yetkisine bakmaz (yalnız fiyat maskeleme).
Süper admin, admin ve /personnel en az "view" olan roller tam listeyi görür.
İzin, prim, bordro, puantaj, mesai önizleme ve vardiya uçlarında diğer
roller yalnız kendi kartının satırlarını görür. Kart yoksa veya başka
firmadaysa o uçlar boş liste döner.

GET /personnel/employees seçim listesidir: aynı kapsamda firmadaki
çalışanlar finansal alansız dizin olarak döner. Kendi kartı (scope ile
eşleşen id) mevcut tam kayıttır. scope "__none__" ise yalnız dizin.
"""
from typing import Any, Dict, Optional

import rbac

# Sorguda eşleşmeyen sentinel. İzin/bordro uçlarında boş liste; çalışan dizininde tam satır yok.
EMPTY = "__none__"

PENDING_FORBIDDEN = "Bu işlem için personel görüntüleme yetkisi gerekir."

# Dizin satırı yalnız bu anahtarları taşır. Projeksiyon allowlist'tir;
# maaş, IBAN, TCKN, adres, telefon ve PIN özeti buraya eklenmez.
DIRECTORY_FIELDS = (
    "id",
    "full_name",
    "status",
    "position",
    "role",
    "department",
    "user_id",
    "has_user",
    "has_shopfloor_pin",
    "has_cashier_pin",
    "workplace",
)

# Seçim listesinde görünmeyen kart durumları. Kendi kartı pasif olsa da tam kayıt döner.
DIRECTORY_HIDDEN_STATUSES = frozenset({"terminated", "passive", "inactive", "left"})


async def personnel_scope(user: Optional[dict], cid: Optional[str]) -> Optional[str]:
    """None = tam liste. Çalışan kimliği = izin/bordro uçlarında yalnız o kart. "__none__" = o uçlarda boş liste."""
    if user and (user.get("is_super_admin") or rbac.normalize_role_code(user.get("role")) == "admin"):
        return None
    if not user:
        return EMPTY
    role = await rbac.role_for(user, cid)
    perms = (role or {}).get("permissions") or {}
    if rbac.level_allows(perms.get("/personnel"), "view"):
        return None
    import attendance
    emp = await attendance.employee_for_user(user)
    if not emp or str(emp.get("company_id") or "") != str(cid or ""):
        return EMPTY
    eid = emp.get("_id")
    return str(eid) if eid else EMPTY


def restrict(query: Dict[str, Any], scope: Optional[str], requested: Optional[str] = None, *, field: str = "employee_id") -> None:
    """scope doluysa sorguya çalışan filtresi ekler. İstemci başka id isterse boş liste."""
    if scope is None:
        return
    req = str(requested).strip() if requested else ""
    if scope == EMPTY or (req and req != scope):
        query[field] = EMPTY
        return
    query[field] = scope


def directory_visible(emp: Optional[dict], scope: Optional[str] = None) -> bool:
    """Dizin: aktif kartlar. scope ile eşleşen kendi kartı durumdan bağımsız kalır."""
    src = emp or {}
    eid = str(src.get("_id") or src.get("id") or "")
    if scope and scope != EMPTY and eid == str(scope):
        return True
    status = str(src.get("status") or "active").strip().lower()
    return status not in DIRECTORY_HIDDEN_STATUSES


def workplace_label(payload: Any) -> str:
    """İş yeri adı. Konum, adres ve yarıçap dizin satırına yazılmaz."""
    if isinstance(payload, str):
        return payload.strip()
    if isinstance(payload, dict):
        for key in ("label", "name", "project_name"):
            text = str(payload.get(key) or "").strip()
            if text:
                return text
    return ""


def project_directory(emp: Optional[dict], *, has_user: bool = False, workplace: Any = None) -> Dict[str, Any]:
    """Çalışan kartını DIRECTORY_FIELDS allowlist'ine indirger.

    Ham belgedeki diğer anahtarlar (maaş, IBAN, TCKN, PIN hash, telefon,
    adres) kopyalanmaz. PIN yalnız has_* boolean olarak çıkar.
    """
    src = emp or {}
    eid = src.get("id") or src.get("_id")
    role = src.get("role") if isinstance(src.get("role"), str) else ""
    position = src.get("position") if isinstance(src.get("position"), str) else ""
    if not position and role:
        position = role
    user_id = str(src.get("user_id") or "").strip()
    if user_id == "-":
        user_id = ""
    built: Dict[str, Any] = {
        "id": str(eid) if eid else "",
        "full_name": src.get("full_name") or "",
        "status": src.get("status") or "",
        "position": position,
        "role": role,
        "department": src.get("department") if isinstance(src.get("department"), str) else "",
        "user_id": user_id,
        "has_user": bool(has_user),
    }
    if "shopfloor_pin_hash" in src or "has_shopfloor_pin" in src:
        built["has_shopfloor_pin"] = bool(src.get("shopfloor_pin_hash") or src.get("has_shopfloor_pin"))
    if "cashier_pin_hash" in src or "has_cashier_pin" in src:
        built["has_cashier_pin"] = bool(src.get("cashier_pin_hash") or src.get("has_cashier_pin"))
    label = workplace_label(workplace)
    if label:
        built["workplace"] = label
    # Allowlist: built içinde olup DIRECTORY_FIELDS dışında kalan bir anahtar yazılmaz.
    required = {"id", "full_name", "status", "has_user"}
    out: Dict[str, Any] = {}
    for key in DIRECTORY_FIELDS:
        if key not in built:
            continue
        val = built[key]
        if key not in required and val in ("", None, False):
            continue
        out[key] = val
    return out
