import {
  draftFromEmployee,
  employeePayload,
  emptyEmployeeDraft,
  leaveDays,
  leaveStatusTr,
  leaveTypeTr,
  monthlyPayrollLoad,
  payrollBreakdown,
  payrollStatusTr,
  remainingDue,
  remainingLeaveDays,
  unpaidPayrollTotal,
  validateAdvance,
  validateEmployee,
  validateLeave,
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
    expect(validateAdvance("")).toBe("Avans tutarı girin.");
    expect(validateAdvance("2500")).toBeNull();
  });
});

describe("leave helpers", () => {
  it("counts inclusive days and rejects inverted ranges", () => {
    expect(leaveDays("2026-09-01", "2026-09-03")).toBe(3);
    expect(leaveDays("2026-09-03", "2026-09-01")).toBe(0);
    expect(validateLeave("", "2026-09-01", "2026-09-02")).toBe("Çalışan seçin.");
    expect(validateLeave("e1", "2026-09-03", "2026-09-01")).toBe("Bitiş tarihi başlangıçtan önce olamaz.");
    expect(validateLeave("e1", "2026-09-01", "2026-09-02")).toBeNull();
    expect(leaveTypeTr("annual")).toBe("Yıllık İzin");
    expect(leaveStatusTr("approved")).toBe("Onaylandı");
    expect(remainingLeaveDays({ annual_leave_days: 14, used_leave_days: 3 })).toBe(11);
  });
});
