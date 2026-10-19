import type { Invoice } from "../types";
import { compareInvoiceActivity } from "./invoiceSortStamp";
import { eTypeTr } from "./labels";
import { fmtDate, fmtMoney, idOf } from "./money";

/** Sunucu sayfası. Web 50 kullanır; mobil liste 30. */
export const INVOICE_PAGE_SIZE = 30;
export const INVOICE_SEARCH_DEBOUNCE_MS = 300;

export const INVOICE_SEGMENTS = [
  { key: "sales", label: "Satış" },
  { key: "purchase", label: "Alış" },
  { key: "dispatch", label: "İrsaliye" },
  { key: "all", label: "Tümü" },
] as const;

export type InvoiceSegment = (typeof INVOICE_SEGMENTS)[number]["key"];

export const INVOICE_CHIPS = [
  { key: "all", label: "Tümü" },
  { key: "unpaid", label: "Ödenmedi" },
  { key: "overdue", label: "Vadesi geçti" },
  { key: "partially_paid", label: "Kısmi" },
  { key: "outgoing_e", label: "Giden e" },
  { key: "incoming_e", label: "Gelen e" },
  { key: "export", label: "İhracat" },
  { key: "import", label: "İthalat" },
  { key: "proforma", label: "Proforma" },
  { key: "return", label: "İade" },
] as const;

export type InvoiceChip = (typeof INVOICE_CHIPS)[number]["key"];

export type InvoiceListSummary = {
  count?: number | null;
  total_amount?: number | null;
  draft_count?: number | null;
  approved_count?: number | null;
};

export type InvoiceListPage = {
  items?: Invoice[];
  total?: number;
  page?: number;
  page_size?: number;
  has_more?: boolean;
  summary?: InvoiceListSummary | null;
};

const TAB_OVERRIDE: Partial<Record<InvoiceChip, string>> = {
  outgoing_e: "outgoing_gib",
  incoming_e: "incoming",
  export: "export",
  import: "import",
};

const PAY_CHIP: Partial<Record<InvoiceChip, string>> = {
  unpaid: "unpaid",
  overdue: "overdue",
  partially_paid: "partially_paid",
};

export type InvoiceListRequest =
  | {
      kind: "server";
      query: {
        company_id: string;
        tab: string;
        pay: string;
        page: number;
        page_size: number;
        q?: string;
      };
    }
  | {
      kind: "legacy";
      query: {
        company_id: string;
        type: "dispatch" | "proforma" | "return";
      };
    };

/**
 * Satış / Alış / Tümü ve sunucunun kabul ettiği chip'ler `/invoices/page`.
 * İrsaliye, Proforma ve İade eski `/invoices?type=` çağrısında kalır.
 * Giden e / Gelen e / İhracat / İthalat sekmenin tab değerini ezer.
 */
export function resolveInvoiceList(input: {
  companyId: string;
  segment: InvoiceSegment;
  chip: InvoiceChip;
  q: string;
  page: number;
}): InvoiceListRequest {
  const page = input.page >= 1 ? input.page : 1;
  if (input.chip === "proforma" || input.chip === "return") {
    return { kind: "legacy", query: { company_id: input.companyId, type: input.chip } };
  }
  const override = TAB_OVERRIDE[input.chip];
  if (!override && input.segment === "dispatch") {
    return { kind: "legacy", query: { company_id: input.companyId, type: "dispatch" } };
  }
  const tab = override || (input.segment === "dispatch" ? "all" : input.segment);
  const pay = PAY_CHIP[input.chip] || "all";
  const q = input.q.trim();
  return {
    kind: "server",
    query: {
      company_id: input.companyId,
      tab,
      pay,
      page,
      page_size: INVOICE_PAGE_SIZE,
      ...(q ? { q } : {}),
    },
  };
}

/** Yeni fatura türü: Giden/Gelen e bugünkü gibi `all`, diğer filtreler kendi anahtarı. */
export function invoiceCreateType(segment: InvoiceSegment, chip: InvoiceChip): string {
  if (chip === "proforma" || chip === "return" || chip === "export" || chip === "import") return chip;
  if (chip === "outgoing_e" || chip === "incoming_e") return "all";
  return segment;
}

