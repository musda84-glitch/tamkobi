import { splitPaymentTarget } from "./finance";
import { fmtDate, idOf } from "./money";
import { hoursFromTimeRange } from "./overtimeRange";
import { workplaceDays, workplaceHint, type Workplace } from "./workplace";

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
  pay_type?: string;
  daily_wage?: number;
  meal_allowance?: number;
  transport_allowance?: number;
  start_date?: string;
  status?: string;
  annual_leave_days?: number;
  used_leave_days?: number;
  photo_url?: string | null;
  workplace?: Workplace | null;
  yevmiye_days?: number;
  yevmiye_due?: number;
  sgk_number?: string | null;
  iban?: string | null;
  birth_date?: string | null;
  address?: string | null;
  emergency_contact?: string | null;
  notes?: string | null;
  location_tracking?: LocationTracking | null;
  location_last_ok?: boolean | null;
  location_last_at?: string | null;
  location_last_inside?: boolean | null;
  location_inside_at?: string | null;
};

export type LocMode = {
  enabled: boolean;
  continuous: boolean;
  interval_minutes: number | "";
  exit_tolerance_hours?: number | "";
};

export type LocationTracking = {
  enabled?: boolean;
  continuous?: boolean;
  interval_minutes?: number;
  exit_tolerance_hours?: number;
  field?: { enabled?: boolean; continuous?: boolean; interval_minutes?: number; exit_tolerance_hours?: number };
};

export const DEFAULT_LOC_MODE: LocMode = { enabled: true, continuous: false, interval_minutes: 15, exit_tolerance_hours: 0 };

export function initLocMode(raw?: Partial<LocMode> | LocationTracking | null): LocMode {
  const n = Number((raw as LocMode | undefined)?.interval_minutes);
  const continuous = !!(raw as LocMode | undefined)?.continuous || n === 0;
  const interval = continuous || n === 0 ? 0 : (Number.isFinite(n) && n > 0 ? n : 15);
  const hoursRaw = Number((raw as LocMode | undefined)?.exit_tolerance_hours);
  const hours = Number.isFinite(hoursRaw) ? Math.max(0, Math.min(12, hoursRaw)) : 0;
  return {
    enabled: (raw as LocMode | undefined)?.enabled !== false,
    continuous: continuous || interval === 0,
    interval_minutes: interval,
    exit_tolerance_hours: hours,
  };
}

export function patchLocMode(prev: LocMode, key: keyof LocMode, value: boolean | number | ""): LocMode {
  const next: LocMode = { ...prev, [key]: value } as LocMode;
  if (key === "enabled" && !value) next.continuous = false;
  if (key === "interval_minutes") {
    const n = value === "" ? "" : Number(value);
    if (n === 0) next.continuous = true;
    else if (typeof n === "number" && n > 0) next.continuous = false;
  }
  if (key === "continuous") {
    if (value) next.interval_minutes = 0;
    else if (Number(prev.interval_minutes) === 0) next.interval_minutes = 15;
  }
  return next;
}

export function serializeLocMode(mode: LocMode): { enabled: boolean; continuous: boolean; interval_minutes: number; exit_tolerance_hours: number } {
  const rawInterval = mode.interval_minutes === "" ? 15 : Number(mode.interval_minutes);
  const interval = Math.max(0, Math.min(120, Number.isFinite(rawInterval) ? rawInterval : 15));
  const continuous = !!mode.enabled && (interval === 0 || !!mode.continuous);
  const hoursRaw = mode.exit_tolerance_hours === "" ? 0 : Number(mode.exit_tolerance_hours);
  const hours = Math.max(0, Math.min(12, Number.isFinite(hoursRaw) ? hoursRaw : 0));
  return { enabled: !!mode.enabled, continuous, interval_minutes: continuous ? 0 : interval, exit_tolerance_hours: hours };
}

export function locationTrackingPayload(company: LocMode, field: LocMode): LocationTracking {
  return { ...serializeLocMode(company), field: serializeLocMode(field) };
}

export function locModeSummary(mode?: LocMode | LocationTracking | null): string {
  const m = initLocMode(mode);
  if (!m.enabled) return "Kapalı";
  if (m.continuous || m.interval_minutes === 0) return "Sürekli";
  return `${m.interval_minutes} dk`;
}

export function locationTrackingEnabled(lt?: LocationTracking | null): boolean {
  return initLocMode(lt).enabled || initLocMode(lt?.field || lt).enabled;
}

export function locationControllerLabel(on: boolean): string {
  return on ? "Konum açık" : "Konum kapalı";
}

export function locationCellCaption(on: boolean): string {
  return on ? "Açık" : "Kapalı";
}

export function locationTrackingTogglePayload(raw: LocationTracking | null | undefined, enabled: boolean): LocationTracking {
  const company = initLocMode(raw);
  const field = initLocMode(raw?.field || raw);
  return locationTrackingPayload({ ...company, enabled }, { ...field, enabled });
}

export function todayAttendanceLine(today?: AttendanceToday | null): string {
  const parts = todayAttendanceParts(today);
  if (parts.empty) return "Bugün giriş / çıkış yok";
  return `Bugün ${parts.checkIn} → ${parts.checkOut}` + (parts.late ? ` · ${parts.late} dk geç` : "");
}

export function todayAttendanceParts(today?: AttendanceToday | null): {
  checkIn: string;
  checkOut: string;
  late: number;
  empty: boolean;
} {
  const empty = !today || (!today.check_in && !today.check_out && today.status !== "present");
  return {
    checkIn: today?.check_in || "--:--",
    checkOut: today?.check_out || "--:--",
    late: Number(today?.late_minutes) || 0,
    empty,
  };
}

export function cardPunchConfirmMessage(action: "check_in" | "check_out" | "absent", name?: string): string {
  const who = String(name || "").trim();
  const prefix = who ? `${who} için ` : "";
  if (action === "absent") return `${prefix}bugün devamsız işaretlensin mi? Giriş/çıkış silinir.`;
  if (action === "check_in") return `${prefix}giriş saati personel onayına gönderilsin mi?`;
  return `${prefix}çıkış saati personel onayına gönderilsin mi?`;
}

export function absentConfirmMessage(name?: string): string {
  return cardPunchConfirmMessage("absent", name);
}

export function cardPunchDraftTime(
  action: "check_in" | "check_out",
  today?: { check_in?: string | null; check_out?: string | null } | null,
): string {
  const raw = action === "check_in" ? today?.check_in : today?.check_out;
  const t = String(raw || "").trim();
  return /^\d{1,2}:\d{2}$/.test(t) ? t.slice(0, 5) : "";
}

export function cardPunchAttempts(
  today?: { manager_time_edit_rounds?: Record<string, { attempts?: number } | null> | null } | null,
  action?: "check_in" | "check_out",
): number {
  if (!action) return 0;
  const row = today?.manager_time_edit_rounds?.[action];
  const n = Number(row?.attempts);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function cardPunchTimeHint(attempts?: number): string {
  if (Number(attempts) >= 2) return "3. deneme: personel onayı atlanır.";
  return "Onaylayınca değişiklik personelin teyidine düşer.";
}

export function cardPunchRequiresTime(time?: string | null): string | null {
  return /^\d{1,2}:\d{2}$/.test(String(time || "").trim()) ? null : "Saat seçin.";
}

export function cardPunchPayload(action: "check_in" | "check_out", time?: string | null): Record<string, string> {
  const t = String(time || "").trim().slice(0, 5);
  return t ? { action, [action]: t } : { action };
}

export function advanceFormToggleIcon(open: boolean): "eye-off-outline" | "eye-outline" {
  return open ? "eye-off-outline" : "eye-outline";
}

export function advanceFormToggleLabel(open: boolean): string {
  return open ? "Gizle" : "Göster";
}

export function employeeInitials(name?: string | null): string {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase("tr-TR");
  }
  return (parts[0] || "?").slice(0, 2).toLocaleUpperCase("tr-TR");
}

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
  pay_type?: string;
  daily_wage?: number;
  worked_days?: number;
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
  overtime_pay?: number;
  overtime_due?: number;
  overtime_hours?: number;
};

