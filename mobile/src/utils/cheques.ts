export type Cheque = {
  id?: string;
  _id?: string;
  number?: string;
  instrument?: string;
  direction?: string;
  status?: string;
  status_label?: string;
  contact_id?: string;
  contact_name?: string;
  amount?: number;
  currency?: string;
  issue_date?: string;
  due_date?: string;
  serial_no?: string;
  bank_name?: string;
  bank_branch?: string;
  account_no?: string;
  drawer_name?: string;
  account_name?: string;
  settled_at?: string;
  endorsed_to_name?: string;
  overdue?: boolean;
  due_soon?: boolean;
  notes?: string;
};

export type ChequeSummary = {
  count?: number;
  open_count?: number;
  portfolio?: number;
  issued_open?: number;
  overdue_received?: number;
  overdue_issued?: number;
  due_this_week?: number;
  bounced?: number;
  received_count?: number;
  issued_count?: number;
};

export const CHEQUE_STATUS_TR: Record<string, string> = {
  open: "Portföy / Açık",
  collected: "Tahsil edildi",
  paid: "Ödendi",
  endorsed: "Ciro edildi",
  bounced: "Karşılıksız",
  cancelled: "İptal",
};

export const CHEQUE_FILTERS = [
  { key: "all", label: "Tümü" },
  { key: "received", label: "Alınan" },
  { key: "issued", label: "Verilen" },
  { key: "open", label: "Açık" },
  { key: "overdue", label: "Vadesi geçen" },
] as const;

export type ChequeFilter = (typeof CHEQUE_FILTERS)[number]["key"];

export function chequeStatusTr(row: Pick<Cheque, "status" | "status_label">): string {
  return row.status_label || CHEQUE_STATUS_TR[String(row.status)] || String(row.status || "—");
}

export function chequeTitle(row: Cheque): string {
  const kind = row.instrument === "promissory" ? "Senet" : "Çek";
  const way = row.direction === "issued" ? "verilen" : "alınan";
  return `${row.number || kind} · ${way} ${kind.toLowerCase()}`;
}

export function chequeTone(row: Cheque): "green" | "red" | "amber" | "slate" {
  if (row.status === "bounced") return "red";
  if (row.status === "collected" || row.status === "paid") return "green";
  if (row.overdue) return "red";
  if (row.due_soon) return "amber";
  return "slate";
}

/** Alınan çek tahsil edilir, verilen çek ödenir; kapalı kayıtta işlem yok. */
export function chequeAction(row: Cheque): { path: "collect" | "pay"; label: string } | null {
  if (row.status !== "open") return null;
  return row.direction === "received"
    ? { path: "collect", label: "Tahsil et" }
    : { path: "pay", label: "Öde" };
}

export const CHEQUE_DIRECTIONS = [
  { key: "received", label: "Alınan (müşteriden)" },
  { key: "issued", label: "Verilen (tedarikçiye)" },
] as const;

export const CHEQUE_INSTRUMENTS = [
  { key: "cheque", label: "Çek" },
  { key: "promissory", label: "Senet" },
] as const;

export type ChequeDraft = {
  direction: "received" | "issued";
  instrument: "cheque" | "promissory";
  contact_id: string;
  contact_name: string;
  amount: string;
  issue_date: string;
  due_date: string;
  serial_no: string;
  bank_name: string;
  bank_branch: string;
  account_no: string;
  drawer_name: string;
  notes: string;
};

export function emptyChequeDraft(today: string): ChequeDraft {
  return {
    direction: "received",
    instrument: "cheque",
    contact_id: "",
    contact_name: "",
    amount: "",
    issue_date: today,
    due_date: today,
    serial_no: "",
    bank_name: "",
    bank_branch: "",
    account_no: "",
    drawer_name: "",
    notes: "",
  };
}

