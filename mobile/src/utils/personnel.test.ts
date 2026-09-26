import {
  draftFromEmployee,
  employeeInitials,
  employeePayload,
  emptyEmployeeDraft,
  leaveDays,
  leaveStatusTr,
  leaveTypeTr,
  selfLeavePayload,
  monthlyPayrollLoad,
  payrollBreakdown,
  payrollStatusTr,
  remainingDue,
  employeeCompRows,
  remainingLeaveDays,
  unpaidPayrollTotal,
  employeeCardActionTitles,
  employeeCardActionIcon,
  EMPLOYEE_LOCATION_SETTINGS_TITLE,
  employeeCardActionsByGroup,
  employeePayMoves,
  enrichEmployeeBalance,
  bonusDue,
  overtimeDue,
  calculatedOvertimeFromCard,
  mergeOvertimePreview,
  overtimeAmountFromHours,
  overtimeApproveConfirm,
  overtimeApprovePayload,
  overtimeCanApprove,
  overtimeCanDelete,
  overtimeCanEdit,
  overtimeDeleteConfirm,
  overtimeEditPayload,
  overtimeStatusLabel,
  overtimeSummaryLine,
  validateOvertimeEdit,
  bonusPayPayload,
  allowanceDue,
  personnelExpensePayload,
  assignEmployeeToTasks,
  assignedTaskAfterAssign,
  overtimePayload,
  projectSelectGroups,
  closedProjectCount,
  taskSelectGroups,
  advancePayload,
  advanceRequestPayload,
  validateAdvance,
  validateEmployee,
  validateIsoDate,
  validateLeave,
  validateSelfLeave,
  validateOvertime,
  positionOptionsFromRoles,
  positionSelectGroups,
  validateTaskAssign,
  isFieldTask,
  normalizeTaskKind,
  taskKindLabel,
  parseYevmiyeDays,
  parseYevmiyeWage,
  pendingYevmiyeBonus,
  unpaidYevmiyeTotals,
  yevmiyeAccrual,
  yevmiyeAddHint,
  ledgerPayPayload,
  dueDateFromDays,
  parseTaskDays,
  validateYevmiyeDays,
  validateYevmiyeWage,
  yevmiyeDaysFromBonus,
  yevmiyeDaysLine,
  yevmiyeAdjustedAmount,
  yevmiyeAdjustmentNeeded,
  yevmiyePayPayload,
  yevmiyeStatusLine,
  referenceDailyWage,
  hasEmployeeDetails,
  employeeStatusLabel,
  employeePresenceChip,
  pendingRequestDecision,
  pendingRequestDecisionMessage,
  requestActionLook,
  requestKey,
  mergeSettledRequests,
  requestKindLabel,
  requestsForEmployee,
  requestsDetailsToggleLabel,
  requestsDetailsToggleIcon,
  requestsDetailsSummary,
  locationCellCaption,
  workplaceDetailsSummary,
  workplaceDetailsToggleLabel,
  workplaceDetailsToggleIcon,
  attendanceGroupToggleLabel,
  attendanceRecordsForEmployee,
  groupAttendanceRecords,
  employeeDutyBoard,
  employeeDutyHeadline,
  employeeCardChrome,
  employeeCardPayKind,
  employeeCompGroups,
  employeeCompRowCaption,
  requestDecisionActions,
  initLocMode,
  patchLocMode,
  serializeLocMode,
  locationTrackingPayload,
  locModeSummary,
  locationTrackingEnabled,
  locationControllerLabel,
  locationTrackingTogglePayload,
  todayAttendanceLine,
  todayAttendanceParts,
  cardPunchAttempts,
  cardPunchConfirmMessage,
  cardPunchDraftTime,
  cardPunchPayload,
  cardPunchRequiresTime,
  cardPunchTimeHint,
  advanceFormToggleIcon,
  advanceFormToggleLabel,
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
  payMoveInPeriod,
  payMovesPeriodHint,
  payMoveDeleteConfirm,
  payMovesPeriodLabel,
  companyBonusPayload,
  bonusesPeriodTotal,
} from "./personnel";

describe("employee initials", () => {
  it("uses first and last name letters", () => {
    expect(employeeInitials("Muhammed Usta")).toBe("MU");
    expect(employeeInitials("Ali")).toBe("AL");
    expect(employeeInitials("")).toBe("?");
  });
});