export type EmployeeBonus = {
  id?: string;
  _id?: string;
  employee_id?: string;
  employee_name?: string;
  type?: string;
  type_label?: string;
  amount?: number;
  period?: string;
  note?: string;
  account_name?: string;
  status?: string;
  created_at?: string;
  worked_days?: number;
  daily_wage?: number;
};

export type EmployeeCard = {
  employee?: Employee;
  payrolls?: Payroll[];
  bonuses?: EmployeeBonus[];
  balance?: EmployeeBalance;
  overtime?: { hours?: number; amount?: number };
  workplace?: Workplace | null;
  leave_balance?: { remaining?: number; annual?: number };
  attendance?: { days_present?: number; total_hours?: number; overtime_hours?: number };
  performance?: {
    overall?: number;
    check_in?: { pct?: number; ok?: number; expected?: number };
    check_out?: { pct?: number; ok?: number; expected?: number };
    leave?: { pct?: number; approved_days?: number; absent_days?: number };
    task?: { pct?: number; done?: number; total?: number };
  };
  tasks?: Array<{
    id?: string;
    title?: string;
    project_id?: string;
    project_name?: string;
    project_number?: string;
    due_date?: string | null;
    duration_days?: number | null;
    done?: boolean;
    kind?: string;
    park_name?: string;
    address?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    location_url?: string | null;
    photos?: Array<{
      url: string;
      visibility?: string;
      visibility_label?: string;
      customer_visible?: boolean;
      source?: string;
      task_id?: string;
    }>;
    workflow?: Array<{ id?: string; title?: string; done?: boolean; assignee_name?: string }>;
  }>;
};

export type PendingRequest = {
  id?: string;
  kind?: string;
  employee_id?: string;
  employee_name?: string;
  title?: string;
  detail?: string;
};

export const REQUEST_KIND_TR: Record<string, string> = {
  leave: "İzin",
  early_leave: "Erken çıkış",
  intraday_leave: "Gün içi izin",
  dispute: "İtiraz",
  advance: "Avans",
  yevmiye_adjustment: "Geç giriş ücreti",
  location_exit: "Konum dışı",
  geo_confirm: "Teyitli giriş",
};

export function requestKindLabel(kind?: string | null): string {
  return REQUEST_KIND_TR[String(kind || "")] || "Talep";
}

export type RequestDecision = boolean | "ack" | "deduct";

export function locationExitDecisionBody(approved: RequestDecision): { decision: string; wage_deduction: string } {
  if (approved === "ack") return { decision: "ack", wage_deduction: "false" };
  if (approved === "deduct") return { decision: "approve", wage_deduction: "true" };
  if (approved) return { decision: "approve", wage_deduction: "false" };
  return { decision: "reject", wage_deduction: "false" };
}

export function pendingRequestDecision(
  it: PendingRequest,
  approved: RequestDecision,
): { path: string; body: Record<string, string> } | null {
  const id = String(it.id || "").trim();
  if (!id) return null;
  if (it.kind === "leave") {
    return { path: `/personnel/leaves/${id}/decide`, body: { status: approved ? "approved" : "rejected" } };
  }
  if (it.kind === "advance") {
    return { path: `/personnel/bonuses/${id}/decide`, body: { status: approved ? "approved" : "rejected" } };
  }
  if (it.kind === "early_leave") {
    return { path: `/personnel/attendance/${id}/early-leave-decision`, body: { decision: approved ? "approve" : "reject" } };
  }
  if (it.kind === "intraday_leave") {
    return { path: `/personnel/attendance/${id}/intraday-leave-decision`, body: { decision: approved ? "approve" : "reject" } };
  }
  if (it.kind === "yevmiye_adjustment") {
    return { path: `/personnel/attendance/${id}/yevmiye-decision`, body: { decision: approved ? "approve" : "reject" } };
  }
  if (it.kind === "location_exit") {
    return { path: `/personnel/attendance/${id}/location-exit-decision`, body: locationExitDecisionBody(approved) };
  }
  if (it.kind === "dispute") {
    return { path: `/personnel/attendance/${id}/dispute-decision`, body: { decision: approved ? "approve" : "reject" } };
  }
  if (it.kind === "geo_confirm") {
    return { path: `/personnel/attendance/${id}/geo-confirm-decision`, body: { decision: approved ? "approve" : "reject" } };
  }
  return null;
}

export function pendingRequestDecisionMessage(it: PendingRequest, approved: RequestDecision): string {
  if (it.kind === "location_exit") {
    if (approved === "ack") return "Konum dışı çıkış: haberim var. Kesinti yok.";
    if (approved === "deduct") return "Konum dışı çıkış: ücretten kesinti uygulandı.";
    return approved ? "Konum dışı çıkış onaylandı (kesinti yok)." : "Konum dışı çıkış reddedildi.";
  }
  if (it.kind === "yevmiye_adjustment") {
    return approved ? "Ücret kesildi." : "Ücret kesilmedi.";
  }
  if (it.kind === "dispute") {
    return approved ? "İtiraz düzeltildi olarak kapatıldı." : "İtiraz reddedildi.";
  }
  const label = requestKindLabel(it.kind);
  return approved ? `${label} onaylandı.` : `${label} reddedildi.`;
}

export function requestDecisionActions(kind?: string | null): { key: string; title: string; decision: RequestDecision; color: "primary" | "secondary" | "danger" | "warning" }[] {
  if (kind === "dispute") {
    return [
      { key: "approve", title: "Düzeltildi", decision: true, color: "primary" },
      { key: "reject", title: "Reddet", decision: false, color: "danger" },
    ];
  }
  if (kind === "location_exit") {
    return [
      { key: "ack", title: "Haberim var", decision: "ack", color: "secondary" },
      { key: "approve", title: "Kesinti olmasın", decision: true, color: "primary" },
      { key: "deduct", title: "Kesinti olsun", decision: "deduct", color: "warning" },
      { key: "reject", title: "Reddet", decision: false, color: "danger" },
    ];
  }
  if (kind === "yevmiye_adjustment") {
    return [
      { key: "approve", title: "Ücret kes", decision: true, color: "warning" },
      { key: "reject", title: "Ücret kesme", decision: false, color: "primary" },
    ];
  }
  return [
    { key: "approve", title: "Onayla", decision: true, color: "primary" },
    { key: "reject", title: "Reddet", decision: false, color: "danger" },
  ];
}

export function requestsForEmployee(items: PendingRequest[] | null | undefined, empId: string): PendingRequest[] {
  const id = String(empId || "");
  if (!id) return [];
  return (items || []).filter((it) => String(it.employee_id || "") === id);
}

export function requestsDetailsToggleLabel(open: boolean): string {
  return open ? "Gizle" : "Büyüt";
}

export function requestsDetailsToggleIcon(open: boolean): "chevron-up" | "chevron-down" {
  return open ? "chevron-up" : "chevron-down";
}

export function requestsDetailsSummary(items: PendingRequest[] | null | undefined): string {
  const rows = items || [];
  if (!rows.length) return "Talep yok";
  const first = rows[0];
  const head = `${requestKindLabel(first.kind)} · ${first.title || "Talep"}`;
  return rows.length > 1 ? `${head} · +${rows.length - 1}` : head;
}

