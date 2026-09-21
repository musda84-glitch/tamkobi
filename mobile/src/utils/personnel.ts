import { splitPaymentTarget } from "./finance";
import { idOf } from "./money";
import { hoursFromTimeRange } from "./overtimeRange";

export type Employee = {
  id?: string;
  _id?: string;
  full_name?: string;
  tc_kimlik?: string;
  department?: string;
  position?: string;
  phone?: string;
  email?: string;
  salary?: number;
  meal_allowance?: number;
  transport_allowance?: number;
  start_date?: string;
  status?: string;
  annual_leave_days?: number;
  used_leave_days?: number;
};

export type Payroll = {
  id?: string;
  _id?: string;
  employee_id?: string;
  employee_name?: string;
  period?: string;
  net_salary?: number;
  gross_salary?: number;
  final_payable?: number;
  overtime_pay?: number;
  overtime_hours?: number;
  second_salary?: number;
  bonus?: number;
  status?: string;
  paid_date?: string;
};

export type EmployeeBalance = {
  remaining?: number;
  unpaid_payroll?: number;
  unpaid_expenses?: number;
  bonus_pending?: number;
  advances?: number;
  meal_due?: number;
  transport_due?: number;
  meal_allowance?: number;
  transport_allowance?: number;
};

export type EmployeeCard = {
  employee?: Employee;
  payrolls?: Payroll[];
  balance?: EmployeeBalance;
};

export type EmployeeDraft = {
  full_name: string;
  tc_kimlik: string;
  department: string;
  position: string;
  phone: string;
  email: string;
  salary: string;
  start_date: string;
};

export type LeaveRequest = {
  id?: string;
  _id?: string;
  employee_id?: string;
  employee_name?: string;
  type?: string;
  start_date?: string;
  end_date?: string;
  days?: number;
  reason?: string;
  status?: string;
};

export type AttendanceToday = {
  check_in?: string;
  check_out?: string;
  status?: string;
  late_minutes?: number;
  assigned_overtime_hours?: number;
};

export type AttendanceSummary = {
  employee_id?: string;
  employee_name?: string;
  days_present?: number;
  days_absent?: number;
  days_leave?: number;
  total_hours?: number;
  overtime_hours?: number;
  overtime_pay?: number;
  late_count?: number;
  today?: AttendanceToday | null;
};

export type AttendanceRecord = {
  id?: string;
  _id?: string;
  employee_id?: string;
  employee_name?: string;
  date?: string;
  status?: string;
  check_in?: string;
  check_out?: string;
  hours?: number;
  overtime_hours?: number;
  late_minutes?: number;
  early_leave_minutes?: number;
  early_leave_request?: { status?: string; planned_time?: string; reason?: string };
  intraday_leave_minutes?: number;
  intraday_leave_request?: { status?: string; out_time?: string; return_time?: string; reason?: string };
};

export type AttendancePayload = {
  summary?: AttendanceSummary[];
  records?: AttendanceRecord[];
};

export type SalaryCalc = {
  gross?: number;
  sgk_employee?: number;
  unemployment_employee?: number;
  income_tax?: number;
  stamp_tax?: number;
  net?: number;
  employer_sgk?: number;
  employer_unemployment?: number;
  total_employer_cost?: number;
};

export const LEAVE_TYPES = [
  { key: "annual", label: "Yıllık İzin" },
  { key: "sick", label: "Hastalık" },
  { key: "unpaid", label: "Ücretsiz" },
  { key: "other", label: "Diğer" },
] as const;

const LEAVE_TYPE_TR: Record<string, string> = Object.fromEntries(LEAVE_TYPES.map((t) => [t.key, t.label]));

export function emptyEmployeeDraft(today: string): EmployeeDraft {
  return {
    full_name: "",
    tc_kimlik: "",
    department: "Satış & Pazarlama",
    position: "Uzman",
    phone: "",
    email: "",
    salary: "35000",
    start_date: today,
  };
}

export function draftFromEmployee(emp: Employee, today: string): EmployeeDraft {
  return {
    ...emptyEmployeeDraft(today),
    full_name: emp.full_name || "",
    tc_kimlik: emp.tc_kimlik || "",
    department: emp.department || "",
    position: emp.position || "",
    phone: emp.phone || "",
    email: emp.email || "",
    salary: emp.salary == null ? "" : String(emp.salary),
    start_date: String(emp.start_date || today).slice(0, 10),
  };
}

