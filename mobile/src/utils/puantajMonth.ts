import { fmtDmy } from "./calendar";

export const PUANTAJ_STATUS: Record<string, string> = {
  present: "Çalıştı",
  absent: "Devamsız",
  leave: "İzinli",
  off: "Tatil",
  empty: "Kayıt yok",
};

export const PUANTAJ_WEEKDAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

export function puantajStatusLabel(status?: string | null): string {
  return PUANTAJ_STATUS[String(status || "")] || PUANTAJ_STATUS.empty;
}

export function puantajStatusTone(status?: string | null): "emerald" | "rose" | "amber" | "slate" {
  if (status === "present") return "emerald";
  if (status === "absent") return "rose";
  if (status === "leave") return "amber";
  return "slate";
}

export function puantajToneColors(tone: string): { bg: string; fg: string; border: string } {
  if (tone === "emerald") return { bg: "#ECFDF5", fg: "#065F46", border: "#A7F3D0" };
  if (tone === "rose") return { bg: "#FFF1F2", fg: "#9F1239", border: "#FECDD3" };
  if (tone === "amber") return { bg: "#FFFBEB", fg: "#92400E", border: "#FDE68A" };
  return { bg: "#F8FAFC", fg: "#475569", border: "#E2E8F0" };
}

/** YYYY-MM → [YYYY-MM-DD, ...] for all days in month. */
export function monthDateList(month?: string | null): string[] {
  const m = String(month || "").slice(0, 7);
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return [];
  const y = Number(match[1]);
  const mo = Number(match[2]);
  const last = new Date(y, mo, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${m}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

export type PuantajDay = {
  date: string;
  weekday: number;
  weekday_label: string;
  status: string;
  status_label: string;
  check_in?: string | null;
  check_out?: string | null;
  hours?: number;
  overtime_hours?: number;
  late_minutes?: number;
  early_leave_minutes?: number;
  wage?: number | null;
  wage_full?: number | null;
  wage_proposed?: number | null;
  wage_adjustment_status?: string | null;
  wage_ask?: boolean;
  leave_type?: string | null;
  leave_label?: string | null;
  note?: string | null;
  attendance_id?: string | null;
  is_off_day?: boolean;
};

export function puantajDayLine(day?: PuantajDay | null): string {
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
export function buildPuantajCalendarCells(days?: PuantajDay[] | null): Array<PuantajDay | null> {
  const list = days || [];
  if (!list.length) return [];
  const lead = list[0].weekday || 0;
  const cells: Array<PuantajDay | null> = Array.from({ length: lead }, () => null);
  return cells.concat(list);
}

export function puantajWageCanAsk(day?: PuantajDay | null): boolean {
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

export function puantajWageAskReason(day?: PuantajDay | null): string {
  const bits: string[] = [];
  const late = Number(day?.late_minutes) || 0;
  const early = Number(day?.early_leave_minutes) || 0;
  if (late > 0) bits.push(`${late} dk geç`);
  if (early > 0) bits.push(`${early} dk erken`);
  return bits.join(" · ");
}

export function puantajWageAskCopy(
  day?: PuantajDay | null,
  formatAmount: (n: unknown) => string = (n) => String(n ?? ""),
): { title: string; body: string; kes: string; kesme: string } {
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

export function puantajWageDecisionPath(day?: PuantajDay | null): string {
  const id = day?.attendance_id;
  return id ? `/personnel/attendance/${id}/yevmiye-decision` : "";
}

export const PUANTAJ_EDIT_STATUSES = [
  { value: "present", label: "Çalıştı" },
  { value: "absent", label: "Devamsız" },
  { value: "leave", label: "İzinli" },
] as const;

export type PuantajEditForm = {
  date: string;
  status: string;
  check_in: string;
  check_out: string;
  note: string;
};

export function puantajEditableStatus(status?: string | null): "present" | "absent" | "leave" {
  if (status === "present" || status === "absent" || status === "leave") return status;
  return "present";
}

export function puantajEditDraft(day?: PuantajDay | null): PuantajEditForm {
  if (!day) return { date: "", status: "present", check_in: "", check_out: "", note: "" };
  return {
    date: day.date,
    status: puantajEditableStatus(day.status),
    check_in: day.check_in || "",
    check_out: day.check_out || "",
    note: day.note || "",
  };
}

export function puantajEditValidate(form?: PuantajEditForm | null): string | null {
  if (!form?.date) return "Tarih gerekli.";
  const status = puantajEditableStatus(form.status);
  if (status === "present" && !String(form.check_in || "").trim()) return "Giriş saati gerekli.";
  return null;
}

export function puantajEditPayload(employeeId: string, form?: PuantajEditForm | null): Record<string, string | null> {
  const status = puantajEditableStatus(form?.status);
  const body: Record<string, string | null> = {
    employee_id: employeeId,
    date: form?.date || "",
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

export function leaveYearArchiveLine(row?: {
  year?: number | string;
  used?: number;
  remaining?: number;
  carry_over?: number;
} | null): string {
  if (!row) return "";
  const y = row.year || "—";
  const used = Number(row.used) || 0;
  const rem = Number(row.remaining) || 0;
  const carry = Number(row.carry_over) || 0;
  return `${y} · kullanılan ${used}g · kalan ${rem}g${carry ? ` · devir ${carry}g` : ""}`;
}

export type PuantajPayload = {
  month?: string;
  days?: PuantajDay[];
  summary?: {
    days_present?: number;
    days_absent?: number;
    days_leave?: number;
    total_hours?: number;
    overtime_hours?: number;
  };
  leave_year?: {
    year?: number;
    annual?: number;
    used?: number;
    carry?: number;
    remaining?: number;
  };
  leave_archives?: Array<{
    id?: string;
    year?: number;
    used?: number;
    remaining?: number;
    carry_over?: number;
  }>;
};

export function movesSheetTitle(tab: string): string {
  if (tab === "location") return "Konum hareketleri";
  if (tab === "puantaj") return "Personel puantajı";
  if (tab === "overtime") return "Mesai hareketleri";
  if (tab === "tasks") return "Atanan görevler";
  return "Ödeme hareketleri";
}