export function employeeStatusLabel(status?: string | null): string {
  if (status === "terminated") return "İşten çıktı";
  if (status === "passive" || status === "inactive") return "Pasif";
  return "Aktif";
}

export type EmployeePresenceKind = "duty" | "work" | "out";

export type EmployeePresenceChip = {
  key: EmployeePresenceKind;
  label: string;
  color: string;
  bg: string;
};

type PresenceToday = {
  check_in?: string;
  check_out?: string;
  location_inside_at?: string;
  location_left_at?: string;
  location_exit_request?: { status?: string } | null;
  geo_check_in?: unknown;
};

function presenceInside(opts: {
  location_last_inside?: boolean | null;
  location_last_ok?: boolean | null;
  location_inside_at?: string | null;
  today?: PresenceToday | null;
}): boolean | null {
  if (opts.location_last_inside === true) return true;
  if (opts.location_last_inside === false) return false;
  const today = opts.today;
  if (today?.check_out) return false;
  if (today?.location_exit_request?.status === "pending") return false;
  if (today?.location_left_at) return false;
  if (opts.location_last_ok === false) return null;
  if (today?.check_in && (opts.location_inside_at || today.location_inside_at || today.geo_check_in)) return true;
  return null;
}

/** Aktif yanındaki anlık yer: görev yerinde / işte / dışarda. */
export function employeePresenceChip(opts?: {
  status?: string | null;
  workplace?: Workplace | null;
  location_last_inside?: boolean | null;
  location_last_ok?: boolean | null;
  location_inside_at?: string | null;
  today?: PresenceToday | null;
} | null): EmployeePresenceChip | null {
  if (!opts) return null;
  const status = String(opts.status || "active");
  if (status === "terminated" || status === "passive" || status === "inactive") return null;
  const inside = presenceInside(opts);
  if (inside === true) {
    if (opts.workplace?.kind === "task") {
      return { key: "duty", label: "Görev yerinde", color: "#3730A3", bg: "#EEF2FF" };
    }
    return { key: "work", label: "İşte", color: "#047857", bg: "#D1FAE5" };
  }
  if (inside === false) {
    return { key: "out", label: "Dışarda", color: "#C2410C", bg: "#FFEDD5" };
  }
  return null;
}

export function openEmployeeTasks(card?: EmployeeCard | null) {
  return (card?.tasks || []).filter((t) => !t.done);
}

export type EmployeeDutyRow = {
  id: string;
  title: string;
  kindLabel: string;
  project: string;
  due: string;
  days: number;
  park: string;
  current: boolean;
  done: boolean;
  lines: string[];
};

export type EmployeeDutyBoard = {
  current: EmployeeDutyRow | null;
  open: EmployeeDutyRow[];
  done: EmployeeDutyRow[];
  headline: string;
  currentHint: string;
};

function dutyLines(opts: {
  kindLabel: string;
  project?: string;
  days?: number;
  due?: string;
  park?: string;
  address?: string;
}): string[] {
  const lines = [opts.kindLabel];
  if (opts.project) lines.push(opts.project);
  if (opts.days) lines.push(`${opts.days} gün`);
  if (opts.due) lines.push(`Bitiş ${fmtDate(opts.due)}`);
  if (opts.park) lines.push(`Parkur: ${opts.park}`);
  if (opts.address) lines.push(opts.address);
  return lines;
}

export function employeeDutyHeadline(board: Pick<EmployeeDutyBoard, "current" | "open">): string {
  if (board.current) return `Şu an: ${board.current.title}`;
  if (board.open.length === 1) return "1 açık görev";
  if (board.open.length > 1) return `${board.open.length} açık görev`;
  return "Atanmış görev yok";
}

export function employeeDutyBoard(emp?: Employee | null, card?: EmployeeCard | null): EmployeeDutyBoard {
  const workplace = emp?.workplace || card?.workplace || null;
  const currentId = workplace?.kind === "task" ? String(workplace.task_id || "") : "";
  const currentTitle = workplace?.kind === "task" ? String(workplace.task_title || "") : "";
  const rows: EmployeeDutyRow[] = (card?.tasks || []).map((t) => {
    const id = String(t.id || t.title || "");
    const kindLabel = taskKindLabel(t.kind);
    const project = [t.project_number, t.project_name].filter(Boolean).join(" · ");
    const days = Number(t.duration_days) || 0;
    const due = String(t.due_date || "").slice(0, 10);
    const park = String(t.park_name || "");
    const current = (!!currentId && id === currentId) || (!!currentTitle && String(t.title || "") === currentTitle);
    return {
      id,
      title: t.title || "Görev",
      kindLabel,
      project,
      due,
      days,
      park,
      current,
      done: !!t.done,
      lines: dutyLines({ kindLabel, project, days, due, park }),
    };
  });

  let current = rows.find((r) => r.current && !r.done) || null;
  if (!current && workplace?.kind === "task") {
    const kindLabel = "Dış görev";
    const project = [workplace.project_number, workplace.project_name || workplace.label].filter(Boolean).join(" · ");
    const days = workplaceDays(workplace);
    const due = String(workplace.due_date || "").slice(0, 10);
    current = {
      id: String(workplace.task_id || workplace.task_title || "current"),
      title: workplace.task_title || "Dış görev",
      kindLabel,
      project,
      due,
      days,
      park: "",
      current: true,
      done: false,
      lines: dutyLines({ kindLabel, project, days, due, address: workplace.address }),
    };
    if (!rows.some((r) => r.id === current!.id || r.title === current!.title)) rows.unshift(current);
  }
  if (!current) {
    const firstOpen = rows.find((r) => !r.done) || null;
    current = firstOpen ? { ...firstOpen, current: true } : null;
  }

  const open = rows
    .filter((r) => !r.done)
    .map((r) => (current && (r.id === current.id || r.title === current.title) ? { ...r, current: true } : { ...r, current: false }));
  const done = rows.filter((r) => r.done);
  const board: EmployeeDutyBoard = {
    current,
    open,
    done,
    headline: "",
    currentHint: current && workplace?.kind === "task" ? workplaceHint(workplace, true) : "",
  };
  board.headline = employeeDutyHeadline(board);
  return board;
}

export function workplaceDetailsToggleLabel(open: boolean): string {
  return open ? "Gizle" : "Aç";
}

export function workplaceDetailsToggleIcon(open: boolean): "chevron-up" | "chevron-down" {
  return open ? "chevron-up" : "chevron-down";
}

export function workplaceDetailsSummary(opts: {
  hasFieldDuty?: boolean;
  fieldLabel?: string;
  taskCount?: number;
}): string {
  const parts: string[] = [];
  if (opts.hasFieldDuty && String(opts.fieldLabel || "").trim()) parts.push(String(opts.fieldLabel).trim());
  const n = Number(opts.taskCount) || 0;
  if (n === 1) parts.push("1 açık görev");
  else if (n > 1) parts.push(`${n} açık görev`);
  return parts.join(" · ") || "Ayrıntı yok";
}

export type EmployeePayMove = {
  id: string;
  kind: "payroll" | "bonus";
  title: string;
  subtitle: string;
  amount: number;
  date: string;
  status?: string;
  type?: string;
  worked_days?: number;
  daily_wage?: number;
  note?: string;
  editable?: boolean;
  payable?: boolean;
  deletable?: boolean;
};

export function isUnpaidYevmiye(b?: EmployeeBonus | null): boolean {
  return String(b?.type || "") === "yevmiye" && String(b?.status || "") !== "paid";
}

