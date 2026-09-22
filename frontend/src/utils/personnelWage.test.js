import {
  attendanceYevmiyeCoveredDays,
  dailyWageOf,
  employeePayActionTitle,
  isDailyWage,
  referenceDailyWage,
  ledgerPayPayload,
  parseYevmiyeDays,
  yevmiyeAddHint,
  yevmiyeDaysOf,
  yevmiyeAdjustedAmount,
  yevmiyeAdjustmentNeeded,
  yevmiyePayPayload,
  yevmiyeStatusLine,
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

  it("builds yevmiye and ledger payloads", () => {
    expect(parseYevmiyeDays("6")).toBe(6);
    expect(yevmiyeAddHint(6, 3)).toBe("6 gün + 3 gün = 9 gün");
    expect(yevmiyePayPayload("e1", { pay_type: "daily", daily_wage: 1500 }, "6", "2026-09", "", "", "1500")).toMatchObject({
      employee_id: "e1", type: "yevmiye", amount: 9000, worked_days: 6, daily_wage: 1500,
    });
    expect(ledgerPayPayload("e1", "alacak", "2500", "2026-09", "fazla")).toMatchObject({
      employee_id: "e1", type: "bakiye", amount: 2500, note: "fazla",
    });
    expect(ledgerPayPayload("e1", "borc", "800", "2026-09", "")).toMatchObject({ type: "borc", amount: 800, note: "Borç" });
    expect(employeePayActionTitle("salary", { pay_type: "daily" })).toBe("Bakiye öde");
    expect(employeePayActionTitle("bonus", { pay_type: "daily" })).toBe("Yevmiye günü");
    expect(employeePayActionTitle("salary", { pay_type: "monthly" })).toBe("Maaş");
  });

  it("prorates yevmiye from card wage and late/early minutes", () => {
    expect(referenceDailyWage({ daily_wage: 1500, salary: 39000 })).toBe(1500);
    expect(referenceDailyWage({ daily_wage: 0, salary: 26000 })).toBe(1000);
    expect(yevmiyeAdjustedAmount(1600, 48, 0, 480)).toBe(1440);
    expect(yevmiyeAdjustedAmount(1600, 0, 96, 480)).toBe(1280);
    expect(yevmiyeAdjustmentNeeded(0, 0)).toBe(false);
    expect(yevmiyeAdjustmentNeeded(5, 0)).toBe(true);
    expect(attendanceYevmiyeCoveredDays([
      { type: "yevmiye", source: "attendance", worked_days: 1 },
      { type: "yevmiye", source: "manual", worked_days: 4 },
    ])).toBe(1);
    expect(yevmiyeStatusLine({
      yevmiye_full_amount: 1500,
      yevmiye_adjustment_request: { status: "pending", proposed_amount: 1200 },
    })).toMatch(/1200/);
  });
});
