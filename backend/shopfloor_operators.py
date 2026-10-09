"""Atölye operatör listesi: yalnız sistem kullanıcısı açılmış personel.

Ayrıca: başlatan personel bitirmeden/duraklatmadan başka istasyonda iş açamaz;
başka personel serbestçe çalışabilir.
"""


def station_key(station) -> str:
    return str(station or "").strip().casefold()


def operator_active_station_blocker(rows, operator_name, target_station, exclude_wo_id=None):
    """Operatörün *in_progress* işi farklı istasyondaysa engelleyen satırı döndür.

    - Yalnızca status=in_progress kilitler (paused/done serbest bırakır).
    - Aynı istasyonda ikinci işe izin verilir.
    - Başka personelin işi bu operatörü engellemez.
    """
    who = str(operator_name or "").strip()
    if not who:
        return None
    target = station_key(target_station)
    ex = str(exclude_wo_id or "").strip()
    for w in rows or []:
        if str(w.get("status") or "") != "in_progress":
            continue
        if str(w.get("operator_name") or "").strip() != who:
            continue
        wid = str(w.get("_id") or w.get("id") or "").strip()
        if ex and wid == ex:
            continue
        if station_key(w.get("station")) != target:
            return w
    return None


def operator_station_lock_detail(blocker, operator_name=None) -> str:
    who = str(operator_name or (blocker or {}).get("operator_name") or "Operatör").strip() or "Operatör"
    st = str((blocker or {}).get("station") or "başka istasyon").strip() or "başka istasyon"
    code = str((blocker or {}).get("order_code") or "").strip()
    step = (blocker or {}).get("step_no")
    where = f"{code} · adım {step}" if code and step is not None else (code or "açık iş")
    return (
        f"{who} şu an «{st}» istasyonunda devam eden işi var ({where}). "
        "Bitirin veya duraklatın; başka istasyonda işlem açılamaz. "
        "Başka personel bu işi alabilir."
    )


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