export function pendingYevmiyeBonus(bonuses?: EmployeeBonus[] | null, period?: string): EmployeeBonus | null {
  const rows = (bonuses || []).filter(isUnpaidYevmiye);
  if (!rows.length) return null;
  if (period) {
    const same = rows.find((b) => String(b.period || "") === period);
    if (same) return same;
  }
  return rows[0];
}

export function yevmiyeDaysFromBonus(b?: EmployeeBonus | null): number | null {
  const days = Math.trunc(Number(b?.worked_days) || 0);
  if (days > 0) return days;
  const m = String(b?.note || "").match(/(\d+)\s*gün/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** Ödenmemiş yevmiye prim kayıtlarının gün ve tutar toplamı. */
export function unpaidYevmiyeTotals(bonuses?: EmployeeBonus[] | null): { days: number; amount: number } {
  let days = 0;
  let amount = 0;
  for (const b of (bonuses || []).filter(isUnpaidYevmiye)) {
    days += yevmiyeDaysFromBonus(b) || 0;
    amount += Number(b.amount) || 0;
  }
  return { days, amount };
}

/** Ödenmemiş yevmiye prim + günlük bordro: kartta görünen gün/tutar toplamı. */
export function yevmiyeAccrual(input?: {
  bonuses?: EmployeeBonus[] | null;
  payrolls?: Payroll[] | null;
  employeeId?: string;
} | null): { days: number; amount: number } {
  const bonus = unpaidYevmiyeTotals(input?.bonuses);
  const seen = new Set<string>();
  let days = bonus.days;
  let amount = bonus.amount;
  for (const p of input?.payrolls || []) {
    if (input?.employeeId && p.employee_id && p.employee_id !== input.employeeId) continue;
    if (!isDailyPayroll(p) || String(p.status || "") === "paid") continue;
    const id = idOf(p) || `${p.period || ""}-${p.worked_days || ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    days += Math.max(0, Math.trunc(Number(p.worked_days) || 0));
    amount += Number(p.final_payable ?? p.net_salary) || 0;
  }
  return { days, amount };
}

const BONUS_TYPE_TR: Record<string, string> = {
  bonus: "Prim",
  second_salary: "İkinci Maaş",
  advance: "Avans",
  expense: "Masraf Ödemesi",
  overtime: "Fazla Mesai",
  yevmiye: "Yevmiye",
  alacak: "Alacak",
  borc: "Borç",
  bakiye: "Bakiye",
};

export function isDeletableBonus(b?: EmployeeBonus | null): boolean {
  return !!idOf(b);
}

export function yevmiyeAddHint(existingDays = 0, newDays = 0): string {
  const have = Math.max(0, Math.trunc(Number(existingDays) || 0));
  const add = Math.max(0, Math.trunc(Number(newDays) || 0));
  if (add > 0 && have > 0) return `${have} gün + ${add} gün = ${have + add} gün`;
  if (add > 0) return `+${add} gün alacağa yazılacak`;
  if (have > 0) return `Mevcut ${have} gün · yazılan gün artı olarak eklenir`;
  return "Yazılan gün mevcut alacağa eklenir.";
}

export function bonusTypeTr(type?: string | null, fallback?: string | null): string {
  const key = String(type || "");
  return BONUS_TYPE_TR[key] || fallback || "Ödeme";
}

export function bonusStatusTr(status?: string | null): string {
  const key = String(status || "");
  if (key === "paid") return "Ödendi";
  if (key === "pending") return "Bekliyor";
  if (key === "approved") return "Onaylı";
  if (key === "rejected") return "Reddedildi";
  return key;
}

/** Personel kartı: maaş + avans/prim satırlarını tarihe göre yeni→eski. */
export function employeePayMoves(card?: EmployeeCard | null): EmployeePayMove[] {
  const rows: EmployeePayMove[] = [];
  for (const p of card?.payrolls || []) {
    const wage = payrollWageLine(p);
    rows.push({
      id: idOf(p) || `pay-${p.period || ""}`,
      kind: "payroll",
      title: isDailyPayroll(p) ? "Yevmiye" : "Maaş",
      subtitle: [p.period, wage, payrollStatusTr(p.status, p.paid_date)].filter(Boolean).join(" · "),
      amount: Number(p.final_payable ?? p.net_salary) || 0,
      date: String(p.paid_date || p.period || ""),
      status: p.status,
      payable: String(p.status || "") !== "paid",
    });
  }
  for (const b of card?.bonuses || []) {
    const days = yevmiyeDaysFromBonus(b);
    rows.push({
      id: idOf(b) || `bonus-${b.created_at || b.period || ""}`,
      kind: "bonus",
      title: bonusTypeTr(b.type, b.type_label),
      subtitle: [b.period, days ? `${days} gün` : "", bonusStatusTr(b.status), b.account_name, b.note].filter(Boolean).join(" · "),
      amount: Number(b.amount) || 0,
      date: String(b.created_at || b.period || ""),
      status: b.status,
      type: b.type,
      worked_days: days || undefined,
      daily_wage: Number(b.daily_wage) || undefined,
      note: b.note,
      editable: isUnpaidYevmiye(b),
      payable: String(b.status || "") !== "paid",
      deletable: isDeletableBonus(b),
    });
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export type PayMovesPeriod = "30d" | "month" | "all";

export function payMovesPeriodLabel(period: PayMovesPeriod): string {
  if (period === "month") return "Bu ay";
  if (period === "all") return "Tümü";
  return "Son 30 gün";
}

function payMoveInstant(raw?: string | null): number | null {
  const s = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(`${s.slice(0, 10)}T00:00:00`);
    return Number.isFinite(t) ? t : null;
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const t = Date.parse(`${s}-01T00:00:00`);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

export function payMoveInPeriod(
  row: Pick<EmployeePayMove, "date">,
  period: PayMovesPeriod,
  now = new Date(),
  month = "",
): boolean {
  if (period === "all") return true;
  const ts = payMoveInstant(row.date);
  if (ts == null) return period === "month" && String(row.date || "").startsWith(String(month || "").slice(0, 7));
  if (period === "month") {
    const ym = String(month || now.toISOString().slice(0, 7));
    return new Date(ts).toISOString().slice(0, 7) === ym || String(row.date || "").startsWith(ym);
  }
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 30);
  return ts >= cutoff.getTime();
}

export function filterPayMoves(
  rows: EmployeePayMove[] | null | undefined,
  period: PayMovesPeriod,
  now = new Date(),
  month = "",
): EmployeePayMove[] {
  return (rows || []).filter((row) => payMoveInPeriod(row, period, now, month));
}

export const PAY_MOVE_DELETE_TITLE = "Kaydı sil";

export function payMoveDeleteConfirm(row?: { title?: string } | null): { title: string; message: string } {
  const name = String(row?.title || "Kayıt").trim() || "Kayıt";
  return {
    title: PAY_MOVE_DELETE_TITLE,
    message: `${name} silinsin mi? Bu işlem geri alınamaz.`,
  };
}

export function payMovesPeriodHint(shown: number, total: number, period: PayMovesPeriod): string {
  if (period === "all" || shown === total) return `${total} hareket`;
  return `${shown} / ${total} hareket`;
}

export function employeeCardChrome(emp?: Pick<Employee, "pay_type" | "daily_wage"> | null): {
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
} {
  if (isDailyWage(emp)) return { backgroundColor: "#FEF3C7", borderColor: "#D97706", borderWidth: 2 };
  return { backgroundColor: "#D1FAE5", borderColor: "#059669", borderWidth: 2 };
}

export function employeeCardPayKind(emp?: Pick<Employee, "pay_type" | "daily_wage"> | null): "daily" | "monthly" {
  return isDailyWage(emp) ? "daily" : "monthly";
}

export type EmployeeDraft = {
  full_name: string;
  tc_kimlik: string;
  department: string;
  position: string;
  phone: string;
  email: string;
  salary: string;
  start_date: string;
  pay_type: "monthly" | "daily";
  daily_wage: string;
  sgk_number: string;
  iban: string;
  meal_allowance: string;
  transport_allowance: string;
  birth_date: string;
  address: string;
  emergency_contact: string;
  notes: string;
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
  location_inside_at?: string;
  location_left_at?: string;
  location_exit_request?: { status?: string } | null;
  geo_check_in?: unknown;
  manager_time_edit?: {
    pending_employee?: boolean;
    field?: string;
    attempt?: number;
  } | null;
  manager_time_edit_rounds?: Record<string, { attempts?: number; auto_confirmed?: boolean } | null> | null;
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
  pay_type?: string;
  daily_wage?: number;
  period_wage?: number;
  today?: AttendanceToday | null;
  workplace?: Workplace | null;
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
  yevmiye_full_amount?: number;
  yevmiye_adjustment_request?: {
    status?: string;
    full_amount?: number;
    proposed_amount?: number;
    final_amount?: number;
    late_minutes?: number;
    early_leave_minutes?: number;
  };
  manager_time_edit?: {
    prev_check_in?: string;
    prev_check_out?: string;
    check_in?: string;
    check_out?: string;
    pending_employee?: boolean;
  } | null;
  location_exit_request?: {
    status?: string;
    place?: string;
    distance_m?: number;
    radius_m?: number;
    tolerance_hours?: number;
    left_at?: string;
    wage_deduction?: boolean | null;
    deduction_amount?: number;
  };
  geo_confirm_request?: {
    status?: string;
    action?: string;
    reason?: string;
    proposed_time?: string;
    place?: string;
    distance_m?: number | null;
  };
};

export type AttendancePayload = {
  summary?: AttendanceSummary[];
  records?: AttendanceRecord[];
};

export type AttendanceRecordGroup<T = AttendanceRecord> = {
  employee_id: string;
  employee_name: string;
  records: T[];
};

export function attendanceEmployeeKey(r?: { employee_id?: string; employee_name?: string } | null): string {
  return String(r?.employee_id || r?.employee_name || "unknown");
}

export function groupAttendanceRecords<T extends { employee_id?: string; employee_name?: string; date?: string }>(
  records?: T[] | null,
): AttendanceRecordGroup<T>[] {
  const map = new Map<string, AttendanceRecordGroup<T>>();
  for (const r of records || []) {
    const key = attendanceEmployeeKey(r);
    const g = map.get(key);
    if (g) g.records.push(r);
    else {
      map.set(key, {
        employee_id: String(r.employee_id || key),
        employee_name: r.employee_name || "Personel",
        records: [r],
      });
    }
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.records.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }
  groups.sort((a, b) => a.employee_name.localeCompare(b.employee_name, "tr"));
  return groups;
}

export function attendanceRecordsForEmployee<T extends { employee_id?: string; employee_name?: string; date?: string }>(
  records: T[] | null | undefined,
  employeeId?: string,
  employeeName?: string,
): T[] {
  const key = attendanceEmployeeKey({ employee_id: employeeId, employee_name: employeeName });
  return (records || [])
    .filter((r) => attendanceEmployeeKey(r) === key)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function attendanceGroupToggleLabel(open: boolean, count = 0): string {
  const n = Number(count) || 0;
  return open ? `Kayıtları gizle (${n})` : `Kayıtlar (${n})`;
}

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
    department: "",
    position: "",
    phone: "",
    email: "",
    salary: "",
    start_date: today,
    pay_type: "monthly",
    daily_wage: "",
    sgk_number: "",
    iban: "",
    meal_allowance: "",
    transport_allowance: "",
    birth_date: "",
    address: "",
    emergency_contact: "",
    notes: "",
  };
}

export function positionOptionsFromRoles(
  roles: { code?: string; name?: string }[] | null | undefined,
  current = "",
): { value: string; label: string; code: string }[] {
  const seen = new Set<string>();
  const opts: { value: string; label: string; code: string }[] = [];
  for (const r of roles || []) {
    const name = String(r?.name || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    opts.push({ value: name, label: name, code: String(r.code || "") });
  }
  const cur = String(current || "").trim();
  if (cur && !seen.has(cur)) {
    opts.unshift({ value: cur, label: `${cur} (kayıtlı)`, code: "" });
  }
  return opts;
}

export function positionSelectGroups(
  roles: { code?: string; name?: string }[] | null | undefined,
  current = "",
): { label: string; options: { value: string; label: string }[] }[] {
  return [{ label: "Roller", options: positionOptionsFromRoles(roles, current) }];
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
    pay_type: isDailyWage(emp) ? "daily" : "monthly",
    daily_wage: emp.daily_wage == null ? "" : String(emp.daily_wage),
    sgk_number: emp.sgk_number || "",
    iban: emp.iban || "",
    meal_allowance: emp.meal_allowance == null ? "" : String(emp.meal_allowance),
    transport_allowance: emp.transport_allowance == null ? "" : String(emp.transport_allowance),
    birth_date: emp.birth_date ? String(emp.birth_date).slice(0, 10) : "",
    address: emp.address || "",
    emergency_contact: emp.emergency_contact || "",
    notes: emp.notes || "",
  };
}

export function hasEmployeeDetails(d: Pick<EmployeeDraft, "sgk_number" | "iban" | "meal_allowance" | "transport_allowance" | "birth_date" | "address" | "emergency_contact" | "notes">): boolean {
  return Boolean(
    String(d.sgk_number || "").trim()
    || String(d.iban || "").trim()
    || String(d.meal_allowance || "").trim()
    || String(d.transport_allowance || "").trim()
    || String(d.birth_date || "").trim()
    || String(d.address || "").trim()
    || String(d.emergency_contact || "").trim()
    || String(d.notes || "").trim()
  );
}

export function validateEmployee(d: EmployeeDraft): string | null {
  if (!d.full_name.trim() || !d.tc_kimlik.trim()) return "Lütfen ad soyad ve TC kimlik no girin.";
  if (d.pay_type === "daily" && parseYevmiyeWage(d.daily_wage) == null) return "Yevmiye ücreti girin.";
  if (String(d.sgk_number || "").trim() && !String(d.iban || "").trim()) {
    return "SGK sicil numarası girildiğinde IBAN zorunludur — maaş yalnız bankadan ödenir.";
  }
  return null;
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function employeePayload(d: EmployeeDraft, companyId?: string) {
  const daily = parseYevmiyeWage(d.daily_wage) || 0;
  const monthly = num(d.salary);
  const isDaily = d.pay_type === "daily";
  const sgk = String(d.sgk_number || "").trim();
  const iban = String(d.iban || "").trim();
  const body: Record<string, unknown> = {
    full_name: d.full_name.trim(),
    tc_kimlik: d.tc_kimlik.trim(),
    department: d.department.trim(),
    position: d.position.trim(),
    phone: d.phone.trim(),
    email: d.email.trim(),
    pay_type: isDaily ? "daily" : "monthly",
    daily_wage: isDaily ? daily : 0,
    salary: isDaily ? Math.round(daily * 26 * 100) / 100 : monthly,
    start_date: d.start_date,
    sgk_number: sgk || null,
    iban: iban || null,
    meal_allowance: num(d.meal_allowance) || 0,
    transport_allowance: num(d.transport_allowance) || 0,
    birth_date: String(d.birth_date || "").trim() || null,
    address: String(d.address || "").trim() || null,
    emergency_contact: String(d.emergency_contact || "").trim() || null,
    notes: String(d.notes || "").trim() || null,
  };
  if (companyId) body.company_id = companyId;
  return body;
}

export function isDailyWage(emp?: Pick<Employee, "pay_type" | "daily_wage"> | null): boolean {
  const t = String(emp?.pay_type || "").toLowerCase();
  if (t === "daily" || t === "yevmiye" || t === "gunluk" || t === "günlük") return true;
  if (t === "monthly" || t === "aylik" || t === "aylık" || t === "maas" || t === "maaş") return false;
  return Number(emp?.daily_wage) > 0;
}

export function isDailyPayroll(p?: Pick<Payroll, "pay_type"> | null): boolean {
  return isDailyWage(p);
}

export function dailyEarned(emp?: Employee | null, daysPresent = 0): number {
  if (!isDailyWage(emp)) return 0;
  const days = Math.max(0, Math.trunc(Number(daysPresent) || 0));
  return Math.round((Number(emp?.daily_wage) || 0) * days * 100) / 100;
}

export function referenceDailyWage(emp?: Pick<Employee, "daily_wage" | "salary"> | null): number {
  const wage = Number(emp?.daily_wage) || 0;
  if (wage > 0) return wage;
  const salary = Number(emp?.salary) || 0;
  if (salary > 0) return Math.round((salary / 26) * 100) / 100;
  return 0;
}

export function yevmiyeAdjustedAmount(
  dailyWage: number,
  lateMinutes = 0,
  earlyMinutes = 0,
  scheduledMinutes = 480,
): number {
  const wage = Number(dailyWage) || 0;
  const sched = Math.max(1, Math.trunc(Number(scheduledMinutes) || 480));
  const cut = Math.max(0, Math.trunc(Number(lateMinutes) || 0)) + Math.max(0, Math.trunc(Number(earlyMinutes) || 0));
  const worked = Math.max(0, sched - cut);
  return Math.round((wage * worked / sched) * 100) / 100;
}

export function yevmiyeAdjustmentNeeded(lateMinutes = 0, earlyMinutes = 0): boolean {
  return (Number(lateMinutes) || 0) > 0 || (Number(earlyMinutes) || 0) > 0;
}

export function yevmiyeStatusLine(rec?: {
  yevmiye_full_amount?: number;
  yevmiye_adjustment_request?: {
    status?: string;
    full_amount?: number;
    proposed_amount?: number;
    final_amount?: number;
  } | null;
} | null): string {
  const adj = rec?.yevmiye_adjustment_request || {};
  const full = Number(rec?.yevmiye_full_amount ?? adj.full_amount) || 0;
  const proposed = Number(adj.proposed_amount ?? adj.final_amount) || 0;
  if (adj.status === "pending" && proposed) {
    return `Yevmiye ${proposed} ₺ önerildi — yönetici onayı bekleniyor`;
  }
  if (adj.status === "approved") {
    return `Yevmiye ${adj.final_amount ?? proposed} ₺ (ücret kesildi)`;
  }
  if (adj.status === "rejected" && full) {
    return `Yevmiye ${full} ₺ (ücret kesilmedi)`;
  }
  if (full) return `Yevmiye ${full} ₺`;
  return "";
}

/** Yevmiye günü: 1–31 tam sayı. */
export function parseYevmiyeDays(raw: string): number | null {
  const n = Math.trunc(Number(String(raw || "").trim().replace(",", ".")));
  if (!Number.isFinite(n) || n < 1 || n > 31) return null;
  return n;
}

export function validateYevmiyeDays(raw: string): string | null {
  return parseYevmiyeDays(raw) == null ? "1–31 arası gün sayısı girin." : null;
}

export function parseYevmiyeWage(raw: string): number | null {
  const n = Number(String(raw || "").trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function validateYevmiyeWage(raw: string): string | null {
  return parseYevmiyeWage(raw) == null ? "Yevmiye ücreti girin." : null;
}

export function yevmiyeDaysLine(emp?: Employee | null, days = 0, wageOverride?: number): string {
  const d = Math.max(0, Math.trunc(Number(days) || 0));
  const wage = wageOverride != null ? Number(wageOverride) : Number(emp?.daily_wage) || 0;
  return `${d} gün × ${wage} ₺`;
}

export function yevmiyePayPayload(
  employeeId: string,
  emp: Employee | null | undefined,
  daysRaw: string,
  period: string,
  accountId: string,
  note: string,
  wageRaw = "",
) {
  const days = parseYevmiyeDays(daysRaw) || 0;
  const wage = parseYevmiyeWage(wageRaw) ?? (Number(emp?.daily_wage) || 0);
  const forCalc = { ...(emp || {}), daily_wage: wage };
  return {
    employee_id: employeeId,
    type: "yevmiye" as const,
    amount: dailyEarned(forCalc, days),
    period,
    note: note.trim() || yevmiyeDaysLine(forCalc, days, wage),
    worked_days: days,
    daily_wage: wage,
    ...splitPaymentTarget(accountId),
  };
}

export function payrollWageLine(p?: Payroll | null): string {
  if (!isDailyPayroll(p)) return "";
  const days = Math.max(0, Math.trunc(Number(p?.worked_days) || 0));
  const wage = Number(p?.daily_wage) || 0;
  return `${days} gün × ${wage} ₺`;
}

export function monthlyPayrollLoad(employees: Employee[]): number {
  return (employees || []).reduce((s, e) => {
    if (isDailyWage(e)) return s + (Number(e.daily_wage) || 0) * 26;
    return s + (Number(e.salary) || 0);
  }, 0);
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
  if (status === "paid") return paidDate ? `Ödendi (${fmtDate(paidDate)})` : "Ödendi";
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

export function bonusDue(balance?: EmployeeBalance | null): number {
  return Number(balance?.bonus_pending) || 0;
}

export function overtimeDue(balance?: EmployeeBalance | null): number {
  if (balance?.overtime_due != null && Number.isFinite(Number(balance.overtime_due))) {
    return Number(balance.overtime_due) || 0;
  }
  return Number(balance?.overtime_pay) || 0;
}

/** Kart bakiyesine dönem mesai tutarını yaz (ödenen fazla mesai düşülür). */
export function enrichEmployeeBalance(card?: EmployeeCard | null, month = ""): EmployeeBalance | null {
  if (!card?.balance && !card?.overtime) return null;
  const bal: EmployeeBalance = { ...(card.balance || {}) };
  const earned = Number(card.overtime?.amount ?? bal.overtime_pay) || 0;
  const hours = Number(card.overtime?.hours ?? bal.overtime_hours) || 0;
  const paid = (card.bonuses || [])
    .filter((b) => String(b.type || "") === "overtime" && b.status === "paid" && (!month || String(b.period || "").startsWith(month)))
    .reduce((s, b) => s + (Number(b.amount) || 0), 0);
  bal.overtime_pay = earned;
  bal.overtime_hours = hours;
  if (bal.overtime_due == null) bal.overtime_due = Math.max(0, Math.round((earned - paid) * 100) / 100);
  return bal;
}

export function employeeCompRows(
  emp?: Employee | null,
  balance?: EmployeeBalance | null,
  opts?: { daysPresent?: number; yevmiyeDays?: number; yevmiyeAmount?: number },
): { key: string; label: string; value: number; hint?: string; days?: number }[] {
  const meal = Number(emp?.meal_allowance ?? balance?.meal_allowance ?? balance?.meal_due ?? 0) || 0;
  const yol = Number(emp?.transport_allowance ?? balance?.transport_allowance ?? balance?.transport_due ?? 0) || 0;
  const daily = isDailyWage(emp);
  const wage = daily ? (Number(emp?.daily_wage) || 0) : (Number(emp?.salary) || 0);
  const recordedDays = Math.max(0, Math.trunc(Number(opts?.yevmiyeDays ?? emp?.yevmiye_days) || 0));
  const present = Math.max(0, Math.trunc(Number(opts?.daysPresent) || 0));
  const prim = bonusDue(balance);
  const recordedAmt = Number(opts?.yevmiyeAmount ?? emp?.yevmiye_due) || 0;
  const bonusValue = daily
    ? (recordedAmt > 0 ? recordedAmt : prim > 0 ? prim : dailyEarned(emp, recordedDays || present))
    : prim;
  const days = recordedDays > 0
    ? recordedDays
    : (daily && wage > 0 && bonusValue > 0 ? Math.round(bonusValue / wage) : present);
  const mesai = overtimeDue(balance);
  return [
    { key: "meal", label: "Yemek", value: meal },
    { key: "yol", label: "Yol", value: yol },
    { key: "salary", label: daily ? "Yevmiye" : "Maaş", value: wage },
    {
      key: "bonus",
      label: daily ? "Yevmiye günü" : "Prim hakedişi",
      value: bonusValue,
      hint: daily ? `${days} gün` : undefined,
      days: daily ? days : undefined,
    },
    { key: "overtime", label: "Fazla mesai ücreti", value: mesai },
    { key: "total", label: "Toplam", value: meal + yol + wage + bonusValue + mesai },
  ];
}

export type CompRow = { key: string; label: string; value: number; hint?: string; days?: number };
export type CompGroup = { key: string; title: string; rows: CompRow[] };

export function employeeCompGroups(rows: CompRow[]): CompGroup[] {
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  const pick = (...keys: string[]) => keys.map((k) => byKey[k]).filter(Boolean) as CompRow[];
  const wageTitle = byKey.salary?.label === "Yevmiye" ? "Yevmiye" : "Maaş";
  return [
    { key: "allowance", title: "Yan hak", rows: pick("meal", "yol") },
    { key: "wage", title: wageTitle, rows: pick("salary", "bonus") },
    { key: "sum", title: "Özet", rows: pick("overtime", "total") },
  ];
}

export function employeeCompRowCaption(row: CompRow, daily?: boolean): string {
  const label = row.key === "salary" && daily ? `${row.label} / gün` : row.label;
  if (row.key === "bonus" && row.days != null) return `${label} · ${row.days} gün`;
  return label;
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

export function bonusPayPayload(
  employeeId: string,
  kind: "bonus" | "overtime",
  amount: string,
  period: string,
  accountId: string,
  note: string,
) {
  const overtime = kind === "overtime";
  return {
    employee_id: employeeId,
    type: overtime ? "overtime" as const : "bonus" as const,
    amount: num(amount),
    period,
    note: note.trim() || (overtime ? "Fazla mesai ücreti" : "Prim"),
    ...splitPaymentTarget(accountId),
  };
}

export type LedgerSide = "alacak" | "borc";

export function ledgerPayPayload(
  employeeId: string,
  side: LedgerSide,
  amount: string,
  period: string,
  accountId: string,
  note: string,
) {
  const debt = side === "borc";
  return {
    employee_id: employeeId,
    type: debt ? "borc" : "bakiye",
    amount: num(amount),
    period,
    note: note.trim() || (debt ? "Borç" : "Bakiye ödemesi"),
    ...splitPaymentTarget(accountId),
  };
}

export function validateOvertime(hours: string, start?: string, end?: string): string | null {
  const ranged = hoursFromTimeRange(start, end);
  if (ranged != null && ranged > 0) return null;
  const clock = hoursFromTimeRange("00:00", hours);
  if (clock != null && clock > 0) return null;
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
  const clock = hoursFromTimeRange("00:00", hours);
  return {
    employee_id: employeeId,
    date: date.trim(),
    hours: ranged != null ? ranged : clock != null ? clock : Math.round(num(hours) * 100) / 100,
    note: note.trim(),
    ...(start ? { start_time: start } : {}),
    ...(end ? { end_time: end } : {}),
  };
}

export type TaskKind = "field" | "office";

export type ProjectTask = {
  id?: string;
  title?: string;
  name?: string;
  done?: boolean;
  status?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  due_date?: string | null;
  duration_days?: number | null;
  kind?: TaskKind | string | null;
  task_kind?: TaskKind | string | null;
};

export function normalizeTaskKind(raw?: string | null): TaskKind {
  const s = String(raw || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ç/g, "c").replace(/ş/g, "s");
  if (s === "office" || s === "ic" || s === "internal" || s === "iceride") return "office";
  return "field";
}

export function isFieldTask(task?: Pick<ProjectTask, "kind" | "task_kind"> | null): boolean {
  return normalizeTaskKind(task?.kind || task?.task_kind) === "field";
}

export function taskKindLabel(kind?: string | null): string {
  return normalizeTaskKind(kind) === "office" ? "İç görev" : "Dış görev";
}

/** Dış görev gün sayısı: 1–366. */
export function parseTaskDays(raw: string): number | null {
  const n = Math.trunc(Number(String(raw || "").trim().replace(",", ".")));
  if (!Number.isFinite(n) || n < 1 || n > 366) return null;
  return n;
}

export function validateTaskDays(raw: string): string | null {
  if (!String(raw || "").trim()) return null;
  return parseTaskDays(raw) == null ? "1–366 arası gün sayısı girin." : null;
}

export function dueDateFromDays(start: string, days: number): string {
  const parts = String(start || "").slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((x) => !Number.isFinite(x))) return String(start || "").slice(0, 10);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + Math.max(1, Math.trunc(days)) - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type ProjectWithTasks = {
  id?: string;
  _id?: string;
  name?: string;
  project_number?: string;
  status?: string;
  tasks?: ProjectTask[];
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  location_url?: string;
};

export function newTaskId(now = Date.now(), rand = Math.random().toString(36).slice(2, 7)): string {
  return `t_${now}_${rand}`;
}

export function taskIsDone(task?: Pick<ProjectTask, "done" | "status"> | null): boolean {
  if (!task) return false;
  if (task.done) return true;
  const s = String(task.status || "").toLocaleLowerCase("tr-TR");
  return s === "done" || s === "completed" || s === "tamamlandı" || s === "tamamlandi";
}

export function normalizeProjectTasks(tasks?: ProjectTask[] | null): ProjectTask[] {
  return (tasks || [])
    .map((t, i) => ({
      id: t.id || `t_${i}`,
      title: (t.title || t.name || "").trim(),
      done: taskIsDone(t),
      assignee_id: t.assignee_id || null,
      assignee_name: t.assignee_name || null,
      due_date: t.due_date || null,
      duration_days: t.duration_days || null,
      kind: normalizeTaskKind(t.kind || t.task_kind),
    }))
    .filter((t) => t.title);
}

function withTaskAssign(
  task: ProjectTask,
  opts: { durationDays?: number; dueDate?: string; kind?: string },
): ProjectTask {
  const kind = normalizeTaskKind(opts.kind || task.kind);
  const next: ProjectTask = { ...task, kind };
  if (kind === "office") {
    next.duration_days = null;
    return next;
  }
  if (opts.durationDays) next.duration_days = opts.durationDays;
  if (opts.dueDate) next.due_date = opts.dueDate;
  return next;
}

export function assignEmployeeToTasks(
  tasks: ProjectTask[] | undefined,
  employee: Pick<Employee, "id" | "_id" | "full_name">,
  opts: { taskId?: string; title?: string; newId?: string; durationDays?: number; dueDate?: string; kind?: string },
): { tasks: ProjectTask[]; error: string | null } {
  const empId = idOf(employee);
  const empName = employee.full_name || "Personel";
  const existing = normalizeProjectTasks(tasks);
  if (opts.taskId) {
    const idx = existing.findIndex((t) => t.id === opts.taskId);
    if (idx < 0) return { tasks: existing, error: "Görev bulunamadı." };
    return {
      tasks: existing.map((t, i) => (i === idx ? withTaskAssign({ ...t, assignee_id: empId, assignee_name: empName }, opts) : t)),
      error: null,
    };
  }
  const title = (opts.title || "").trim();
  if (!title) return { tasks: existing, error: "Görev adı girin." };
  return {
    tasks: [...existing, withTaskAssign({
      id: opts.newId || newTaskId(),
      title,
      done: false,
      assignee_id: empId,
      assignee_name: empName,
    }, opts)],
    error: null,
  };
}

export function validateTaskAssign(projectId: string, taskId: string, title: string): string | null {
  if (!projectId) return "Proje seçin.";
  if (!taskId && !title.trim()) return "Yapacağı işi seçin veya yeni iş adı yazın.";
  return null;
}

export function isClosedProject(p?: Pick<ProjectWithTasks, "status"> | null): boolean {
  const s = String(p?.status || "").toLocaleLowerCase("tr-TR");
  return s === "completed" || s === "tamamlandı" || s === "tamamlandi" || s === "done";
}

export function closedProjectCount(projects?: ProjectWithTasks[] | null): number {
  return (projects || []).filter(isClosedProject).length;
}

export function projectSelectGroups(
  projects: ProjectWithTasks[],
  opts?: { includeCompleted?: boolean; keepId?: string },
) {
  const keep = String(opts?.keepId || "");
  const rows = (projects || []).filter((p) => opts?.includeCompleted || !isClosedProject(p) || idOf(p) === keep);
  const open = rows.filter((p) => !isClosedProject(p));
  const done = rows.filter((p) => isClosedProject(p));
  const labelOf = (p: ProjectWithTasks) => `${p.name || "Proje"}${p.project_number ? ` · ${p.project_number}` : ""}`;
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  if (open.length) {
    groups.push({ label: "Açık projeler", options: open.map((p) => ({ value: idOf(p), label: labelOf(p) })) });
  }
  if (done.length) {
    groups.push({ label: "Tamamlanan", options: done.map((p) => ({ value: idOf(p), label: labelOf(p) })) });
  }
  return groups;
}

export function taskSelectGroups(tasks?: ProjectTask[] | null) {
  const open = normalizeProjectTasks(tasks).filter((t) => !t.done);
  if (!open.length) return [];
  return [{
    label: "Yapılacak işler",
    options: open.map((t) => ({
      value: t.id || "",
      label: String(t.title || ""),
    })),
  }];
}

export const EMPLOYEE_MEAL_CATEGORY = "Yemek";
export const EMPLOYEE_TRANSPORT_CATEGORY = "Yol / Ulaşım";

export const EMPLOYEE_CARD_PAY_ACTIONS = [
  { key: "advance", title: "Avans" },
  { key: "salary", title: "Maaş öde" },
  { key: "meal", title: "Yemek" },
  { key: "transport", title: "Yol" },
  { key: "bonus", title: "Prim öde" },
  { key: "otpay", title: "Mesai öde" },
] as const;

export const EMPLOYEE_CARD_WORK_ACTIONS = [
  { key: "task", title: "Görev ata" },
  { key: "overtime", title: "+ Mesai" },
] as const;

export const EMPLOYEE_CARD_ACTIONS = [...EMPLOYEE_CARD_PAY_ACTIONS, ...EMPLOYEE_CARD_WORK_ACTIONS] as const;

export type EmployeeCardActionKey = (typeof EMPLOYEE_CARD_ACTIONS)[number]["key"];

export function employeeCardActionsByGroup(group: "pay" | "work") {
  return group === "work" ? EMPLOYEE_CARD_WORK_ACTIONS : EMPLOYEE_CARD_PAY_ACTIONS;
}

export const EMPLOYEE_CARD_ACTION_ICONS: Record<string, string> = {
  moves: "list-outline",
  advance: "cash-outline",
  salary: "wallet-outline",
  meal: "restaurant-outline",
  transport: "bus-outline",
  bonus: "calendar-outline",
  otpay: "time-outline",
  task: "briefcase-outline",
  overtime: "add-circle-outline",
  location: "location-outline",
  expense: "receipt-outline",
  duties: "checkbox-outline",
};

export function employeeCardActionIcon(key: string): string {
  return EMPLOYEE_CARD_ACTION_ICONS[key] || "ellipse-outline";
}

export const EMPLOYEE_LOCATION_SETTINGS_TITLE = "Konum Ayarları";

export function allowanceDue(emp?: Employee | null, balance?: EmployeeBalance | null, kind: "meal" | "transport" = "meal"): number {
  if (kind === "meal") return Number(balance?.meal_due ?? emp?.meal_allowance ?? 0) || 0;
  return Number(balance?.transport_due ?? emp?.transport_allowance ?? 0) || 0;
}

export function personnelExpensePayload(
  employeeId: string,
  kind: "meal" | "transport" | "expense",
  amount: string,
  accountId: string,
  note: string,
  companyId: string,
  date = "",
) {
  const meal = kind === "meal";
  const generic = kind === "expense";
  return {
    company_id: companyId,
    employee_id: employeeId,
    category: generic ? "Personel masrafı" : meal ? EMPLOYEE_MEAL_CATEGORY : EMPLOYEE_TRANSPORT_CATEGORY,
    description: note.trim() || (generic ? "Personel masrafı" : meal ? "Yemek ücreti" : "Yol / ulaşım ödemesi"),
    amount: num(amount),
    vat_rate: 0,
    date: (date || new Date().toISOString().slice(0, 10)).slice(0, 10),
    notes: note.trim(),
    ...splitPaymentTarget(accountId),
  };
}

export const COMPANY_BONUS_TYPES = [
  { key: "bonus", label: "Prim" },
  { key: "overtime", label: "Mesai" },
  { key: "second_salary", label: "2. Maaş" },
  { key: "advance", label: "Avans" },
  { key: "bakiye", label: "Bakiye" },
  { key: "alacak", label: "Alacak" },
  { key: "borc", label: "Borç" },
] as const;

export function companyBonusPayload(
  employeeId: string,
  type: string,
  amount: string,
  period: string,
  accountId: string,
  note: string,
) {
  return {
    employee_id: employeeId,
    type,
    amount: num(amount),
    period,
    note: note.trim(),
    ...splitPaymentTarget(accountId),
  };
}

export function bonusesPeriodTotal(rows: EmployeeBonus[] | null | undefined, period: string): number {
  return (rows || []).filter((b) => b.period === period).reduce((s, b) => s + (Number(b.amount) || 0), 0);
}

export function employeeCardActionTitle(
  action: { key: string; title: string },
  emp?: Pick<Employee, "pay_type"> | null,
): string {
  if (action.key === "salary" && isDailyWage(emp)) return "Bakiye öde";
  if (action.key === "bonus" && isDailyWage(emp)) return "Yevmiye günü";
  return action.title;
}

export function employeeCardActionTitles(emp?: Pick<Employee, "pay_type"> | null): string[] {
  return EMPLOYEE_CARD_ACTIONS.map((a) => employeeCardActionTitle(a, emp));
}

export function payrollBreakdown(p: Payroll): string {
  const bits: string[] = [];
  const wage = payrollWageLine(p);
  if (wage) bits.push(wage);
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
