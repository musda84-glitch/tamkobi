import { employeeCompGroups, employeeCompRowCaption, employeeCompRows, remainingLeaveDays } from "./personnelCard";

describe("personnelCard", () => {
  test("groups wage and allowance like the mobile employee card", () => {
    const rows = employeeCompRows(
      { pay_type: "daily", daily_wage: 500, meal_allowance: 0, transport_allowance: 0 },
      { bonus_pending: 8000, overtime_due: 0 },
    );
    expect(employeeCompGroups(rows).map((g) => g.title)).toEqual(["Yan hak", "Yevmiye", "Özet"]);
    expect(employeeCompRowCaption(rows.find((r) => r.key === "salary"), true)).toBe("Yevmiye / gün");
    expect(employeeCompRowCaption(rows.find((r) => r.key === "bonus"), true)).toBe("Yevmiye günü · 16 gün");
    expect(remainingLeaveDays({ annual_leave_days: 14, used_leave_days: 3 })).toBe(11);
  });
});