describe("employee draft", () => {
  it("requires name and TC", () => {
    const d = emptyEmployeeDraft("2026-09-18");
    expect(validateEmployee(d)).toBe("Lütfen ad soyad ve TC kimlik no girin.");
    d.full_name = "Ayşe Yılmaz";
    expect(validateEmployee(d)).toBe("Lütfen ad soyad ve TC kimlik no girin.");
    d.tc_kimlik = "12345678901";
    expect(validateEmployee(d)).toBeNull();
  });

  it("builds position options from company roles", () => {
    const roles = [{ code: "production", name: "Üretim" }, { code: "sales", name: "Satış" }];
    expect(positionOptionsFromRoles(roles).map((o) => o.value)).toEqual(["Üretim", "Satış"]);
    expect(positionOptionsFromRoles(roles, "Uzman")[0].label).toContain("kayıtlı");
    expect(positionSelectGroups(roles)[0].label).toBe("Roller");
  });

  it("maps an existing card and posts salary as number", () => {
    const d = draftFromEmployee({ full_name: "Ali", tc_kimlik: "111", salary: 42000, department: "Üretim" }, "2026-09-18");
    expect(d.full_name).toBe("Ali");
    expect(d.salary).toBe("42000");
    expect(d.department).toBe("Üretim");
    expect(d.pay_type).toBe("monthly");
    const body = employeePayload(d, "comp_1");
    expect(body.company_id).toBe("comp_1");
    expect(body.salary).toBe(42000);
    expect(body.pay_type).toBe("monthly");
    expect(body.full_name).toBe("Ali");
  });

  it("requires IBAN when SGK is set and daily wage when yevmiye", () => {
    const d = emptyEmployeeDraft("2026-09-18");
    d.full_name = "Ayşe";
    d.tc_kimlik = "123";
    d.sgk_number = "111222333";
    expect(validateEmployee(d)).toContain("IBAN");
    expect(hasEmployeeDetails(d)).toBe(true);
    d.iban = "TR00";
    expect(validateEmployee(d)).toBeNull();
    d.pay_type = "daily";
    expect(validateEmployee(d)).toBe("Yevmiye ücreti girin.");
    d.daily_wage = "1500";
    expect(validateEmployee(d)).toBeNull();
    const body = employeePayload(d);
    expect(body.pay_type).toBe("daily");
    expect(body.daily_wage).toBe(1500);
    expect(body.salary).toBe(39000);
  });

  it("labels requests and sums period bonuses", () => {
    expect(employeeStatusLabel("terminated")).toBe("İşten çıktı");
    expect(employeeStatusLabel("active")).toBe("Aktif");
    expect(employeePresenceChip({ location_last_inside: true, workplace: { kind: "task" } })).toMatchObject({
      label: "Dış Görev Yerinde", border: "#A5B4FC",
    });
    expect(employeePresenceChip({ location_last_inside: true, workplace: { kind: "company" } })).toMatchObject({
      label: "İş Yerinde Şuan", border: "#6EE7B7",
    });
    expect(employeePresenceChip({ location_last_inside: false })).toMatchObject({
      label: "Şuan Dışarıda", border: "#FDBA74",
    });
    expect(employeePresenceChip({ status: "terminated", location_last_inside: true })).toBeNull();
    expect(employeePresenceChip({ today: { check_in: "08:30", location_inside_at: "2026-09-25T05:30:00Z" } })?.key).toBe("work");
    expect(requestKindLabel("early_leave")).toBe("Erken çıkış");
    expect(requestKindLabel("geo_confirm")).toBe("Teyitli giriş");
    expect(pendingRequestDecision({ id: "g1", kind: "geo_confirm" }, true)).toEqual({
      path: "/personnel/attendance/g1/geo-confirm-decision", body: { decision: "approve" },
    });
    expect(pendingRequestDecisionMessage({ kind: "geo_confirm" }, true)).toBe("Teyitli giriş onaylandı.");
    expect(requestKindLabel("yevmiye_adjustment")).toBe("Geç giriş ücreti");
    expect(pendingRequestDecision({ id: "l1", kind: "leave" }, true)).toEqual({
      path: "/personnel/leaves/l1/decide", body: { status: "approved" },
    });
    expect(pendingRequestDecision({ id: "a1", kind: "advance" }, false)?.body).toEqual({ status: "rejected" });
    expect(pendingRequestDecision({ id: "y1", kind: "yevmiye_adjustment" }, true)?.path).toBe("/personnel/attendance/y1/yevmiye-decision");
    expect(pendingRequestDecision({ id: "x1", kind: "location_exit" }, "ack")).toEqual({
      path: "/personnel/attendance/x1/location-exit-decision", body: { decision: "ack", wage_deduction: "false" },
    });
    expect(pendingRequestDecision({ id: "x1", kind: "location_exit" }, "deduct")?.body).toEqual({
      decision: "approve", wage_deduction: "true",
    });
    expect(pendingRequestDecision({ id: "x1", kind: "location_exit" }, true)?.body).toEqual({
      decision: "approve", wage_deduction: "false",
    });
    expect(pendingRequestDecision({ id: "d1", kind: "dispute" }, true)).toEqual({
      path: "/personnel/attendance/d1/dispute-decision", body: { decision: "approve" },
    });
    expect(pendingRequestDecision({ id: "d1", kind: "dispute" }, false)?.body).toEqual({ decision: "reject" });
    expect(pendingRequestDecisionMessage({ kind: "location_exit" }, "ack")).toBe("Konum dışı çıkış: haberim var. Kesinti yok.");
    expect(pendingRequestDecisionMessage({ kind: "location_exit" }, "deduct")).toBe("Konum dışı çıkış: ücretten kesinti uygulandı.");
    expect(requestDecisionActions("location_exit").map((a) => a.title)).toEqual(["Haberim var", "Kesinti olmasın", "Kesinti olsun", "Reddet"]);
    expect(requestDecisionActions("dispute").map((a) => a.title)).toEqual(["Düzeltildi", "Reddet"]);
    expect(pendingRequestDecisionMessage({ kind: "dispute" }, true)).toBe("İtiraz düzeltildi olarak kapatıldı.");
    expect(pendingRequestDecisionMessage({ kind: "early_leave" }, false)).toBe("Erken çıkış reddedildi.");
    expect(pendingRequestDecisionMessage({ kind: "yevmiye_adjustment" }, true)).toBe("Ücret kesildi.");
    expect(pendingRequestDecisionMessage({ kind: "yevmiye_adjustment" }, false)).toBe("Ücret kesilmedi.");
    expect(requestDecisionActions("yevmiye_adjustment").map((a) => a.title)).toEqual(["Ücret kes", "Ücret kesme"]);
    expect(requestKindLabel("overtime_confirm")).toBe("Mesai onayı");
    expect(pendingRequestDecision({ id: "ot1", kind: "overtime_confirm" }, true)).toEqual({
      path: "/personnel/attendance/ot1/overtime-confirm-decision", body: { decision: "yes" },
    });
    expect(pendingRequestDecision({ id: "ot1", kind: "overtime_confirm" }, false)?.body).toEqual({ decision: "no" });
    expect(pendingRequestDecisionMessage({ kind: "overtime_confirm" }, true)).toBe("Fazla mesai yazıldı.");
    expect(pendingRequestDecisionMessage({ kind: "overtime_confirm" }, false)).toBe("Fazla mesai yazılmadı.");
    const approve = requestDecisionActions("leave")[0];
    const reject = requestDecisionActions("leave")[1];
    expect(requestActionLook(approve, null)).toMatchObject({ title: "Onayla", icon: null, muted: false, color: "#059669" });
    expect(requestActionLook(approve, true)).toMatchObject({ title: "Onaylandı", icon: "checkmark-circle", color: "#047857", muted: false });
    expect(requestActionLook(approve, false)).toMatchObject({ title: "Onayla", icon: null, muted: true, color: "#94A3B8" });
    expect(requestActionLook(reject, false)).toMatchObject({ title: "Reddedildi", icon: "close-circle", color: "#9F1239", muted: false });
    expect(requestKey({ kind: "leave", id: "abc" })).toBe("leave-abc");
    expect(mergeSettledRequests(
      [{ id: "1", kind: "leave" }],
      [{ item: { id: "1", kind: "leave" }, decision: true }, { item: { id: "2", kind: "advance" }, decision: false }],
    )).toEqual([
      { item: { id: "1", kind: "leave" }, decision: true },
      { item: { id: "2", kind: "advance" }, decision: false },
    ]);
    expect(requestsForEmployee([{ id: "1", employee_id: "e1", kind: "leave" }, { id: "2", employee_id: "e2" }], "e1")).toHaveLength(1);
    expect(requestsDetailsToggleLabel(false)).toBe("Büyüt");
    expect(requestsDetailsToggleLabel(true)).toBe("Gizle");
    expect(requestsDetailsToggleIcon(false)).toBe("chevron-down");
    expect(requestsDetailsSummary([{ kind: "leave", title: "Yıllık" }, { kind: "advance", title: "Avans" }])).toBe("İzin · Yıllık · +1");
    expect(requestsDetailsSummary([])).toBe("Talep yok");
    expect(locationCellCaption(true)).toBe("Açık");
    expect(locationCellCaption(false)).toBe("Kapalı");
    expect(companyBonusPayload("e1", "second_salary", "2000", "2026-09", "", "not").type).toBe("second_salary");
    expect(bonusesPeriodTotal([{ period: "2026-09", amount: 100 }, { period: "2026-08", amount: 50 }], "2026-09")).toBe(100);
    expect(attendanceGroupToggleLabel(false, 3)).toBe("Kayıtlar (3)");
    expect(attendanceGroupToggleLabel(true, 3)).toBe("Kayıtları gizle (3)");
    const grouped = groupAttendanceRecords([
      { id: "2", employee_id: "e1", employee_name: "Ali", date: "2026-09-20" },
      { id: "1", employee_id: "e2", employee_name: "Zeynep", date: "2026-09-21" },
      { id: "3", employee_id: "e1", employee_name: "Ali", date: "2026-09-23" },
    ]);
    expect(grouped.map((g) => g.employee_name)).toEqual(["Ali", "Zeynep"]);
    expect(grouped[0].records.map((r) => r.id)).toEqual(["3", "2"]);
    expect(attendanceRecordsForEmployee(grouped.flatMap((g) => g.records), "e2").map((r) => r.id)).toEqual(["1"]);
    expect(workplaceDetailsToggleLabel(false)).toBe("Aç");
    expect(workplaceDetailsToggleLabel(true)).toBe("Gizle");
    expect(workplaceDetailsToggleIcon(false)).toBe("chevron-down");
    expect(workplaceDetailsToggleIcon(true)).toBe("chevron-up");
    expect(workplaceDetailsSummary({ hasFieldDuty: true, fieldLabel: "aa", taskCount: 4 })).toBe("aa · 4 açık görev");
    expect(workplaceDetailsSummary({ taskCount: 1 })).toBe("1 açık görev");
    const duties = employeeDutyBoard(
      {
        workplace: {
          kind: "task",
          task_id: "t1",
          task_title: "Montaj",
          project_number: "PRJ-2026-0012",
          project_name: "Villa",
          duration_days: 3,
          due_date: "2026-09-26",
          address: "Kadıköy",
        },
      },
      {
        tasks: [
          { id: "t1", title: "Montaj", project_number: "PRJ-2026-0012", project_name: "Villa", duration_days: 3, due_date: "2026-09-26", kind: "field" },
          { id: "t2", title: "Keşif", project_name: "Ofis", kind: "office", park_name: "Makina" },
          { id: "t3", title: "Eski", done: true },
        ],
      },
    );
    expect(duties.headline).toBe("Şu an: Montaj");
    expect(duties.current?.title).toBe("Montaj");
    expect(duties.current?.lines).toEqual(["Dış görev", "PRJ-2026-0012 · Villa", "3 gün", "Bitiş 26.09.2026"]);
    expect(duties.open.map((t) => t.title)).toEqual(["Montaj", "Keşif"]);
    expect(duties.done).toHaveLength(1);
    expect(employeeDutyHeadline({ current: null, open: [] })).toBe("Atanmış görev yok");
    expect(payMovesPeriodLabel("30d")).toBe("Son 30 gün");
    expect(payMoveDeleteConfirm({ title: "Avans" })).toEqual({
      title: "Kaydı sil",
      message: "Avans silinsin mi? Bu işlem geri alınamaz.",
    });
    expect(payMovesPeriodHint(8, 24, "30d")).toBe("8 / 24 hareket");
    expect(payMovesPeriodHint(12, 12, "all")).toBe("12 hareket");
    expect(payMoveInPeriod({ date: "2026-09-20" }, "30d", new Date("2026-09-22T12:00:00"), "2026-09")).toBe(true);
    expect(payMoveInPeriod({ date: "2026-07-01" }, "30d", new Date("2026-09-22T12:00:00"), "2026-09")).toBe(false);
    expect(payMoveInPeriod({ date: "2026-09" }, "month", new Date("2026-09-22"), "2026-09")).toBe(true);
    expect(filterPayMoves([{ id: "1", kind: "bonus", title: "Avans", subtitle: "", amount: 1, date: "2026-07-01" }], "30d", new Date("2026-09-22"), "2026-09")).toHaveLength(0);
    expect(locationMoveDidLabel("enter")).toBe("İş yerine giriş yaptı");
    expect(locationMoveDidLabel("leave")).toBe("İş yerine çıkış yaptı");
    expect(locationMoveColor("enter")).toBe("#047857");
    expect(locationMoveColor("leave")).toBe("#BE123C");
    expect(locationMoveColor("leave", true)).toBe("#94A3B8");
    expect(locationMoveTone(null, "İş yerine giriş yaptı")).toBe("in");
    expect(locationMoveTone(null, "İş yerine çıkış yaptı")).toBe("out");
    expect(locationMoveBg("enter")).toBe("#ECFDF5");
    expect(locationMoveBg("leave")).toBe("#FFF1F2");
    expect(locationMoveDidLabel("lost")).toBe("Konum kaybı");
    expect(fmtLocationMoveAt("2026-09-24T08:32:00")).toBe("24.09.2026 08:32");
    expect(fmtLocationMoveAt("2026-09-24T05:32:00+00:00")).toBe("24.09.2026 08:32");
    expect(locationMoveLine({ at: "2026-09-24T08:32:00", kind: "enter" })).toBe("24.09.2026 08:32 · İş yerine giriş yaptı");
    expect(locationMoveCanIgnore({ kind: "leave", ignorable: true })).toBe(true);
    expect(locationMoveCanIgnore({ kind: "enter", official: true, ignorable: false })).toBe(false);
    expect(locationMoveCanIgnore({ kind: "lost", ignorable: true, ignored: true })).toBe(false);
    expect(locationMoveIgnorePath({ attendance_id: "a1", id: "m1" })).toBe("/personnel/attendance/a1/location-moves/m1/ignore");
    expect(locationMovesPeriodHint(3, 8, "30d")).toBe("3 / 8 konum hareketi");
    expect(employeeCardChrome({ pay_type: "daily", daily_wage: 500 }).borderColor).toBe("#D97706");
    expect(employeeCardChrome({ pay_type: "monthly" }).backgroundColor).toBe("#D1FAE5");
    expect(employeeCardChrome({ pay_type: "daily", daily_wage: 500 }).borderWidth).toBe(2);
    expect(employeeCardPayKind({ pay_type: "daily", daily_wage: 500 })).toBe("daily");
    expect(employeeCardPayKind({ pay_type: "monthly" })).toBe("monthly");
  });
});

