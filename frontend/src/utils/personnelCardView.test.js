import { balanceView, filterEmployees, presenceState, teamSummary, todayWorkLabel } from "./personnelCardView";

const morning = new Date(2026, 9, 5, 10, 30);
const evening = new Date(2026, 9, 5, 19, 15);

describe("personnelCardView", () => {
  test("balanceView labels the signed remaining", () => {
    expect(balanceView({ remaining: 1500 })).toEqual({ amount: 1500, tone: "pay", label: "Ödenecek" });
    expect(balanceView({ remaining: -1000 })).toEqual({ amount: 1000, tone: "owes", label: "Personel borçlu" });
    expect(balanceView({ remaining: 0 })).toEqual({ amount: 0, tone: "zero", label: "Bakiye yok" });
    expect(balanceView(undefined).label).toBe("Bakiye yok");
  });

  test("presenceState is in, overtime, or out from the chip and assigned overtime", () => {
    const onSite = { status: "active", location_last_inside: true, workplace: { kind: "office" } };
    expect(presenceState(onSite, null, morning)).toBe("in");
    expect(presenceState(onSite, { check_in: "09:00", scheduled_end: "18:00" }, morning)).toBe("in");
    expect(presenceState(onSite, { check_in: "09:00", assigned_overtime_hours: 2 }, morning)).toBe("overtime");
    expect(presenceState(onSite, { check_in: "09:00", scheduled_end: "18:00" }, evening)).toBe("overtime");
    expect(presenceState(
      { status: "active", location_last_inside: true, workplace: { kind: "task" } },
      { check_in: "08:00" },
      morning,
    )).toBe("in");
    expect(presenceState(
      { status: "active", location_last_inside: false },
      { check_in: "09:00", check_out: "18:05", assigned_overtime_start: "18:00", assigned_overtime_end: "20:30" },
      evening,
    )).toBe("out");
    expect(presenceState({ status: "terminated", location_last_inside: true }, null, morning)).toBe("out");
    expect(presenceState({ status: "active" }, null, morning)).toBe("out");
  });

  test("teamSummary counts people on shift and sums signed remaining", () => {
    const employees = [
      { id: "a", status: "active", location_last_inside: true, workplace: { kind: "office" }, balance: { remaining: 1500 } },
      { id: "b", status: "active", location_last_inside: true, balance: { remaining: -1000 } },
      { id: "c", status: "active", balance: { remaining: 0 } },
    ];
    const attToday = {
      b: { check_in: "09:00", assigned_overtime_start: "00:00", assigned_overtime_end: "00:00" },
    };
    expect(teamSummary(employees, attToday)).toEqual({ inCount: 2, total: 3, netRemaining: 500 });
    expect(teamSummary([], {})).toEqual({ inCount: 0, total: 0, netRemaining: 0 });
  });

  test("filterEmployees keeps all, on-shift, or non-zero balance", () => {
    const employees = [
      { id: "a", status: "active", location_last_inside: true, workplace: { kind: "office" }, balance: { remaining: 1500 } },
      { id: "b", status: "active", location_last_inside: true, balance: { remaining: 0 } },
      { id: "c", status: "active", balance: { remaining: -1000 } },
    ];
    const attToday = {
      b: { check_in: "09:00", assigned_overtime_start: "00:00", assigned_overtime_end: "00:00" },
    };
    expect(filterEmployees(employees, "all", attToday).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(filterEmployees(employees, "in", attToday).map((e) => e.id)).toEqual(["a", "b"]);
    expect(filterEmployees(employees, "balance", attToday).map((e) => e.id)).toEqual(["a", "c"]);
  });

  test("todayWorkLabel reads a worked-time field and does not derive one", () => {
    expect(todayWorkLabel(null)).toBe("—");
    expect(todayWorkLabel({ check_in: "09:00", check_out: "18:00" })).toBe("—");
    expect(todayWorkLabel({ hours: 7.5 })).toBe("7,5 sa");
    expect(todayWorkLabel({ hours: 0 })).toBe("0 sa");
    expect(todayWorkLabel({ worked_minutes: 90 })).toBe("1 sa 30 dk");
  });
});