export function applyChequePrefill(
  draft: ChequeDraft,
  params?: {
    contact_id?: string | string[];
    contact_name?: string | string[];
    instrument?: string | string[];
    direction?: string | string[];
    amount?: string | string[];
    notes?: string | string[];
  } | null,
): ChequeDraft {
  const one = (v?: string | string[]) => String(Array.isArray(v) ? v[0] : v || "").trim();
  const instrument = one(params?.instrument);
  const direction = one(params?.direction);
  return {
    ...draft,
    contact_id: one(params?.contact_id) || draft.contact_id,
    contact_name: one(params?.contact_name) || draft.contact_name,
    instrument: instrument === "promissory" ? "promissory" : instrument === "cheque" ? "cheque" : draft.instrument,
    direction: direction === "issued" ? "issued" : direction === "received" ? "received" : draft.direction,
    amount: one(params?.amount) || draft.amount,
    notes: one(params?.notes) || draft.notes,
  };
}

function num(v: string): number {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function validateChequeDraft(d: ChequeDraft): string | null {
  if (!d.contact_id) return "Cari seçin.";
  if (!(num(d.amount) > 0)) return "Tutar sıfırdan büyük olmalı.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.due_date)) return "Vade YYYY-AA-GG olmalı.";
  if (d.issue_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.issue_date)) return "Keşide tarihi YYYY-AA-GG olmalı.";
  if (d.due_date < d.issue_date) return "Vade, keşide tarihinden önce olamaz.";
  return null;
}

export function draftFromCheque(row: Cheque, today: string): ChequeDraft {
  const base = emptyChequeDraft(today);
  return {
    ...base,
    direction: row.direction === "issued" ? "issued" : "received",
    instrument: row.instrument === "promissory" ? "promissory" : "cheque",
    contact_id: String(row.contact_id || ""),
    contact_name: String(row.contact_name || ""),
    amount: row.amount != null ? String(row.amount) : "",
    issue_date: String(row.issue_date || today).slice(0, 10),
    due_date: String(row.due_date || today).slice(0, 10),
    serial_no: String(row.serial_no || ""),
    bank_name: String(row.bank_name || ""),
    bank_branch: String(row.bank_branch || ""),
    account_no: String(row.account_no || ""),
    drawer_name: String(row.drawer_name || ""),
    notes: String(row.notes || ""),
  };
}

export function chequeLedgerLocked(row: Pick<Cheque, "status"> | null | undefined): boolean {
  return !!row && row.status !== "open";
}

export function chequeReceiptKind(row: Pick<Cheque, "direction">): "collection" | "payment" {
  return row.direction === "issued" ? "payment" : "collection";
}

export function chequeReceiptLabel(row: Pick<Cheque, "direction">): string {
  return chequeReceiptKind(row) === "collection" ? "Tahsilat makbuzu" : "Tediye makbuzu";
}

export function chequePayload(d: ChequeDraft, companyId: string) {
  return {
    company_id: companyId,
    direction: d.direction,
    instrument: d.instrument,
    contact_id: d.contact_id,
    amount: num(d.amount),
    issue_date: d.issue_date,
    due_date: d.due_date,
    serial_no: d.serial_no.trim(),
    bank_name: d.bank_name.trim(),
    bank_branch: d.bank_branch.trim(),
    account_no: d.account_no.trim(),
    // Boşsa sunucu cari adını keşideci kabul ediyor.
    drawer_name: d.drawer_name.trim(),
    notes: d.notes.trim(),
  };
}

export function filterCheques(rows: Cheque[], filter: ChequeFilter, query: string): Cheque[] {
  const s = query.trim().toLowerCase();
  return (rows || []).filter((r) => {
    if (filter === "received" && r.direction !== "received") return false;
    if (filter === "issued" && r.direction !== "issued") return false;
    if (filter === "open" && r.status !== "open") return false;
    if (filter === "overdue" && !r.overdue) return false;
    if (!s) return true;
    return [r.number, r.serial_no, r.contact_name, r.bank_name, r.drawer_name]
      .some((v) => String(v || "").toLowerCase().includes(s));
  });
}
