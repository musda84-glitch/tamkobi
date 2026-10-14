import {
  bonusPaidDate,
  employeeCompGroups,
  employeeCompRowCaption,
  employeeCompRows,
  employeePayMoves,
  employeePresenceChip,
  employeePayButtonDue,
  employeePayButtonLabel,
  empDataResetConfirm,
  empDataResetPath,
  filterPayMoves,
  fmtLocationMoveAt,
  locationMoveBg,
  locationMoveCanIgnore,
  locationMoveColor,
  locationMoveDidLabel,
  locationMoveTone,
  locationMoveIgnorePath,
  locationMoveLine,
  locationMovesPeriodHint,
  overtimeMoveCanDelete,
  overtimeMoveCanEdit,
  overtimeMoveDetail,
  overtimeMoveLine,
  overtimeMoveSourceLabel,
  overtimeMovesPeriodHint,
  payMoveCanDelete,
  payMoveDeleteConfirm,
  payMoveDeletePath,
  payMovesPeriodHint,
  presenceTodayOf,
  remainingDue,
  remainingLeaveDays,
  leaveEntitlementDays,
  formatLeaveRemainingLine,
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
    expect(remainingLeaveDays({ annual_leave_days: 14, used_leave_days: 3, leave_carry_days: 2 })).toBe(13);
    expect(remainingLeaveDays({ leave_balance: { remaining: 9 } })).toBe(9);
    // annual=0 / eksik hak → varsayılan 14; kalan ve hak aynı kaynaktan (eski 14/0 hatası)
    expect(leaveEntitlementDays({ annual_leave_days: 0 })).toBe(14);
    expect(remainingLeaveDays({ annual_leave_days: 0, used_leave_days: 0 })).toBe(14);
    expect(formatLeaveRemainingLine({ annual_leave_days: 0 })).toBe("Kalan izin: 14 / 14 gün");
    expect(formatLeaveRemainingLine({ annual_leave_days: 14, used_leave_days: 0 })).toBe("Kalan izin: 14 / 14 gün");
    expect(formatLeaveRemainingLine({ leave_balance: { remaining: 14, annual: 0, used: 0, carry: 0 } })).toBe("Kalan izin: 14 / 14 gün");
    expect(formatLeaveRemainingLine({ annual_leave_days: 14, used_leave_days: 3 })).toBe("Kalan izin: 11 / 14 gün");
    expect(leaveEntitlementDays({})).toBe(14);
  });

  test("shows live presence next to Aktif: iş yeri, görev, mesai bitti, fazla mesai", () => {
    const morning = new Date(2026, 9, 5, 10, 30);
    const evening = new Date(2026, 9, 5, 19, 15);
    expect(employeePresenceChip({ status: "active", location_last_inside: true, workplace: { kind: "office" }, now: morning })).toMatchObject({
      key: "work", label: "İş Yerinde", border: "#6EE7B7",
    });
    expect(employeePresenceChip({ status: "active", location_last_inside: true, workplace: { kind: "task" }, now: morning }).label).toBe("Görev Yerinde");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: true,
      today: { check_in: "09:00", check_out: "17:45" },
      now: evening,
    }).label).toBe("Mesai Bitti");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: true,
      today: { check_in: "09:00", scheduled_end: "18:00" },
      now: evening,
    }).label).toBe("Fazla Mesaide");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: true,
      today: { check_in: "09:00", assigned_overtime_start: "18:00", assigned_overtime_end: "20:30" },
      now: evening,
    }).label).toBe("Fazla Mesaide");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: false,
      today: { check_in: "09:00", check_out: "18:05", assigned_overtime_start: "18:00", assigned_overtime_end: "20:30" },
      now: evening,
    }).label).toBe("Mesai Bitti");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: false,
      workplace: { kind: "task" },
      today: { check_in: "08:00" },
      now: morning,
    }).label).toBe("Görev Yerinde");
    expect(employeePresenceChip({
      status: "active",
      location_last_inside: false,
      today: { check_in: "09:00", scheduled_end: "18:00" },
      now: evening,
    }).label).toBe("Mesai Bitti");
    expect(employeePresenceChip({ status: "terminated", location_last_inside: true, now: morning })).toBeNull();
    expect(employeePresenceChip({ status: "active", location_last_ok: false, now: morning })).toBeNull();
    expect(employeePresenceChip({
      status: "active",
      today: { check_in: "08:30", location_inside_at: "2026-10-05T05:30:00Z" },
      now: morning,
    })?.key).toBe("work");
    expect(presenceTodayOf({
      today: { check_in: "09:00" },
      schedule: { start: "09:00", end: "18:00" },
    })).toMatchObject({ check_in: "09:00", scheduled_end: "18:00" });
  });

  test("bonusPaidDate prefers paid_at then date then created_at", () => {
    expect(bonusPaidDate({ status: "paid", paid_at: "2026-10-10", date: "2026-10-09", created_at: "2026-10-08T12:00:00Z" })).toBe("2026-10-10");
    expect(bonusPaidDate({ status: "paid", date: "2026-10-09", created_at: "2026-10-08T12:00:00Z" })).toBe("2026-10-09");
    expect(bonusPaidDate({ status: "paid", created_at: "2026-10-08T12:00:00Z" })).toBe("2026-10-08T12:00:00Z");
    expect(bonusPaidDate({ status: "pending", date: "2026-10-09" })).toBe("");
  });

  test("builds pay and location move lines like mobile", () => {
    const moves = employeePayMoves({
      payrolls: [{ id: "p1", period: "2026-09", status: "pending", final_payable: 30000 }],
      bonuses: [{ id: "b1", type: "advance", status: "paid", period: "2026-09", amount: 2000, paid_at: "2026-09-10", created_at: "2026-09-10T12:00:00" }],
    });
    expect(moves.map((m) => m.title)).toEqual(["Avans", "Maaş"]);
    expect(moves[0].subtitle).toContain("Ödendi (10.09.2026)");
    expect(moves[0].date).toBe("2026-09-10");
    expect(payMovesPeriodHint(1, 2, "30d")).toBe("1 / 2 hareket");
    expect(filterPayMoves([{ id: "1", date: "2026-07-01" }], "30d", new Date("2026-09-22"), "2026-09")).toHaveLength(0);
    expect(locationMoveDidLabel("enter")).toBe("İş yerine giriş yaptı");
    expect(locationMoveDidLabel("leave")).toBe("İş yerine çıkış yaptı");
    expect(locationMoveColor("enter")).toBe("#047857");
    expect(locationMoveColor("leave")).toBe("#BE123C");
    expect(locationMoveTone(null, "İş yerine giriş yaptı")).toBe("in");
    expect(locationMoveTone(null, "İş yerine çıkış yaptı")).toBe("out");
    expect(locationMoveBg("enter")).toBe("#ECFDF5");
    expect(locationMoveBg("leave")).toBe("#FFF1F2");
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
      source: "manager",
      source_label: "Yönetici atadı",
    })).toBe("20.09.2026 · 2.5 sa · 18:00–20:30 · Yönetici atadı");
    expect(overtimeMoveSourceLabel({ source: "location", source_label: "Konumdan tespit edildi" })).toBe("Konumdan tespit edildi");
    expect(overtimeMoveSourceLabel({ kind: "computed", source: "punch" })).toBe("Puantajdan hesaplandı");
    expect(overtimeMoveDetail({ check_in: "12:38", check_out: "10:26" })).toBe("Puantaj 12:38 → 10:26");
    expect(overtimeMoveDetail({ kind: "assigned" })).toBe("");
    expect(overtimeMovesPeriodHint(2, 5, "30d")).toBe("2 / 5 mesai kaydı");
    expect(overtimeMoveCanEdit({ can_edit: true }, true)).toBe(true);
    expect(overtimeMoveCanDelete({ can_delete: true, assigned_hours: 2 }, true)).toBe(true);
    expect(overtimeMoveCanDelete({ kind: "computed", assigned_hours: 0 }, true)).toBe(false);
    expect(overtimeMoveCanEdit({ can_edit: true }, false)).toBe(false);
  });

  test("gates pay-move delete for payroll and bonus rows", () => {
    expect(payMoveCanDelete({ id: "pay_cedeeef3", kind: "payroll", status: "pending" }, true)).toBe(true);
    expect(payMoveDeletePath({ id: "pay_cedeeef3", kind: "payroll" })).toBe("/personnel/payrolls/pay_cedeeef3");
    expect(payMoveDeleteConfirm({ kind: "payroll", status: "pending" }).message).toContain("bekleyen maaş");
    expect(payMoveCanDelete({ id: "b1", kind: "bonus", status: "paid" }, true)).toBe(true);
    expect(payMoveDeletePath({ id: "b1", kind: "bonus" })).toBe("/personnel/bonuses/b1");
    expect(payMoveCanDelete({ id: "pay-2026-11", kind: "payroll" }, true)).toBe(false);
    expect(payMoveCanDelete({ id: "pay_cedeeef3", kind: "payroll" }, false)).toBe(false);
    expect(payMoveDeleteConfirm({ kind: "payroll", status: "paid" }).message).toContain("geri alınır");
    expect(payMoveDeletePath({ id: "mov_1", kind: "personnel_payment" })).toBe("/personnel/movements/mov_1");
    expect(payMoveCanDelete({ id: "mov_1", kind: "personnel_payment", status: "posted" }, true)).toBe(true);
    expect(payMoveDeleteConfirm({ kind: "personnel_payment" }).title).toBe("Ödemeyi geri al");
    expect(employeePayMoves({
      movements: [{ id: "mov_1", kind_label: "Maaş", amount: 1000, date: "2026-10-13", period: "2026-10", status: "posted" }],
    }).map((m) => m.kind)).toEqual(["personnel_payment"]);
  });

  test("collapses a linked advance into the personnel row and names the source", () => {
    const moves = employeePayMoves({
      bonuses: [{
        id: "b1",
        type: "advance",
        status: "paid",
        amount: 1500,
        period: "2026-10",
        paid_at: "2026-10-13",
        note: "Avans",
        source_type: "personnel_payment",
        source_id: "mov1",
        movement_id: "mov1",
      }],
      movements: [{
        id: "mov1",
        kind: "advance",
        kind_label: "Avans",
        amount: 1500,
        account_name: "Ali BAL (Ortak)",
        date: "2026-10-13",
        period: "2026-10",
        status: "posted",
        description: "Avans",
        effects: [{ collection: "bonus_payments", id: "b1", action: "insert" }],
      }],
    });
    expect(moves).toHaveLength(1);
    expect(moves[0].kind).toBe("bonus");
    expect(moves[0].title).toBe("Avans");
    expect(moves[0].subtitle).toContain("Ödendi");
    expect(moves[0].subtitle).toContain("Kaynak: Ali BAL (Ortak)");
    expect(moves[0].subtitle).not.toMatch(/Ali BAL \(Ortak\).*Ali BAL/);
    expect(moves[0].sourceLabel).toBe("Kaynak: Ali BAL (Ortak)");
    expect(moves[0].linkedMovementId).toBe("mov1");
    expect(moves[0].amount).toBe(1500);
    expect(payMoveDeletePath(moves[0])).toBe("/personnel/bonuses/b1");
  });

  test("keeps an unlinked movement and a payroll source on one row", () => {
    const moves = employeePayMoves({
      payrolls: [{ id: "p1", period: "2026-10", status: "paid", paid_date: "2026-10-13", final_payable: 10000, account_name: "Banka" }],
      movements: [
        {
          id: "mov_salary",
          kind_label: "Maaş",
          amount: 10000,
          account_name: "Banka",
          date: "2026-10-13",
          period: "2026-10",
          status: "posted",
          effects: [{ collection: "payrolls", id: "p1" }],
        },
        {
          id: "mov_meal",
          kind_label: "Yol/Yemek",
          amount: 200,
          account_name: "Kasa",
          description: "Yemek",
          date: "2026-10-12",
          period: "2026-10",
          status: "posted",
        },
        {
          id: "mov_old",
          kind_label: "Avans",
          amount: 50,
          account_name: "Eski",
          date: "2026-10-01",
          status: "reversed",
        },
      ],
    });
    expect(moves.map((m) => m.kind)).toEqual(["payroll", "personnel_payment"]);
    expect(moves[0].subtitle).toContain("Kaynak: Banka");
    expect(moves[0].linkedMovementId).toBe("mov_salary");
    expect(moves[1].id).toBe("mov_meal");
    expect(moves[1].subtitle).toContain("Kaynak: Kasa");
    expect(moves[1].subtitle).not.toMatch(/^Kasa/);
    const named = employeePayMoves({
      bonuses: [{ id: "b2", type: "advance", status: "paid", amount: 10, account_name: "Ali BAL (Ortak)", paid_at: "2026-10-02", period: "2026-10", note: "Avans" }],
    });
    expect(named).toHaveLength(1);
    expect(named[0].sourceLabel).toBe("Kaynak: Ali BAL (Ortak)");
  });

  test("personnel data reset path and confirm copy", () => {
    expect(empDataResetPath("emp_1")).toBe("/personnel/employees/emp_1/reset-data");
    expect(empDataResetPath("")).toBe("");
    const ask = empDataResetConfirm({ full_name: "Ali Yılmaz" });
    expect(ask.title).toMatch(/sıfırla/i);
    expect(ask.message).toMatch(/ödemeler/i);
    expect(ask.message).toMatch(/puantaj/i);
    expect(ask.message).toMatch(/sistem kullanıcısı durur/i);
    expect(ask.check).toContain("Ali Yılmaz");
  });

  test("identity column remaining receivable is always a number", () => {
    expect(remainingDue(undefined)).toBe(0);
    expect(remainingDue({ remaining: 1234.5 })).toBe(1234.5);
    expect(remainingDue({ remaining: -80 })).toBe(-80);
  });

  test("list Öde button uses remaining (overtime already in balance.remaining)", () => {
    expect(employeePayButtonLabel({})).toBe("Öde");
    expect(employeePayButtonDue({ balance: { remaining: 41500, overtime_due: 1500 } })).toBe(41500);
    expect(employeePayButtonLabel({ balance: { remaining: 41500, overtime_due: 1500 } })).toMatch(/^Öde · /);
    expect(employeePayButtonLabel({ balance: { remaining: 0, overtime_due: 0 } })).toBe("Öde");
    expect(remainingDue({ remaining: -2500 })).toBe(-2500);
  });
});
