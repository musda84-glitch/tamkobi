import {
  dailyWageOf,
  isDailyWage,
  yevmiyeDaysOf,
  monthlyLoad,
  payrollWageLine,
  periodWage,
  totalMonthlyLoad,
  WORKDAYS_PER_MONTH,
} from "./personnelWage";

describe("personnel wage", () => {
  it("treats daily aliases as yevmiye", () => {
    expect(isDailyWage({ pay_type: "monthly" })).toBe(false);
    expect(isDailyWage({ pay_type: "daily" })).toBe(true);
    expect(isDailyWage({ pay_type: "yevmiye" })).toBe(true);
    expect(isDailyWage({ pay_type: "günlük" })).toBe(true);
    expect(dailyWageOf({ daily_wage: "1500" })).toBe(1500);
    expect(isDailyWage({ daily_wage: 1500 })).toBe(true);
    expect(isDailyWage({ pay_type: "monthly", daily_wage: 1500 })).toBe(false);
    expect(yevmiyeDaysOf({ daily_wage: 1500, yevmiye_days: 6 })).toBe(6);
    expect(yevmiyeDaysOf({ daily_wage: 1500, balance: { bonus_pending: 10500 } })).toBe(7);
  });

  it("computes period and monthly load", () => {
    const daily = { pay_type: "daily", daily_wage: 1500, salary: 0 };
    expect(periodWage(daily, 18)).toBe(27000);
    expect(periodWage(daily, 0)).toBe(0);
    expect(monthlyLoad(daily)).toBe(1500 * WORKDAYS_PER_MONTH);
    expect(periodWage({ salary: 28075.5 }, 20)).toBe(28075.5);
    expect(totalMonthlyLoad([{ salary: 10000 }, daily])).toBe(10000 + 39000);
  });

  it("formats payroll yevmiye line", () => {
    expect(payrollWageLine({ pay_type: "monthly", worked_days: 22 })).toBe("");
    expect(payrollWageLine({ pay_type: "daily", worked_days: 18, daily_wage: 1500 })).toMatch(/^18 gün × .+ ₺$/);
  });
});
