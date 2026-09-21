import type { Invoice } from "../types";
import {
  computeLine,
  documentLineTotals,
  emptyLine,
  hydrateLine,
  type InvoiceLine,
} from "./documentLines";
import { eTypeTr, invoiceTypeTr, statusTr } from "./labels";
import { fmtDate, idOf, todayIso } from "./money";

export type GdMode = "percent" | "amount";

export type InvoiceDraft = {
  invoice_type: string;
  e_type: string;
  status: string;
  withholding_rate: number;
  withholding_code: string;
  price_mode: string;
  contact_id: string;
  contact_name: string;
  issue_date: string;
  due_date: string;
  items: InvoiceLine[];
  notes: string;
  general_discount_rate: number;
  general_discount_amount: number;
  gdMode: GdMode;
  currency: string;
  fx_rate: number;
  fx_source: string;
  trade_kind: string;
  incoterm: string;
  country: string;
  customs_office: string;
  project_id: string;
  project_number: string;
  regime_code: string;
  declaration_no: string;
  declaration_date: string;
  dab_no: string;
  bl_awb: string;
  certificate: string;
  trade_file_number: string;
};

export const INVOICE_TYPES = [
  { key: "sales", label: "Satış Faturası" },
  { key: "purchase", label: "Alış Faturası" },
  { key: "proforma", label: "Proforma Fatura" },
  { key: "return", label: "İade Faturası" },
  { key: "dispatch", label: "İrsaliye (Sevk)" },
] as const;

export const E_TYPES = [
  { key: "e_invoice", label: "E-Fatura" },
  { key: "e_archive", label: "E-Arşiv" },
  { key: "e_export", label: "e-İhracat" },
  { key: "e_dispatch", label: "E-İrsaliye" },
  { key: "paper", label: "Kağıt Fatura" },
] as const;

export const TRADE_KINDS = [
  { key: "", label: "Yurt içi" },
  { key: "export", label: "İhracat" },
  { key: "import", label: "İthalat" },
] as const;

