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
};

export type EdocInboxCounts = { pending?: number; approved?: number; rejected?: number };

export type EdocInboxList = {
  items?: EdocInboxItem[];
  counts?: EdocInboxCounts;
  blank?: number;
};

export const EDOC_FILTERS = [
  { key: "pending", label: "Bekleyen" },
  { key: "approved", label: "İçeri alınan" },
  { key: "rejected", label: "Reddedilen" },
  { key: "", label: "Tümü" },
] as const;

export function edocStatusTr(status?: string | null): string {
  if (status === "approved") return "İçeri alındı";
  if (status === "rejected") return "Reddedildi";
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
  return [
    edocKindTr(doc.kind),
    doc.number || "—",
    fmtDate(doc.issue_date),
    `${matched}/${lines.length} satır`,
    doc.contact_id ? "" : "tedarikçi yok",
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
