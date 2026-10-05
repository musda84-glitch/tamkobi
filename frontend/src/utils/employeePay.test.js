import {
  employeeAllowanceSaveMessage,
  employeeDueLines,
  employeePayKindLabel,
  employeePayKindsForSubmit,
  employeePayModalStart,
  employeePayModalTitle,
  employeePayTotal,
  payDayOf,
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
