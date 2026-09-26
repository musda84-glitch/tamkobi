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
  return "Ödeme hareketleri";
}
