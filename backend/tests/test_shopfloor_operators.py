"""Atölye operatör seçimi: kullanıcısı açılmamış personel listede yok."""
from shopfloor_operators import (
    employee_has_system_user,
    linked_system_user_keys,
    shopfloor_operators,
)


def test_linked_keys_skip_inactive():
    emp_ids, usr_ids = linked_system_user_keys([
        {"_id": "usr_1", "employee_id": "emp_a", "is_active": True},
        {"_id": "usr_2", "employee_id": "emp_b", "is_active": False},
        {"id": "usr_3"},
    ])
    assert emp_ids == {"emp_a"}
    assert usr_ids == {"usr_1", "usr_3"}


def test_has_user_from_users_index():
    emp_ids, usr_ids = linked_system_user_keys([
        {"_id": "usr_1", "employee_id": "emp_a"},
        {"_id": "usr_orphan"},
    ])
    assert employee_has_system_user({"_id": "emp_a"}, emp_ids, usr_ids) is True
    assert employee_has_system_user({"_id": "emp_b", "user_id": "usr_orphan"}, emp_ids, usr_ids) is True
    assert employee_has_system_user({"_id": "emp_c", "user_id": "usr_missing"}, emp_ids, usr_ids) is False
    assert employee_has_system_user({"_id": "emp_d"}, emp_ids, usr_ids) is False


def test_client_fallback_user_id_and_flag():
    assert employee_has_system_user({"id": "e1", "has_user": True}) is True
    assert employee_has_system_user({"id": "e2", "has_user": False, "user_id": "usr_x"}) is False
    assert employee_has_system_user({"id": "e3", "user_id": "usr_x"}) is True
    assert employee_has_system_user({"id": "e4", "user_id": ""}) is False
    assert employee_has_system_user({"id": "e5", "user_id": "-"}) is False
    assert employee_has_system_user(None) is False


def test_shopfloor_operators_drops_personnel_without_user():
    rows = [
        {"id": "a", "full_name": "Soner Akkaya", "has_user": False},
        {"id": "b", "full_name": "Muhammed ASLAN", "has_user": True},
        {"id": "c", "full_name": "Yaşar Yıldırım", "user_id": "usr_1"},
    ]
    names = [e["full_name"] for e in shopfloor_operators(rows)]
    assert names == ["Muhammed ASLAN", "Yaşar Yıldırım"]
