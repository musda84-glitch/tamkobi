import {
  employeeCompGroups,
  employeeCompRowCaption,
  employeeCompRows,
  employeePayMoves,
  employeePresenceChip,
  filterPayMoves,
  fmtLocationMoveAt,
  locationMoveCanIgnore,
  locationMoveColor,
  locationMoveDidLabel,
  locationMoveIgnorePath,
  locationMoveLine,
  locationMovesPeriodHint,
  overtimeMoveCanDelete,
  overtimeMoveCanEdit,
  overtimeMoveLine,
  overtimeMovesPeriodHint,
  payMovesPeriodHint,
  remainingLeaveDays,
} from "./personnelCard";

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

  test("shows live presence next to Aktif from GPS inside flag", () => {
    expect(employeePresenceChip({ status: "active", location_last_inside: true, workplace: { kind: "office" } })).toMatchObject({
      key: "work", label: "İş Yerinde Şuan", border: "#6EE7B7",
    });
    expect(employeePresenceChip({ status: "active", location_last_inside: true, workplace: { kind: "task" } }).label).toBe("Dış Görev Yerinde");
    expect(employeePresenceChip({ status: "active", location_last_inside: false }).label).toBe("Şuan Dışarıda");
    expect(employeePresenceChip({ status: "terminated", location_last_inside: true })).toBeNull();
    expect(employeePresenceChip({ status: "active", location_last_ok: false })).toBeNull();
  });

  test("builds pay and location move lines like mobile", () => {
    const moves = employeePayMoves({
      payrolls: [{ id: "p1", period: "2026-09", status: "pending", final_payable: 30000 }],
      bonuses: [{ id: "b1", type: "advance", status: "paid", period: "2026-09", amount: 2000, created_at: "2026-09-10" }],
    });
    expect(moves.map((m) => m.title)).toEqual(["Avans", "Maaş"]);
    expect(payMovesPeriodHint(1, 2, "30d")).toBe("1 / 2 hareket");
    expect(filterPayMoves([{ id: "1", date: "2026-07-01" }], "30d", new Date("2026-09-22"), "2026-09")).toHaveLength(0);
    expect(locationMoveDidLabel("enter")).toBe("İş yerine giriş yaptı");
    expect(locationMoveDidLabel("leave")).toBe("İş yerine çıkış yaptı");
    expect(locationMoveColor("enter")).toBe("#047857");
    expect(locationMoveColor("leave")).toBe("#BE123C");
    expect(fmtLocationMoveAt("2026-09-24T08:32:00")).toBe("24.09.2026 08:32");
    expect(locationMoveLine({ at: "2026-09-24T08:32:00", kind: "enter" })).toBe("24.09.2026 08:32 · İş yerine giriş yaptı");
    expect(locationMoveCanIgnore({ kind: "leave", ignorable: true })).toBe(true);
    expect(locationMoveCanIgnore({ kind: "enter", official: true, ignorable: false })).toBe(false);
    expect(locationMoveIgnorePath({ attendance_id: "a1", id: "m1" })).toBe("/personnel/attendance/a1/location-moves/m1/ignore");
    expect(locationMovesPeriodHint(3, 8, "30d")).toBe("3 / 8 konum hareketi");
  });

  test("formats overtime moves and gates edit/delete", () => {
    expect(overtimeMoveLine({
      date: "2026-09-20",
      hours: 2.5,
      start: "18:00",
      end: "20:30",
      kind: "assigned",
    })).toBe("20.09.2026 · 2.5 sa · 18:00–20:30 · Atanan");
    expect(overtimeMovesPeriodHint(2, 5, "30d")).toBe("2 / 5 mesai kaydı");
    expect(overtimeMoveCanEdit({ can_edit: true }, true)).toBe(true);
    expect(overtimeMoveCanDelete({ can_delete: true, assigned_hours: 2 }, true)).toBe(true);
    expect(overtimeMoveCanDelete({ kind: "computed", assigned_hours: 0 }, true)).toBe(false);
    expect(overtimeMoveCanEdit({ can_edit: true }, false)).toBe(false);
  });
});
