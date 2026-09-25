import { formatTrDate } from "./employeeCardSummary";
import { isDailyWage, payrollWageLine, periodWage } from "./personnelWage";
import { formatTrAmount } from "./money";

export function bonusDue(balance) {
  return Number(balance?.bonus_pending) || 0;
}

export function overtimeDue(balance) {
  if (balance?.overtime_due != null && Number.isFinite(Number(balance.overtime_due))) {
    return Number(balance.overtime_due) || 0;
  }
  return Number(balance?.overtime_pay) || 0;
}

export function remainingDue(balance, unpaidFallback = 0) {
  if (balance && balance.remaining != null && Number.isFinite(Number(balance.remaining))) {
    return Number(balance.remaining) || 0;
  }
  return unpaidFallback;
}

export function remainingLeaveDays(emp) {
  return (Number(emp?.annual_leave_days) || 14) - (Number(emp?.used_leave_days) || 0);
}

export function employeeCompRows(emp, balance, opts = {}) {
  const meal = Number(emp?.meal_allowance ?? balance?.meal_allowance ?? balance?.meal_due ?? 0) || 0;
  const yol = Number(emp?.transport_allowance ?? balance?.transport_allowance ?? balance?.transport_due ?? 0) || 0;
  const daily = isDailyWage(emp);
  const wage = daily ? (Number(emp?.daily_wage) || 0) : (Number(emp?.salary) || 0);
  const recordedDays = Math.max(0, Math.trunc(Number(opts.yevmiyeDays ?? emp?.yevmiye_days) || 0));
  const present = Math.max(0, Math.trunc(Number(opts.daysPresent) || 0));
  const prim = bonusDue(balance);
  const recordedAmt = Number(opts.yevmiyeAmount ?? emp?.yevmiye_due) || 0;
  const bonusValue = daily
    ? (recordedAmt > 0 ? recordedAmt : prim > 0 ? prim : periodWage(emp, recordedDays || present))
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

export function employeeCompGroups(rows) {
  const byKey = Object.fromEntries((rows || []).map((r) => [r.key, r]));
  const pick = (...keys) => keys.map((k) => byKey[k]).filter(Boolean);
  const wageTitle = byKey.salary?.label === "Yevmiye" ? "Yevmiye" : "Maaş";
  return [
    { key: "allowance", title: "Yan hak", rows: pick("meal", "yol") },
    { key: "wage", title: wageTitle, rows: pick("salary", "bonus") },
    { key: "sum", title: "Özet", rows: pick("overtime", "total") },
  ];
}

export function employeeCompRowCaption(row, daily) {
  const label = row.key === "salary" && daily ? `${row.label} / gün` : row.label;
  if (row.key === "bonus" && row.days != null) return `${label} · ${row.days} gün`;
  return label;
}

export function fmtCardMoney(n) {
  return `${Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
}

function idOf(row) {
  return String(row?.id || row?._id || "").trim();
}

function presenceInside(opts = {}) {
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
export function employeePresenceChip(opts) {
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

const BONUS_TYPE_TR = {
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

function bonusTypeTr(type, fallback) {
  return BONUS_TYPE_TR[String(type || "")] || fallback || "Ödeme";
}

function bonusStatusTr(status) {
  const key = String(status || "");
  if (key === "paid") return "Ödendi";
  if (key === "pending") return "Bekliyor";
  if (key === "approved") return "Onaylı";
  if (key === "rejected") return "Reddedildi";
  return key;
}

function payrollStatusTr(status, paidDate) {
  if (status === "paid") return paidDate ? `Ödendi (${formatTrDate(paidDate)})` : "Ödendi";
  if (status === "pending") return "Ödeme bekliyor";
  return status || "";
}

function yevmiyeDaysFromBonus(b) {
  const days = Math.trunc(Number(b?.worked_days) || 0);
  if (days > 0) return days;
  const m = String(b?.note || "").match(/(\d+)\s*gün/);
  return m ? Number(m[1]) || null : null;
}

export function employeePayMoves(card) {
  const rows = [];
  for (const p of card?.payrolls || []) {
    const wage = payrollWageLine(p);
    rows.push({
      id: idOf(p) || `pay-${p.period || ""}`,
      kind: "payroll",
      title: isDailyWage(p) ? "Yevmiye" : "Maaş",
      subtitle: [p.period, wage, payrollStatusTr(p.status, p.paid_date)].filter(Boolean).join(" · "),
      amount: Number(p.final_payable ?? p.net_salary) || 0,
      date: String(p.paid_date || p.period || ""),
      status: p.status,
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
    });
  }
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

export function payMovesPeriodLabel(period) {
  if (period === "month") return "Bu ay";
  if (period === "all") return "Tümü";
  return "Son 30 gün";
}

function payMoveInstant(raw) {
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

export function payMoveInPeriod(row, period, now = new Date(), month = "") {
  if (period === "all") return true;
  const ts = payMoveInstant(row?.date);
  if (ts == null) return period === "month" && String(row?.date || "").startsWith(String(month || "").slice(0, 7));
  if (period === "month") {
    const ym = String(month || now.toISOString().slice(0, 7));
    return new Date(ts).toISOString().slice(0, 7) === ym || String(row?.date || "").startsWith(ym);
  }
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 30);
  return ts >= cutoff.getTime();
}

export function filterPayMoves(rows, period, now = new Date(), month = "") {
  return (rows || []).filter((row) => payMoveInPeriod(row, period, now, month));
}

export function payMovesPeriodHint(shown, total, period) {
  if (period === "all" || shown === total) return `${total} hareket`;
  return `${shown} / ${total} hareket`;
}

export function locationMoveDidLabel(kind) {
  if (kind === "enter") return "İş yerine giriş yaptı";
  if (kind === "leave") return "İş yerine çıkış yaptı";
  if (kind === "lost") return "Konum kaybı";
  return "Konum hareketi";
}

export function fmtLocationMoveAt(raw) {
  const s = String(raw || "").trim();
  if (!s) return "—";
  const hasTz = /[zZ]|[+-]\d{2}:\d{2}$/.test(s);
  const wall = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
  if (wall && !hasTz) return `${formatTrDate(wall[1])} ${wall[2]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatTrDate(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const fmt = new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const hour = String(parts.hour || "00").padStart(2, "0");
  const minute = String(parts.minute || "00").padStart(2, "0");
  return `${parts.day}.${parts.month}.${parts.year} ${hour}:${minute}`;
}

export function locationMoveLine(row) {
  return `${fmtLocationMoveAt(row?.at)} · ${locationMoveDidLabel(row?.kind)}`;
}

export function locationMoveCanIgnore(row) {
  if (!row || row.ignored) return false;
  if (row.official && !row.ignorable) return false;
  return Boolean(row.ignorable) && (row.kind === "leave" || row.kind === "lost" || row.kind === "enter");
}

export function locationMoveIgnorePath(row) {
  const att = String(row?.attendance_id || "").trim();
  const id = String(row?.id || "").trim();
  if (!att || !id) return null;
  return `/personnel/attendance/${att}/location-moves/${id}/ignore`;
}

export function locationMovesPeriodHint(shown, total, period) {
  if (period === "all" || shown === total) return `${total} konum hareketi`;
  return `${shown} / ${total} konum hareketi`;
}

export function fmtPayMoveAmount(n) {
  return `${formatTrAmount(Number(n) || 0)} ₺`;
}