describe("payroll helpers", () => {
  it("sums monthly net load and formats status / extras", () => {
    expect(monthlyPayrollLoad([{ salary: 30000 }, { salary: 25000 }])).toBe(55000);
    expect(payrollStatusTr("pending")).toBe("Ödeme bekliyor");
    expect(payrollStatusTr("paid", "2026-09-15")).toBe("Ödendi (15.09.2026)");
    expect(payrollBreakdown({ overtime_pay: 1200, overtime_hours: 8, second_salary: 5000 })).toContain("mesai");
    expect(payrollBreakdown({ overtime_pay: 0, second_salary: 0 })).toBe("");
    expect(payrollBreakdown({ pay_type: "daily", worked_days: 18, daily_wage: 1500 })).toBe("18 gün × 1500 ₺");
  });

  it("sums unpaid payroll and prefers card remaining", () => {
    const pays = [
      { employee_id: "e1", status: "pending", final_payable: 12000 },
      { employee_id: "e1", status: "paid", final_payable: 30000 },
      { employee_id: "e2", status: "pending", net_salary: 8000 },
    ];
    expect(unpaidPayrollTotal("e1", pays)).toBe(12000);
    expect(unpaidPayrollTotal("e2", pays)).toBe(8000);
    expect(remainingDue({ remaining: 15400 }, 12000)).toBe(15400);
    expect(remainingDue(null, 12000)).toBe(12000);
    expect(employeeCompRows({ salary: 30000, meal_allowance: 1750, transport_allowance: 850 }).map((r) => [r.label, r.value])).toEqual([
      ["Yemek", 1750],
      ["Yol", 850],
      ["Maaş", 30000],
      ["Prim hakedişi", 0],
      ["Fazla mesai ücreti", 0],
      ["Toplam", 32600],
    ]);
    expect(employeeCompRows({ salary: 30000 }, { meal_allowance: 500, transport_due: 200, bonus_pending: 4000, overtime_due: 1250 }).map((r) => [r.key, r.value])).toEqual([
      ["meal", 500],
      ["yol", 200],
      ["salary", 30000],
      ["bonus", 4000],
      ["overtime", 1250],
      ["total", 35950],
    ]);
    expect(employeeCompRows({ salary: 30000 }, { meal_allowance: 500, transport_due: 200 }).find((r) => r.key === "yol")?.value).toBe(200);
    expect(employeeCompRows({ pay_type: "daily", daily_wage: 1500, meal_allowance: 100 }).map((r) => [r.label, r.value, r.hint, r.days])).toEqual([
      ["Yemek", 100, undefined, undefined],
      ["Yol", 0, undefined, undefined],
      ["Yevmiye", 1500, undefined, undefined],
      ["Yevmiye günü", 0, "0 gün", 0],
      ["Fazla mesai ücreti", 0, undefined, undefined],
      ["Toplam", 1600, undefined, undefined],
    ]);
    expect(employeeCompRows({ pay_type: "daily", daily_wage: 1500 }, null, { daysPresent: 6 }).find((r) => r.key === "bonus")).toEqual({
      key: "bonus", label: "Yevmiye günü", value: 9000, hint: "6 gün", days: 6,
    });
    expect(employeeCompRows({ pay_type: "daily", daily_wage: 1500 }, { bonus_pending: 10500 }, { daysPresent: 1 }).find((r) => r.key === "bonus")).toEqual({
      key: "bonus", label: "Yevmiye günü", value: 10500, hint: "7 gün", days: 7,
    });
    expect(employeeCompGroups(employeeCompRows({ salary: 30000, meal_allowance: 100, transport_allowance: 50 })).map((g) => [g.key, g.title, g.rows.map((r) => r.key)])).toEqual([
      ["allowance", "Yan hak", ["meal", "yol"]],
      ["wage", "Maaş", ["salary", "bonus"]],
      ["sum", "Özet", ["overtime", "total"]],
    ]);
    expect(employeeCompGroups(employeeCompRows({ pay_type: "daily", daily_wage: 500 })).find((g) => g.key === "wage")?.title).toBe("Yevmiye");
    expect(employeeCompRowCaption({ key: "salary", label: "Yevmiye", value: 500 }, true)).toBe("Yevmiye / gün");
    expect(employeeCompRowCaption({ key: "bonus", label: "Yevmiye günü", value: 8000, days: 16 }, true)).toBe("Yevmiye günü · 16 gün");
    expect(initLocMode(null).interval_minutes).toBe(15);
    expect(initLocMode({ enabled: false, continuous: true, interval_minutes: 0 })).toMatchObject({ enabled: false, continuous: true, interval_minutes: 0 });
    expect(patchLocMode({ enabled: true, continuous: false, interval_minutes: 15 }, "continuous", true).interval_minutes).toBe(0);
    expect(serializeLocMode({ enabled: true, continuous: true, interval_minutes: 10 })).toEqual({ enabled: true, continuous: true, interval_minutes: 0, exit_tolerance_hours: 0 });
    expect(locationTrackingPayload(
      { enabled: false, continuous: false, interval_minutes: 15 },
      { enabled: true, continuous: true, interval_minutes: 0, exit_tolerance_hours: 2 },
    )).toEqual({
      enabled: false, continuous: false, interval_minutes: 15, exit_tolerance_hours: 0,
      field: { enabled: true, continuous: true, interval_minutes: 0, exit_tolerance_hours: 2 },
    });
    expect(locModeSummary({ enabled: false })).toBe("Kapalı");
    expect(locModeSummary({ enabled: true, continuous: true, interval_minutes: 0 })).toBe("Sürekli");
    expect(locModeSummary({ enabled: true, interval_minutes: 15 })).toBe("15 dk");
    expect(locationTrackingEnabled({ enabled: true, field: { enabled: false } })).toBe(true);
    expect(locationTrackingEnabled({ enabled: false, field: { enabled: false } })).toBe(false);
    expect(locationControllerLabel(true)).toBe("Konum açık");
    expect(locationControllerLabel(false)).toBe("Konum kapalı");
    expect(locationTrackingTogglePayload({ enabled: true, field: { enabled: true } }, false).enabled).toBe(false);
    expect(todayAttendanceLine({ check_in: "08:50", check_out: "18:05" })).toBe("Bugün 08:50 → 18:05");
    expect(todayAttendanceLine(null)).toBe("Bugün giriş / çıkış yok");
    expect(todayAttendanceParts({ check_in: "01:37", check_out: "10:26", late_minutes: 0 })).toEqual({
      checkIn: "01:37", checkOut: "10:26", late: 0, empty: false,
    });
    expect(todayAttendanceParts(null).empty).toBe(true);
    expect(cardPunchConfirmMessage("check_in", "Davut")).toBe("Davut için giriş saati personel onayına gönderilsin mi?");
    expect(cardPunchConfirmMessage("check_out")).toMatch(/çıkış saati/);
    expect(cardPunchConfirmMessage("absent", "Davut")).toMatch(/devamsız/);
    expect(cardPunchConfirmMessage("absent", "Davut")).toMatch(/Giriş\/çıkış silinir/);
    expect(cardPunchDraftTime("check_in", { check_in: "09:13" })).toBe("09:13");
    expect(cardPunchDraftTime("check_out", { check_out: "--:--" })).toBe("");
    expect(cardPunchRequiresTime("")).toMatch(/Saat/);
    expect(cardPunchRequiresTime("09:13")).toBeNull();
    expect(cardPunchPayload("check_in", "09:13")).toEqual({ action: "check_in", check_in: "09:13" });
    expect(cardPunchAttempts({ manager_time_edit_rounds: { check_in: { attempts: 2 } } }, "check_in")).toBe(2);
    expect(cardPunchTimeHint(0)).toMatch(/teyidine/);
    expect(cardPunchTimeHint(2)).toMatch(/3\. deneme/);
    expect(advanceFormToggleIcon(true)).toBe("eye-off-outline");
    expect(advanceFormToggleLabel(false)).toBe("Göster");
    expect(employeeCompRows({ daily_wage: 1500 }, { bonus_pending: 3000 }).find((r) => r.key === "bonus")).toMatchObject({
      label: "Yevmiye günü", value: 3000, days: 2,
    });
    expect(unpaidYevmiyeTotals([
      { type: "yevmiye", status: "pending", worked_days: 6, amount: 9000 },
      { type: "yevmiye", status: "pending", worked_days: 1, amount: 1500 },
      { type: "yevmiye", status: "paid", worked_days: 2, amount: 3000 },
    ])).toEqual({ days: 7, amount: 10500 });
    expect(yevmiyeAccrual({
      bonuses: [{ type: "yevmiye", status: "pending", worked_days: 6, amount: 9000 }],
      payrolls: [
        { id: "p1", employee_id: "e1", pay_type: "daily", status: "pending", worked_days: 1, daily_wage: 1500, final_payable: 1500 },
        { id: "p2", employee_id: "e1", pay_type: "daily", status: "paid", worked_days: 2, final_payable: 3000 },
      ],
      employeeId: "e1",
    })).toEqual({ days: 7, amount: 10500 });
    expect(bonusDue({ bonus_pending: 2500 })).toBe(2500);
    expect(overtimeDue({ overtime_pay: 1800, overtime_due: 600 })).toBe(600);
    expect(calculatedOvertimeFromCard({
      overtime: { hours: 3.5, amount: 1750, weekday_hours: 3.5, holiday_hours: 0, weekday_rate: 500 },
      attendance: { month: "2026-09" },
    }).status).toBe("calculated");
    expect(calculatedOvertimeFromCard({
      overtime: { hours: 3.5, amount: 1750 },
      attendance: { month: "2026-09" },
      bonuses: [{ id: "b1", type: "overtime", status: "pending", period: "2026-09", amount: 1600, note: "Düzenlenen fazla mesai · 3 sa" }],
    })).toMatchObject({ status: "approved", amount: 1600, hours: 3, bonusId: "b1" });
    expect(calculatedOvertimeFromCard({
      overtime: { hours: 2, amount: 800 },
      bonuses: [{ _id: "p1", type: "overtime", status: "paid", period: "2026-09", amount: 800, note: "Hesaplanan fazla mesai · 2 sa" }],
    }, "2026-09")).toMatchObject({ status: "paid", amount: 800, hours: 2 });
    expect(overtimeCanApprove({ status: "calculated", amount: 1750, hours: 3.5, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09" })).toBe(true);
    expect(overtimeCanApprove({ status: "approved", amount: 1750, hours: 3.5, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09" })).toBe(false);
    expect(overtimeCanDelete({ status: "calculated", amount: 1750, hours: 3.5, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09" })).toBe(false);
    expect(overtimeCanDelete({ status: "approved", amount: 1600, hours: 3, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09", bonusId: "b1" })).toBe(true);
    expect(overtimeCanDelete({ status: "paid", amount: 800, hours: 2, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09", bonusId: "p1" })).toBe(false);
    expect(overtimeCanEdit({ status: "paid", amount: 800, hours: 2, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09" })).toBe(false);
    expect(overtimeApproveConfirm()).toEqual({
      title: "Fazla mesai onayla",
      message: "İşlemi onaylıyor musunuz?",
    });
    expect(overtimeDeleteConfirm()).toEqual({
      title: "Fazla mesai sil",
      message: "Fazla mesai kaydını silmek istiyor musunuz?",
    });
    expect(overtimeStatusLabel("calculated")).toBe("Hesaplandı");
    expect(overtimeSummaryLine({
      hours: 3.5, amount: 1750, weekdayHours: 3.5, holidayHours: 0, weekdayRate: 500, holidayRate: 0, period: "2026-09", status: "calculated",
    })).toBe("2026-09 · 3.5 sa · HF 3.5 / tatil 0 · 500 ₺/sa");
    expect(overtimeAmountFromHours(2.5, 400)).toBe(1000);
    expect(validateOvertimeEdit("", "")).toMatch(/saati veya tutar/);
    expect(validateOvertimeEdit("2", "0")).toMatch(/Tutar/);
    expect(validateOvertimeEdit("2", "800")).toBeNull();
    expect(overtimeApprovePayload("e1", {
      hours: 3.5, amount: 1750, weekdayHours: 0, holidayHours: 0, weekdayRate: 0, holidayRate: 0, period: "2026-09", status: "calculated",
    })).toEqual({
      employee_id: "e1",
      type: "overtime",
      amount: 1750,
      period: "2026-09",
      note: "Hesaplanan fazla mesai · 3.5 sa",
    });
    expect(overtimeEditPayload("e1", "2,5", "900", "2026-09", "")).toEqual({
      employee_id: "e1",
      type: "overtime",
      amount: 900,
      period: "2026-09",
      note: "Düzenlenen fazla mesai · 2.5 sa",
    });
    expect(mergeOvertimePreview({ overtime: { hours: 1, amount: 100 } }, {
      overtime_hours: 4, amount: 2000, weekday_hours: 4, holiday_hours: 0, weekday_rate: 500, period: "2026-08",
    }, "2026-08").overtime).toMatchObject({ hours: 4, amount: 2000, weekday_rate: 500 });
    expect(enrichEmployeeBalance({
      overtime: { hours: 3, amount: 1800 },
      bonuses: [{ type: "overtime", status: "paid", period: "2026-09", amount: 600 }],
      balance: { remaining: 0 },
    }, "2026-09")?.overtime_due).toBe(1200);
    expect(bonusPayPayload("e1", "overtime", "1200", "2026-09", "partner:p1", "")).toMatchObject({
      employee_id: "e1",
      type: "overtime",
      amount: 1200,
      note: "Fazla mesai ücreti",
      partner_id: "p1",
    });
    expect(monthlyPayrollLoad([{ salary: 10000 }, { pay_type: "daily", daily_wage: 1000 }])).toBe(36000);
    expect(validateAdvance("")).toBe("Avans tutarı girin.");
    expect(validateAdvance("2500")).toBeNull();
    expect(advanceRequestPayload(" 2500 ", " maaş ", "2026-09")).toEqual({
      amount: 2500,
      note: "maaş",
      period: "2026-09",
    });
    expect(advancePayload("e1", "2500", "2026-09", "partner:p1", "maaş")).toMatchObject({
      employee_id: "e1",
      type: "advance",
      amount: 2500,
      partner_id: "p1",
      account_id: null,
    });
  });
});

describe("leave helpers", () => {
  it("counts inclusive days and rejects inverted ranges", () => {
    expect(leaveDays("2026-09-01", "2026-09-03")).toBe(3);
    expect(leaveDays("2026-09-03", "2026-09-01")).toBe(0);
    expect(validateLeave("", "2026-09-01", "2026-09-02")).toBe("Çalışan seçin.");
    expect(validateLeave("e1", "2026-09-03", "2026-09-01")).toBe("Bitiş tarihi başlangıçtan önce olamaz.");
    expect(validateLeave("e1", "2026-09-01", "2026-09-02")).toBeNull();
    expect(validateSelfLeave("", "")).toBe("Başlangıç tarihi seçin.");
    expect(validateSelfLeave("2026-09-03", "2026-09-01")).toBe("Bitiş tarihi başlangıçtan önce olamaz.");
    expect(validateSelfLeave("2026-09-01", "")).toBeNull();
    expect(selfLeavePayload("annual", "2026-09-01", "2026-09-03", "  aile  ")).toEqual({
      type: "annual",
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      days: 3,
      reason: "aile",
    });
    expect(leaveTypeTr("annual")).toBe("Yıllık İzin");
    expect(leaveStatusTr("approved")).toBe("Onaylandı");
    expect(remainingLeaveDays({ annual_leave_days: 14, used_leave_days: 3 })).toBe(11);
  });
});

describe("overtime assign", () => {
  it("requires a positive hour amount and ISO date", () => {
    expect(validateOvertime("")).toBe("Mesai saati veya saat aralığı girin.");
    expect(validateOvertime("0")).toBe("Mesai saati 0'dan büyük olmalı.");
    expect(validateOvertime("2,5")).toBeNull();
    expect(validateOvertime("02:30")).toBeNull();
    expect(validateOvertime("", "18:00", "20:30")).toBeNull();
    expect(validateOvertime("", "18:00", "")).toBe("Saat aralığını başlangıç ve bitiş olarak girin.");
    expect(validateIsoDate("19.09.2026")).toBe("Tarih YYYY-AA-GG formatında olmalı.");
    expect(validateIsoDate("2026-09-19")).toBeNull();
    expect(overtimePayload("e1", "2026-09-19", "2,5", " keşif ")).toEqual({
      employee_id: "e1",
      date: "2026-09-19",
      hours: 2.5,
      note: "keşif",
    });
    expect(overtimePayload("e1", "2026-09-19", "02:30", "")).toEqual({
      employee_id: "e1",
      date: "2026-09-19",
      hours: 2.5,
      note: "",
    });
    expect(overtimePayload("e1", "2026-09-19", "", "", "18:00", "20:30")).toEqual({
      employee_id: "e1",
      date: "2026-09-19",
      hours: 2.5,
      note: "",
      start_time: "18:00",
      end_time: "20:30",
    });
  });
});

describe("employee card actions", () => {
  it("shows Görev ata and never Düzenle/Sil", () => {
    const titles = employeeCardActionTitles();
    expect(titles).toEqual(["Avans", "Maaş öde", "Yemek", "Yol", "Prim öde", "Mesai öde", "Görev ata", "+ Mesai"]);
    expect(employeeCardActionIcon("advance")).toBe("cash-outline");
    expect(employeeCardActionIcon("location")).toBe("location-outline");
    expect(EMPLOYEE_LOCATION_SETTINGS_TITLE).toBe("Konum Ayarları");
    expect(employeeCardActionIcon("expense")).toBe("receipt-outline");
    expect(employeeCardActionIcon("duties")).toBe("checkbox-outline");
    expect(employeeCardActionTitles({ pay_type: "daily" })).toEqual([
      "Avans", "Bakiye öde", "Yemek", "Yol", "Yevmiye günü", "Mesai öde", "Görev ata", "+ Mesai",
    ]);
    expect(parseYevmiyeDays("12")).toBe(12);
    expect(parseYevmiyeDays("2,5")).toBe(2);
    expect(parseYevmiyeDays("0")).toBeNull();
    expect(validateYevmiyeDays("")).toBe("1–31 arası gün sayısı girin.");
    expect(yevmiyeDaysLine({ pay_type: "daily", daily_wage: 1500 }, 6)).toBe("6 gün × 1500 ₺");
    expect(validateYevmiyeWage("")).toBe("Yevmiye ücreti girin.");
    expect(parseYevmiyeWage("1750,5")).toBe(1750.5);
    expect(yevmiyePayPayload("e1", { pay_type: "daily", daily_wage: 1500 }, "6", "2026-09", "", "", "1750")).toMatchObject({
      employee_id: "e1",
      type: "yevmiye",
      amount: 10500,
      period: "2026-09",
      note: "6 gün × 1750 ₺",
      worked_days: 6,
      daily_wage: 1750,
      account_id: null,
    });
    expect(yevmiyePayPayload("e1", { pay_type: "daily", daily_wage: 1500 }, "6", "2026-09", "acc1", "")).toMatchObject({
      employee_id: "e1",
      type: "yevmiye",
      amount: 9000,
      period: "2026-09",
      note: "6 gün × 1500 ₺",
      worked_days: 6,
      account_id: "acc1",
    });
    expect(employeeCardActionsByGroup("work").map((a) => a.title)).toEqual(["Görev ata", "+ Mesai"]);
    expect(employeeCardActionsByGroup("pay").map((a) => a.key)).toEqual(["advance", "salary", "meal", "transport", "bonus", "otpay"]);
    expect(titles).not.toContain("Düzenle");
    expect(titles).not.toContain("Sil");
    expect(allowanceDue({ meal_allowance: 5000 }, { meal_due: 3750 }, "meal")).toBe(3750);
    expect(allowanceDue({ transport_allowance: 2500 }, null, "transport")).toBe(2500);
    expect(personnelExpensePayload("e1", "meal", "3750", "partner:p1", "", "comp", "2026-09-22")).toMatchObject({
      company_id: "comp",
      employee_id: "e1",
      category: "Yemek",
      description: "Yemek ücreti",
      amount: 3750,
      vat_rate: 0,
      partner_id: "p1",
      account_id: null,
    });
    expect(personnelExpensePayload("e1", "transport", "2000", "acc1", " yol ", "comp", "2026-09-22")).toMatchObject({
      category: "Yol / Ulaşım",
      description: "yol",
      amount: 2000,
      account_id: "acc1",
    });
  });

  it("lists maaş and avans as payment moves, newest first", () => {
    const rows = employeePayMoves({
      payrolls: [
        { id: "p1", period: "2026-08", status: "paid", paid_date: "2026-08-31", final_payable: 28000 },
        { id: "p2", period: "2026-09", status: "pending", final_payable: 28100 },
      ],
      bonuses: [
        { id: "b1", type: "advance", amount: 3750, period: "2026-09", status: "paid", created_at: "2026-09-10", note: "Avans" },
      ],
    });
    expect(rows.map((r) => r.title)).toEqual(["Avans", "Maaş", "Maaş"]);
    expect(rows[0].amount).toBe(3750);
    expect(rows[1].subtitle).toContain("Ödeme bekliyor");
    expect(rows[1].payable).toBe(true);
    expect(rows[0].payable).toBe(false);
    expect(employeePayMoves(null)).toEqual([]);
    const daily = employeePayMoves({
      payrolls: [{ id: "d1", period: "2026-09", status: "pending", pay_type: "daily", worked_days: 12, daily_wage: 1500, final_payable: 18000 }],
    });
    expect(daily[0].title).toBe("Yevmiye");
    expect(daily[0].subtitle).toContain("12 gün × 1500 ₺");
    const yev = employeePayMoves({
      bonuses: [{ id: "y1", type: "yevmiye", amount: 9000, period: "2026-09", status: "pending", note: "6 gün × 1500 ₺", worked_days: 6, daily_wage: 1500 }],
    });
    expect(yev[0].editable).toBe(true);
    expect(yev[0].payable).toBe(true);
    expect(yev[0].deletable).toBe(true);
    expect(yev[0].worked_days).toBe(6);
    expect(pendingYevmiyeBonus([{ type: "yevmiye", status: "pending", period: "2026-09", id: "a" }, { type: "yevmiye", status: "paid", id: "b" }], "2026-09")?.id).toBe("a");
    expect(yevmiyeDaysFromBonus({ note: "8 gün × 1200 ₺" })).toBe(8);
    expect(yevmiyeAddHint(6, 3)).toBe("6 gün + 3 gün = 9 gün");
    expect(yevmiyeAddHint(6, 0)).toBe("Mevcut 6 gün · yazılan gün artı olarak eklenir");
    expect(referenceDailyWage({ daily_wage: 0, salary: 26000 })).toBe(1000);
    expect(yevmiyeAdjustedAmount(1600, 48, 0, 480)).toBe(1440);
    expect(yevmiyeAdjustmentNeeded(0, 10)).toBe(true);
    expect(yevmiyeStatusLine({
      yevmiye_full_amount: 1500,
      yevmiye_adjustment_request: { status: "pending", proposed_amount: 1200 },
    })).toMatch(/1200/);
    expect(yevmiyeStatusLine({
      yevmiye_full_amount: 1500,
      yevmiye_adjustment_request: { status: "approved", proposed_amount: 1200, final_amount: 1200 },
    })).toContain("ücret kesildi");
    expect(yevmiyeStatusLine({
      yevmiye_full_amount: 1500,
      yevmiye_adjustment_request: { status: "rejected" },
    })).toContain("ücret kesilmedi");
    expect(ledgerPayPayload("e1", "alacak", "2500", "2026-09", "", "fazla")).toMatchObject({
      employee_id: "e1", type: "bakiye", amount: 2500, account_id: null, note: "fazla",
    });
    expect(ledgerPayPayload("e1", "borc", "800", "2026-09", "acc1", "")).toMatchObject({
      type: "borc", amount: 800, account_id: "acc1", note: "Borç",
    });
  });
});

describe("project task assign", () => {
  it("assigns an existing task or appends a new one", () => {
    const tasks = [{ id: "t1", title: "Montaj", done: false }];
    const assigned = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { taskId: "t1" });
    expect(assigned.error).toBeNull();
    expect(assigned.tasks[0].assignee_id).toBe("e1");
    expect(assigned.tasks[0].assignee_name).toBe("Ali");
    const shared = assignEmployeeToTasks(assigned.tasks, { id: "e2", full_name: "Ayşe" }, { taskId: "t1", newId: "t_copy" });
    expect(shared.tasks).toHaveLength(2);
    expect(shared.tasks[0]).toMatchObject({ id: "t1", assignee_id: "e1", assignee_name: "Ali" });
    expect(shared.tasks[1]).toMatchObject({ id: "t_copy", title: "Montaj", assignee_id: "e2", assignee_name: "Ayşe", done: false });
    expect(assignedTaskAfterAssign(shared.tasks, "e2", "t1")?.id).toBe("t_copy");
    expect(assignedTaskAfterAssign(assigned.tasks, "e1", "t1")?.id).toBe("t1");
    expect(assignEmployeeToTasks(tasks, { id: "e1" }, { taskId: "missing" }).error).toBe("Görev bulunamadı.");

    const created = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { title: "Keşif", newId: "t_new" });
    expect(created.error).toBeNull();
    expect(created.tasks).toHaveLength(2);
    expect(created.tasks[1]).toMatchObject({ id: "t_new", title: "Keşif", assignee_id: "e1", done: false });
    const withDays = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { title: "Montaj", newId: "t_d", durationDays: 3, dueDate: dueDateFromDays("2026-09-22", 3) });
    expect(withDays.tasks[1]).toMatchObject({ duration_days: 3, due_date: "2026-09-24", kind: "field" });
    const office = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { title: "Ofis", newId: "t_o", kind: "office", durationDays: 4 });
    expect(office.tasks[1]).toMatchObject({ kind: "office", title: "Ofis" });
    expect(office.tasks[1].duration_days).toBeFalsy();
    expect(normalizeTaskKind("iç")).toBe("office");
    expect(normalizeTaskKind("field")).toBe("field");
    expect(isFieldTask({ kind: "office" })).toBe(false);
    expect(taskKindLabel("office")).toBe("İç görev");
    expect(parseTaskDays("3")).toBe(3);
    expect(dueDateFromDays("2026-09-22", 1)).toBe("2026-09-22");
    expect(assignEmployeeToTasks(tasks, { id: "e1" }, {}).error).toBe("Görev adı girin.");
  });

  it("groups projects and open vs done tasks", () => {
    expect(validateTaskAssign("", "", "")).toBe("Proje seçin.");
    expect(validateTaskAssign("p1", "", "")).toBe("Yapacağı işi seçin veya yeni iş adı yazın.");
    expect(validateTaskAssign("p1", "t1", "")).toBeNull();
    expect(projectSelectGroups([{ id: "p1", name: "Villa", project_number: "PRJ-1" }])[0].options[0]).toEqual({
      value: "p1",
      label: "Villa · PRJ-1",
    });
    expect(projectSelectGroups([
      { id: "p1", name: "Villa", project_number: "PRJ-1" },
      { id: "p2", name: "Bitti", status: "completed" },
    ]).map((g) => g.label)).toEqual(["Açık projeler"]);
    expect(projectSelectGroups([
      { id: "p1", name: "Villa" },
      { id: "p2", name: "Bitti", status: "completed" },
    ], { includeCompleted: true }).map((g) => [g.label, g.options.map((o) => o.value)])).toEqual([
      ["Açık projeler", ["p1"]],
      ["Tamamlanan", ["p2"]],
    ]);
    expect(closedProjectCount([{ status: "completed" }, { status: "active" }])).toBe(1);
    const groups = taskSelectGroups([
      { id: "t1", title: "Montaj", assignee_name: "Ali" },
      { id: "t2", title: "Keşif", done: true },
      { id: "t3", title: "Teslim", status: "tamamlandı" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Yapılacak işler");
    expect(groups[0].options.map((o) => o.label)).toEqual(["Montaj · Ali"]);
  });
});
