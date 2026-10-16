"""Personel GET listelerinde satır filtresi.

RBAC middleware GET'te modül yetkisine bakmaz (yalnız fiyat maskeleme).
Süper admin, admin ve /personnel en az "view" olan roller tam listeyi görür.
Diğerleri (personel rolü ve /personnel yetkisi olmayanlar) yalnız kendi
çalışan kartının satırlarını görür. Kart yoksa veya başka firmadaysa boş liste.
"""
from typing import Any, Dict, Optional

import rbac

# Sorguda eşleşmeyen sentinel. Boş liste döner; 500 değil.
EMPTY = "__none__"

PENDING_FORBIDDEN = "Bu işlem için personel görüntüleme yetkisi gerekir."


async def personnel_scope(user: Optional[dict], cid: Optional[str]) -> Optional[str]:
    """None = tam liste. Çalışan kimliği = yalnız o kart. "__none__" = boş liste."""
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
