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

export function leaveYearArchiveLine(row) {
  if (!row) return "";
  const y = row.year || "—";
  const used = Number(row.used) || 0;
  const rem = Number(row.remaining) || 0;
  const carry = Number(row.carry_over) || 0;
  return `${y} · kullanılan ${used}g · kalan ${rem}g${carry ? ` · devir ${carry}g` : ""}`;
}
