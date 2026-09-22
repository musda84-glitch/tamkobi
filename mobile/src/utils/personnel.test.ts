import {
  draftFromEmployee,
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
  employeeCardActionsByGroup,
  employeePayMoves,
  enrichEmployeeBalance,
  bonusDue,
  overtimeDue,
  bonusPayPayload,
  allowanceDue,
  personnelExpensePayload,
  assignEmployeeToTasks,
  overtimePayload,
  projectSelectGroups,
  taskSelectGroups,
  advancePayload,
  advanceRequestPayload,
  validateAdvance,
  validateEmployee,
  validateIsoDate,
  validateLeave,
  validateSelfLeave,
  validateOvertime,
  validateTaskAssign,
} from "./personnel";

describe("employee draft", () => {
  it("requires name and TC", () => {
    const d = emptyEmployeeDraft("2026-09-18");
    expect(validateEmployee(d)).toBe("Lütfen ad soyad ve TC kimlik no girin.");
    d.full_name = "Ayşe Yılmaz";
    expect(validateEmployee(d)).toBe("Lütfen ad soyad ve TC kimlik no girin.");
    d.tc_kimlik = "12345678901";
    expect(validateEmployee(d)).toBeNull();
  });

  it("maps an existing card and posts salary as number", () => {
    const d = draftFromEmployee({ full_name: "Ali", tc_kimlik: "111", salary: 42000, department: "Üretim" }, "2026-09-18");
    expect(d.full_name).toBe("Ali");
    expect(d.salary).toBe("42000");
    expect(d.department).toBe("Üretim");
    const body = employeePayload(d, "comp_1");
    expect(body.company_id).toBe("comp_1");
    expect(body.salary).toBe(42000);
    expect(body.full_name).toBe("Ali");
  });
});

describe("payroll helpers", () => {
  it("sums monthly net load and formats status / extras", () => {
    expect(monthlyPayrollLoad([{ salary: 30000 }, { salary: 25000 }])).toBe(55000);
    expect(payrollStatusTr("pending")).toBe("Ödeme bekliyor");
    expect(payrollStatusTr("paid", "2026-09-15")).toBe("Ödendi (2026-09-15)");
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
      ["Prim", 0],
      ["Mesai", 0],
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
    expect(employeeCompRows({ pay_type: "daily", daily_wage: 1500, meal_allowance: 100 }).map((r) => [r.label, r.value])).toEqual([
      ["Yemek", 100],
      ["Yol", 0],
      ["Yevmiye", 1500],
      ["Prim", 0],
      ["Mesai", 0],
      ["Toplam", 1600],
    ]);
    expect(bonusDue({ bonus_pending: 2500 })).toBe(2500);
    expect(overtimeDue({ overtime_pay: 1800, overtime_due: 600 })).toBe(600);
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
    expect(employeePayMoves(null)).toEqual([]);
    const daily = employeePayMoves({
      payrolls: [{ id: "d1", period: "2026-09", status: "pending", pay_type: "daily", worked_days: 12, daily_wage: 1500, final_payable: 18000 }],
    });
    expect(daily[0].title).toBe("Yevmiye");
    expect(daily[0].subtitle).toContain("12 gün × 1500 ₺");
  });
});

describe("project task assign", () => {
  it("assigns an existing task or appends a new one", () => {
    const tasks = [{ id: "t1", title: "Montaj", done: false }];
    const assigned = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { taskId: "t1" });
    expect(assigned.error).toBeNull();
    expect(assigned.tasks[0].assignee_id).toBe("e1");
    expect(assigned.tasks[0].assignee_name).toBe("Ali");
    expect(assignEmployeeToTasks(tasks, { id: "e1" }, { taskId: "missing" }).error).toBe("Görev bulunamadı.");

    const created = assignEmployeeToTasks(tasks, { id: "e1", full_name: "Ali" }, { title: "Keşif", newId: "t_new" });
    expect(created.error).toBeNull();
    expect(created.tasks).toHaveLength(2);
    expect(created.tasks[1]).toMatchObject({ id: "t_new", title: "Keşif", assignee_id: "e1", done: false });
    expect(assignEmployeeToTasks(tasks, { id: "e1" }, {}).error).toBe("Görev adı girin.");
  });

  it("groups projects and open vs done tasks", () => {
    expect(validateTaskAssign("", "", "")).toBe("Proje seçin.");
    expect(validateTaskAssign("p1", "", "")).toBe("Görev seçin veya yeni görev adı girin.");
    expect(validateTaskAssign("p1", "t1", "")).toBeNull();
    expect(projectSelectGroups([{ id: "p1", name: "Villa", project_number: "PRJ-1" }])[0].options[0]).toEqual({
      value: "p1",
      label: "Villa · PRJ-1",
    });
    const groups = taskSelectGroups([
      { id: "t1", title: "Montaj", assignee_name: "Ali" },
      { id: "t2", title: "Keşif", done: true },
    ]);
    expect(groups[0].label).toBe("Açık görevler");
    expect(groups[0].options[0].label).toBe("Montaj · Ali");
    expect(groups[1].label).toBe("Tamamlanan");
  });
});