export function validateEmployee(d: EmployeeDraft): string | null {
  if (!d.full_name.trim() || !d.tc_kimlik.trim()) return "Lütfen ad soyad ve TC kimlik no girin.";
  return null;
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function employeePayload(d: EmployeeDraft, companyId?: string) {
  const body: Record<string, unknown> = {
    full_name: d.full_name.trim(),
    tc_kimlik: d.tc_kimlik.trim(),
    department: d.department.trim(),
    position: d.position.trim(),
    phone: d.phone.trim(),
    email: d.email.trim(),
    salary: num(d.salary),
    start_date: d.start_date,
  };
  if (companyId) body.company_id = companyId;
  return body;
}

export function monthlyPayrollLoad(employees: Employee[]): number {
  return (employees || []).reduce((s, e) => s + (Number(e.salary) || 0), 0);
}

export function remainingLeaveDays(emp?: Employee | null): number {
  return (Number(emp?.annual_leave_days) || 14) - (Number(emp?.used_leave_days) || 0);
}

export function leaveTypeTr(type?: string | null): string {
  if (!type) return "—";
  return LEAVE_TYPE_TR[type] || type;
}

export function leaveStatusTr(status?: string | null): string {
  if (status === "approved") return "Onaylandı";
  if (status === "rejected") return "Reddedildi";
  return "Bekliyor";
}

export function payrollStatusTr(status?: string | null, paidDate?: string | null): string {
  if (status === "paid") return paidDate ? `Ödendi (${paidDate})` : "Ödendi";
  return "Ödeme bekliyor";
}

export function leaveDays(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

export function validateLeave(employeeId: string, start: string, end: string): string | null {
  if (!employeeId) return "Çalışan seçin.";
  if (!start || !end) return "Başlangıç ve bitiş tarihi girin.";
  if (leaveDays(start, end) <= 0) return "Bitiş tarihi başlangıçtan önce olamaz.";
  return null;
}

export function validateSelfLeave(start: string, end: string): string | null {
  if (!start) return "Başlangıç tarihi seçin.";
  const endDate = end || start;
  if (!endDate) return "Bitiş tarihi seçin.";
  if (leaveDays(start, endDate) <= 0) return "Bitiş tarihi başlangıçtan önce olamaz.";
  return null;
}

export function selfLeavePayload(type: string, start: string, end: string, reason: string) {
  const start_date = start.trim();
  const end_date = (end || start).trim();
  return {
    type,
    start_date,
    end_date,
    days: leaveDays(start_date, end_date),
    reason: reason.trim().slice(0, 300),
  };
}

export function employeeSelectGroups(employees: Employee[]) {
  return [{
    label: "Çalışanlar",
    options: (employees || []).map((e) => ({
      value: idOf(e),
      label: `${e.full_name || "Personel"}${remainingLeaveDays(e) || remainingLeaveDays(e) === 0 ? ` · kalan ${remainingLeaveDays(e)} g` : ""}`,
    })),
  }];
}

export function unpaidPayrollTotal(employeeId: string, payrolls: Payroll[]): number {
  return (payrolls || [])
    .filter((p) => p.employee_id === employeeId && p.status !== "paid")
    .reduce((s, p) => s + (Number(p.final_payable ?? p.net_salary) || 0), 0);
}

export function openPayroll(employeeId: string, payrolls: Payroll[]): Payroll | undefined {
  return (payrolls || []).find((p) => p.employee_id === employeeId && p.status !== "paid");
}

export function employeeCompRows(emp?: Employee | null, balance?: EmployeeBalance | null): { key: string; label: string; value: number }[] {
  const meal = Number(emp?.meal_allowance ?? balance?.meal_allowance ?? balance?.meal_due ?? 0) || 0;
  const yol = Number(emp?.transport_allowance ?? balance?.transport_allowance ?? balance?.transport_due ?? 0) || 0;
  const salary = Number(emp?.salary) || 0;
  return [
    { key: "meal", label: "Yemek", value: meal },
    { key: "yol", label: "Yol", value: yol },
    { key: "salary", label: "Maaş", value: salary },
    { key: "total", label: "Toplam", value: meal + yol + salary },
  ];
}

export function remainingDue(balance?: EmployeeBalance | null, unpaidFallback = 0): number {
  if (balance && balance.remaining != null && Number.isFinite(Number(balance.remaining))) {
    return Number(balance.remaining) || 0;
  }
  return unpaidFallback;
}

export function validateAdvance(amount: string): string | null {
  if (!(num(amount) > 0)) return "Avans tutarı girin.";
  return null;
}

export function advanceRequestPayload(amount: string, note: string, period: string) {
  return {
    amount: num(amount),
    note: note.trim(),
    period: period.trim(),
  };
}

export function advancePayload(employeeId: string, amount: string, period: string, accountId: string, note: string) {
  return {
    employee_id: employeeId,
    type: "advance" as const,
    amount: num(amount),
    period,
    note: note.trim(),
    ...splitPaymentTarget(accountId),
  };
}

export function validateOvertime(hours: string, start?: string, end?: string): string | null {
  const ranged = hoursFromTimeRange(start, end);
  if (ranged != null && ranged > 0) return null;
  if (!String(hours || "").trim() && !(start || end)) return "Mesai saati veya saat aralığı girin.";
  if (start || end) return "Saat aralığını başlangıç ve bitiş olarak girin.";
  const n = num(hours);
  if (!(n > 0)) return "Mesai saati 0'dan büyük olmalı.";
  return null;
}

export function validateIsoDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "").trim())) return "Tarih YYYY-AA-GG formatında olmalı.";
  return null;
}

