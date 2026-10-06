"""Atölye operatör listesi: yalnız sistem kullanıcısı açılmış personel."""


def linked_system_user_keys(users):
    """Aktif users satırlarından employee_id / user _id kümeleri."""
    emp_ids, usr_ids = set(), set()
    for u in users or []:
        if u.get("is_active") is False:
            continue
        eid = u.get("employee_id")
        if eid:
            emp_ids.add(eid)
        uid = u.get("_id") or u.get("id")
        if uid:
            usr_ids.add(uid)
    return emp_ids, usr_ids


def employee_has_system_user(emp, linked_employee_ids=None, linked_user_ids=None):
    """Personel kartında create-user ile (veya users.employee_id) sistem kullanıcısı var mı.

    linked_* verilirse users koleksiyonuna göre hesaplar.
    Aksi halde API'deki has_user / user_id alanına bakar (istemci).
    """
    if not emp:
        return False
    emp_ids = linked_employee_ids if linked_employee_ids is not None else set()
    usr_ids = linked_user_ids if linked_user_ids is not None else set()
    using_index = linked_employee_ids is not None or linked_user_ids is not None
    if using_index:
        eid = emp.get("_id") or emp.get("id")
        uid = str(emp.get("user_id") or "").strip()
        if eid and eid in emp_ids:
            return True
        if uid and uid != "-" and uid in usr_ids:
            return True
        return False
    if emp.get("has_user") is True:
        return True
    if emp.get("has_user") is False:
        return False
    uid = str(emp.get("user_id") or "").strip()
    return bool(uid) and uid != "-"


def shopfloor_operators(employees, linked_employee_ids=None, linked_user_ids=None):
    return [
        e for e in (employees or [])
        if employee_has_system_user(e, linked_employee_ids, linked_user_ids)
    ]
