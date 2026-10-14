import {
  cashShortfallWarning,
  defaultPayAccount,
  employeeAllowanceSaveMessage,
  employeeDueLines,
  employeePayKindLabel,
  employeePayKindsForSubmit,
  employeePayModalStart,
  employeePayModalTitle,
  employeePayTotal,
  hasPayStartDate,
  istanbulPeriod,
  PAY_START_MISSING_MSG,
  payDayOf,
  paymentPreview,
  sgkCashBlocked,
} from "./employeePay";

describe("employeePay", () => {
  const balance = {
    unpaid_payroll: 28000,
    overtime_due: 1200,
    bonus_pending: 500,
    meal_due: 2500,
    transport_due: 1500,
    unpaid_expenses: 800,
  };

  it("lists only positive due lines and labels yevmiye for daily wage", () => {
    const monthly = employeeDueLines(balance, { pay_type: "monthly" });
    expect(monthly.map((l) => l.key)).toEqual(["salary", "overtime", "bonus", "meal", "transport", "expense"]);
    expect(employeePayKindLabel("salary", { pay_type: "monthly" })).toBe("Maaş");
    expect(employeePayKindLabel("salary", { pay_type: "daily" })).toBe("Bakiye");
    expect(employeePayKindLabel("bonus", { pay_type: "daily" })).toBe("Yevmiye");
    expect(employeeDueLines({ unpaid_payroll: 0, meal_due: 0, transport_due: 10 }, {}).map((l) => l.key)).toEqual(["transport"]);
  });

  it("sums all dues vs selected split kinds", () => {
    const lines = employeeDueLines(balance, {});
    expect(employeePayTotal(lines, "all", [])).toBe(34500);
    expect(employeePayTotal(lines, "split", ["meal", "transport"])).toBe(4000);
    expect(employeePayKindsForSubmit("all", lines, ["meal"])).toEqual(["salary", "overtime", "bonus", "meal", "transport", "expense"]);
    expect(employeePayKindsForSubmit("split", lines, ["salary", "overtime"])).toEqual(["salary", "overtime"]);
  });

  it("reads hak ediş günü from pay_start_date", () => {
    expect(payDayOf({ pay_start_date: "2026-11-01" })).toBe(1);
    expect(payDayOf({ pay_day: 15 })).toBe(15);
    expect(hasPayStartDate({ pay_start_date: "2026-11-01" })).toBe(true);
    expect(hasPayStartDate({ pay_start_date: "" })).toBe(false);
    expect(hasPayStartDate({})).toBe(false);
    expect(PAY_START_MISSING_MSG).toBe("Hak ediş tarihi tanımlı değil");
  });

  it("starts list pay buttons in split mode for a single kind", () => {
    const lines = employeeDueLines(balance, {});
    expect(employeePayModalStart("meal", lines)).toEqual({ mode: "split", selected: ["meal"] });
    expect(employeePayModalStart("advance", lines)).toEqual({ mode: "split", selected: [] });
    expect(employeePayModalStart(undefined, lines).mode).toBe("all");
    expect(employeePayModalTitle("overtime", { full_name: "Ali" })).toBe("Mesai — Ali");
    expect(employeePayModalTitle("advance", { full_name: "Ali" })).toBe("Avans — Ali");
    expect(employeePayKindsForSubmit("split", lines.filter((l) => l.key !== "salary"), ["salary"])).toEqual(["salary"]);
  });

  it("defaults salary account to bank and never POS", () => {
    const accounts = [
      { id: "pos", type: "pos" },
      { id: "card", type: "credit_card" },
      { id: "cash", type: "cash_box" },
    ];
    expect(defaultPayAccount(accounts).id).toBe("cash");
    expect(defaultPayAccount([{ id: "bank", type: "bank" }, ...accounts]).id).toBe("bank");
  });

  it("blocks SGK official salary paid from cash and previews overpay", () => {
    const emp = { sgk_insured: true, official_salary: 15000, salary: 28000 };
    const accounts = [{ id: "b", type: "bank" }, { id: "k", type: "cash_box", current_balance: 100 }];
    expect(sgkCashBlocked(emp, true, [{ kind: "salary", amount: 15000, accountId: "k" }], accounts)).toContain("bankadan");
    expect(sgkCashBlocked(emp, true, [
      { kind: "salary", amount: 15000, accountId: "b" },
      { kind: "advance", amount: 2000, accountId: "k" },
    ], accounts)).toBeNull();
    expect(sgkCashBlocked({ salary: 10000 }, true, [{ kind: "salary", amount: 10000, accountId: "k" }], accounts)).toBeNull();
    expect(cashShortfallWarning([{ kind: "advance", amount: 150, accountId: "k" }], accounts)).toContain("yetersiz");
    expect(paymentPreview(5000, [{ amount: 7000 }]).message).toContain("sonraki maaştan düşülecek");
    expect(paymentPreview(5000, [{ kind: "reimburse", amount: 7000 }])).toMatchObject({
      paying: 0, remainingAfter: 5000, overpaid: false,
    });
    expect(paymentPreview(5000, [{ amount: 1000 }, { kind: "reimburse", amount: 7000 }]).remainingAfter).toBe(4000);
    expect(istanbulPeriod(new Date("2026-09-30T21:30:00Z"))).toBe("2026-10");
  });

  it("formats yemek/yol hak ediş save toast like partner salary", () => {
    expect(employeeAllowanceSaveMessage(null, "2026-11-01")).toBe("Ücret ve mesai bilgileri kaydedildi.");
    expect(employeeAllowanceSaveMessage({ posted_count: 0, scheduled_date: "2026-11-01" }, "2026-11-01")).toBe(
      "Kaydedildi. 01.11.2026 tarihinde yemek/yol alacağa yazılacak.",
    );
    expect(employeeAllowanceSaveMessage({ posted_count: 2, message: "2 hak ediş masrafı yazıldı." })).toBe(
      "2 hak ediş masrafı yazıldı.",
    );
  });
});
