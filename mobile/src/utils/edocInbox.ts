import { fmtDate, fmtMoney, idOf } from "./money";

export type EdocSupplier = {
  name?: string;
  tax_id?: string;
  tax_office?: string;
  address?: string;
};

export type EdocLine = {
  name?: string;
  sku?: string;
  barcode?: string;
  quantity?: number;
  unit_price?: number;
  total?: number;
  product_id?: string;
  product_name?: string;
};

export type EdocInboxItem = {
  id?: string;
  _id?: string;
  status?: string;
  kind?: string;
  number?: string;
  issue_date?: string;
  grand_total?: number;
  supplier?: EdocSupplier;
  contact_id?: string;
  contact_name?: string;
  lines?: EdocLine[];
  matched_lines?: number;
  invoice_id?: string;
  source?: string;
  uuid?: string;
  ettn?: string;
  profile?: string;
  commercial_response?: string;
};

export type EdocInboxCounts = { pending?: number; approved?: number; rejected?: number; ignored?: number };

export type EdocInboxList = {
  items?: EdocInboxItem[];
  counts?: EdocInboxCounts;
  blank?: number;
};

export const EDOC_FILTERS = [
  { key: "pending", label: "Bekleyen" },
  { key: "rejected", label: "Reddedilen" },
  { key: "ignored", label: "Dikkate alınmayan" },
] as const;

export function edocStatusTr(status?: string | null): string {
  if (status === "approved") return "İçeri alındı";
  if (status === "rejected") return "Reddedildi";
  if (status === "ignored") return "Dikkate alınmadı";
  if (status === "pending") return "Bekliyor";
  return status || "—";
}

export function edocKindTr(kind?: string | null): string {
  return kind === "dispatch" ? "e-İrsaliye" : "e-Fatura";
}

export function edocRowTitle(doc: EdocInboxItem): string {
  return doc.supplier?.name || doc.contact_name || "Tedarikçi ?";
}

export function edocRowSubtitle(doc: EdocInboxItem): string {
  const lines = doc.lines || [];
  const matched = Number(doc.matched_lines || 0);
  const commercial = commercialBadge(doc);
  return [
    edocKindTr(doc.kind),
    doc.number || "—",
    fmtDate(doc.issue_date),
    `${matched}/${lines.length} satır`,
    doc.contact_id ? "" : "tedarikçi yok",
    commercial?.label || "",
  ].filter(Boolean).join(" · ");
}

export function edocRowRight(doc: EdocInboxItem): string {
  return fmtMoney(doc.grand_total);
}

/** Web isProcessable: bekleyen ve okunabilir (tedarikçi / kalem / tutar). */
export function isEdocProcessable(doc: EdocInboxItem | null | undefined): boolean {
  if (!doc || doc.status !== "pending") return false;
  const lines = doc.lines || [];
  const supplier = doc.supplier || {};
  const blank = !lines.length && !supplier.name && !supplier.tax_id && !Number(doc.grand_total);
  return !blank;
}

export function pendingEdocCount(counts?: EdocInboxCounts | null): number {
  return Math.max(0, Number(counts?.pending) || 0);
}

export function edocId(doc: EdocInboxItem): string {
  return idOf(doc);
}

export const COMMERCIAL_RESPONSE_DAYS = 8;
export const GIB_ACCEPT_CONFIRM = "Bu yanıt GİB'e gider, geri alınamaz";
export const GIB_RED_OPTION_LABEL = "GİB'e RED yanıtı gönder";
export const DISPATCH_PROCESS_LABEL = "İrsaliyeyi teslim al (stok girişi)";
export const DISPATCH_PROCESS_SUCCESS = "Gelen irsaliye alındı";

export function istanbulDateISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function commercialElapsedDays(issueDate?: string | null, now = new Date()): number | null {
  const issued = String(issueDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issued)) return null;
  const today = istanbulDateISO(now);
  const a = Date.parse(`${issued}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function isCommercialInvoice(doc?: EdocInboxItem | null): boolean {
  if (!doc || doc.kind === "dispatch") return false;
  return String(doc.profile || "").toUpperCase().includes("TICARI");
}

export function commercialWindowOpen(doc?: EdocInboxItem | null, now = new Date()): boolean {
  if (!isCommercialInvoice(doc)) return false;
  const elapsed = commercialElapsedDays(doc?.issue_date, now);
  return elapsed != null && elapsed <= COMMERCIAL_RESPONSE_DAYS;
}

export function canSendCommercialResponse(doc?: EdocInboxItem | null, now = new Date()): boolean {
  if (!commercialWindowOpen(doc, now)) return false;
  const resp = String(doc?.commercial_response || "");
  return resp !== "accepted" && resp !== "rejected" && resp !== "sending";
}

export function commercialBadge(doc?: EdocInboxItem | null, now = new Date()): { label: string; tone: "wait" | "ok" | "bad" } | null {
  if (!doc || doc.kind === "dispatch") return null;
  const resp = String(doc.commercial_response || "");
  if (resp === "accepted") return { label: "Kabul edildi", tone: "ok" };
  if (resp === "rejected") return { label: "Reddedildi", tone: "bad" };
  if (!isCommercialInvoice(doc)) return null;
  const elapsed = commercialElapsedDays(doc.issue_date, now);
  if (elapsed == null || elapsed > COMMERCIAL_RESPONSE_DAYS) return null;
  const left = Math.max(0, COMMERCIAL_RESPONSE_DAYS - Math.max(0, elapsed));
  return { label: `Yanıt bekliyor (${left} gün)`, tone: "wait" };
}

export function inboxProcessLabel(doc?: EdocInboxItem | null): string {
  return doc?.kind === "dispatch" ? DISPATCH_PROCESS_LABEL : "İçeri al";
}

export function inboxProcessSuccess(doc?: EdocInboxItem | null): string {
  return doc?.kind === "dispatch" ? DISPATCH_PROCESS_SUCCESS : "Belge içeri alındı.";
}