export function appendUniqueInvoices(prev: Invoice[], next: Invoice[]): Invoice[] {
  const seen = new Set(prev.map((row) => idOf(row)).filter(Boolean));
  const out = prev.slice();
  for (const row of next || []) {
    const id = idOf(row);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

export function filterInvoicesLocally(rows: Invoice[], q: string): Invoice[] {
  const s = q.trim().toLowerCase();
  let list = rows.slice();
  if (s) {
    list = list.filter((inv) => [inv.invoice_number, inv.contact_name, inv.gib_status, inv.gib_tracking_id]
      .some((value) => String(value || "").toLowerCase().includes(s)));
  }
  list.sort((a, b) => compareInvoiceActivity(a, b, "desc"));
  return list;
}

export function localInvoiceSummary(rows: Invoice[]): InvoiceListSummary & { currency: string } {
  let total = 0;
  let drafts = 0;
  const currencies = new Set<string>();
  for (const row of rows) {
    const amount = Number(row.grand_total);
    if (Number.isFinite(amount)) total += amount;
    if (row.status === "draft") drafts += 1;
    currencies.add(row.currency || "TRY");
  }
  const currency = currencies.size === 1 ? [...currencies][0] : "TRY";
  return {
    count: rows.length,
    total_amount: Math.round(total * 100) / 100,
    draft_count: drafts,
    currency,
  };
}

function missingNumber(value: number | null | undefined): boolean {
  if (value == null) return true;
  const n = Number(value);
  return !Number.isFinite(n);
}

export function summaryCountText(value: number | null | undefined): string {
  if (missingNumber(value)) return "—";
  return String(value);
}

export function summaryMoneyText(value: number | null | undefined, currency = "TRY"): string {
  if (missingNumber(value)) return "—";
  return fmtMoney(value, currency);
}

export type InvoiceListBadge = { label: "Taslak" | "Kabul" | "Gönderildi" | "Red"; bg: string; fg: string };

/** Kart rozeti: taslak amber, kabul yeşil, gönderildi mavi, red kırmızı. */
export function invoiceListBadge(inv: Invoice): InvoiceListBadge | null {
  if (String(inv.status || "") === "draft") {
    return { label: "Taslak", bg: "#FFFBEB", fg: "#B45309" };
  }
  const gs = String(inv.gib_status || "");
  const folded = gs.toLocaleLowerCase("tr-TR");
  const state = String(inv.einvoice_state || "").toLowerCase();
  const resp = String(inv.gib_response || "").toLowerCase();
  const rejected = resp === "rejected"
    || state === "error"
    || /reddedildi/.test(folded)
    || /(^|[^a-zçğıöşü])red([^a-zçğıöşü]|$)/i.test(folded);
  if (rejected) return { label: "Red", bg: "#FFF1F2", fg: "#E11D48" };
  const accepted = state === "accepted"
    || resp === "accepted"
    || String(inv.gib_status_code || "") === "1300"
    || /kabul|onayland|tamamland/.test(folded);
  if (accepted) return { label: "Kabul", bg: "#D1FAE5", fg: "#047857" };
  const sent = state === "sent"
    || state === "queued"
    || /gönderildi|gonderildi|iletildi/.test(folded);
  if (sent) return { label: "Gönderildi", bg: "#EFF6FF", fg: "#1D4ED8" };
  return null;
}

export function invoicePaymentMark(inv: Invoice): { label: string; color: string } {
  const pay = String(inv.payment_status || "");
  if (pay === "paid") return { label: "Ödendi", color: "#059669" };
  if (pay === "partially_paid" || pay === "partial") return { label: "Kısmi", color: "#B45309" };
  if (pay === "unpaid" || pay === "overdue") return { label: "Ödenmedi", color: "#E11D48" };
  return { label: "—", color: "#64748B" };
}

export function invoiceCardNumber(inv: Invoice): string {
  return String(inv.invoice_number || inv.gib_invoice_id || "Fatura");
}

export function invoiceCardMeta(inv: Invoice): { eType: string; pay: { label: string; color: string }; due: string } {
  return {
    eType: eTypeTr(inv.e_type),
    pay: invoicePaymentMark(inv),
    due: fmtDate(inv.due_date),
  };
}
