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

/** Liste / kart Öde butonu: kalan alacak (mesai bakiyeye dahil). */
export function employeePayButtonDue(emp) {
  return remainingDue(emp?.balance);
}

export function employeePayButtonLabel(emp) {
  const due = employeePayButtonDue(emp);
  return due ? `Öde · ${formatTrAmount(due)} ₺` : "Öde";
}

export function remainingLeaveDays(emp) {
  const annual = Number(emp?.annual_leave_days) || 14;
  const used = Number(emp?.used_leave_days) || 0;
  const carry = Number(emp?.leave_carry_days) || 0;
  if (emp?.leave_balance && emp.leave_balance.remaining != null) {
    return Number(emp.leave_balance.remaining) || 0;
  }
  return Math.max(0, annual + carry - used);
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

function hmMinutes(hm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hm || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function clockMinutes(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function inHmWindow(startHm, endHm, now) {
  const start = hmMinutes(startHm);
  const end = hmMinutes(endHm);
  if (start == null || end == null) return false;
  const nowM = clockMinutes(now);
  if (end > start) return nowM >= start && nowM < end;
  return nowM >= start || nowM < end;
}

/** GPS / konum bayrağı — resmi çıkış saatini yok sayar (mesai/OT ayrımı için). */
function presenceGpsInside(opts = {}) {
  const today = opts.today;
  if (opts.location_last_inside === true) return true;
  if (opts.location_last_inside === false) return false;
  if (today?.location_exit_request?.status === "pending") return false;
  if (today?.location_left_at) return false;
  if (opts.location_last_ok === false) return null;
  if (today?.check_in && (opts.location_inside_at || today.location_inside_at || today.geo_check_in)) return true;
  return null;
}

const PRESENCE_CHIP = {
  work: { key: "work", label: "İş Yerinde", color: "#047857", bg: "#D1FAE5", border: "#6EE7B7" },
  duty: { key: "duty", label: "Görev Yerinde", color: "#3730A3", bg: "#EEF2FF", border: "#A5B4FC" },
  done: { key: "done", label: "Mesai Bitti", color: "#475569", bg: "#F1F5F9", border: "#CBD5E1" },
  overtime: { key: "overtime", label: "Fazla Mesaide", color: "#6D28D9", bg: "#EDE9FE", border: "#C4B5FD" },
};

export function presenceTodayOf(summaryRow) {
  if (!summaryRow) return null;
  const today = summaryRow.today && typeof summaryRow.today === "object" ? { ...summaryRow.today } : {};
  if (!today.scheduled_end && summaryRow.schedule?.end) today.scheduled_end = summaryRow.schedule.end;
  if (!today.scheduled_start && summaryRow.schedule?.start) today.scheduled_start = summaryRow.schedule.start;
  return Object.keys(today).length ? today : null;
}

function currentlyOnOvertime(opts, now) {
  const today = opts.today || {};
  if (hmMinutes(today.check_in) == null) return false;
  const gps = presenceGpsInside(opts);
  const checkedOut = hmMinutes(today.check_out) != null;
  const otWin = inHmWindow(today.assigned_overtime_start, today.assigned_overtime_end, now);
  const hours = Number(today.assigned_overtime_hours) || 0;
  const pending = today.overtime_confirm_request?.status === "pending";
  const schedEnd = hmMinutes(today.scheduled_end || today.expected_end);
  const pastEnd = schedEnd != null && clockMinutes(now) >= schedEnd;
  const inOt = otWin || ((hours > 0 || pending) && pastEnd) || (gps === true && pastEnd && !checkedOut);
  if (!inOt) return false;
  if (checkedOut && gps !== true) return false;
  return true;
}

/** Aktif yanındaki anlık yer: iş yeri / görev / mesai bitti / fazla mesai. */
export function employeePresenceChip(opts) {
  if (!opts) return null;
  const status = String(opts.status || "active");
  if (status === "terminated" || status === "passive" || status === "inactive") return null;
  const now = opts.now instanceof Date ? opts.now : new Date();
  const today = opts.today || {};
  const duty = opts.workplace?.kind === "task";
  const gps = presenceGpsInside(opts);
  if (currentlyOnOvertime(opts, now)) return PRESENCE_CHIP.overtime;
  if (hmMinutes(today.check_out) != null) return PRESENCE_CHIP.done;
  if (gps === true) return duty ? PRESENCE_CHIP.duty : PRESENCE_CHIP.work;
  if (duty && hmMinutes(today.check_in) != null) return PRESENCE_CHIP.duty;
  const schedEnd = hmMinutes(today.scheduled_end || today.expected_end);
  if (gps === false && schedEnd != null && clockMinutes(now) >= schedEnd) return PRESENCE_CHIP.done;
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

export function locationMoveTone(kind, extra) {
  const bits = `${kind || ""} ${extra || ""}`.toLocaleLowerCase("tr-TR");
  if (bits.includes("lost") || bits.includes("kayıp") || bits.includes("kayb")) return "lost";
  if (bits.includes("leave") || bits.includes("çıkış") || bits.includes("cikis")) return "out";
  if (bits.includes("enter") || bits.includes("giriş") || bits.includes("giris")) return "in";
  return null;
}

export function locationMoveColor(kind, ignored = false, extra) {
  if (ignored) return "#94A3B8";
  const tone = locationMoveTone(kind, extra);
  if (tone === "in") return "#047857";
  if (tone === "out") return "#BE123C";
  if (tone === "lost") return "#C2410C";
  return "#0F172A";
}

export function locationMoveBg(kind, ignored = false, extra) {
  if (ignored) return "#F8FAFC";
  const tone = locationMoveTone(kind, extra);
  if (tone === "in") return "#ECFDF5";
  if (tone === "out") return "#FFF1F2";
  if (tone === "lost") return "#FFF7ED";
  return "transparent";
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

export function overtimeMovesPeriodHint(shown, total, period) {
  if (period === "all" || shown === total) return `${total} mesai kaydı`;
  return `${shown} / ${total} mesai kaydı`;
}

export function overtimeMoveKindLabel(kind) {
  if (kind === "assigned") return "Yönetici atadı";
  if (kind === "computed") return "Puantajdan hesaplandı";
  return "Mesai";
}

export function overtimeMoveSourceLabel(row) {
  if (row?.source_label) return String(row.source_label);
  if (row?.source === "manager" || row?.kind === "assigned") return "Yönetici atadı";
  if (row?.source === "location") return "Konumdan tespit edildi";
  if (row?.source === "punch" || row?.kind === "computed") return "Puantajdan hesaplandı";
  return overtimeMoveKindLabel(row?.kind);
}

export function overtimeMoveLine(row) {
  const hours = Number(row?.hours) || 0;
  const range = row?.start && row?.end ? `${row.start}–${row.end}` : "";
  const bits = [formatTrDate(row?.date), `${hours} sa`, range, overtimeMoveSourceLabel(row)].filter(Boolean);
  return bits.join(" · ");
}

export function overtimeMoveDetail(row) {
  if (row?.check_in || row?.check_out) {
    return `Puantaj ${row.check_in || "—"} → ${row.check_out || "—"}`;
  }
  return "";
}

export function overtimeMoveCanEdit(row, canEdit = true) {
  return !!canEdit && !!row && row.can_edit !== false;
}

export function overtimeMoveCanDelete(row, canEdit = true) {
  return !!canEdit && !!row && (row.can_delete === true || (Number(row?.assigned_hours) || 0) > 0);
}

export function overtimeMoveDeleteConfirm() {
  return {
    title: "Fazla mesai sil",
    message: "Bu günün fazla mesai ataması kaldırılsın mı?",
  };
}

export function payMoveCanDelete(row, canEdit = true) {
  return !!canEdit && !!payMoveDeletePath(row);
}

export function payMoveDeletePath(row) {
  const id = String(row?.id || "").trim();
  if (!id || /^pay-\d{4}-\d{2}$/.test(id)) return null;
  if (row?.kind === "payroll") return `/personnel/payrolls/${id}`;
  if (row?.kind === "bonus") return `/personnel/bonuses/${id}`;
  return null;
}

export function payMoveDeleteConfirm(row) {
  const paid = row?.status === "paid";
  if (row?.kind === "payroll") {
    return {
      title: "Maaş kaydını sil",
      message: paid
        ? "Bu maaş kaydı silinsin mi? Ödeme kasa/banka veya ortak bakiyesine geri alınır."
        : "Bu bekleyen maaş kaydı silinsin mi?",
    };
  }
  return {
    title: "Ödeme kaydını sil",
    message: paid
      ? "Bu kayıt silinsin mi? Ödeme kasa/banka veya ortak bakiyesine geri alınır."
      : "Bu ödeme kaydı silinsin mi?",
  };
}

export function empDataResetPath(empId) {
  const id = String(empId || "").trim();
  return id ? `/personnel/employees/${id}/reset-data` : "";
}

export function empDataResetConfirm(emp) {
  const name = emp?.full_name || "Personel";
  return {
    title: "Personel verilerini sıfırla",
    message: `${name} için ödemeler, masraflar, fazla mesai, giriş-çıkış ve puantaj kayıtları silinecek. Personel kartı, belgeler ve sistem kullanıcısı durur.`,
    check: `${name} adlı personelin bu kayıtlarını sıfırlamayı onaylıyorum.`,
  };
}

export function fmtPayMoveAmount(n) {
  return `${formatTrAmount(Number(n) || 0)} ₺`;
}
