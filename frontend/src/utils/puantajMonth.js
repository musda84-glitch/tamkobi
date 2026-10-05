import { fmtDmy } from "./dateFormat";

export const PUANTAJ_STATUS = {
  present: "Çalıştı",
  absent: "Devamsız",
  leave: "İzinli",
  off: "Tatil",
  empty: "Kayıt yok",
};

export const PUANTAJ_WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function puantajStatusLabel(status) {
  return PUANTAJ_STATUS[status] || PUANTAJ_STATUS.empty;
}

export function puantajStatusTone(status) {
  if (status === "present") return "emerald";
  if (status === "absent") return "rose";
  if (status === "leave") return "amber";
  if (status === "off") return "slate";
  return "slate";
}

/** YYYY-MM → [YYYY-MM-DD, ...] for all days in month. */
export function monthDateList(month) {
  const m = String(month || "").slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return [];
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const last = new Date(y, mo, 0).getDate();
  const out = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${m}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function leaveCovers(leaves, date) {
  return (leaves || []).find((l) => {
    if (!l || (l.status && l.status !== "approved")) return false;
    const a = String(l.start_date || "").slice(0, 10);
    const b = String(l.end_date || l.start_date || "").slice(0, 10);
    return a && b && date >= a && date <= b;
  }) || null;
}

/**
 * Build day rows for a month from attendance records + approved leaves.
 * workDays: 0=Mon … 6=Sun (JS getDay() remapped) OR attendance schedule work_days (0=Mon).
 */
export function buildPuantajDayRows(month, records = [], leaves = [], opts = {}) {
  const byDate = new Map();
  for (const r of records || []) {
    const d = String(r.date || "").slice(0, 10);
    if (d) byDate.set(d, r);
  }
  const workDays = Array.isArray(opts.workDays) ? new Set(opts.workDays.map(Number)) : null;
  const hire = String(opts.hireDate || "").slice(0, 10) || null;
  const term = String(opts.endDate || "").slice(0, 10) || null;

  return monthDateList(month).map((date) => {
    const rec = byDate.get(date) || null;
    const lv = leaveCovers(leaves, date);
    const jsDay = new Date(`${date}T12:00:00`).getDay(); // 0=Sun
    const weekday = (jsDay + 6) % 7; // 0=Mon
    let isOff = workDays ? !workDays.has(weekday) : false;
    if (rec?.is_off_day) isOff = true;

    let status = "empty";
    if (rec?.status === "present") status = "present";
    else if (rec?.status === "absent") status = "absent";
    else if (rec?.status === "leave" || lv) status = "leave";
    else if (isOff) status = "off";

    const beforeHire = hire && date < hire;
    const afterTerm = term && date > term;
    if (beforeHire || afterTerm) status = "off";

    const ot = Number(rec?.assigned_overtime_hours || 0) || Number(rec?.overtime_hours || 0) || 0;
    return {
      date,
      weekday,
      weekday_label: PUANTAJ_WEEKDAYS[weekday],
      status,
      status_label: puantajStatusLabel(status),
      check_in: rec?.check_in || null,
      check_out: rec?.check_out || null,
      hours: Number(rec?.hours) || 0,
      overtime_hours: ot,
      late_minutes: Number(rec?.late_minutes) || 0,
      early_leave_minutes: Number(rec?.early_leave_minutes) || 0,
      leave_type: lv?.type || (rec?.status === "leave" ? "leave" : null),
      leave_label: lv?.type_label || lv?.reason || null,
      note: rec?.note || lv?.reason || null,
      attendance_id: rec?.id || rec?._id || null,
      is_off_day: isOff,
    };
  });
}

export function puantajDayLine(day) {
  if (!day) return "";
  const bits = [fmtDmy(day.date), day.weekday_label, day.status_label];
  if (day.status === "present") {
    bits.push(`${day.check_in || "—"} → ${day.check_out || "—"}`);
    if (day.hours) bits.push(`${day.hours} sa`);
    if (day.overtime_hours) bits.push(`+${day.overtime_hours} sa mesai`);
  }
  return bits.filter(Boolean).join(" · ");
}

/** Calendar grid cells: leading blanks + days (Mon-first). */
export function buildPuantajCalendarCells(days) {
  const list = days || [];
  if (!list.length) return [];
  const lead = list[0].weekday || 0;
  const cells = Array.from({ length: lead }, () => null);
  return cells.concat(list);
}

export function leaveYearBalance({ annual = 14, used = 0, carry = 0 } = {}) {
  const a = Math.max(0, Number(annual) || 0);
  const u = Math.max(0, Number(used) || 0);
  const c = Math.max(0, Number(carry) || 0);
  return {
    annual: a,
    used: u,
    carry: c,
    remaining: Math.max(0, a + c - u),
  };
}

export function puantajWageCanAsk(day) {
  if (!day || day.status !== "present") return false;
  if (!day.attendance_id) return false;
  const st = String(day.wage_adjustment_status || "").trim().toLowerCase();
  if (st === "approved" || st === "rejected") return false;
  if (day.wage_ask) return true;
  if (st === "pending") return true;
  const late = Number(day.late_minutes) || 0;
  const early = Number(day.early_leave_minutes) || 0;
  if (late > 0 || early > 0) return true;
  const full = Number(day.wage_full);
  const wage = Number(day.wage);
  return Number.isFinite(full) && Number.isFinite(wage) && full > wage + 0.009;
}

export function puantajWageAskReason(day) {
  const bits = [];
  const late = Number(day?.late_minutes) || 0;
  const early = Number(day?.early_leave_minutes) || 0;
  if (late > 0) bits.push(`${late} dk geç`);
  if (early > 0) bits.push(`${early} dk erken`);
  return bits.join(" · ");
}

export function puantajWageAskCopy(day, formatAmount = (n) => String(n ?? "")) {
  const reason = puantajWageAskReason(day);
  const full = formatAmount(day?.wage_full ?? day?.wage);
  const proposed = formatAmount(day?.wage_proposed ?? day?.wage);
  return {
    title: "Ücret kesintisi",
    body: reason
      ? `${reason}. Tam ${full} ₺ → kesilecek ${proposed} ₺.`
      : `Tam ${full} ₺ → kesilecek ${proposed} ₺.`,
    kes: "Ücret kes",
    kesme: "Ücret kesme",
  };
}

export function puantajWageDecisionPath(day) {
  const id = day?.attendance_id;
  return id ? `/personnel/attendance/${id}/yevmiye-decision` : "";
}

export const PUANTAJ_EDIT_STATUSES = [
  { value: "present", label: "Çalıştı" },
  { value: "absent", label: "Devamsız" },
  { value: "leave", label: "İzinli" },
];

export function puantajEditableStatus(status) {
  if (status === "present" || status === "absent" || status === "leave") return status;
  return "present";
}

export function puantajEditDraft(day) {
  if (!day) return { date: "", status: "present", check_in: "", check_out: "", note: "" };
  return {
    date: day.date,
    status: puantajEditableStatus(day.status),
    check_in: day.check_in || "",
    check_out: day.check_out || "",
    note: day.note || "",
  };
}

export function puantajEditValidate(form) {
  if (!form?.date) return "Tarih gerekli.";
  const status = puantajEditableStatus(form.status);
  if (status === "present" && !String(form.check_in || "").trim()) return "Giriş saati gerekli.";
  return null;
}

/** POST /personnel/attendance gövdesi — yönetici gün kaydı oluşturur/günceller. */
export function puantajEditPayload(employeeId, form) {
  const status = puantajEditableStatus(form?.status);
  const body = {
    employee_id: employeeId,
    date: form?.date,
    status,
    note: String(form?.note || ""),
  };
  if (status === "present") {
    body.check_in = String(form?.check_in || "").trim() || null;
    body.check_out = String(form?.check_out || "").trim() || null;
  } else {
    body.check_in = null;
    body.check_out = null;
  }
  return body;
}

export function leaveYearArchiveLine(row) {
  if (!row) return "";
  const y = row.year || "—";
  const used = Number(row.used) || 0;
  const rem = Number(row.remaining) || 0;
  const carry = Number(row.carry_over) || 0;
  return `${y} · kullanılan ${used}g · kalan ${rem}g${carry ? ` · devir ${carry}g` : ""}`;
}
