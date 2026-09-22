from personnel_wage import monthly_load, pay_type_of, period_wage


def test_monthly_uses_salary():
    emp = {"pay_type": "monthly", "salary": 28075.5, "daily_wage": 1500}
    assert pay_type_of(emp) == "monthly"
    assert period_wage(emp, 20) == 28075.5
    assert monthly_load(emp) == 28075.5


def test_daily_times_present_days():
    emp = {"pay_type": "daily", "salary": 0, "daily_wage": 1500}
    assert pay_type_of(emp) == "daily"
    assert period_wage(emp, 18) == 27000
    assert period_wage(emp, 0) == 0
    assert monthly_load(emp) == 39000


def test_yevmiye_alias():
    assert pay_type_of({"pay_type": "yevmiye"}) == "daily"
    assert period_wage({"pay_type": "günlük", "daily_wage": "2000"}, 2) == 4000