export function overtimePayload(
  employeeId: string,
  date: string,
  hours: string,
  note: string,
  start?: string,
  end?: string,
) {
  const ranged = hoursFromTimeRange(start, end);
  return {
    employee_id: employeeId,
    date: date.trim(),
    hours: ranged != null ? ranged : Math.round(num(hours) * 100) / 100,
    note: note.trim(),
    ...(start ? { start_time: start } : {}),
    ...(end ? { end_time: end } : {}),
  };
}

export type ProjectTask = {
  id?: string;
  title?: string;
  name?: string;
  done?: boolean;
  status?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
};

export type ProjectWithTasks = {
  id?: string;
  _id?: string;
  name?: string;
  project_number?: string;
  status?: string;
  tasks?: ProjectTask[];
};

export function newTaskId(now = Date.now(), rand = Math.random().toString(36).slice(2, 7)): string {
  return `t_${now}_${rand}`;
}

export function normalizeProjectTasks(tasks?: ProjectTask[] | null): ProjectTask[] {
  return (tasks || [])
    .map((t, i) => ({
      id: t.id || `t_${i}`,
      title: (t.title || t.name || "").trim(),
      done: !!(t.done || t.status === "done" || t.status === "completed"),
      assignee_id: t.assignee_id || null,
      assignee_name: t.assignee_name || null,
    }))
    .filter((t) => t.title);
}

export function assignEmployeeToTasks(
  tasks: ProjectTask[] | undefined,
  employee: Pick<Employee, "id" | "_id" | "full_name">,
  opts: { taskId?: string; title?: string; newId?: string },
): { tasks: ProjectTask[]; error: string | null } {
  const empId = idOf(employee);
  const empName = employee.full_name || "Personel";
  const existing = normalizeProjectTasks(tasks);
  if (opts.taskId) {
    const idx = existing.findIndex((t) => t.id === opts.taskId);
    if (idx < 0) return { tasks: existing, error: "Görev bulunamadı." };
    return {
      tasks: existing.map((t, i) => (i === idx ? { ...t, assignee_id: empId, assignee_name: empName } : t)),
      error: null,
    };
  }
  const title = (opts.title || "").trim();
  if (!title) return { tasks: existing, error: "Görev adı girin." };
  return {
    tasks: [...existing, {
      id: opts.newId || newTaskId(),
      title,
      done: false,
      assignee_id: empId,
      assignee_name: empName,
    }],
    error: null,
  };
}

export function validateTaskAssign(projectId: string, taskId: string, title: string): string | null {
  if (!projectId) return "Proje seçin.";
  if (!taskId && !title.trim()) return "Görev seçin veya yeni görev adı girin.";
  return null;
}

export function projectSelectGroups(projects: ProjectWithTasks[]) {
  return [{
    label: "Projeler",
    options: (projects || []).map((p) => ({
      value: idOf(p),
      label: `${p.name || "Proje"}${p.project_number ? ` · ${p.project_number}` : ""}`,
    })),
  }];
}

export function taskSelectGroups(tasks?: ProjectTask[] | null) {
  const rows = normalizeProjectTasks(tasks);
  const open = rows.filter((t) => !t.done);
  const done = rows.filter((t) => t.done);
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  if (open.length) {
    groups.push({
      label: "Açık görevler",
      options: open.map((t) => ({
        value: t.id || "",
        label: t.assignee_name ? `${t.title} · ${t.assignee_name}` : String(t.title || ""),
      })),
    });
  }
  if (done.length) {
    groups.push({
      label: "Tamamlanan",
      options: done.map((t) => ({
        value: t.id || "",
        label: String(t.title || ""),
      })),
    });
  }
  return groups;
}

export const EMPLOYEE_CARD_ACTIONS = [
  { key: "advance", title: "Avans" },
  { key: "salary", title: "Maaş öde" },
  { key: "task", title: "Görev ata" },
  { key: "overtime", title: "+ Mesai" },
] as const;

export function employeeCardActionTitles(): string[] {
  return EMPLOYEE_CARD_ACTIONS.map((a) => a.title);
}

export function payrollBreakdown(p: Payroll): string {
  const bits: string[] = [];
  if ((p.overtime_pay || 0) > 0) bits.push(`+${p.overtime_pay} ₺ mesai${p.overtime_hours ? ` (${p.overtime_hours} sa)` : ""}`);
  if ((p.second_salary || 0) > 0) bits.push(`+${p.second_salary} ₺ 2. maaş`);
  return bits.join(" · ");
}

export const SALARY_CALC_ROWS: { key: keyof SalaryCalc; label: string; tone?: "green" | "red" | "slate" }[] = [
  { key: "gross", label: "Brüt maaş" },
  { key: "sgk_employee", label: "SGK işçi payı", tone: "red" },
  { key: "unemployment_employee", label: "İşsizlik işçi", tone: "red" },
  { key: "income_tax", label: "Gelir vergisi", tone: "red" },
  { key: "stamp_tax", label: "Damga vergisi", tone: "red" },
  { key: "net", label: "Net maaş", tone: "green" },
  { key: "employer_sgk", label: "SGK işveren" },
  { key: "employer_unemployment", label: "İşsizlik işveren" },
  { key: "total_employer_cost", label: "Toplam işveren maliyeti", tone: "red" },
];
