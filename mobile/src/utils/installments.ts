import { todayIso } from "./money";

export type Installment = {
  id?: string;
  _id?: string;
  invoice_id?: string | null;
  invoice_number?: string;
  direction?: string;
  no?: number;
  label?: string;
  total_count?: number;
  due_date?: string;
  amount?: number;
  paid_amount?: number;
  status?: string;
  is_overdue?: boolean;
  days_left?: number | null;
};

export type InstallmentGroup = {
  key: string;
  title: string;
  direction: string;
  paidCount: number;
  totalCount: number;
  rows: Installment[];
};

export type PlanDraft = {
  count: string;
  down_payment: string;
  interval: "month" | "week" | "days";
  interval_days: string;
  first_due_date: string;
};

export const PLAN_INTERVALS = [
  { key: "month", label: "Aylık" },
  { key: "week", label: "Haftalık" },
  { key: "days", label: "Gün aralığı" },
] as const;

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function remainingOf(row: Installment): number {
  return Math.max(0, Math.round(((Number(row.amount) || 0) - (Number(row.paid_amount) || 0)) * 100) / 100);
}

export function installmentSummary(rows: Installment[]): { pending: number; overdue: number; remaining: number } {
  const open = (rows || []).filter((r) => r.status !== "paid");
  return {
    pending: open.length,
    overdue: (rows || []).filter((r) => r.is_overdue).length,
    remaining: Math.round(open.reduce((s, r) => s + remainingOf(r), 0) * 100) / 100,
  };
}

/** Web'deki gibi fatura bazında grupla; bakiye planı tek grupta toplanır. */
export function groupInstallments(rows: Installment[]): InstallmentGroup[] {
  const map = new Map<string, Installment[]>();
  for (const row of rows || []) {
    const key = row.invoice_id || "bal";
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
    return {
      key,
      title: sorted[0]?.invoice_number || (key === "bal" ? "AÇIK BAKİYE" : "Taksit planı"),
      direction: sorted[0]?.direction || "receivable",
      paidCount: sorted.filter((r) => r.status === "paid").length,
      totalCount: Number(sorted[0]?.total_count) || sorted.length,
      rows: sorted,
    };
  });
}

export function emptyPlanDraft(): PlanDraft {
  const first = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return { count: "3", down_payment: "0", interval: "month", interval_days: "30", first_due_date: first };
}

export function validatePlanDraft(d: PlanDraft, total: number): string | null {
  const count = num(d.count);
  if (!(count >= 1)) return "Taksit sayısı en az 1 olmalı.";
  if (count > 60) return "Taksit sayısı en fazla 60 olabilir.";
  if (!(total > 0)) return "Taksitlendirilecek bakiye yok.";
  if (num(d.down_payment) > total) return "Peşinat toplam tutardan büyük olamaz.";
  if (d.interval === "days" && !(num(d.interval_days) >= 1)) return "Gün aralığı en az 1 olmalı.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.first_due_date)) return "İlk taksit tarihi YYYY-AA-GG olmalı.";
  return null;
}

export function planPayload(d: PlanDraft, total: number) {
  return {
    total,
    count: Math.trunc(num(d.count)) || 1,
    down_payment: num(d.down_payment),
    interval: d.interval,
    interval_days: Math.trunc(num(d.interval_days)) || 30,
    first_due_date: d.first_due_date || todayIso(),
  };
}

export type ContactPayment = {
  id?: string;
  _id?: string;
  type?: string;
  amount?: number;
  date?: string;
  description?: string;
  category?: string;
  account_id?: string;
  account_name?: string;
  source?: string;
  virtual?: boolean;
  cheque_id?: string;
};

/** Banka entegrasyonu, ortak ve çek kaynaklı hareketler kendi modülünden yönetilir. */
export function isLockedPayment(p: ContactPayment): boolean {
  return p.source === "bank_sync" || p.source === "partner" || p.source === "cheque" || !!p.virtual;
}

export function isChequePayment(p: ContactPayment): boolean {
  return p.source === "cheque" || !!p.virtual || !!p.cheque_id;
}

export function chequeNumberOfPayment(p: ContactPayment): string {
  const m = String(p.description || "").match(/\b((?:CEK|SNT)-\d{4}-\d+)\b/i);
  return m ? m[1].toUpperCase() : "";
}

export function chequeIdOfPayment(
  p: ContactPayment,
  cheques?: Array<{ id?: string; _id?: string; number?: string }> | null,
): string {
  if (p.cheque_id) return String(p.cheque_id);
  const raw = String(p.id || p._id || "");
  if (raw.startsWith("cheque-virt-")) return raw.slice("cheque-virt-".length);
  const num = chequeNumberOfPayment(p);
  if (num && cheques?.length) {
    const hit = cheques.find((c) => String(c.number || "").toUpperCase() === num);
    if (hit) return String(hit.id || hit._id || "");
  }
  return "";
}

export function lockedPaymentLabel(p: ContactPayment): string {
  if (p.source === "partner") return "Ortak";
  if (p.source === "cheque" || p.virtual) return "Çek";
  return "Banka";
}

export type PaymentEdit = { id: string; amount: string; date: string; description: string; account_id: string };

export function paymentEditFrom(p: ContactPayment): PaymentEdit {
  return {
    id: String(p.id || p._id || ""),
    amount: String(p.amount ?? ""),
    date: String(p.date || todayIso()).slice(0, 10),
    description: p.description || "",
    account_id: p.account_id || "",
  };
}

export function validatePaymentEdit(e: PaymentEdit): string | null {
  if (!(num(e.amount) > 0)) return "Tutar sıfırdan büyük olmalı.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return "Tarih YYYY-AA-GG olmalı.";
  if (!e.account_id) return "Kasa / banka seçin.";
  return null;
}

export function paymentEditPayload(e: PaymentEdit) {
  return {
    amount: num(e.amount),
    date: e.date,
    description: e.description,
    account_id: e.account_id,
  };
}

export const TERM_QUICK_DAYS = [0, 7, 15, 30, 45, 60, 90];

export type TermsDraft = { days: string; late_fee_rate: string; apply_to_open_invoices: boolean };

export function termsPayload(d: TermsDraft) {
  return {
    payment_term_days: Math.max(0, Math.trunc(num(d.days))),
    late_fee_rate: num(d.late_fee_rate),
    apply_to_open_invoices: d.apply_to_open_invoices,
  };
}