export const INCOTERMS = ["", "EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

export const CURRENCIES = ["TRY", "USD", "EUR", "GBP"];

export const WITHHOLDING: { value: string; rate: number; code: string; label: string }[] = [
  { value: "", rate: 0, code: "", label: "Tevkifat yok" },
  { value: "0.2|601", rate: 0.2, code: "601", label: "2/10 – Yapım işleri (601)" },
  { value: "0.3|619", rate: 0.3, code: "619", label: "3/10 – Makine/teçhizat bakım (619)" },
  { value: "0.5|602", rate: 0.5, code: "602", label: "5/10 – Etüt, plan-proje (602)" },
  { value: "0.5|603", rate: 0.5, code: "603", label: "5/10 – Makine bakım (603)" },
  { value: "0.5|604", rate: 0.5, code: "604", label: "5/10 – Yemek servisi (604)" },
  { value: "0.7|606", rate: 0.7, code: "606", label: "7/10 – Temizlik, bahçe (606)" },
  { value: "0.7|608", rate: 0.7, code: "608", label: "7/10 – Servis taşımacılığı (608)" },
  { value: "0.9|609", rate: 0.9, code: "609", label: "9/10 – İşgücü temini (609)" },
  { value: "0.9|610", rate: 0.9, code: "610", label: "9/10 – Yapı denetim (610)" },
  { value: "1|611", rate: 1, code: "611", label: "10/10 – Fason tekstil (611)" },
  { value: "0.5|615", rate: 0.5, code: "615", label: "5/10 – Reklam hizmetleri (615)" },
];

/** Uzun tevkifat listesini orana göre grupla; "2/10 – " öneki grup başlığına taşınır. */
export function withholdingSelectGroups(): { label: string; options: { value: string; label: string }[] }[] {
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  const none = WITHHOLDING.find((w) => !w.value);
  if (none) groups.push({ label: "Tevkifat", options: [{ value: "", label: none.label }] });
  const byRate = new Map<number, { value: string; label: string }[]>();
  for (const w of WITHHOLDING) {
    if (!w.value) continue;
    const options = byRate.get(w.rate) || [];
    options.push({ value: w.value, label: w.label.replace(/^\s*\d+\/10\s*[–-]\s*/, "") });
    byRate.set(w.rate, options);
  }
  for (const rate of [...byRate.keys()].sort((a, b) => a - b)) {
    groups.push({ label: `${Math.round(rate * 10)}/10 tevkifat`, options: byRate.get(rate) || [] });
  }
  return groups;
}

export const INVOICE_FILTERS = [
  { key: "all", label: "Tümü" },
  { key: "sales", label: "Satış" },
  { key: "purchase", label: "Alış" },
  { key: "proforma", label: "Proforma" },
  { key: "return", label: "İade" },
  { key: "export", label: "İhracat" },
  { key: "import", label: "İthalat" },
  { key: "dispatch", label: "İrsaliye" },
];

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function plusDaysIso(issue: string, days: number): string {
  const d = new Date(`${issue}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function emptyInvoiceDraft(): InvoiceDraft {
  const issue = todayIso();
  return {
    invoice_type: "sales",
    e_type: "paper",
    status: "draft",
    withholding_rate: 0,
    withholding_code: "",
    price_mode: "excl",
    contact_id: "",
    contact_name: "",
    issue_date: issue,
    due_date: plusDaysIso(issue, 15),
    items: [computeLine(emptyLine())],
    notes: "Teşekkür ederiz.",
    general_discount_rate: 0,
    general_discount_amount: 0,
    gdMode: "percent",
    currency: "TRY",
    fx_rate: 1,
    fx_source: "try",
    trade_kind: "",
    incoterm: "",
    country: "",
    customs_office: "",
    project_id: "",
    project_number: "",
    regime_code: "",
    declaration_no: "",
    declaration_date: "",
    dab_no: "",
    bl_awb: "",
    certificate: "",
    trade_file_number: "",
  };
}

export function draftFromInvoice(inv: Invoice): InvoiceDraft {
  const base = emptyInvoiceDraft();
  return {
    ...base,
    invoice_type: inv.invoice_type || "sales",
    e_type: inv.e_type || "paper",
    status: "draft",
    contact_id: inv.contact_id || "",
    contact_name: inv.contact_name || "",
    issue_date: String(inv.issue_date || base.issue_date).slice(0, 10),
    due_date: String(inv.due_date || base.due_date).slice(0, 10),
    notes: inv.notes || "",
    withholding_rate: num(inv.withholding_rate),
    withholding_code: inv.withholding_code || "",
    price_mode: inv.price_mode || "excl",
    general_discount_rate: num(inv.general_discount_rate),
    general_discount_amount: num(inv.general_discount_amount),
    gdMode: inv.general_discount_rate ? "percent" : "amount",
    currency: inv.currency || "TRY",
    fx_rate: num(inv.fx_rate, 1) || 1,
    fx_source: inv.fx_source || "try",
    trade_kind: inv.trade_kind || "",
    incoterm: inv.incoterm || "",
    country: inv.country || "",
    customs_office: inv.customs_office || "",
    project_id: inv.project_id || "",
    project_number: inv.project_number || "",
    regime_code: inv.regime_code || "",
    declaration_no: inv.declaration_no || "",
    declaration_date: String(inv.declaration_date || "").slice(0, 10),
    dab_no: inv.dab_no || "",
    bl_awb: inv.bl_awb || "",
    certificate: inv.certificate || "",
    trade_file_number: inv.trade_file_number || "",
    items: (inv.items || []).length
      ? (inv.items || []).map((it) => hydrateLine(it as Partial<InvoiceLine>))
      : [computeLine(emptyLine())],
  };
}

export type InvoiceTotals = {
  itemsSum: number;
  lineDiscount: number;
  gd: number;
  subtotal: number;
  vat: number;
  withholding: number;
  grandTotal: number;
};

export function invoiceTotals(draft: InvoiceDraft): InvoiceTotals {
  const { subtotal: itemsNet, lineDiscount } = documentLineTotals(draft.items);
  const itemsSum = itemsNet;
  const gdRaw =
    draft.gdMode === "percent"
      ? (itemsSum * num(draft.general_discount_rate)) / 100
      : num(draft.general_discount_amount);
  const gd = Math.min(Math.max(gdRaw, 0), itemsSum);
  const factor = itemsSum ? (itemsSum - gd) / itemsSum : 1;
  const subtotal = itemsSum - gd;
  const vat = draft.items.reduce(
    (sum, item) => sum + num(computeLine(item).total) * factor * (num(item.vat_rate, 20) / 100),
    0,
  );
  const withholding = vat * num(draft.withholding_rate);
  return {
    itemsSum: itemsSum + lineDiscount,
    lineDiscount,
    gd,
    subtotal,
    vat,
    withholding,
    grandTotal: subtotal + vat - withholding,
  };
}

export function validateInvoiceDraft(draft: InvoiceDraft): string | null {
  if (!draft.contact_id) return "Lütfen bir cari seçiniz.";
  if (!draft.items.length) return "En az bir fatura kalemi gerekli.";
  if (draft.items.some((it) => !(it.name || it.product_name))) {
    return "Her satır için ürün seçin ya da hizmet adı yazın.";
  }
  return null;
}

export function invoicePayload(draft: InvoiceDraft, companyId: string) {
  const t = invoiceTotals(draft);
  const status = draft.invoice_type === "dispatch" ? "draft" : draft.status || "draft";
  return {
    company_id: companyId,
    invoice_type: draft.invoice_type,
    e_type: draft.invoice_type === "dispatch" ? "e_dispatch" : draft.e_type,
    status,
    gib_status: status === "draft" ? "Taslak" : "Onaylandı",
    contact_id: draft.contact_id,
    contact_name: draft.contact_name,
    issue_date: draft.issue_date,
    due_date: draft.due_date,
    notes: draft.notes,
    price_mode: "excl",
    withholding_rate: num(draft.withholding_rate),
    withholding_code: draft.withholding_code || null,
    general_discount_amount: t.gd,
    general_discount_rate: draft.gdMode === "percent" ? num(draft.general_discount_rate) : 0,
    currency: draft.currency || "TRY",
    fx_rate: num(draft.fx_rate, 1) || 1,
    fx_source: draft.fx_source || "try",
    trade_kind: draft.trade_kind || "",
    incoterm: draft.incoterm || "",
    country: draft.country || "",
    customs_office: draft.customs_office || "",
    project_id: draft.project_id || "",
    project_number: draft.project_number || "",
    regime_code: draft.regime_code || "",
    declaration_no: draft.declaration_no || "",
    declaration_date: draft.declaration_date || "",
    dab_no: draft.dab_no || "",
    bl_awb: draft.bl_awb || "",
    certificate: draft.certificate || "",
    trade_file_number: draft.trade_file_number || "",
    items: draft.items.map((it) => {
      const line = computeLine(it);
      return {
        ...line,
        unit_price: Number(Number(line.unit_price).toFixed(4)),
        product_id: it.is_service ? "" : it.product_id,
        name: line.name || line.product_name,
      };
    }),
  };
}

export function invoiceUpdateBody(draft: InvoiceDraft) {
  const { company_id, gib_status, ...upd } = invoicePayload(draft, "");
  void company_id;
  void gib_status;
  return upd;
}

export function applyTradeKind(draft: InvoiceDraft, tradeKind: string): InvoiceDraft {
  const exportMode = tradeKind === "export";
  const invoice_type =
    tradeKind === "import"
      ? "purchase"
      : draft.invoice_type === "purchase" && tradeKind === "export"
        ? "sales"
        : draft.invoice_type;
  const e_type = exportMode
    ? draft.e_type === "paper"
      ? "paper"
      : "e_export"
    : draft.e_type === "e_export"
      ? "e_archive"
      : draft.e_type;
  return {
    ...draft,
    trade_kind: tradeKind,
    invoice_type,
    e_type,
    items: exportMode ? draft.items.map((it) => computeLine({ ...it, vat_rate: 0 }, "vat_rate")) : draft.items,
  };
}

export function eTypeForContact(draft: InvoiceDraft, isEInvoiceUser?: boolean): string {
  if (draft.invoice_type !== "sales") return draft.e_type;
  if (["paper", "e_export", "e_dispatch"].includes(draft.e_type)) return draft.e_type;
  return isEInvoiceUser ? "e_invoice" : "e_archive";
}

export function createInvoiceButtonLabel(filterType: string): string {
  if (filterType === "dispatch") return "Yeni İrsaliye";
  if (filterType === "purchase") return "Alış Faturası Gir";
  return "Yeni Fatura Kes";
}

/** Liste satırı: önce cari, sonra tür / belge / durum / tarih. */
export function invoiceListSubtitle(inv: {
  contact_name?: string;
  invoice_type?: string;
  e_type?: string;
  status?: string;
  issue_date?: string;
}): string {
  const cari = (inv.contact_name || "").trim() || "Cari yok";
  return [cari, invoiceTypeTr(inv.invoice_type), eTypeTr(inv.e_type), statusTr(inv.status), fmtDate(inv.issue_date)]
    .filter(Boolean)
    .join(" · ");
}

export function defaultInvoiceTypeForFilter(filterType: string): Partial<InvoiceDraft> {
  if (filterType === "dispatch") return { invoice_type: "dispatch", e_type: "e_dispatch" };
  if (filterType === "purchase") return { invoice_type: "purchase", e_type: "paper" };
  if (filterType === "proforma") return { invoice_type: "proforma", e_type: "paper" };
  if (filterType === "return") return { invoice_type: "return", e_type: "paper" };
  if (filterType === "export") return applyTradeKind(emptyInvoiceDraft(), "export");
  if (filterType === "import") return applyTradeKind(emptyInvoiceDraft(), "import");
  return {};
}

const GIB_ISSUED = new Set([
  "Başarıyla İletildi (GİB Onaylı)",
  "Kağıt Fatura (Matbu)",
  "n11 Faturam ile GİB'e iletildi",
  "e-İhracat GİB'e iletildi",
  "GİB'e Gönderildi",
  "Kuyrukta",
]);

export function isGibIssued(inv?: Invoice | null): boolean {
  if (!inv) return false;
  if (inv.einvoice_state === "sent" || inv.einvoice_state === "queued") return true;
  if (inv.gib_tracking_id) return true;
  const gs = String(inv.gib_status || "");
  if (GIB_ISSUED.has(gs)) return true;
  return /ileti|matbu|n11 faturam|e-ihracat.*ileti/i.test(gs) && !/onaylandı$/i.test(gs);
}

export function canDeleteInvoice(inv?: Invoice | null): boolean {
  if (!inv) return false;
  if (inv.status === "draft") return true;
  if (inv.e_type !== "paper") return false;
  if (num(inv.paid_amount) > 0.01) return false;
  if (["paid", "partially_paid", "partial"].includes(String(inv.payment_status || ""))) return false;
  return true;
}

export function isIncomingPurchaseInvoice(inv?: Invoice | null): boolean {
  if (!inv || inv.invoice_type !== "purchase") return false;
  if (inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id) return true;
  if (inv.e_type === "e_invoice") return true;
  return /gelen|received/i.test(String(inv.gib_status || ""));
}

export function incomingPurchaseResponse(inv?: Invoice | null): "accepted" | "rejected" | "pending" {
  const r = String(inv?.gib_response || "").toLowerCase();
  if (r === "accepted" || r === "rejected") return r;
  const gs = String(inv?.gib_status || "");
  if (/reddedildi/i.test(gs)) return "rejected";
  if (/gelen/i.test(gs) && /onaylandı/i.test(gs)) return "accepted";
  return "pending";
}

export function isIncomingPurchasePending(inv?: Invoice | null): boolean {
  if (!isIncomingPurchaseInvoice(inv)) return false;
  if (inv?.status === "cancelled") return false;
  return incomingPurchaseResponse(inv) === "pending";
}

export function remainingAmount(inv?: Invoice | null): number {
  return Math.max(0, num(inv?.grand_total) - num(inv?.paid_amount));
}

export function withholdingValue(draft: InvoiceDraft): string {
  if (!draft.withholding_rate) return "";
  return `${draft.withholding_rate}|${draft.withholding_code || ""}`;
}

export function parseWithholding(value: string): { withholding_rate: number; withholding_code: string } {
  if (!value) return { withholding_rate: 0, withholding_code: "" };
  const [r, c] = value.split("|");
  return { withholding_rate: num(r), withholding_code: c || "" };
}

export function invoiceProjectSelectGroups(
  projects: { id?: string; _id?: string; name?: string; project_number?: string }[],
) {
  return [{
    label: "Projeler",
    options: (projects || []).map((p) => ({
      value: idOf(p),
      label: [p.project_number, p.name].filter(Boolean).join(" · ") || "Proje",
    })),
  }];
}

